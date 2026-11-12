"""The approval gate: the only code path that can send an email.

Rules (all enforced here, covered by tests/test_drafts.py):
  * A draft can only be sent when a human has approved it.
  * Approval is bound to a hash of recipient + subject + body. Editing a draft, or changing
    the recipient's address, voids the approval.
  * Nothing but `send_draft` calls the Mailer; the AI and schedulers can only create drafts.
"""

import hashlib

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models import Contact, Draft, Interaction
from app.models.enums import Channel, DraftStatus, InteractionType
from app.providers.mail import Mailer, MailError
from app.services import contacts as rules


class DraftError(Exception):
    """A rule was violated; the message is safe to show the user."""


def content_hash(to_email: str, subject: str, body: str) -> str:
    payload = "\x00".join([to_email.strip().lower(), subject, body])
    return hashlib.sha256(payload.encode()).hexdigest()


def _recipient(db: Session, draft: Draft) -> Contact:
    contact = db.get(Contact, draft.contact_id)
    if contact is None:
        raise DraftError("Recipient no longer exists")
    return contact


def _address(contact: Contact) -> str:
    if not contact.email:
        raise DraftError("This contact has no email address yet; add one first")
    return contact.email


def edit_draft(db: Session, draft: Draft, subject: str | None, body: str | None) -> Draft:
    if draft.status in (DraftStatus.SENDING, DraftStatus.SENT):
        raise DraftError(f"A {draft.status.value} draft cannot be edited")
    if subject is not None:
        draft.subject = subject
    if body is not None:
        draft.body = body
    _void_approval(draft)
    db.commit()
    return draft


def _void_approval(draft: Draft) -> None:
    draft.status = DraftStatus.DRAFT
    draft.approved_hash = draft.approved_by = draft.approved_at = None


def _email_only(draft: Draft, what: str) -> None:
    if draft.channel != Channel.EMAIL:
        raise DraftError(
            f"{what} applies to emails. A LinkedIn note is copied into LinkedIn by hand; "
            "use “I sent it” afterwards"
        )


def approve_draft(db: Session, draft: Draft, operator: str) -> Draft:
    _email_only(draft, "Approval")
    if draft.status != DraftStatus.DRAFT:
        raise DraftError(f"Only drafts awaiting review can be approved (is {draft.status.value})")
    contact = _recipient(db, draft)
    if contact.do_not_contact:
        raise DraftError("This contact is marked do-not-contact")
    draft.status = DraftStatus.APPROVED
    draft.approved_hash = content_hash(_address(contact), draft.subject, draft.body)
    draft.approved_by = operator
    draft.approved_at = utcnow()
    draft.last_error = None
    db.commit()
    return draft


def revoke_approval(db: Session, draft: Draft) -> Draft:
    if draft.status != DraftStatus.APPROVED:
        raise DraftError("Only approved drafts can be revoked")
    _void_approval(draft)
    db.commit()
    return draft


def send_draft(db: Session, draft: Draft, mailer: Mailer) -> Draft:
    _email_only(draft, "Sending")
    contact = _recipient(db, draft)
    if draft.status != DraftStatus.APPROVED or draft.approved_hash is None:
        raise DraftError("Draft has not been approved by a human")
    if contact.do_not_contact:
        raise DraftError("This contact is marked do-not-contact")
    address = _address(contact)
    if content_hash(address, draft.subject, draft.body) != draft.approved_hash:
        _void_approval(draft)
        db.commit()
        raise DraftError("Draft changed since approval; review and approve it again")

    # Claim the draft atomically before touching the network. The conditional UPDATE is the
    # lock: of two concurrent sends only one changes a row, the other sees 0 and stops. (A plain
    # read-then-write would let both through.)
    claimed = db.execute(
        update(Draft)
        .where(Draft.id == draft.id, Draft.status == DraftStatus.APPROVED)
        .values(status=DraftStatus.SENDING)
    ).rowcount
    db.commit()
    db.refresh(draft)
    if claimed != 1:
        raise DraftError("This draft is already being sent, or was changed; reload and check")
    # Re-check under the claim: an edit that landed between our check and the claim voids it.
    if content_hash(address, draft.subject, draft.body) != draft.approved_hash:
        _void_approval(draft)
        db.commit()
        raise DraftError("Draft changed since approval; review and approve it again")
    try:
        message_id = mailer.send(to=address, subject=draft.subject, body=draft.body)
    except MailError as exc:
        draft.status = DraftStatus.APPROVED
        draft.last_error = str(exc)
        db.commit()
        raise DraftError(f"Sending failed: {exc}") from exc

    now = utcnow()
    draft.status = DraftStatus.SENT
    draft.sent_at = now
    draft.last_error = None
    rules.record_outreach(contact, Channel.EMAIL, now)  # contacted, by email, just now
    db.add(
        Interaction(
            contact_id=contact.id,
            type=InteractionType.EMAIL_SENT,
            channel=Channel.EMAIL,
            subject=draft.subject,
            content=draft.body,
            message_id=message_id,
            draft_id=draft.id,
            approved_by=draft.approved_by,
            occurred_at=now,
        )
    )
    db.commit()
    return draft


def undo_revision(db: Session, draft: Draft) -> Draft:
    """Put back the version before the last AI revision. The approval stays voided."""
    if draft.status in (DraftStatus.SENDING, DraftStatus.SENT):
        raise DraftError(f"A {draft.status.value} draft cannot be changed")
    if not draft.history:
        raise DraftError("There is no earlier version to go back to")
    last = draft.history[-1]
    draft.history = draft.history[:-1]
    draft.subject, draft.body = last["subject"], last["body"]
    _void_approval(draft)
    db.commit()
    return draft


def mark_note_sent(db: Session, draft: Draft) -> Draft:
    """The team pasted a LinkedIn note into LinkedIn themselves; record that they did.

    This sends nothing. It is only for notes: an email can only become Sent by being sent.
    """
    if draft.channel != Channel.LINKEDIN:
        raise DraftError("Only LinkedIn notes can be marked sent by hand; emails go through Send")
    if draft.status == DraftStatus.SENT:
        raise DraftError("This note is already marked sent")
    contact = _recipient(db, draft)
    if contact.do_not_contact:
        raise DraftError("This contact is marked do-not-contact")
    now = utcnow()
    draft.status = DraftStatus.SENT
    draft.sent_at = now
    rules.record_outreach(contact, Channel.LINKEDIN, now)
    db.add(
        Interaction(
            contact_id=contact.id,
            type=InteractionType.OUTREACH,
            channel=Channel.LINKEDIN,
            content=draft.body,
            draft_id=draft.id,
            occurred_at=now,
        )
    )
    db.commit()
    return draft
