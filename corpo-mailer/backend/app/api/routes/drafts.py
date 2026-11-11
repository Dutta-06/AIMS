from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import Contact, Draft
from app.models.enums import DraftStatus
from app.providers.llm import LLM, get_llm
from app.providers.mail import Mailer, get_mailer
from app.schemas import api as s
from app.services import drafting
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
    if not contact.email:
        raise HTTPException(409, "This contact has no email address yet; add one first")
    try:
        return drafting.generate_draft(db, llm, settings, contact, body.kind, body.instructions)
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


@router.post("/{draft_id}/approve", response_model=s.DraftOut)
def approve(draft_id: int, body: s.ApproveIn | None = None, db: Session = Depends(get_db)):
    """Approve a draft. `by` records which teammate did it (there are no accounts)."""
    who = ((body.by if body else None) or "").strip() or "Team"
    return _guard(svc.approve_draft, db, get_or_404(db, Draft, draft_id), who)


@router.post("/{draft_id}/revoke", response_model=s.DraftOut)
def revoke(draft_id: int, db: Session = Depends(get_db)):
    return _guard(svc.revoke_approval, db, get_or_404(db, Draft, draft_id))


@router.post("/{draft_id}/send", response_model=s.DraftOut)
def send(draft_id: int, db: Session = Depends(get_db), mailer: Mailer = Depends(get_mailer)):
    return _guard(svc.send_draft, db, get_or_404(db, Draft, draft_id), mailer)
