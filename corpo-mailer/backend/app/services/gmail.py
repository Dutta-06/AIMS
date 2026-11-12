"""Connecting a Gmail account ("Connect Gmail") and keeping it working.

Flow: the signed-in team member presses Connect -> `start_connect` makes a one-time `state` and a
PKCE verifier and returns Google's consent URL -> Google sends the browser back to the backend's
callback -> `complete_connect` checks the `state`, swaps the code for tokens (the client secret
never leaves the backend) and saves the refresh token. After that `StoredAccount` hands out
short-lived access tokens for sending (SMTP) and reading replies (IMAP).
"""

import time
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.base import utcnow
from app.models import GmailConnection
from app.providers.google import (
    MAIL_SCOPES,
    GoogleOAuth,
    OAuthError,
    challenge_for,
)
from app.services import oauth_state


class ConnectError(Exception):
    """The connection attempt failed; the message is safe to show."""

    def __init__(self, message: str, return_to: str | None = None) -> None:
        super().__init__(message)
        self.return_to = return_to


def start_connect(settings: Settings, oauth: GoogleOAuth, return_to: str | None) -> str:
    if not settings.google_configured:
        raise ConnectError(
            "Gmail sign-in isn't set up yet: add the Google client ID and secret first"
        )
    back = oauth_state.safe_return_to(settings, return_to)
    state, verifier = oauth_state.begin("connect", back)
    return oauth.authorize_url(
        state,
        challenge_for(verifier),
        settings.google_redirect_uri,
        scope=MAIL_SCOPES,
        offline=True,
        prompt="consent",
    )


def complete_connect(
    db: Session, settings: Settings, oauth: GoogleOAuth, code: str, entry: dict
) -> str:
    """Finish connecting. Returns where to send the browser; raises ConnectError(.., return_to)."""
    return_to = entry["return_to"]
    try:
        tokens = oauth.exchange(code, entry["verifier"], settings.google_redirect_uri)
    except OAuthError as exc:
        raise ConnectError(str(exc), return_to) from None
    if not tokens.refresh_token:
        raise ConnectError(
            "Google didn't give a lasting sign-in. Remove Corpo Mailer at "
            "myaccount.google.com/permissions and connect again.",
            return_to,
        )
    if not tokens.email:
        raise ConnectError("Google didn't say which account this is.", return_to)
    row = db.get(GmailConnection, 1)
    if row is None:
        row = GmailConnection(id=1)
        db.add(row)
    row.email, row.refresh_token = tokens.email, tokens.refresh_token
    row.status, row.last_error, row.connected_at = "connected", None, utcnow()
    db.commit()
    _CACHE.pop(1, None)
    return return_to


def disconnect(db: Session, oauth: GoogleOAuth) -> bool:
    row = db.get(GmailConnection, 1)
    if row is None:
        return False
    oauth.revoke(row.refresh_token)  # best effort
    db.delete(row)
    db.commit()
    _CACHE.pop(1, None)
    return True


# ------------------------------------------------------------------ using the connection
_CACHE: dict[int, tuple[str, float]] = {}  # access token and when it stops being good


@dataclass
class StoredAccount:
    """The connected mailbox. `access_token()` renews itself and notices a dead connection."""

    email: str
    _settings: Settings
    _oauth: GoogleOAuth
    _db: Session

    def access_token(self) -> str:
        cached = _CACHE.get(1)
        if cached and cached[1] > time.time() + 60:
            return cached[0]
        row = self._db.get(GmailConnection, 1)
        if row is None:
            raise OAuthError("Gmail isn't connected. Connect it in Settings.", permanent=True)
        try:
            token, ttl = self._oauth.refresh(row.refresh_token)
        except OAuthError as exc:
            if exc.permanent:
                row.status, row.last_error = "needs_reconnect", str(exc)
                self._db.commit()
                _CACHE.pop(1, None)
            raise
        _CACHE[1] = (token, time.time() + ttl)
        if row.status != "connected":
            row.status, row.last_error = "connected", None
            self._db.commit()
        return token


def connection(db: Session) -> GmailConnection | None:
    return db.get(GmailConnection, 1)


def active_account(db: Session, settings: Settings, oauth: GoogleOAuth) -> StoredAccount | None:
    """The connected Gmail account, if there is a working one."""
    row = connection(db)
    if row is None or row.status != "connected":
        return None
    return StoredAccount(row.email, settings, oauth, db)


def mail_identity(db: Session, settings: Settings) -> str | None:
    """Who the team is sending as: the connected Gmail account, if there is a working one."""
    row = connection(db)
    return row.email if row is not None and row.status == "connected" else None


def mail_ready(db: Session, settings: Settings) -> bool:
    row = connection(db)
    return bool(row and row.status == "connected")


def status(db: Session, settings: Settings) -> dict:
    row = connection(db)
    return {
        "configured": settings.google_configured,
        "connected": bool(row and row.status == "connected"),
        "needs_reconnect": bool(row and row.status == "needs_reconnect"),
        "email": row.email if row else None,
        "connected_at": row.connected_at if row else None,
        "last_error": row.last_error if row else None,
        "redirect_uri": settings.google_redirect_uri,
    }
