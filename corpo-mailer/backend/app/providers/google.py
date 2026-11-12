"""Google sign-in (OAuth 2.0) for Gmail.

The backend, not the website, talks to Google and holds the client secret. We ask for one scope,
https://mail.google.com/, because it is what Gmail's SMTP (sending) and IMAP (reading replies)
accept for OAuth: it covers both with the code that already exists. It is a broad permission, so
the connection is made by a person pressing "Connect Gmail", can be removed at any time in the app
or at myaccount.google.com/permissions, and the token never leaves this backend.
"""

import base64
import hashlib
import secrets
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlencode

import httpx

from app.core.config import Settings, get_settings

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
# Signing in only needs to know who you are. Connecting a mailbox also needs mail access.
SIGNIN_SCOPES = "openid email"
MAIL_SCOPES = "https://mail.google.com/ openid email"


class OAuthError(Exception):
    """Google said no (or couldn't be reached). The message is safe to show."""

    def __init__(self, message: str, *, permanent: bool = False) -> None:
        super().__init__(message)
        self.permanent = permanent  # True: the saved connection is dead and must be redone


@dataclass
class TokenSet:
    access_token: str
    expires_in: int
    refresh_token: str | None = None
    email: str | None = None
    email_verified: bool = False


class GoogleOAuth(Protocol):
    def authorize_url(
        self,
        state: str,
        challenge: str,
        redirect_uri: str,
        *,
        scope: str = MAIL_SCOPES,
        offline: bool = True,
        prompt: str = "consent",
    ) -> str: ...
    def exchange(self, code: str, verifier: str, redirect_uri: str) -> TokenSet: ...
    def refresh(self, refresh_token: str) -> tuple[str, int]: ...
    def revoke(self, token: str) -> None: ...


class OAuthAccount(Protocol):
    """A connected mailbox: who it is, and a currently valid access token."""

    email: str

    def access_token(self) -> str: ...


def new_verifier() -> str:
    return secrets.token_urlsafe(48)


def challenge_for(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def xoauth2(user: str, token: str) -> str:
    """The login string Gmail's SMTP and IMAP servers expect in place of a password."""
    return f"user={user}\x01auth=Bearer {token}\x01\x01"


def xoauth2_authobject(user: str, token: str):
    """For smtplib.auth: send the login once; answer any later server challenge (which is how Gmail
    reports a rejected token) with an empty line, as the protocol expects."""
    sent = False

    def authobject(challenge: bytes | None = None) -> str:
        nonlocal sent
        if not sent:
            sent = True
            return xoauth2(user, token)
        return ""

    return authobject


class HttpGoogleOAuth:
    def __init__(self, settings: Settings) -> None:
        self.s = settings

    def authorize_url(
        self,
        state: str,
        challenge: str,
        redirect_uri: str,
        *,
        scope: str = MAIL_SCOPES,
        offline: bool = True,
        prompt: str = "consent",
    ) -> str:
        params = {
            "client_id": self.s.google_client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": scope,
            "prompt": prompt,  # connecting: "consent" always returns a refresh token
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        if offline:
            params["access_type"] = "offline"  # a refresh token, so it keeps working without you
        return f"{AUTH_URL}?{urlencode(params)}"

    def _post(self, url: str, data: dict) -> httpx.Response:
        try:
            return httpx.post(url, data=data, timeout=15)
        except httpx.HTTPError as exc:
            raise OAuthError(f"Couldn't reach Google: {type(exc).__name__}") from None

    def _client(self) -> dict:
        return {"client_id": self.s.google_client_id, "client_secret": self.s.google_client_secret}

    def exchange(self, code: str, verifier: str, redirect_uri: str) -> TokenSet:
        r = self._post(
            TOKEN_URL,
            {
                **self._client(),
                "code": code,
                "code_verifier": verifier,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if r.status_code != 200:
            raise OAuthError(_reason(r, "Google didn't accept the sign-in"))
        body = r.json()
        token = body.get("access_token")
        if not token:
            raise OAuthError("Google didn't return an access token")
        email, verified = None, False
        try:
            u = httpx.get(USERINFO_URL, headers={"Authorization": f"Bearer {token}"}, timeout=15)
            if u.status_code == 200:
                info = u.json()
                email, verified = info.get("email"), info.get("email_verified") is True
        except httpx.HTTPError:
            pass
        return TokenSet(
            token, int(body.get("expires_in", 3600)), body.get("refresh_token"), email, verified
        )

    def refresh(self, refresh_token: str) -> tuple[str, int]:
        r = self._post(
            TOKEN_URL,
            {**self._client(), "refresh_token": refresh_token, "grant_type": "refresh_token"},
        )
        if r.status_code != 200:
            # invalid_grant: revoked, password changed, or (for an unpublished app) expired
            dead = r.status_code in (400, 401) and "invalid_grant" in r.text
            raise OAuthError(
                "The Gmail connection has expired or was removed. Connect Gmail again."
                if dead
                else _reason(r, "Google wouldn't renew the connection"),
                permanent=dead,
            )
        body = r.json()
        return body["access_token"], int(body.get("expires_in", 3600))

    def revoke(self, token: str) -> None:
        try:
            httpx.post(REVOKE_URL, data={"token": token}, timeout=10)
        except httpx.HTTPError:
            pass  # best effort: the connection is deleted here either way


def _reason(r: httpx.Response, fallback: str) -> str:
    try:
        err = r.json().get("error_description") or r.json().get("error")
    except ValueError:
        err = None
    return f"{fallback}: {err}" if err else f"{fallback} ({r.status_code})"


def get_oauth() -> GoogleOAuth:
    return HttpGoogleOAuth(get_settings())
