"""Connect Gmail (OAuth): the sign-in flow, keeping it alive, and sending/reading with it."""

import imaplib
import smtplib
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import pytest

from app.core.config import Settings
from app.models import GmailConnection
from app.providers import google as google_mod
from app.providers import imap as imap_mod
from app.providers import mail as mail_mod
from app.providers.google import (
    HttpGoogleOAuth,
    OAuthError,
    TokenSet,
    challenge_for,
    xoauth2,
    xoauth2_authobject,
)
from app.providers.imap import IMAPMailboxReader, MailboxError
from app.providers.mail import MailError, SMTPMailer
from app.services import gmail
from tests.fake_imap import FakeIMAPServer
from tests.test_imap_parsing import PLAIN_REPLY

API = "/api/v1/gmail"
SITE = "http://localhost:3000"


@pytest.fixture(autouse=True)
def _fresh_state():
    gmail._pending.clear()
    gmail._CACHE.clear()
    yield
    gmail._pending.clear()
    gmail._CACHE.clear()


def begin(client, google, return_to=None):
    r = client.post(f"{API}/connect", json={"return_to": return_to} if return_to else {})
    assert r.status_code == 200, r.text
    return google.urls[-1]["state"]


def finish(client, state, code="the-code", **extra):
    params = {"code": code, "state": state, **extra}
    return client.get(f"{API}/callback", params=params, follow_redirects=False)


def connect(client, google, **kw):
    return finish(client, begin(client, google, **kw))


def row(db_session):
    db_session.expire_all()
    return db_session.get(GmailConnection, 1)


# ------------------------------------------------------------------ the sign-in flow
def test_status_before_connecting(client):
    s = client.get(f"{API}/status").json()
    assert s["configured"] is True and s["connected"] is False and s["email"] is None
    assert s["redirect_uri"] == "http://localhost:8000/api/v1/gmail/callback"


def test_connecting_needs_the_one_time_google_setup(client, imap_settings):
    imap_settings.google_client_id = ""
    assert client.get(f"{API}/status").json()["configured"] is False
    r = client.post(f"{API}/connect", json={})
    assert r.status_code == 409 and "isn't set up" in r.json()["detail"]


def test_connect_returns_googles_page_with_a_one_time_state_and_a_pkce_challenge(client, google):
    r = client.post(f"{API}/connect", json={})
    assert r.json()["url"].startswith("https://fake.google/auth?state=")
    sent = google.urls[0]
    assert (
        len(sent["state"]) >= 20
        and sent["redirect_uri"] == "http://localhost:8000/api/v1/gmail/callback"
    )
    assert sent["challenge"]
    # a second attempt gets a different state
    client.post(f"{API}/connect", json={})
    assert google.urls[1]["state"] != sent["state"]


def test_the_callback_connects_the_account_and_sends_the_browser_back(client, google, db_session):
    state = begin(client, google, return_to=f"{SITE}/settings/?x=1")
    r = finish(client, state, code="abc")
    assert r.status_code == 303
    assert r.headers["location"] == f"{SITE}/settings/?x=1&gmail=connected"
    ex = google.exchanged[0]
    assert (
        ex["code"] == "abc" and challenge_for(ex["verifier"]) == google.urls[0]["challenge"]
    )  # PKCE
    saved = row(db_session)
    assert (saved.email, saved.refresh_token, saved.status) == (
        "team@gmail.com",
        "refresh-1",
        "connected",
    )
    s = client.get(f"{API}/status").json()
    assert s["connected"] is True and s["email"] == "team@gmail.com"
    assert "refresh" not in str(s).lower()  # the token never goes to the browser


def test_a_state_works_once_only(client, google):
    state = begin(client, google)
    assert "gmail=connected" in finish(client, state).headers["location"]
    again = finish(client, state)
    assert (
        "gmail=error" in again.headers["location"] and "already+used" in again.headers["location"]
    )
    assert len(google.exchanged) == 1


def test_a_forged_or_unknown_state_connects_nothing(client, google, db_session):
    r = finish(client, "not-a-real-state")
    assert r.status_code == 303 and "gmail=error" in r.headers["location"]
    assert google.exchanged == [] and row(db_session) is None


