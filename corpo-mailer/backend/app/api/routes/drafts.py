from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import Contact, Draft
from app.models.enums import Channel, DraftStatus
from app.providers.llm import LLM, get_llm
from app.providers.mail import Mailer, get_mailer
from app.schemas import api as s
from app.services import drafting, gmail
from app.services import drafts as svc

router = APIRouter()


def _guard(fn, *args):
    try:
        return fn(*args)
    except svc.DraftError as exc:
        raise HTTPException(409, str(exc)) from None


@router.post("", response_model=s.DraftOut, status_code=201)
def create_draft(body: s.DraftIn, db: Session = Depends(get_db)):
    get_or_404(db, Contact, body.contact_id)
    draft = Draft(**body.model_dump())
    db.add(draft)
    db.commit()
    return draft


@router.post("/generate", response_model=s.DraftOut, status_code=201)
def generate(
    body: s.GenerateIn,
    db: Session = Depends(get_db),
    llm: LLM = Depends(get_llm),
    settings: Settings = Depends(get_settings),
):
    """Ask the AI for a draft. It lands as an unapproved draft; sending still needs approval."""
    contact = get_or_404(db, Contact, body.contact_id)
    if contact.do_not_contact:
        raise HTTPException(409, "This contact is marked do-not-contact")
    if body.channel == Channel.EMAIL and not contact.email:
        raise HTTPException(409, "This contact has no email address yet; add one first")
    try:
        return drafting.generate_draft(
            db, llm, settings, contact, body.kind, body.instructions, body.channel
        )
    except drafting.GenerationError as exc:
        raise HTTPException(502, str(exc)) from None


@router.get("", response_model=list[s.DraftOut])
def list_drafts(
    status: DraftStatus | None = None,
    contact_id: int | None = None,
    db: Session = Depends(get_db),
):
    stmt = select(Draft).order_by(Draft.created_at.desc(), Draft.id.desc())
    if status is not None:
        stmt = stmt.where(Draft.status == status)
    if contact_id is not None:
        stmt = stmt.where(Draft.contact_id == contact_id)
    return db.scalars(stmt).all()


@router.get("/{draft_id}", response_model=s.DraftOut)
def get_draft(draft_id: int, db: Session = Depends(get_db)):
    return get_or_404(db, Draft, draft_id)


@router.patch("/{draft_id}", response_model=s.DraftOut)
def edit_draft(draft_id: int, body: s.DraftUpdate, db: Session = Depends(get_db)):
    draft = get_or_404(db, Draft, draft_id)
    return _guard(svc.edit_draft, db, draft, body.subject, body.body)


@router.post("/{draft_id}/revise", response_model=s.DraftOut)
def revise(
    draft_id: int,
    body: s.ReviseIn,
    db: Session = Depends(get_db),
    llm: LLM = Depends(get_llm),
    settings: Settings = Depends(get_settings),
):
    """Rewrite a draft following the team's feedback. Voids any approval; the old text is kept."""
    draft = get_or_404(db, Draft, draft_id)
    if draft.status in (DraftStatus.SENDING, DraftStatus.SENT):
        raise HTTPException(409, f"A {draft.status.value} draft cannot be changed")
    try:
        return drafting.revise_draft(db, llm, settings, draft, body.feedback)
    except drafting.GenerationError as exc:
        raise HTTPException(502, str(exc)) from None


@router.post("/{draft_id}/undo", response_model=s.DraftOut)
def undo(draft_id: int, db: Session = Depends(get_db)):
    return _guard(svc.undo_revision, db, get_or_404(db, Draft, draft_id))


@router.post("/{draft_id}/mark-sent", response_model=s.DraftOut)
def mark_sent(draft_id: int, db: Session = Depends(get_db)):
    """Record that a LinkedIn note was pasted into LinkedIn by hand. Sends nothing."""
    return _guard(svc.mark_note_sent, db, get_or_404(db, Draft, draft_id))


@router.post("/{draft_id}/approve", response_model=s.DraftOut)
def approve(
    draft_id: int,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Approve a draft. It is recorded as approved by the connected Gmail account."""
    who = gmail.mail_identity(db, settings) or "Team"
    return _guard(svc.approve_draft, db, get_or_404(db, Draft, draft_id), who)


@router.post("/{draft_id}/revoke", response_model=s.DraftOut)
def revoke(draft_id: int, db: Session = Depends(get_db)):
    return _guard(svc.revoke_approval, db, get_or_404(db, Draft, draft_id))


@router.post("/{draft_id}/send", response_model=s.DraftOut)
def send(draft_id: int, db: Session = Depends(get_db), mailer: Mailer = Depends(get_mailer)):
    return _guard(svc.send_draft, db, get_or_404(db, Draft, draft_id), mailer)
