from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from app.core.config import Settings, get_settings
from app.db.base import utcnow
from app.db.session import get_db
from app.models import Contact
from app.models.enums import ContactStatus
from app.schemas.api import DashboardOut, OwnerRow

router = APIRouter()


@router.get("", response_model=DashboardOut)
def dashboard(db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    now = utcnow()
    contacts = db.scalars(select(Contact).options(joinedload(Contact.company))).unique().all()

    counts = {status: 0 for status in ContactStatus}
    owners: dict[str | None, OwnerRow] = {}
    for c in contacts:
        counts[c.status] += 1
        row = owners.setdefault(c.owner, OwnerRow(owner=c.owner))
        setattr(row, c.status.value, getattr(row, c.status.value) + 1)
        row.total += 1

    new_replies = (
        db.scalars(
            select(Contact)
            .options(joinedload(Contact.company))
            .where(Contact.reply_unread.is_(True))
            .order_by(Contact.last_contacted_at.desc())
        )
        .unique()
        .all()
    )
    reply_ids = {c.id for c in new_replies}

    # Reached out, no answer yet, and either a follow-up was scheduled and is due, or it has
    # been quiet for too long. Someone with an unread reply is handled in the replies list.
    cutoff = now - timedelta(days=settings.stale_after_days)
    needs = [
        c
        for c in db.scalars(
            select(Contact)
            .options(joinedload(Contact.company))
            .where(
                Contact.status == ContactStatus.CONTACTED,
                Contact.do_not_contact.is_(False),
                or_(Contact.next_followup_at <= now, Contact.last_contacted_at < cutoff),
            )
            .order_by(Contact.last_contacted_at)
        ).unique()
        if c.id not in reply_ids
    ]
    return DashboardOut(
        total=len(contacts),
        status_counts=counts,
        owners=sorted(owners.values(), key=lambda r: (r.owner is None, (r.owner or "").lower())),
        needs_followup=needs,
        new_replies=new_replies,
    )
