"""Short-lived, single-use records for the Google round trips.

Two kinds of thing are remembered between pressing a button and Google sending the browser back:
* a `state` (plus the PKCE verifier and where to return to), made when sign-in or connect starts;
* a one-time login code, handed to the browser after a successful sign-in so it can trade it for a
  session without the session ever appearing in a web address.
Both are single use and expire quickly; both live in memory only.
"""

import secrets
import threading
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.core.config import Settings
from app.providers.google import new_verifier

STATE_TTL = 600  # seconds to finish the Google screen
CODE_TTL = 60  # seconds to trade a login code for a session

_pending: dict[str, dict] = {}
_codes: dict[str, dict] = {}
_lock = threading.Lock()


def clear() -> None:
    with _lock:
        _pending.clear()
        _codes.clear()


def begin(kind: str, return_to: str) -> tuple[str, str]:
    """A fresh state and PKCE verifier for a `kind` ("signin" or "connect") of round trip."""
    state, verifier = new_verifier()[:32], new_verifier()
    with _lock:
        now = time.time()
        for k in [k for k, v in _pending.items() if v["expires"] < now]:
            del _pending[k]  # forget abandoned attempts
        _pending[state] = {
            "kind": kind,
            "verifier": verifier,
            "return_to": return_to,
            "expires": now + STATE_TTL,
        }
    return state, verifier


def take(state: str) -> dict | None:
    """Single use: a state completes one round trip, once, soon after it was made."""
    with _lock:
        entry = _pending.pop(state, None)
    return entry if entry and entry["expires"] >= time.time() else None


def issue_login_code(email: str) -> str:
    code = secrets.token_urlsafe(32)
    with _lock:
        now = time.time()
        for k in [k for k, v in _codes.items() if v["expires"] < now]:
            del _codes[k]
        _codes[code] = {"email": email, "expires": now + CODE_TTL}
    return code


def redeem_login_code(code: str) -> str | None:
    with _lock:
        entry = _codes.pop(code, None)
    return entry["email"] if entry and entry["expires"] >= time.time() else None


def safe_return_to(settings: Settings, return_to: str | None, page: str = "/settings/") -> str:
    """Where to send the browser afterwards: only the team's own website, never another link."""
    allowed = settings.cors_origins
    if return_to:
        parts = urlsplit(return_to)
        if f"{parts.scheme}://{parts.netloc}" in allowed:
            return return_to
    return (allowed[0] if allowed else "http://localhost:3000").rstrip("/") + page


def with_result(url: str, **params: str) -> str:
    """`url` with these query parameters set, replacing earlier results (no fragment)."""
    parts = urlsplit(url)
    drop = set(params) | {"gmail", "signin", "reason", "code"}
    query = [(k, v) for k, v in parse_qsl(parts.query) if k not in drop]
    query += list(params.items())
    return urlunsplit(parts._replace(query=urlencode(query), fragment=""))
