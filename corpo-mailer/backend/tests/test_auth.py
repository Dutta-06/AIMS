"""Signing in with Google, and the gate that only lets allowed accounts use the site."""

import base64
import logging
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from app import main as main_mod
from app.core import auth
from app.core.config import Settings, get_settings
from app.db.base import Base
from app.db.session import get_engine
from app.main import create_app
from app.providers.google import OAuthError, TokenSet, get_oauth
from app.services import oauth_state
from tests.conftest import FakeGoogle

API = "/api/v1"
SITE = "http://localhost:3000"
PAGES = "https://dutta-06.github.io"
TEAM = "team@gmail.com"


def build(monkeypatch, tmp_path, google, allowed="Team@Gmail.com, boss@dtu.ac.in", configured=True):
    monkeypatch.setenv("ALLOWED_EMAILS", allowed)
    monkeypatch.setenv("SESSION_SECRET", "test-secret")
    monkeypatch.setenv("CORS_ORIGINS", f'["{SITE}", "{PAGES}"]')
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'auth.db'}")
    for k in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"):
        if configured:
            monkeypatch.setenv(k, "x")
        else:
            monkeypatch.delenv(k, raising=False)
    get_settings.cache_clear()
    get_engine.cache_clear()
    Base.metadata.create_all(get_engine())
    oauth_state.clear()
    app = create_app()
    app.dependency_overrides[get_oauth] = lambda: google
    return app


@pytest.fixture
def google():
    return FakeGoogle()


@pytest.fixture
def locked(monkeypatch, tmp_path, google):
    """A backend with sign-in on (two allowed accounts), run through the real app and settings."""
    app = build(monkeypatch, tmp_path, google)
    with TestClient(app) as c:
        c.headers["X-Corpo-Mailer"] = "1"
        yield c
    get_engine().dispose()
    get_engine.cache_clear()
    get_settings.cache_clear()
    oauth_state.clear()


def start(c, google, return_to=None):
    body = {"return_to": return_to} if return_to else {}
    r = c.post(f"{API}/auth/google/start", json=body)
    assert r.status_code == 200, r.text
    return google.urls[-1]["state"]


def callback(c, state, code="the-code", **extra):
    return c.get(
        f"{API}/auth/google/callback",
        params={"code": code, "state": state, **extra},
        follow_redirects=False,
    )


def login_code(response):
    return parse_qs(urlsplit(response.headers["location"]).query)["code"][0]


def sign_in(c, google, email=TEAM, verified=True):
    """The whole round trip. Returns the session the website would hold."""
    google.tokens = TokenSet("a", 3600, None, email, verified)
    r = callback(c, start(c, google))
    assert "signin=ok" in r.headers["location"], r.headers["location"]
    x = c.post(f"{API}/auth/exchange", json={"code": login_code(r)})
    assert x.status_code == 200, x.text
    return x.json()


def bearer(session):
    return {"Authorization": f"Bearer {session['token']}"}


# ------------------------------------------------------------------ the gate
def test_everything_but_signing_in_is_refused_without_a_session(locked):
    for method, url in [
        ("get", "/companies"),
        ("get", "/contacts"),
        ("get", "/dashboard"),
        ("get", "/drafts"),
        ("get", "/export.csv"),
        ("get", "/discovery"),
        ("get", "/gmail/status"),
        ("post", "/gmail/connect"),
        ("post", "/gmail/disconnect"),
        ("post", "/drafts/1/send"),
        ("post", "/drafts/1/approve"),
        ("post", "/replies/sync"),
        ("post", "/companies"),
    ]:
        r = getattr(locked, method)(f"{API}{url}")
        assert r.status_code == 401, (method, url, r.status_code)
        assert r.json() == {"detail": "Sign in required"}


def test_health_status_and_the_sign_in_steps_are_open(locked):
    assert locked.get("/health").status_code == 200
    assert locked.get(f"{API}/auth/status").json() == {
        "required": True,
        "configured": True,
        "authenticated": False,
        "email": None,
        "allowed": [],  # strangers aren't told who is allowed
    }
    assert locked.post(f"{API}/auth/google/start", json={}).status_code == 200
    assert locked.get(f"{API}/auth/google/callback").status_code == 400  # reachable, but no state
    assert locked.post(f"{API}/auth/exchange", json={"code": "nope"}).status_code == 401


