"""One shared password, enforced by the backend (the website itself can be public)."""

import pytest
from fastapi.testclient import TestClient

from app.core import auth
from app.core.config import Settings, get_settings
from app.db.base import Base
from app.db.session import get_engine
from app.main import create_app

API = "/api/v1"
PAGES = "https://dutta-06.github.io"


@pytest.fixture
def locked(monkeypatch, tmp_path):
    """A backend with a password set. Uses the real app and settings, not the test overrides."""
    monkeypatch.setenv("APP_PASSWORD", "correct horse")
    monkeypatch.setenv("SESSION_SECRET", "test-secret")
    monkeypatch.setenv("CORS_ORIGINS", f'["http://localhost:3000", "{PAGES}"]')
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'auth.db'}")
    get_settings.cache_clear()
    get_engine.cache_clear()
    Base.metadata.create_all(get_engine())
    auth.limiter.failures.clear()
    with TestClient(create_app()) as c:
        c.headers["X-Corpo-Mailer"] = "1"
        yield c
    get_engine().dispose()
    get_engine.cache_clear()
    get_settings.cache_clear()
    auth.limiter.failures.clear()


def login(c, password="correct horse"):
    return c.post(f"{API}/auth/login", json={"password": password})


def authed(c, token):
    return {"Authorization": f"Bearer {token}"}


# ------------------------------------------------------------------ the gate
def test_everything_but_signing_in_is_refused_without_a_token(locked):
    for method, url in [
        ("get", "/companies"),
        ("get", "/contacts"),
        ("get", "/dashboard"),
        ("get", "/drafts"),
        ("get", "/export.csv"),
        ("get", "/discovery"),
        ("post", "/drafts/1/send"),
        ("post", "/drafts/1/approve"),
        ("post", "/replies/sync"),
        ("post", "/companies"),
    ]:
        r = getattr(locked, method)(f"{API}{url}")
        assert r.status_code == 401, (method, url, r.status_code)
        assert r.json() == {"detail": "Sign in required"}


def test_health_and_the_status_check_stay_open(locked):
    assert locked.get("/health").status_code == 200
    assert locked.get(f"{API}/auth/status").json() == {"required": True, "authenticated": False}


def test_the_right_password_gives_a_token_that_opens_the_api(locked):
    r = login(locked)
    assert r.status_code == 200
    token = r.json()["token"]
    assert locked.get(f"{API}/companies", headers=authed(locked, token)).status_code == 200
    assert locked.get(f"{API}/auth/status", headers=authed(locked, token)).json() == {
        "required": True,
        "authenticated": True,
    }
    made = locked.post(f"{API}/companies", json={"name": "Acme"}, headers=authed(locked, token))
    assert made.status_code == 201


def test_a_wrong_password_is_refused_and_gives_no_token(locked):
    r = login(locked, "nope")
    assert r.status_code == 401 and "token" not in r.json()
    assert login(locked, "").status_code == 401
    assert login(locked, "correct horse ").status_code == 401  # exact match only


@pytest.mark.parametrize(
    "bad", ["", "garbage", "1.2", "9999999999.deadbeef", "Bearer x", "Basic abc"]
)
def test_forged_or_malformed_tokens_are_refused(locked, bad):
    assert locked.get(f"{API}/companies", headers={"Authorization": bad}).status_code == 401
    assert (
        locked.get(f"{API}/companies", headers={"Authorization": f"Bearer {bad}"}).status_code
        == 401
    )


def test_a_token_cannot_be_stretched_by_editing_its_expiry(locked):
    token = login(locked).json()["token"]
    expires, sig = token.split(".")
    forged = f"{int(expires) + 10_000_000}.{sig}"
    assert locked.get(f"{API}/companies", headers=authed(locked, forged)).status_code == 401


def test_tokens_expire(monkeypatch):
    s = Settings(app_password="pw", session_secret="k", session_hours=1)
    token, expires = auth.make_token(s, now=1_000_000)
    assert expires == 1_000_000 + 3600
    assert auth.token_valid(s, token, now=1_000_000 + 3599)
    assert not auth.token_valid(s, token, now=1_000_000 + 3601)


def test_changing_the_password_or_secret_signs_everyone_out(monkeypatch):
    a = Settings(app_password="one", session_secret="k")
    token, _ = auth.make_token(a)
    assert auth.token_valid(a, token)
    assert not auth.token_valid(Settings(app_password="two", session_secret="k"), token)
    assert not auth.token_valid(Settings(app_password="one", session_secret="other"), token)


def test_the_password_cannot_be_guessed_forever(locked):
    for _ in range(5):
        assert login(locked, "wrong").status_code == 401
    r = login(locked, "correct horse")  # even the right one waits while locked
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 0
    assert "Try again in" in r.json()["detail"]


def test_the_lockout_lifts_after_a_minute_and_success_resets_it():
    lim = auth.LoginLimiter()
    for i in range(5):
        lim.failed(now=100 + i)
    assert lim.wait(now=110) > 0
    assert lim.wait(now=104 + 61) == 0  # a minute after the last failure
    lim.failed(now=170)
    assert lim.wait(now=171) > 0  # still 5+ in the window: locked again
    lim.succeeded()
    assert lim.wait(now=172) == 0
    old = auth.LoginLimiter()
    for i in range(5):
        old.failed(now=i)
    assert old.wait(now=10_000) == 0  # failures age out of the window


def test_the_password_comparison_is_exact_and_empty_never_matches():
    assert auth.password_matches(Settings(app_password="pw"), "pw")
    assert not auth.password_matches(Settings(app_password="pw"), "PW")
    assert not auth.password_matches(Settings(app_password=""), "")


def test_the_other_protections_still_apply_with_a_password(locked):
    token = login(locked).json()["token"]
    h = authed(locked, token)
    no_header = {k: v for k, v in locked.headers.items() if k.lower() != "x-corpo-mailer"}
    r = locked.post(f"{API}/companies", json={"name": "X"}, headers={**h, "X-Corpo-Mailer": ""})
    assert r.status_code == 403  # missing the custom header
    r = locked.post(
        f"{API}/companies", json={"name": "X"}, headers={**h, "Origin": "https://evil.test"}
    )
    assert r.status_code == 403  # foreign origin
    assert no_header  # (sanity: the client really sends the header normally)


# ------------------------------------------------------------------ no password configured
def test_without_a_password_the_api_stays_open_for_local_use(client):
    assert client.get(f"{API}/auth/status").json() == {"required": False, "authenticated": True}
    assert client.get(f"{API}/companies").status_code == 200
    assert client.post(f"{API}/auth/login", json={"password": "x"}).status_code == 409


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


def test_the_pages_site_may_call_the_local_backend_after_the_browsers_private_network_check(locked):
    r = preflight(locked, PAGES)
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == PAGES
    assert r.headers["access-control-allow-private-network"] == "true"
    assert "authorization" in r.headers["access-control-allow-headers"].lower()


def test_other_websites_are_refused_at_the_browsers_preflight(locked):
    r = preflight(locked, "https://evil.test")
    assert r.status_code == 400 and "access-control-allow-origin" not in r.headers
    r = preflight(locked, "https://evil.test", private=False)
    assert r.status_code == 400 and "access-control-allow-origin" not in r.headers


def test_preflights_work_without_a_token_but_the_real_request_does_not(locked):
    assert preflight(locked, PAGES).status_code == 200
    r = locked.post(f"{API}/drafts/1/send", headers={"Origin": PAGES})
    assert (
        r.status_code == 401 and r.headers["access-control-allow-origin"] == PAGES
    )  # browser can read the 401
