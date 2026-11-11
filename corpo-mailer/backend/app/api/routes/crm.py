"""Companies, contacts, deals and manually logged interactions."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.db.base import utcnow
from app.db.session import get_db
from app.models import Company, Contact, Deal, Interaction
from app.models.enums import DealStage, InteractionSource, InteractionType
from app.schemas import api as s

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
    contact = Contact(**body.model_dump())
    db.add(contact)
    db.commit()
    return contact


@router.get("/contacts", response_model=list[s.ContactOut])
def list_contacts(company_id: int | None = None, db: Session = Depends(get_db)):
    stmt = select(Contact).order_by(Contact.name)
    if company_id is not None:
        stmt = stmt.where(Contact.company_id == company_id)
    return db.scalars(stmt).all()


@router.patch("/contacts/{contact_id}", response_model=s.ContactOut)
def update_contact(contact_id: int, body: s.ContactUpdate, db: Session = Depends(get_db)):
    contact = get_or_404(db, Contact, contact_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(contact, k, v)
    db.commit()
    return contact


@router.delete("/contacts/{contact_id}", status_code=204)
def delete_contact(contact_id: int, db: Session = Depends(get_db)):
    db.delete(get_or_404(db, Contact, contact_id))
    db.commit()


# ---- deals
@router.post("/deals", response_model=s.DealOut, status_code=201)
def create_deal(body: s.DealIn, db: Session = Depends(get_db)):
    get_or_404(db, Company, body.company_id)
    deal = Deal(**body.model_dump())
    db.add(deal)
    db.commit()
    return deal


@router.get("/deals", response_model=list[s.DealOut])
def list_deals(
    stage: DealStage | None = None, company_id: int | None = None, db: Session = Depends(get_db)
):
    stmt = select(Deal).order_by(Deal.created_at.desc())
    if stage is not None:
        stmt = stmt.where(Deal.stage == stage)
    if company_id is not None:
        stmt = stmt.where(Deal.company_id == company_id)
    return db.scalars(stmt).all()


@router.get("/deals/{deal_id}", response_model=s.DealOut)
def get_deal(deal_id: int, db: Session = Depends(get_db)):
    return get_or_404(db, Deal, deal_id)


@router.patch("/deals/{deal_id}", response_model=s.DealOut)
def update_deal(deal_id: int, body: s.DealUpdate, db: Session = Depends(get_db)):
    deal = get_or_404(db, Deal, deal_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(deal, k, v)
    db.commit()
    return deal


@router.delete("/deals/{deal_id}", status_code=204)
def delete_deal(deal_id: int, db: Session = Depends(get_db)):
    db.delete(get_or_404(db, Deal, deal_id))
    db.commit()


# ---- interactions
@router.get("/deals/{deal_id}/interactions", response_model=list[s.InteractionOut])
def list_interactions(deal_id: int, db: Session = Depends(get_db)):
    return get_or_404(db, Deal, deal_id).interactions


@router.post("/deals/{deal_id}/interactions", response_model=s.InteractionOut, status_code=201)
def log_interaction(deal_id: int, body: s.InteractionIn, db: Session = Depends(get_db)):
    """Manually log a call, meeting, note or reply. Sent emails are logged by the send gate."""
    deal = get_or_404(db, Deal, deal_id)
    if body.type == InteractionType.EMAIL_SENT:
        raise HTTPException(422, "Emails are logged automatically when a draft is sent")
    if body.contact_id is not None:
        contact = get_or_404(db, Contact, body.contact_id)
        if contact.company_id != deal.company_id:
            raise HTTPException(422, "Contact does not belong to this deal's company")
    interaction = Interaction(
        deal_id=deal_id,
        source=InteractionSource.MANUAL,
        occurred_at=body.occurred_at or utcnow(),
        **body.model_dump(exclude={"occurred_at"}),
    )
    db.add(interaction)
    if body.type != InteractionType.NOTE:
        deal.last_contacted_at = interaction.occurred_at
    db.commit()
    return interaction
