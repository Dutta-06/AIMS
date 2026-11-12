from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
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


@router.get("/callback", include_in_schema=False)
def callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    oauth: GoogleOAuth = Depends(get_oauth),
):
    """Where Google sends the browser back to. It carries no sign-in token (it is a redirect from
    Google), so it is protected by the one-time `state` made when Connect was pressed."""
    if not state:
        raise HTTPException(400, "Missing state")
    if error or not code:
        # The person pressed Cancel, or Google refused. Go back to the page with a reason.
        entry = svc.take_state(state)  # use up the state either way
        back = entry["return_to"] if entry else svc.safe_return_to(settings, None)
        reason = (
            "Gmail wasn't connected" if error == "access_denied" else (error or "Unknown error")
        )
        return RedirectResponse(
            svc.with_result(back, gmail="error", reason=reason), status_code=303
        )
    try:
        back = svc.complete_connect(db, settings, oauth, code, state)
        return RedirectResponse(svc.with_result(back, gmail="connected"), status_code=303)
    except svc.ConnectError as exc:
        back = exc.return_to or svc.safe_return_to(settings, None)
        return RedirectResponse(
            svc.with_result(back, gmail="error", reason=str(exc)), status_code=303
        )


@router.post("/disconnect")
def disconnect(db: Session = Depends(get_db), oauth: GoogleOAuth = Depends(get_oauth)):
    """Forget the connected account and tell Google to revoke the access."""
    return {"disconnected": svc.disconnect(db, oauth)}
