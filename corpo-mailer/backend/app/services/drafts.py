"""The approval gate: the only code path that can send an email.

Rules (all enforced here, covered by tests/test_drafts.py):
  * A draft can only be sent when a human has approved it.
  * Approval is bound to a hash of recipient + subject + body. Editing a draft, or changing
    the recipient's address, voids the approval.
  * Nothing but `send_draft` calls the Mailer; the AI and schedulers can only create drafts.
"""

import hashlib

from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models import Contact, Deal, Draft, Interaction
from app.models.enums import DealStage, DraftStatus, InteractionType
from app.providers.mail import Mailer, MailError


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


def approve_draft(db: Session, draft: Draft, operator: str) -> Draft:
    if draft.status != DraftStatus.DRAFT:
        raise DraftError(f"Only drafts awaiting review can be approved (is {draft.status.value})")
    contact = _recipient(db, draft)
    if contact.do_not_contact:
        raise DraftError("This contact is marked do-not-contact")
    draft.status = DraftStatus.APPROVED
    draft.approved_hash = content_hash(contact.email, draft.subject, draft.body)
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
    contact = _recipient(db, draft)
    if draft.status != DraftStatus.APPROVED or draft.approved_hash is None:
        raise DraftError("Draft has not been approved by a human")
    if contact.do_not_contact:
        raise DraftError("This contact is marked do-not-contact")
    if content_hash(contact.email, draft.subject, draft.body) != draft.approved_hash:
        _void_approval(draft)
        db.commit()
        raise DraftError("Draft changed since approval; review and approve it again")

    # Claim the draft before touching the network so a double click cannot send twice.
    draft.status = DraftStatus.SENDING
    db.commit()
    try:
        message_id = mailer.send(to=contact.email, subject=draft.subject, body=draft.body)
    except MailError as exc:
        draft.status = DraftStatus.APPROVED
        draft.last_error = str(exc)
        db.commit()
        raise DraftError(f"Sending failed: {exc}") from exc

    now = utcnow()
    draft.status = DraftStatus.SENT
    draft.sent_at = now
    draft.last_error = None
    deal = db.get(Deal, draft.deal_id)
    deal.last_contacted_at = now
    if deal.stage == DealStage.PROSPECT:
        deal.stage = DealStage.CONTACTED
    db.add(
        Interaction(
            deal_id=draft.deal_id,
            contact_id=contact.id,
            type=InteractionType.EMAIL_SENT,
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