def test_the_password_login_is_gone(locked):
    assert locked.post(f"{API}/auth/login", json={"password": "x"}).status_code in (401, 404, 405)
    assert not hasattr(Settings(), "app_password")


# ------------------------------------------------------------------ signing in
def test_google_is_asked_only_who_you_are(locked, google):
    start(locked, google)
    asked = google.urls[-1]
    assert asked["scope"] == "openid email"  # no mailbox access just to use the site
    assert asked["offline"] is False and asked["prompt"] == "select_account"
    assert asked["challenge"] and asked["redirect_uri"].endswith("/api/v1/auth/google/callback")


def test_an_allowed_account_signs_in_and_gets_a_working_session(locked, google):
    s = sign_in(locked, google)
    assert s["email"] == TEAM and s["token"] and s["expires_at"] > 0
    assert locked.get(f"{API}/companies", headers=bearer(s)).status_code == 200
    status = locked.get(f"{API}/auth/status", headers=bearer(s)).json()
    assert status["authenticated"] is True and status["email"] == TEAM
    assert status["allowed"] == [TEAM, "boss@dtu.ac.in"]  # members can see who else is in


def test_the_session_never_appears_in_the_redirect_only_a_one_time_code(locked, google):
    google.tokens = TokenSet("a", 3600, None, TEAM, True)
    r = callback(locked, start(locked, google))
    loc = r.headers["location"]
    assert r.status_code == 303 and loc.startswith(f"{SITE}/login/?")
    assert "signin=ok" in loc and "token" not in loc
    session = locked.post(f"{API}/auth/exchange", json={"code": login_code(r)}).json()["token"]
    assert session not in loc


def test_email_case_does_not_matter(locked, google):
    s = sign_in(locked, google, email="TEAM@Gmail.COM")
    assert s["email"] == TEAM


def test_an_account_that_is_not_allowed_is_refused_with_no_code(locked, google):
    google.tokens = TokenSet("a", 3600, None, "stranger@gmail.com", True)
    r = callback(locked, start(locked, google))
    loc = r.headers["location"]
    assert "signin=error" in loc and "isn%27t+allowed" in loc and "code=" not in loc
    assert "stranger" not in loc and TEAM not in loc  # no hints about who is on the list


def test_an_unverified_or_missing_email_is_refused(locked, google):
    for tokens in (TokenSet("a", 3600, None, TEAM, False), TokenSet("a", 3600, None, None, False)):
        google.tokens = tokens
        loc = callback(locked, start(locked, google)).headers["location"]
        assert "signin=error" in loc and "code=" not in loc and "confirm" in loc


def test_google_failing_or_the_person_cancelling_signs_nobody_in(locked, google):
    google.exchange_error = OAuthError("Google didn't accept the sign-in: invalid_grant")
    loc = callback(locked, start(locked, google)).headers["location"]
    assert "signin=error" in loc and "invalid_grant" in loc
    loc = callback(locked, start(locked, google), code="", error="access_denied").headers[
        "location"
    ]
    assert "signin=error" in loc and "Sign-in+was+cancelled" in loc


def test_a_state_works_once_and_only_while_fresh(locked, google, monkeypatch):
    google.tokens = TokenSet("a", 3600, None, TEAM, True)
    state = start(locked, google)
    assert "signin=ok" in callback(locked, state).headers["location"]
    again = callback(locked, state).headers["location"]
    assert "signin=error" in again and "already+used" in again and len(google.exchanged) == 1
    assert "signin=error" in callback(locked, "forged").headers["location"]
    stale = start(locked, google)
    later = oauth_state.time.time() + oauth_state.STATE_TTL + 5
    monkeypatch.setattr(oauth_state.time, "time", lambda: later)
    assert "signin=error" in callback(locked, stale).headers["location"]


