"""One shared password, enforced by the backend.

The frontend can be a public static website (GitHub Pages), so it cannot keep anything secret:
the password is checked *here*, and every API request without a valid token is refused. Tokens are
stateless, signed and expire; they live in the browser and travel in an Authorization header (not
a cookie, so a foreign website can't ride on them).
"""

import hashlib
import hmac
import secrets
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.core.config import Settings, get_settings

_PROCESS_SECRET = secrets.token_hex(32)  # used when SESSION_SECRET isn't set


def _key(settings: Settings) -> bytes:
    # Bound to the password too, so changing the password invalidates every old token.
    seed = f"{settings.session_secret or _PROCESS_SECRET}\x00{settings.app_password}"
    return hashlib.sha256(seed.encode()).digest()


def password_matches(settings: Settings, given: str) -> bool:
    if not settings.app_password:
        return False
    return hmac.compare_digest(
        hashlib.sha256(given.encode()).digest(),
        hashlib.sha256(settings.app_password.encode()).digest(),
    )


def make_token(settings: Settings, now: float | None = None) -> tuple[str, int]:
    expires = int((now if now is not None else time.time()) + settings.session_hours * 3600)
    sig = hmac.new(_key(settings), str(expires).encode(), hashlib.sha256).hexdigest()
    return f"{expires}.{sig}", expires


def token_valid(settings: Settings, token: str, now: float | None = None) -> bool:
    expires, _, sig = token.partition(".")
    if not expires.isdigit() or not sig:
        return False
    good = hmac.new(_key(settings), expires.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, good) and int(expires) > (
        now if now is not None else time.time()
    )


def bearer(request) -> str:
    header = request.headers.get("authorization", "")
    return header[7:].strip() if header.lower().startswith("bearer ") else ""


class LoginLimiter:
    """After 5 wrong passwords in 10 minutes, wait a minute between further tries."""

    def __init__(self, window: int = 600, limit: int = 5, lock: int = 60) -> None:
        self.window, self.limit, self.lock = window, limit, lock
        self.failures: list[float] = []

    def wait(self, now: float | None = None) -> int:
        """Seconds the caller must wait before trying again (0 if free to try)."""
        now = now if now is not None else time.time()
        self.failures = [t for t in self.failures if now - t < self.window]
        if len(self.failures) >= self.limit:
            return max(0, int(self.lock - (now - self.failures[-1])) + 1)
        return 0

    def failed(self, now: float | None = None) -> None:
        self.failures.append(now if now is not None else time.time())

    def succeeded(self) -> None:
        self.failures.clear()


limiter = LoginLimiter()


class AuthGate(BaseHTTPMiddleware):
    """Refuse API calls without a valid token when a password is configured."""

    OPEN = {"/auth/login", "/auth/status"}

    async def dispatch(self, request, call_next):
        settings = get_settings()
        path = request.url.path
        guarded = path.startswith(settings.api_prefix) and request.method != "OPTIONS"
        if settings.app_password and guarded and path[len(settings.api_prefix) :] not in self.OPEN:
            if not token_valid(settings, bearer(request)):
                return JSONResponse({"detail": "Sign in required"}, status_code=401)
        return await call_next(request)
