"""Turn incoming mail into CRM events. Nothing here can send email.

For each new message in the mailbox:
  * ours, or an out-of-office auto-reply  -> ignored
  * a delivery failure                    -> noted on the contact; a permanent one marks the
                                             contact do-not-contact (stop mailing dead addresses)
  * a reply from a prospect               -> logged on their timeline and flagged unread
The status is left for a person to confirm.
"""

import re
from dataclasses import asdict, dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.base import utcnow
from app.models import Contact, Interaction, MailboxState
from app.models.enums import Channel, InteractionSource, InteractionType
from app.providers.imap import IncomingMessage, MailboxError, MailboxReader

_FINAL_RECIPIENT = re.compile(
    r"(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s<>;]+@[^\s<>;]+)>?", re.I
)
_STATUS = re.compile(r"^Status:\s*(\d)\.\d+\.\d+", re.I | re.M)
_ANY_EMAIL = re.compile(r"[\w.+'-]+@[\w-]+(?:\.[\w-]+)+")


@dataclass
class SyncResult:
    fetched: int = 0
    replies: int = 0
    bounces: int = 0
    ignored: int = 0
    unmatched: int = 0  # real mail from people we haven't emailed; left alone

    def as_dict(self) -> dict[str, int]:
        return asdict(self)


def _sent_to(db: Session, contact_id: int) -> Interaction | None:
    return db.scalars(
        select(Interaction)
        .where(Interaction.contact_id == contact_id, Interaction.type == InteractionType.EMAIL_SENT)
        .order_by(Interaction.occurred_at.desc())
    ).first()


def _contact_by_email(db: Session, email: str) -> Contact | None:
    return db.scalars(select(Contact).where(func.lower(Contact.email) == email.lower())).first()


def _match_reply(db: Session, msg: IncomingMessage) -> tuple[Contact, bool] | None:
    """Find the person this answers. Returns (contact, matched_by_thread)."""
    if msg.in_reply_to:
        sent = db.scalars(
            select(Interaction)
            .where(
                Interaction.type == InteractionType.EMAIL_SENT,
                Interaction.message_id.in_(msg.in_reply_to),
            )
            .order_by(Interaction.occurred_at.desc())
        ).first()
        if sent:
            original = db.get(Contact, sent.contact_id)
            # A colleague may answer on their behalf: credit whoever's address it came from.
            colleague = next(
                (c for c in original.company.contacts if (c.email or "").lower() == msg.from_email),
                None,
            )
            return colleague or original, True
    # Fallback (e.g. the mail provider rewrote our Message-ID): the sender is a contact we emailed.
    contact = _contact_by_email(db, msg.from_email)
    if contact and _sent_to(db, contact.id):
        return contact, False
    return None


def _handle_bounce(db: Session, msg: IncomingMessage) -> bool:
    text = msg.raw_text or msg.body
    failed = {m.lower() for m in _FINAL_RECIPIENT.findall(text)} or {
        e.lower() for e in _ANY_EMAIL.findall(text)
    }
    contact = next((c for e in failed if (c := _contact_by_email(db, e))), None)
    if contact is None or _sent_to(db, contact.id) is None:
        return False
    status = _STATUS.search(text)
    permanent = bool(status and status.group(1) == "5")
    if permanent:
        contact.do_not_contact = True  # safe direction: it only ever stops us mailing them
    db.add(
        Interaction(
            contact_id=contact.id,
            type=InteractionType.NOTE,
            source=InteractionSource.AUTO,
            subject=f"Delivery failed: {contact.email}",
            content=(
                "The email bounced"
                + (" permanently; contact marked do-not-contact." if permanent else " (temporary).")
            ),
            message_id=msg.message_id,
            occurred_at=msg.sent_at,
        )
    )
    return True


def _handle_reply(db: Session, msg: IncomingMessage, own: set[str]) -> str:
    """Returns 'reply', 'unmatched' or 'ignored'."""
    if msg.from_email in own or msg.is_auto_reply:
        return "ignored"
    matched = _match_reply(db, msg)
    if matched is None:
        return "unmatched"
    contact, by_thread = matched
    note = "" if by_thread else "\n\n(Matched by the sender's address, not the email thread.)"
    db.add(
        Interaction(
            contact_id=contact.id,
            type=InteractionType.EMAIL_REPLY,
            channel=Channel.EMAIL,
            source=InteractionSource.AUTO,
            subject=msg.subject,
            content=(msg.body or "(no text)") + note,
            message_id=msg.message_id,
            occurred_at=msg.sent_at,
        )
    )
    # Flag it for a person. The status is not changed automatically: they confirm "Responded".
    contact.reply_unread = True
    if contact.last_contacted_at is None or msg.sent_at > contact.last_contacted_at:
        contact.last_contacted_at = msg.sent_at
    return "reply"


def sync_replies(db: Session, reader: MailboxReader, settings: Settings) -> SyncResult:
    state = db.get(MailboxState, settings.imap_folder)
    if state is None:
        state = MailboxState(folder=settings.imap_folder, last_uid=0)
        db.add(state)
    result = SyncResult()
    try:
        fetched = reader.fetch(
            uidvalidity=state.uidvalidity,
            last_uid=state.last_uid,
            lookback_days=settings.imap_lookback_days,
        )
    except MailboxError as exc:
        state.last_error = str(exc)
        db.commit()
        raise

    own = {a.lower() for a in (settings.imap_login[0], settings.smtp_user) if a}
    seen = set(
        db.scalars(
            select(Interaction.message_id).where(
                Interaction.message_id.in_([m.message_id for m in fetched.messages])
            )
        )
    )
    for msg in sorted(fetched.messages, key=lambda m: m.uid):
        result.fetched += 1
        if msg.message_id in seen:
            result.ignored += 1  # already processed (e.g. after a cursor reset)
            continue
        seen.add(msg.message_id)
        if msg.is_bounce:
            ok = _handle_bounce(db, msg)
            result.bounces += ok
            result.ignored += not ok
            continue
        outcome = _handle_reply(db, msg, own)
        if outcome == "reply":
            result.replies += 1
        elif outcome == "unmatched":
            result.unmatched += 1
        else:
            result.ignored += 1

    # A changed UIDVALIDITY means the server renumbered the mailbox: old UIDs mean nothing.
    base = state.last_uid if state.uidvalidity == fetched.uidvalidity else 0
    state.last_uid = max([base, *(m.uid for m in fetched.messages)])
    state.uidvalidity = fetched.uidvalidity
    state.last_sync_at = utcnow()
    state.last_error = None
    db.commit()
    return result