def test_the_login_code_works_once_and_expires(locked, google, monkeypatch):
    google.tokens = TokenSet("a", 3600, None, TEAM, True)
    code = login_code(callback(locked, start(locked, google)))
    assert locked.post(f"{API}/auth/exchange", json={"code": code}).status_code == 200
    assert locked.post(f"{API}/auth/exchange", json={"code": code}).status_code == 401  # used
    code2 = login_code(callback(locked, start(locked, google)))
    later = oauth_state.time.time() + oauth_state.CODE_TTL + 5
    monkeypatch.setattr(oauth_state.time, "time", lambda: later)
    assert locked.post(f"{API}/auth/exchange", json={"code": code2}).status_code == 401


def test_the_browser_is_only_sent_back_to_the_teams_own_website(locked, google):
    google.tokens = TokenSet("a", 3600, None, TEAM, True)
    for bad in ("https://evil.test/x", "javascript:alert(1)", "http://localhost:3000.evil.test/"):
        loc = callback(locked, start(locked, google, return_to=bad)).headers["location"]
        assert loc.startswith(f"{SITE}/login/"), loc
    ok = callback(locked, start(locked, google, return_to=f"{PAGES}/aims/login/")).headers[
        "location"
    ]
    assert ok.startswith(f"{PAGES}/aims/login/?")


def test_someone_removed_from_the_list_cannot_trade_a_code_for_a_session(
    locked, google, monkeypatch
):
    google.tokens = TokenSet("a", 3600, None, TEAM, True)
    code = login_code(callback(locked, start(locked, google)))
    monkeypatch.setenv("ALLOWED_EMAILS", "boss@dtu.ac.in")
    get_settings.cache_clear()
    assert locked.post(f"{API}/auth/exchange", json={"code": code}).status_code == 401


def test_removing_an_account_from_the_list_cuts_off_its_existing_session_at_once(
    locked, google, monkeypatch
):
    s = sign_in(locked, google)
    assert locked.get(f"{API}/companies", headers=bearer(s)).status_code == 200
    monkeypatch.setenv("ALLOWED_EMAILS", "boss@dtu.ac.in")
    get_settings.cache_clear()
    assert locked.get(f"{API}/companies", headers=bearer(s)).status_code == 401


# ------------------------------------------------------------------ the tokens themselves
def settings(**kw):
    return Settings(allowed_emails=[TEAM, "boss@dtu.ac.in"], session_secret="k", **kw)


def forge(settings_, email, expires, secret=None):
    payload = base64.urlsafe_b64encode(f"{email}|{expires}".encode()).decode().rstrip("=")
    other = Settings(session_secret=secret) if secret else settings_
    return f"{payload}.{auth._sign(other, payload)}"


def test_tokens_name_the_account_and_expire():
    s = settings(session_hours=1)
    token, expires = auth.make_token(s, TEAM, now=1_000_000)
    assert expires == 1_000_000 + 3600
    assert auth.token_email(s, token, now=1_000_000 + 3599) == TEAM
    assert auth.token_email(s, token, now=1_000_000 + 3601) is None


@pytest.mark.parametrize("bad", ["", "garbage", "a.b", ".", "x.", ".y", "Bearer x", "Basic abc"])
def test_malformed_tokens_are_refused(bad):
    assert auth.token_email(settings(), bad) is None


def test_a_token_cannot_be_edited_to_name_someone_else_or_live_longer():
    s = settings()
    token, expires = auth.make_token(s, TEAM)
    payload, sig = token.split(".")
    for email, exp in [("boss@dtu.ac.in", expires), (TEAM, expires + 9_999_999)]:
        edited = base64.urlsafe_b64encode(f"{email}|{exp}".encode()).decode().rstrip("=")
        assert auth.token_email(s, f"{edited}.{sig}") is None
    assert auth.token_email(s, f"{payload}.{'0' * 64}") is None


def test_a_token_signed_with_another_secret_or_for_a_non_allowed_account_is_refused():
    s = settings()
    far = 9_999_999_999
    assert auth.token_email(s, forge(s, TEAM, far)) == TEAM  # sanity: the forge helper is right
    assert auth.token_email(s, forge(s, TEAM, far, secret="other")) is None
    assert auth.token_email(s, forge(s, "stranger@gmail.com", far)) is None