def test_missing_state_is_refused(client):
    assert (
        client.get(f"{API}/callback", params={"code": "x"}, follow_redirects=False).status_code
        == 400
    )


def test_an_old_state_expires(client, google, monkeypatch):
    state = begin(client, google)
    later = time.time() + gmail.STATE_TTL + 5
    monkeypatch.setattr(gmail.time, "time", lambda: later)
    r = finish(client, state)
    assert "gmail=error" in r.headers["location"] and google.exchanged == []


def test_the_browser_is_only_ever_sent_back_to_the_teams_own_website(client, google):
    s1 = begin(client, google, return_to="https://evil.test/steal")
    assert finish(client, s1).headers["location"].startswith(f"{SITE}/settings/")
    s2 = begin(client, google, return_to="javascript:alert(1)")
    assert finish(client, s2).headers["location"].startswith(f"{SITE}/settings/")
    s3 = begin(client, google, return_to="http://localhost:3000.evil.test/x")
    assert finish(client, s3).headers["location"].startswith(f"{SITE}/settings/")


def test_pressing_cancel_at_google_connects_nothing_and_explains(client, google, db_session):
    state = begin(client, google, return_to=f"{SITE}/settings/")
    r = finish(client, state, code="", error="access_denied")
    assert r.status_code == 303 and "gmail=error" in r.headers["location"]
    assert "wasn%27t+connected" in r.headers["location"] and row(db_session) is None
    assert google.exchanged == []
    assert "already+used" in finish(client, state).headers["location"]  # the state was used up


def test_google_refusing_the_code_connects_nothing(client, google, db_session):
    google.exchange_error = OAuthError("Google didn't accept the sign-in: invalid_grant")
    r = connect(client, google)
    assert "gmail=error" in r.headers["location"] and "invalid_grant" in r.headers["location"]
    assert row(db_session) is None


def test_no_lasting_sign_in_or_no_email_is_an_error(client, google, db_session):
    google.tokens = TokenSet("a", 3600, None, "team@gmail.com")
    assert "permissions" in connect(client, google).headers["location"]
    google.tokens = TokenSet("a", 3600, "r", None)
    assert "which+account" in connect(client, google).headers["location"]
    assert row(db_session) is None


def test_reconnecting_replaces_the_account(client, google, db_session):
    connect(client, google)
    google.tokens = TokenSet("a", 3600, "refresh-2", "other@gmail.com")
    connect(client, google)
    saved = row(db_session)
    assert (saved.email, saved.refresh_token) == ("other@gmail.com", "refresh-2")
    assert db_session.query(GmailConnection).count() == 1


def test_disconnecting_revokes_at_google_and_forgets_the_account(client, google, db_session):
    connect(client, google)
    assert client.post(f"{API}/disconnect").json() == {"disconnected": True}
    assert google.revoked == ["refresh-1"] and row(db_session) is None
    assert client.get(f"{API}/status").json()["connected"] is False
    assert client.post(f"{API}/disconnect").json() == {"disconnected": False}


# ------------------------------------------------------------------ keeping it working
def account(client, google, db_session, settings):
    connect(client, google)
    acct = gmail.active_account(db_session, settings, google)
    assert acct is not None
    return acct


def test_access_tokens_are_reused_until_they_are_nearly_stale(
    client, google, db_session, imap_settings, monkeypatch
):
    acct = account(client, google, db_session, imap_settings)
    first = acct.access_token()
    assert acct.access_token() == first and google.refreshed == 1
    an_hour_on = time.time() + 3600
    monkeypatch.setattr(gmail.time, "time", lambda: an_hour_on)
    assert acct.access_token() != first and google.refreshed == 2


