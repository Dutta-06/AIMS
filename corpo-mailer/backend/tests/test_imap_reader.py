"""IMAPMailboxReader against a real (local, plaintext) IMAP conversation."""

import imaplib

import pytest

from app.core.config import Settings
from app.providers import imap as imap_mod
from app.providers.imap import IMAPMailboxReader, MailboxError
from tests.fake_imap import FakeIMAPServer
from tests.test_imap_parsing import BOUNCE, PLAIN_REPLY


@pytest.fixture
def server(monkeypatch):
    srv = FakeIMAPServer({3: PLAIN_REPLY, 8: BOUNCE})
    # Production uses IMAP4_SSL; the fake speaks plaintext, so connect without TLS.
    monkeypatch.setattr(
        imap_mod.imaplib,
        "IMAP4_SSL",
        lambda host, port, timeout: imaplib.IMAP4("127.0.0.1", srv.port),
    )
    yield srv
    srv.shutdown()


def reader(password="app-pw"):
    return IMAPMailboxReader(Settings(smtp_user="us@gmail.com", smtp_password=password))


def test_first_run_searches_by_date_and_parses_everything(server):
    got = reader().fetch(uidvalidity=None, last_uid=0, lookback_days=14)
    assert got.uidvalidity == 42
    assert [m.uid for m in got.messages] == [3, 8]
    assert got.messages[0].message_id == "<reply-1@acme.com>" and got.messages[1].is_bounce
    assert any(c.split(" ", 2)[1:2] == ["UID"] and " SINCE " in c for c in server.commands)


def test_later_runs_ask_only_for_newer_uids(server):
    got = reader().fetch(uidvalidity=42, last_uid=3, lookback_days=14)
    assert [m.uid for m in got.messages] == [8]
    assert any("UID 4:*" in c for c in server.commands)


def test_server_quirk_returning_the_newest_old_message_is_filtered(server):
    got = reader().fetch(uidvalidity=42, last_uid=8, lookback_days=14)  # nothing newer than 8
    assert got.messages == []


def test_changed_uidvalidity_falls_back_to_the_date_search(server):
    got = reader().fetch(uidvalidity=7, last_uid=8, lookback_days=14)
    assert got.uidvalidity == 42 and [m.uid for m in got.messages] == [3, 8]


def test_mailbox_is_opened_read_only_and_nothing_is_modified(server):
    reader().fetch(uidvalidity=None, last_uid=0, lookback_days=14)
    verbs = {c.split()[1].upper() for c in server.commands}
    assert "EXAMINE" in verbs  # imaplib's readonly select
    assert not verbs & {"STORE", "EXPUNGE", "DELETE", "COPY", "APPEND"}
    assert all("BODY.PEEK" in c for c in server.commands if " FETCH " in c)  # never marks read


def test_wrong_password_raises_a_clear_error(server):
    with pytest.raises(MailboxError, match="IMAP error"):
        reader(password="nope").fetch(uidvalidity=None, last_uid=0, lookback_days=14)


def test_unreachable_server_raises_mailbox_error(monkeypatch):
    def boom(host, port, timeout):
        raise OSError("connection refused")

    monkeypatch.setattr(imap_mod.imaplib, "IMAP4_SSL", boom)
    with pytest.raises(MailboxError, match="Can't reach"):
        reader().fetch(uidvalidity=None, last_uid=0, lookback_days=14)


def test_missing_credentials_are_reported():
    r = IMAPMailboxReader(Settings())
    with pytest.raises(MailboxError, match="isn't connected"):
        r.fetch(uidvalidity=None, last_uid=0, lookback_days=14)