def test_tokens_are_not_valid_after_the_secret_changes():
    token, _ = auth.make_token(Settings(allowed_emails=[TEAM], session_secret="one"), TEAM)
    assert auth.token_email(Settings(allowed_emails=[TEAM], session_secret="two"), token) is None


@pytest.mark.parametrize("bad", ["", "garbage", "9999999999.deadbeef", "Bearer x"])
def test_forged_headers_are_refused_by_the_gate(locked, bad):
    assert locked.get(f"{API}/companies", headers={"Authorization": bad}).status_code == 401
    assert (
        locked.get(f"{API}/companies", headers={"Authorization": f"Bearer {bad}"}).status_code
        == 401
    )


# ------------------------------------------------------------------ the allow-list setting
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("a@x.com,b@y.com", ["a@x.com", "b@y.com"]),
        (" A@X.com ; b@y.com  c@z.com ", ["a@x.com", "b@y.com", "c@z.com"]),
        ("a@x.com, a@X.COM", ["a@x.com"]),
        ("", []),
    ],
)
def test_the_allow_list_is_forgiving_about_how_it_is_written(raw, expected, monkeypatch):
    monkeypatch.setenv("ALLOWED_EMAILS", raw)
    assert Settings().allowed_emails == expected


def test_the_allow_list_also_accepts_a_real_list():
    assert Settings(allowed_emails=["A@x.com", "b@y.com", "a@X.com"]).allowed_emails == [
        "a@x.com",
        "b@y.com",
    ]


def test_no_allow_list_means_no_sign_in_for_local_use(monkeypatch, tmp_path, google):
    app = build(monkeypatch, tmp_path, google, allowed="")
    with TestClient(app) as c:
        c.headers["X-Corpo-Mailer"] = "1"
        assert c.get(f"{API}/auth/status").json()["required"] is False
        assert c.get(f"{API}/auth/status").json()["authenticated"] is True
        assert c.get(f"{API}/companies").status_code == 200
        r = c.post(f"{API}/auth/google/start", json={})
        assert r.status_code == 409 and "ALLOWED_EMAILS" in r.json()["detail"]
        assert c.get("/openapi.json").status_code == 200
    get_engine().dispose()
    get_engine.cache_clear()
    get_settings.cache_clear()


def test_sign_in_without_the_google_setup_says_what_is_missing(monkeypatch, tmp_path, google):
    app = build(monkeypatch, tmp_path, google, configured=False)
    with TestClient(app) as c:
        c.headers["X-Corpo-Mailer"] = "1"
        assert c.get(f"{API}/auth/status").json()["configured"] is False
        r = c.post(f"{API}/auth/google/start", json={})
        assert r.status_code == 409 and "isn't set up" in r.json()["detail"]
        assert c.get(f"{API}/companies").status_code == 401  # and nobody gets in meanwhile
    get_engine().dispose()
    get_engine.cache_clear()
    get_settings.cache_clear()


# ------------------------------------------------------------------ what signed-in people can do
def test_connecting_gmail_needs_a_session_but_google_s_redirect_back_does_not(locked, google):
    s = sign_in(locked, google)
    google.tokens = TokenSet("a", 3600, "refresh-9", "mailbox@gmail.com", True)
    assert locked.post(f"{API}/gmail/connect", json={}).status_code == 401
    r = locked.post(f"{API}/gmail/connect", json={}, headers=bearer(s))
    assert r.status_code == 200
    assert (
        google.urls[-1]["scope"] == "https://mail.google.com/ openid email"
    )  # mail asked here only
    done = callback(locked, google.urls[-1]["state"])  # Google's redirect carries no session
    assert done.status_code == 303 and "gmail=connected" in done.headers["location"]
    status = locked.get(f"{API}/gmail/status", headers=bearer(s)).json()
    assert status["connected"] is True and status["email"] == "mailbox@gmail.com"


