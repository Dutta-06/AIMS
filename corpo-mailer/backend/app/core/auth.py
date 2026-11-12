"""Who may use the site: Google accounts on the allow-list.

The frontend can be a public static website (GitHub Pages), so it can't keep anything secret and
checks nothing itself. People sign in with Google (see services/signin.py); the backend then hands
the browser a signed, expiring session token naming the account, and refuses every API request
without a valid one. The token travels in an Authorization header (not a cookie, so a foreign
website can't ride on it). The allow-list is checked on every request, so removing someone from it
cuts them off at once.
"""

import base64
import hashlib
import hmac
import secrets
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.core.config import Settings, get_settings

_PROCESS_SECRET = secrets.token_hex(32)  # used when SESSION_SECRET isn't set


def _key(settings: Settings) -> bytes:
    return hashlib.sha256((settings.session_secret or _PROCESS_SECRET).encode()).digest()


def _sign(settings: Settings, payload: str) -> str:
    return hmac.new(_key(settings), payload.encode(), hashlib.sha256).hexdigest()


def make_token(settings: Settings, email: str, now: float | None = None) -> tuple[str, int]:
    expires = int((now if now is not None else time.time()) + settings.session_hours * 3600)
    payload = base64.urlsafe_b64encode(f"{email.lower()}|{expires}".encode()).decode().rstrip("=")
    return f"{payload}.{_sign(settings, payload)}", expires


def token_email(settings: Settings, token: str, now: float | None = None) -> str | None:
    """The signed-in account if the token is genuine, unexpired and the account is still allowed."""
    payload, _, sig = token.partition(".")
    if not payload or not sig or not hmac.compare_digest(sig, _sign(settings, payload)):
        return None
    try:
        raw = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)).decode()
        email, _, expires = raw.rpartition("|")
        fresh = int(expires) > (now if now is not None else time.time())
    except (ValueError, UnicodeDecodeError):
        return None
    return email if fresh and email in settings.allowed_emails else None


def bearer(request) -> str:
    header = request.headers.get("authorization", "")
    return header[7:].strip() if header.lower().startswith("bearer ") else ""


def current_email(request) -> str | None:
    """The signed-in account for this request, or None (also None when sign-in isn't turned on)."""
    return getattr(request.state, "user", None)


class AuthGate(BaseHTTPMiddleware):
    """Refuse API calls without a valid session when sign-in is turned on."""

    # Signing in itself can't need a session. The Google callback is a redirect from Google and
    # can't carry one; its one-time `state` (made by the call that started it) protects it instead.
    OPEN = {"/auth/status", "/auth/google/start", "/auth/google/callback", "/auth/exchange"}

    async def dispatch(self, request, call_next):
        settings = get_settings()
        path = request.url.path
        request.state.user = None
        if settings.auth_required:
            email = token_email(settings, bearer(request))
            request.state.user = email
            guarded = path.startswith(settings.api_prefix) and request.method != "OPTIONS"
            if guarded and path[len(settings.api_prefix) :] not in self.OPEN and email is None:
                return JSONResponse({"detail": "Sign in required"}, status_code=401)
        return await call_next(request)
