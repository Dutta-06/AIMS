from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core import auth
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.providers.google import GoogleOAuth, get_oauth
from app.services import gmail, oauth_state, signin

router = APIRouter()


class StartIn(BaseModel):
    return_to: str | None = Field(default=None, max_length=500, description="Page to come back to")


class ExchangeIn(BaseModel):
    code: str = Field(max_length=200)


@router.get("/status")
def status(request: Request, settings: Settings = Depends(get_settings)):
    """Does the site need a sign-in, is Google set up, and is this browser signed in?"""
    required = settings.auth_required
    email = auth.current_email(request)
    signed_in = (not required) or email is not None
    return {
        "required": required,
        "configured": settings.google_configured,
        "authenticated": signed_in,
        "email": email,
        # Only people who are in may see who else is.
        "allowed": settings.allowed_emails if signed_in and required else [],
    }


@router.post("/google/start")
def start(
    body: StartIn,
    settings: Settings = Depends(get_settings),
    oauth: GoogleOAuth = Depends(get_oauth),
):
    """Start "Sign in with Google": returns the Google page to send the browser to."""
    try:
        return {"url": signin.start_signin(settings, oauth, body.return_to)}
    except signin.SignInError as exc:
        raise HTTPException(409, str(exc)) from None


@router.get("/google/callback", include_in_schema=False)
def callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    oauth: GoogleOAuth = Depends(get_oauth),
):
    """Where Google sends the browser back to, for both signing in and connecting Gmail.

    It carries no session (it is a redirect from Google), so the one-time `state` made when the
    flow started is what protects it, and it decides which flow this is.
    """
    if not state:
        raise HTTPException(400, "Missing state")
    entry = oauth_state.take(state)
    if entry is None:
        back = oauth_state.safe_return_to(settings, None, page="/login/")
        reason = "That link has expired or was already used. Start again."
        return _go(back, signin="error", reason=reason)
    kind, back = entry["kind"], entry["return_to"]
    result_key = "signin" if kind == "signin" else "gmail"
    if error or not code:
        denied = error == "access_denied"
        what = "Sign-in" if kind == "signin" else "Gmail"
        reason = f"{what} was cancelled" if denied else (error or "Unknown error")
        return _go(back, **{result_key: "error", "reason": reason})
    try:
        if kind == "signin":
            return RedirectResponse(
                signin.complete_signin(settings, oauth, code, entry), status_code=303
            )
        done = gmail.complete_connect(db, settings, oauth, code, entry)
        return _go(done, gmail="connected")
    except (signin.SignInError, gmail.ConnectError) as exc:
        return _go(exc.return_to or back, **{result_key: "error", "reason": str(exc)})


def _go(url: str, **params: str) -> RedirectResponse:
    return RedirectResponse(oauth_state.with_result(url, **params), status_code=303)


@router.post("/exchange")
def exchange(body: ExchangeIn, settings: Settings = Depends(get_settings)):
    """Trade the one-time login code from the sign-in redirect for a session token."""
    session = signin.redeem(settings, body.code)
    if session is None:
        raise HTTPException(401, "That sign-in link has expired or was already used")
    return session