def test_a_sign_in_state_cannot_be_used_to_connect_a_mailbox_and_vice_versa(locked, google):
    s = sign_in(locked, google)
    google.tokens = TokenSet("a", 3600, "refresh-9", "mailbox@gmail.com", True)
    signin_state = start(locked, google)  # a "signin" state...
    done = callback(locked, signin_state)
    assert "signin=" in done.headers["location"] and "gmail=" not in done.headers["location"]
    status = locked.get(f"{API}/gmail/status", headers=bearer(s)).json()
    assert status["connected"] is False  # ...never connected a mailbox


def test_approvals_are_recorded_against_the_person_who_signed_in(locked, google):
    s = sign_in(locked, google, email="boss@dtu.ac.in")
    h = bearer(s)
    co = locked.post(f"{API}/companies", json={"name": "Acme"}, headers=h).json()
    lead = locked.post(
        f"{API}/contacts",
        json={"company_id": co["id"], "name": "Raj", "email": "raj@acme.com"},
        headers=h,
    ).json()
    d = locked.post(
        f"{API}/drafts",
        json={"contact_id": lead["id"], "subject": "Hi", "body": "Hello"},
        headers=h,
    ).json()
    r = locked.post(f"{API}/drafts/{d['id']}/approve", json={"by": "Somebody Else"}, headers=h)
    assert r.json()["approved_by"] == "boss@dtu.ac.in"  # not the typed name


def test_the_other_protections_still_apply_when_signed_in(locked, google):
    h = bearer(sign_in(locked, google))
    r = locked.post(f"{API}/companies", json={"name": "X"}, headers={**h, "X-Corpo-Mailer": ""})
    assert r.status_code == 403  # missing the custom header
    r = locked.post(
        f"{API}/companies", json={"name": "X"}, headers={**h, "Origin": "https://evil.test"}
    )
    assert r.status_code == 403  # foreign origin


def test_the_api_docs_are_not_published_when_sign_in_is_on(locked):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert locked.get(path).status_code == 404, path


# ------------------------------------------------------------------ the public website
def preflight(c, origin, private=True, method="POST"):
    headers = {
        "Origin": origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": "authorization,content-type,x-corpo-mailer",
    }
    if private:
        headers["Access-Control-Request-Private-Network"] = "true"
    return c.options(f"{API}/drafts/1/send", headers=headers)


def test_the_pages_site_may_call_the_backend_after_the_browsers_private_network_check(locked):
    r = preflight(locked, PAGES)
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == PAGES
    assert r.headers["access-control-allow-private-network"] == "true"
    assert "authorization" in r.headers["access-control-allow-headers"].lower()


def test_other_websites_are_refused_at_the_browsers_preflight(locked):
    for private in (True, False):
        r = preflight(locked, "https://evil.test", private=private)
        assert r.status_code == 400 and "access-control-allow-origin" not in r.headers


def test_preflights_work_without_a_session_but_the_real_request_does_not(locked):
    assert preflight(locked, PAGES).status_code == 200
    r = locked.post(f"{API}/drafts/1/send", headers={"Origin": PAGES})
    assert r.status_code == 401 and r.headers["access-control-allow-origin"] == PAGES


# ------------------------------------------------------------------ the retired passwords
def test_old_password_settings_are_called_out_not_silently_ignored(monkeypatch, caplog):
    for k in ("APP_PASSWORD", "SMTP_PASSWORD", "SMTP_USER", "IMAP_USER", "IMAP_PASSWORD"):
        monkeypatch.delenv(k, raising=False)
    assert main_mod.warn_about_legacy_settings() == []
    monkeypatch.setenv("APP_PASSWORD", "s3cr3t-team-pw")
    monkeypatch.setenv("SMTP_PASSWORD", "s3cr3t-smtp-pw")
    with caplog.at_level(logging.WARNING, logger="corpo"):
        assert set(main_mod.warn_about_legacy_settings()) == {"APP_PASSWORD", "SMTP_PASSWORD"}
    assert "ALLOWED_EMAILS" in caplog.text and "Connect Gmail" in caplog.text
    assert "s3cr3t" not in caplog.text  # it names the settings, never their values
