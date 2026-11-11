from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.base import utcnow
from app.db.session import get_db
from app.models import Deal
from app.models.enums import CLOSED_STAGES, DealStage
from app.schemas.api import DashboardOut

router = APIRouter()


@router.get("", response_model=DashboardOut)
def dashboard(db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    now = utcnow()
    counts = dict(db.execute(select(Deal.stage, func.count()).group_by(Deal.stage)).all())
    open_deals = Deal.stage.not_in(CLOSED_STAGES)

    due = db.scalars(
        select(Deal).where(open_deals, Deal.next_followup_at <= now).order_by(Deal.next_followup_at)
    ).all()

    cutoff = now - timedelta(days=settings.stale_after_days)
    due_ids = {d.id for d in due}
    stale = [
        d
        for d in db.scalars(
            select(Deal)
            .where(open_deals, Deal.last_contacted_at.is_not(None), Deal.last_contacted_at < cutoff)
            .order_by(Deal.last_contacted_at)
        )
        if d.id not in due_ids
    ]
    new_replies = db.scalars(
        select(Deal).where(Deal.reply_unread.is_(True)).order_by(Deal.last_contacted_at.desc())
    ).all()
    return DashboardOut(
        stage_counts={stage: counts.get(stage, 0) for stage in DealStage},
        followups_due=due,
        stale=stale,
        new_replies=new_replies,
    )
