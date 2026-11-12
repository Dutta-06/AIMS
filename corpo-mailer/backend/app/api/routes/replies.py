from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models import MailboxState
from app.providers.imap import MailboxError, MailboxReader, get_mailbox
from app.schemas import api as s
from app.services import gmail
from app.services.replies import sync_replies

router = APIRouter()


@router.get("/status", response_model=s.ReplyStatusOut)
def status(db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    state = db.get(MailboxState, settings.imap_folder)
    ready = gmail.mail_ready(db, settings)
    return s.ReplyStatusOut(
        configured=ready,
        polling=ready and settings.imap_poll_seconds > 0,
        last_sync_at=state.last_sync_at if state else None,
        last_error=state.last_error if state else None,
    )


@router.post("/sync", response_model=s.SyncOut)
def sync_now(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    reader: MailboxReader = Depends(get_mailbox),
):
    """Check the mailbox for replies right now (it also runs on a timer when configured)."""
    if not gmail.mail_ready(db, settings):
        raise HTTPException(
            503, "Reply tracking isn't set up: connect Gmail in Settings (or add IMAP credentials)"
        )
    try:
        return sync_replies(db, reader, settings).as_dict()
    except MailboxError as exc:
        raise HTTPException(502, str(exc)) from None
