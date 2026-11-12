"""Signing in to the site with Google.

Flow: `start_signin` makes a one-time state and PKCE challenge and returns Google's page -> the
person picks their account -> Google sends the browser to the backend's callback ->
`complete_signin` swaps the code for the account's *verified email* (the only thing asked for) and
checks it is on the allow-list -> the browser gets a one-time login code and trades it for a
session token (`redeem`). Nothing about the account is kept.
"""

from app.core import auth
from app.core.config import Settings
from app.providers.google import (
    SIGNIN_SCOPES,
    GoogleOAuth,
    OAuthError,
    challenge_for,
)
from app.services import oauth_state


class SignInError(Exception):
    """Sign-in failed; the message is safe to show. `return_to` is where to send the browser."""

    def __init__(self, message: str, return_to: str | None = None) -> None:
        super().__init__(message)
        self.return_to = return_to


DENIED = "That Google account isn't allowed to use this site."


def start_signin(settings: Settings, oauth: GoogleOAuth, return_to: str | None) -> str:
    if not settings.auth_required:
        raise SignInError("Sign-in isn't turned on: no accounts are listed in ALLOWED_EMAILS")
    if not settings.google_configured:
        raise SignInError(
            "Google sign-in isn't set up on this backend yet (see docs/GMAIL_SETUP.md)"
        )
    back = oauth_state.safe_return_to(settings, return_to, page="/login/")
    state, verifier = oauth_state.begin("signin", back)
    return oauth.authorize_url(
        state,
        challenge_for(verifier),
        settings.google_redirect_uri,
        scope=SIGNIN_SCOPES,
        offline=False,
        prompt="select_account",
    )


def complete_signin(settings: Settings, oauth: GoogleOAuth, code: str, entry: dict) -> str:
    """Finish the sign-in. Returns where to send the browser (with a one-time login code)."""
    back = entry["return_to"]
    try:
        tokens = oauth.exchange(code, entry["verifier"], settings.google_redirect_uri)
    except OAuthError as exc:
        raise SignInError(str(exc), back) from None
    email = (tokens.email or "").strip().lower()
    if not email or not tokens.email_verified:
        raise SignInError("Google didn't confirm an email address for that account.", back)
    if email not in settings.allowed_emails:
        raise SignInError(DENIED, back)  # the same message whoever you are: no hints about the list
    return oauth_state.with_result(back, signin="ok", code=oauth_state.issue_login_code(email))


def redeem(settings: Settings, one_time_code: str) -> dict | None:
    """Trade a one-time login code for a session. None if it's unknown, used, expired, or the
    account has since been removed from the allow-list."""
    email = oauth_state.redeem_login_code(one_time_code)
    if email is None or email not in settings.allowed_emails:
        return None
    token, expires = auth.make_token(settings, email)
    return {"token": token, "expires_at": expires, "email": email}