def test_a_dead_connection_is_marked_and_mail_falls_back_to_the_app_password(
    client, google, db_session, imap_settings
):
    acct = account(client, google, db_session, imap_settings)
    google.refresh_error = OAuthError(
        "The Gmail connection has expired or was removed.", permanent=True
    )
    with pytest.raises(OAuthError):
        acct.access_token()
    assert row(db_session).status == "needs_reconnect"
    s = client.get(f"{API}/status").json()
    assert s["needs_reconnect"] is True and s["connected"] is False and "expired" in s["last_error"]
    assert gmail.active_account(db_session, imap_settings, google) is None
    assert (
        gmail.mail_identity(db_session, imap_settings) == "us@gmail.com"
    )  # the app-password address
    # connecting again fixes it
    google.refresh_error = None
    connect(client, google)
    assert client.get(f"{API}/status").json()["connected"] is True


def test_a_temporary_google_hiccup_does_not_mark_it_dead(client, google, db_session, imap_settings):
    acct = account(client, google, db_session, imap_settings)
    google.refresh_error = OAuthError("Couldn't reach Google: ConnectError")
    with pytest.raises(OAuthError):
        acct.access_token()
    assert row(db_session).status == "connected"


def test_the_connected_account_is_who_approves_and_who_we_are(
    client, google, lead, draft, db_session, imap_settings
):
    assert client.post(f"/api/v1/drafts/{draft['id']}/revoke")  # (draft starts unapproved)
    connect(client, google)
    d = client.post(f"/api/v1/drafts/{draft['id']}/approve").json()
    assert d["approved_by"] == "team@gmail.com"
    assert gmail.mail_identity(db_session, imap_settings) == "team@gmail.com"


def test_reply_tracking_counts_as_set_up_once_gmail_is_connected(
    client, google, mailbox, imap_settings
):
    imap_settings.smtp_password = ""  # no app password at all
    assert client.get("/api/v1/replies/status").json()["configured"] is False
    assert client.post("/api/v1/replies/sync").status_code == 503
    connect(client, google)
    assert client.get("/api/v1/replies/status").json()["configured"] is True
    assert client.post("/api/v1/replies/sync").status_code == 200


def test_the_poller_checks_for_a_connection_each_round(
    db_session, google, imap_settings, monkeypatch
):
    from app.services import poller

    calls = []
    monkeypatch.setattr(poller, "sessionmaker", lambda *a, **k: lambda: _Ctx(db_session))
    monkeypatch.setattr(
        poller,
        "sync_replies",
        lambda *a: calls.append(1) or type("R", (), {"replies": 0, "bounces": 0})(),
    )
    monkeypatch.setattr(poller, "get_oauth", lambda: google)
    no_mail = Settings()  # nothing connected, no app password
    poller._sync_once(no_mail)
    assert calls == []
    poller._sync_once(imap_settings)  # app password present
    assert calls == [1]


class _Ctx:
    def __init__(self, db):
        self.db = db

    def __enter__(self):
        return self.db

    def __exit__(self, *a):
        return False


# ------------------------------------------------------------------ sending with it
class StubSMTP:
    """Records what the mailer does to an SMTP connection."""

    log: list = []
    auth_error: Exception | None = None

    def __init__(self, host, port, timeout=None):
        StubSMTP.log.append(("connect", host, port))

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self):
        StubSMTP.log.append(("starttls",))

    def ehlo(self):
        StubSMTP.log.append(("ehlo",))

    def login(self, user, password):
        StubSMTP.log.append(("login", user, password))

    def auth(self, mechanism, authobject, initial_response_ok=True):
        first = authobject()
        StubSMTP.log.append(("auth", mechanism, first, authobject(b"challenge")))
        if StubSMTP.auth_error:
            raise StubSMTP.auth_error

    def send_message(self, msg):
        StubSMTP.log.append(("send", msg["From"], msg["To"], msg["Subject"]))


@pytest.fixture
def smtp(monkeypatch):
    StubSMTP.log, StubSMTP.auth_error = [], None
    monkeypatch.setattr(mail_mod.smtplib, "SMTP", StubSMTP)
    return StubSMTP


class Acct:
    email = "team@gmail.com"

    def __init__(self, token="tok-1", error=None):
        self.token, self.error = token, error

    def access_token(self):
        if self.error:
            raise self.error
        return self.token


