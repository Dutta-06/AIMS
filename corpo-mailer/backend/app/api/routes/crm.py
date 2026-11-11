"""Companies, the contacts the team tracks, and manually logged interactions."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_or_404
from app.db.base import utcnow
from app.db.session import get_db
from app.models import Company, Contact, Interaction
from app.models.enums import (
    Channel,
    ContactStatus,
    InteractionSource,
    InteractionType,
)
from app.schemas import api as s
from app.services import contacts as rules

router = APIRouter()


def _commit(db: Session, detail: str) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, detail) from None


# ---- companies
@router.post("/companies", response_model=s.CompanyOut, status_code=201)
def create_company(body: s.CompanyIn, db: Session = Depends(get_db)):
    company = Company(**body.model_dump())
    db.add(company)
    _commit(db, "A company with that name already exists")
    return company


@router.get("/companies", response_model=list[s.CompanyOut])
def list_companies(q: str | None = None, db: Session = Depends(get_db)):
    stmt = select(Company).order_by(Company.name)
    if q:
        stmt = stmt.where(Company.name.ilike(f"%{q}%"))
    return db.scalars(stmt).all()


@router.get("/companies/{company_id}", response_model=s.CompanyOut)
def get_company(company_id: int, db: Session = Depends(get_db)):
    return get_or_404(db, Company, company_id)


@router.patch("/companies/{company_id}", response_model=s.CompanyOut)
def update_company(company_id: int, body: s.CompanyUpdate, db: Session = Depends(get_db)):
    company = get_or_404(db, Company, company_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(company, k, v)
    _commit(db, "A company with that name already exists")
    return company


@router.delete("/companies/{company_id}", status_code=204)
def delete_company(company_id: int, db: Session = Depends(get_db)):
    db.delete(get_or_404(db, Company, company_id))
    db.commit()


# ---- contacts
@router.post("/contacts", response_model=s.ContactOut, status_code=201)
def create_contact(body: s.ContactIn, db: Session = Depends(get_db)):
    get_or_404(db, Company, body.company_id)
    contact = Contact(
        **body.model_dump(exclude={"channels"}), channels=[c.value for c in body.channels]
    )
    if contact.status != ContactStatus.NOT_CONTACTED and contact.last_contacted_at is None:
        contact.last_contacted_at = utcnow()
    rules.normalise(contact)
    db.add(contact)
    db.commit()
    return contact


@router.get("/contacts", response_model=list[s.ContactOut])
def list_contacts(
    company_id: int | None = None,
    status: ContactStatus | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
):
    stmt = (
        select(Contact)
        .join(Company)
        .options(joinedload(Contact.company))
        .order_by(Company.name, Contact.name)
    )
    if company_id is not None:
        stmt = stmt.where(Contact.company_id == company_id)
    if status is not None:
        stmt = stmt.where(Contact.status == status)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                Contact.name.ilike(like),
                Contact.email.ilike(like),
                Contact.role.ilike(like),
                Contact.remarks.ilike(like),
                Company.name.ilike(like),
            )
        )
    return db.scalars(stmt).unique().all()


@router.get("/contacts/{contact_id}", response_model=s.ContactOut)
def get_contact(contact_id: int, db: Session = Depends(get_db)):
    return get_or_404(db, Contact, contact_id)


@router.patch("/contacts/{contact_id}", response_model=s.ContactOut)
def update_contact(contact_id: int, body: s.ContactUpdate, db: Session = Depends(get_db)):
    contact = get_or_404(db, Contact, contact_id)
    changes = body.model_dump(exclude_unset=True)
    channels = changes.pop("channels", None)
    for k, v in changes.items():
        setattr(contact, k, v)
    if "name" in changes or "email" in changes or "linkedin" in changes:
        if not (contact.name or contact.email or contact.linkedin):
            db.rollback()
            raise HTTPException(422, "A contact needs a name, an email or a LinkedIn link")
    if channels is not None:
        contact.channels = [c.value if isinstance(c, Channel) else c for c in channels]
    if contact.status == ContactStatus.NOT_CONTACTED:
        if channels:
            db.rollback()
            raise HTTPException(422, "Channels apply once the contact has been reached")
        contact.channels = []
    elif contact.last_contacted_at is None:
        contact.last_contacted_at = utcnow()
    db.commit()
    return contact


@router.delete("/contacts/{contact_id}", status_code=204)
def delete_contact(contact_id: int, db: Session = Depends(get_db)):
    db.delete(get_or_404(db, Contact, contact_id))
    db.commit()


# ---- interactions
@router.get("/contacts/{contact_id}/interactions", response_model=list[s.InteractionOut])
def list_interactions(contact_id: int, db: Session = Depends(get_db)):
    return get_or_404(db, Contact, contact_id).interactions


@router.post(
    "/contacts/{contact_id}/interactions", response_model=s.InteractionOut, status_code=201
)
def log_interaction(contact_id: int, body: s.InteractionIn, db: Session = Depends(get_db)):
    """Log what happened. Reaching out or hearing back also updates the contact's status and
    channels. (Sent emails are logged by the send gate, never here.)"""
    contact = get_or_404(db, Contact, contact_id)
    if body.type == InteractionType.EMAIL_SENT:
        raise HTTPException(422, "Emails are logged automatically when a draft is sent")
    when = body.occurred_at or utcnow()
    interaction = Interaction(
        contact_id=contact_id,
        source=InteractionSource.MANUAL,
        type=body.type,
        channel=body.channel,
        subject=body.subject,
        content=body.content,
        occurred_at=when,
    )
    db.add(interaction)
    if body.type == InteractionType.OUTREACH:
        rules.record_outreach(contact, body.channel, when)
    elif body.type in (InteractionType.REPLY, InteractionType.EMAIL_REPLY):
        rules.record_reply(contact, body.channel or Channel.EMAIL, when)
    elif body.type in (InteractionType.CALL, InteractionType.MEETING):
        if contact.last_contacted_at is None or when > contact.last_contacted_at:
            contact.last_contacted_at = when
    db.commit()
    return interaction
