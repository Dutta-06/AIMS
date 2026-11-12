from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.providers.google import GoogleOAuth, get_oauth
from app.services import gmail as svc

router = APIRouter()


class ConnectIn(BaseModel):
    return_to: str | None = Field(default=None, max_length=500, description="Page to come back to")


@router.get("/status")
def status(db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    """Is Gmail connected, which account, and is the one-time Google setup done."""
    return svc.status(db, settings)


@router.post("/connect")
def connect(
    body: ConnectIn,
    settings: Settings = Depends(get_settings),
    oauth: GoogleOAuth = Depends(get_oauth),
):
    """Start "Connect Gmail": returns the Google page to send the browser to."""
    try:
        return {"url": svc.start_connect(settings, oauth, body.return_to)}
    except svc.ConnectError as exc:
        raise HTTPException(409, str(exc)) from None


@router.post("/disconnect")
def disconnect(db: Session = Depends(get_db), oauth: GoogleOAuth = Depends(get_oauth)):
    """Forget the connected account and tell Google to revoke the access."""
    return {"disconnected": svc.disconnect(db, oauth)}