def test_sending_logs_in_with_the_oauth_token_not_a_password(smtp):
    sid = SMTPMailer(Settings(smtp_from_name="brAInwave"), Acct()).send(
        to="raj@acme.com", subject="Hi", body="B"
    )
    assert sid.startswith("<") and sid.endswith(">")
    kinds = [e[0] for e in smtp.log]
    assert kinds == ["connect", "starttls", "ehlo", "auth", "send"] and "login" not in kinds
    auth = next(e for e in smtp.log if e[0] == "auth")
    assert auth[1] == "XOAUTH2" and auth[2] == xoauth2("team@gmail.com", "tok-1")
    assert auth[3] == ""  # a server challenge (Gmail's way of saying no) gets an empty answer
    assert next(e for e in smtp.log if e[0] == "send")[1] == "brAInwave <team@gmail.com>"


def test_a_dead_token_stops_before_any_connection_is_opened(smtp):
    err = OAuthError("Connect Gmail again.", permanent=True)
    with pytest.raises(MailError, match="Connect Gmail again"):
        SMTPMailer(Settings(), Acct(error=err)).send(to="a@b.com", subject="s", body="b")
    assert smtp.log == []


def test_gmail_refusing_the_token_says_to_reconnect(smtp):
    smtp.auth_error = smtplib.SMTPAuthenticationError(535, b"bad")
    with pytest.raises(MailError, match="Reconnect Gmail"):
        SMTPMailer(Settings(), Acct()).send(to="a@b.com", subject="s", body="b")


def test_the_app_password_path_still_works_and_needs_a_password(smtp):
    SMTPMailer(Settings(smtp_user="us@gmail.com", smtp_password="pw")).send(
        to="a@b.com", subject="s", body="b"
    )
    assert ("login", "us@gmail.com", "pw") in smtp.log and not any(e[0] == "auth" for e in smtp.log)
    with pytest.raises(MailError, match="isn't connected"):
        SMTPMailer(Settings()).send(to="a@b.com", subject="s", body="b")


def test_the_login_string_is_sent_once_then_challenges_get_an_empty_reply():
    obj = xoauth2_authobject("u@gmail.com", "t")
    assert obj() == "user=u@gmail.com\x01auth=Bearer t\x01\x01"
    assert obj(b"{error}") == "" and obj(b"{error}") == ""


# ------------------------------------------------------------------ reading replies with it
@pytest.fixture
def imap_server(monkeypatch):
    srv = FakeIMAPServer({3: PLAIN_REPLY}, user="team@gmail.com")
    monkeypatch.setattr(
        imap_mod.imaplib,
        "IMAP4_SSL",
        lambda host, port, timeout: imaplib.IMAP4("127.0.0.1", srv.port),
    )
    yield srv
    srv.shutdown()


def test_replies_are_read_by_logging_in_with_the_token(imap_server):
    got = IMAPMailboxReader(Settings(), Acct(token="good-token")).fetch(
        uidvalidity=None, last_uid=0, lookback_days=14
    )
    assert [m.uid for m in got.messages] == [3]
    assert imap_server.oauth_logins == [xoauth2("team@gmail.com", "good-token")]
    assert not any(" LOGIN " in c for c in imap_server.commands)


def test_a_rejected_token_is_a_clear_mailbox_error(imap_server):
    with pytest.raises(MailboxError, match="AUTHENTICATIONFAILED|IMAP error"):
        IMAPMailboxReader(Settings(), Acct(token="stale")).fetch(
            uidvalidity=None, last_uid=0, lookback_days=14
        )


def test_a_dead_connection_is_a_clear_mailbox_error(imap_server):
    err = OAuthError(
        "The Gmail connection has expired or was removed. Connect Gmail again.", permanent=True
    )
    with pytest.raises(MailboxError, match="Connect Gmail again"):
        IMAPMailboxReader(Settings(), Acct(error=err)).fetch(
            uidvalidity=None, last_uid=0, lookback_days=14
        )
    assert imap_server.oauth_logins == []


# ------------------------------------------------------------------ the real Google client, against a local stand-in
SEEN: list[dict] = []
REPLY = {"status": 200, "body": {}}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _answer(self):
        n = int(self.headers.get("Content-Length") or 0)
        form = parse_qs(self.rfile.read(n).decode()) if n else {}
        SEEN.append(
            {
                "path": urlsplit(self.path).path,
                "form": {k: v[0] for k, v in form.items()},
                "auth": self.headers.get("Authorization"),
            }
        )
        body = (
            REPLY["body"].get(urlsplit(self.path).path, {})
            if "/" in REPLY["body"]
            else REPLY["body"]
        )
        import json

        data = json.dumps(body).encode()
        self.send_response(REPLY["status"] if urlsplit(self.path).path != "/userinfo" else 200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(data)

    do_POST = do_GET = _answer


@pytest.fixture
def stand_in(monkeypatch):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    monkeypatch.setattr(google_mod, "TOKEN_URL", f"{base}/token")
    monkeypatch.setattr(google_mod, "USERINFO_URL", f"{base}/userinfo")
    monkeypatch.setattr(google_mod, "REVOKE_URL", f"{base}/revoke")
    SEEN.clear()
    REPLY.update(status=200, body={})
    yield
    srv.shutdown()


def http_client():
    return HttpGoogleOAuth(Settings(google_client_id="cid", google_client_secret="csec"))


def test_the_consent_url_asks_for_offline_access_with_pkce_and_state():
    url = http_client().authorize_url(
        "STATE", "CHALLENGE", "http://localhost:8000/api/v1/gmail/callback"
    )
    q = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
    assert urlsplit(url).netloc == "accounts.google.com"
    assert (q["client_id"], q["state"], q["code_challenge"], q["code_challenge_method"]) == (
        "cid",
        "STATE",
        "CHALLENGE",
        "S256",
    )
    assert (
        q["access_type"] == "offline" and q["prompt"] == "consent" and q["response_type"] == "code"
    )
    assert q["scope"] == "https://mail.google.com/ openid email"
    assert "csec" not in url  # the secret never appears in a browser URL


def test_exchanging_the_code_sends_the_verifier_and_secret_and_reads_the_email(stand_in):
    REPLY["body"] = {
        "access_token": "AT",
        "expires_in": 1800,
        "refresh_token": "RT",
        "email": "team@gmail.com",
    }
    t = http_client().exchange("CODE", "VERIFIER", "http://localhost:8000/cb")
    assert t == TokenSet("AT", 1800, "RT", "team@gmail.com")
    token_call = next(c for c in SEEN if c["path"] == "/token")["form"]
    assert token_call == {
        "client_id": "cid",
        "client_secret": "csec",
        "code": "CODE",
        "code_verifier": "VERIFIER",
        "redirect_uri": "http://localhost:8000/cb",
        "grant_type": "authorization_code",
    }
    assert next(c for c in SEEN if c["path"] == "/userinfo")["auth"] == "Bearer AT"


def test_google_rejecting_the_code_is_a_readable_error(stand_in):
    REPLY.update(status=400, body={"error": "invalid_grant", "error_description": "Bad code"})
    with pytest.raises(OAuthError, match="Bad code"):
        http_client().exchange("x", "v", "r")


def test_refreshing_returns_a_new_access_token(stand_in):
    REPLY["body"] = {"access_token": "NEW", "expires_in": 3599}
    assert http_client().refresh("RT") == ("NEW", 3599)
    assert next(c for c in SEEN if c["path"] == "/token")["form"]["grant_type"] == "refresh_token"


def test_a_revoked_connection_is_permanent_but_other_failures_are_not(stand_in):
    REPLY.update(status=400, body={"error": "invalid_grant"})
    with pytest.raises(OAuthError) as e:
        http_client().refresh("RT")
    assert e.value.permanent is True and "Connect Gmail again" in str(e.value)
    REPLY.update(status=503, body={"error": "backend_error"})
    with pytest.raises(OAuthError) as e:
        http_client().refresh("RT")
    assert e.value.permanent is False


def test_revoking_hits_googles_revoke_endpoint_and_never_raises(stand_in, monkeypatch):
    http_client().revoke("RT")
    assert next(c for c in SEEN if c["path"] == "/revoke")["form"] == {"token": "RT"}
    monkeypatch.setattr(google_mod, "REVOKE_URL", "http://127.0.0.1:9/revoke")
    http_client().revoke("RT")  # unreachable: still fine
