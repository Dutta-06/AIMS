from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import Contact, Deal, Interaction, MailboxState
from app.providers.imap import IncomingMessage, MailboxError
from app.services.replies import sync_replies

API = "/api/v1"


def make(uid, *, frm="raj@acme.com", reply_to=("<fake-1@test>",), mid=None, **kw):
    return IncomingMessage(
        uid=uid,
        message_id=mid or f"<m{uid}@x>",
        from_email=frm,
        subject=kw.pop("subject", "Re: Sponsor brAInwave 3"),
        body=kw.pop("body", "Happy to talk."),
        sent_at=kw.pop("sent_at", datetime(2026, 11, 10, 9, 0, tzinfo=UTC)),
        in_reply_to=list(reply_to),
        **kw,
    )


@pytest.fixture
def sent(client, deal_setup, draft):
    """An email that really went out: the fake mailer assigns it Message-ID <fake-1@test>."""
    client.post(f"{API}/drafts/{draft['id']}/approve")
    assert client.post(f"{API}/drafts/{draft['id']}/send").status_code == 200
    return deal_setup


def deal(db, id_):
    db.expire_all()
    return db.get(Deal, id_)


def log(db, deal_id):
    return list(
        db.scalars(
            select(Interaction).where(Interaction.deal_id == deal_id).order_by(Interaction.id)
        )
    )


def test_reply_matched_by_thread_is_logged_and_flagged(db_session, sent, mailbox, imap_settings):
    mailbox.inbox = [make(1)]
    r = sync_replies(db_session, mailbox, imap_settings)
    assert r.replies == 1 and r.fetched == 1
    d = deal(db_session, sent["deal"]["id"])
    assert d.reply_unread is True
    reply = log(db_session, d.id)[-1]
    assert (reply.type.value, reply.source.value) == ("email_reply", "auto")
    assert reply.content == "Happy to talk." and reply.contact_id == sent["contact"]["id"]


def test_reply_moves_last_contacted_forward_but_never_back(
    db_session, sent, mailbox, imap_settings
):
    did = sent["deal"]["id"]
    sent_at = deal(db_session, did).last_contacted_at  # when our email went out (just now)
    mailbox.inbox = [make(1, sent_at=datetime(2020, 1, 1, tzinfo=UTC))]  # an old-dated reply
    sync_replies(db_session, mailbox, imap_settings)
    assert deal(db_session, did).last_contacted_at == sent_at
    later = sent_at + timedelta(hours=2)
    mailbox.inbox = [make(2, sent_at=later)]
    sync_replies(db_session, mailbox, imap_settings)
    assert deal(db_session, did).last_contacted_at == later


def test_stage_is_not_changed_automatically(db_session, sent, mailbox, imap_settings):
    mailbox.inbox = [make(1)]
    sync_replies(db_session, mailbox, imap_settings)
    assert deal(db_session, sent["deal"]["id"]).stage.value == "contacted"


def test_reply_from_a_colleague_in_the_thread_is_attributed_to_them(
    client, db_session, sent, mailbox, imap_settings
):
    colleague = client.post(
        f"{API}/contacts",
        json={"company_id": sent["company"]["id"], "name": "Priya", "email": "priya@acme.com"},
    ).json()
    mailbox.inbox = [make(1, frm="priya@acme.com")]
    sync_replies(db_session, mailbox, imap_settings)
    assert log(db_session, sent["deal"]["id"])[-1].contact_id == colleague["id"]


def test_falls_back_to_sender_address_when_thread_ids_dont_match(
    db_session, sent, mailbox, imap_settings
):
    # e.g. Gmail rewrote our Message-ID, so In-Reply-To references an id we never stored.
    mailbox.inbox = [make(1, reply_to=("<gmail-assigned@mail.gmail.com>",), frm="RAJ@acme.com")]
    r = sync_replies(db_session, mailbox, imap_settings)
    assert r.replies == 1
    assert "not the email thread" in log(db_session, sent["deal"]["id"])[-1].content


def test_mail_from_strangers_is_left_alone(db_session, sent, mailbox, imap_settings):
    mailbox.inbox = [make(1, frm="newsletter@random.com", reply_to=())]
    r = sync_replies(db_session, mailbox, imap_settings)
    assert (r.replies, r.unmatched) == (0, 1)
    assert deal(db_session, sent["deal"]["id"]).reply_unread is False


def test_mail_from_a_contact_we_never_emailed_is_not_a_reply(
    client, db_session, deal_setup, mailbox, imap_settings
):
    mailbox.inbox = [make(1, reply_to=())]  # raj@acme.com exists but we never sent him anything
    assert sync_replies(db_session, mailbox, imap_settings).unmatched == 1


def test_auto_replies_and_our_own_mail_are_ignored(db_session, sent, mailbox, imap_settings):
    mailbox.inbox = [make(1, is_auto_reply=True), make(2, frm="us@gmail.com", mid="<own@x>")]
    r = sync_replies(db_session, mailbox, imap_settings)
    assert (r.replies, r.ignored) == (0, 2)
    assert deal(db_session, sent["deal"]["id"]).reply_unread is False


def test_syncing_twice_does_not_duplicate(db_session, sent, mailbox, imap_settings):
    mailbox.inbox = [make(1)]
    sync_replies(db_session, mailbox, imap_settings)
    # Cursor lost (e.g. mailbox renumbered): the same message comes back and must be skipped.
    mailbox.uidvalidity = 2
    r = sync_replies(db_session, mailbox, imap_settings)
    assert (r.replies, r.ignored) == (0, 1)
    assert sum(i.type.value == "email_reply" for i in log(db_session, sent["deal"]["id"])) == 1


def test_cursor_advances_so_old_mail_is_not_refetched(db_session, sent, mailbox, imap_settings):
    mailbox.inbox = [make(5), make(9, mid="<m9@x>")]
    sync_replies(db_session, mailbox, imap_settings)
    state = db_session.get(MailboxState, imap_settings.imap_folder)
    assert (state.last_uid, state.uidvalidity) == (9, 1)
    sync_replies(db_session, mailbox, imap_settings)
    assert mailbox.calls[-1] == {"uidvalidity": 1, "last_uid": 9}


def test_uidvalidity_change_resets_the_cursor(db_session, sent, mailbox, imap_settings):
    mailbox.inbox = [make(50)]
    sync_replies(db_session, mailbox, imap_settings)
    mailbox.uidvalidity = 2
    mailbox.inbox = [make(3, mid="<new@x>")]  # renumbered: low uid again
    r = sync_replies(db_session, mailbox, imap_settings)
    assert r.replies == 1
    assert db_session.get(MailboxState, imap_settings.imap_folder).last_uid == 3


def test_permanent_bounce_marks_contact_do_not_contact(db_session, sent, mailbox, imap_settings):
    mailbox.inbox = [
        make(
            1,
            frm="mailer-daemon@googlemail.com",
            reply_to=(),
            is_bounce=True,
            raw_text="Final-Recipient: rfc822; raj@acme.com\nAction: failed\nStatus: 5.1.1\n",
        )
    ]
    r = sync_replies(db_session, mailbox, imap_settings)
    assert r.bounces == 1
    assert db_session.get(Contact, sent["contact"]["id"]).do_not_contact is True
    note = log(db_session, sent["deal"]["id"])[-1]
    assert note.subject == "Delivery failed: raj@acme.com" and "do-not-contact" in note.content
    assert deal(db_session, sent["deal"]["id"]).reply_unread is False  # a bounce isn't a reply


def test_temporary_bounce_does_not_block_the_contact(db_session, sent, mailbox, imap_settings):
    mailbox.inbox = [
        make(
            1,
            frm="mailer-daemon@x.com",
            reply_to=(),
            is_bounce=True,
            raw_text="Final-Recipient: rfc822; raj@acme.com\nStatus: 4.2.2 mailbox full\n",
        )
    ]
    assert sync_replies(db_session, mailbox, imap_settings).bounces == 1
    assert db_session.get(Contact, sent["contact"]["id"]).do_not_contact is False


def test_bounce_for_an_address_we_dont_know_is_ignored(db_session, sent, mailbox, imap_settings):
    mailbox.inbox = [
        make(
            1,
            frm="mailer-daemon@x.com",
            reply_to=(),
            is_bounce=True,
            raw_text="Final-Recipient: rfc822; stranger@else.com\nStatus: 5.1.1\n",
        )
    ]
    r = sync_replies(db_session, mailbox, imap_settings)
    assert (r.bounces, r.ignored) == (0, 1)


def test_bounced_contact_can_no_longer_be_emailed(client, db_session, sent, mailbox, imap_settings):
    mailbox.inbox = [
        make(
            1,
            frm="mailer-daemon@x.com",
            reply_to=(),
            is_bounce=True,
            raw_text="Final-Recipient: rfc822; raj@acme.com\nStatus: 5.1.1\n",
        )
    ]
    sync_replies(db_session, mailbox, imap_settings)
    d = client.post(
        f"{API}/drafts",
        json={
            "deal_id": sent["deal"]["id"],
            "contact_id": sent["contact"]["id"],
            "subject": "again",
            "body": "b",
        },
    ).json()
    assert client.post(f"{API}/drafts/{d['id']}/approve").status_code == 409


def test_mailbox_failure_is_recorded_and_cursor_untouched(db_session, sent, mailbox, imap_settings):
    mailbox.inbox = [make(1)]
    sync_replies(db_session, mailbox, imap_settings)
    mailbox.fail = "Login failed"
    with pytest.raises(MailboxError):
        sync_replies(db_session, mailbox, imap_settings)
    state = db_session.get(MailboxState, imap_settings.imap_folder)
    assert state.last_error == "Login failed" and state.last_uid == 1


# ---- API


def test_sync_endpoint_and_dashboard(client, db_session, sent, mailbox):
    mailbox.inbox = [make(1)]
    r = client.post(f"{API}/replies/sync")
    assert r.status_code == 200 and r.json()["replies"] == 1
    dash = client.get(f"{API}/dashboard").json()
    assert [d["id"] for d in dash["new_replies"]] == [sent["deal"]["id"]]
    st = client.get(f"{API}/replies/status").json()
    assert st["configured"] is True and st["last_sync_at"] and st["last_error"] is None


def test_marking_a_reply_seen_clears_it(client, sent, mailbox):
    mailbox.inbox = [make(1)]
    client.post(f"{API}/replies/sync")
    r = client.patch(f"{API}/deals/{sent['deal']['id']}", json={"reply_unread": False})
    assert r.json()["reply_unread"] is False
    assert client.get(f"{API}/dashboard").json()["new_replies"] == []


def test_sync_endpoint_reports_mailbox_errors_as_502(client, mailbox):
    mailbox.fail = "Can't reach imap.gmail.com"
    r = client.post(f"{API}/replies/sync")
    assert r.status_code == 502 and "imap.gmail.com" in r.json()["detail"]
    assert client.get(f"{API}/replies/status").json()["last_error"]


def test_sync_endpoint_says_so_when_imap_isnt_configured(client, imap_settings):
    from app.core.config import get_settings
    from app.main import app

    app.dependency_overrides[get_settings] = lambda: imap_settings.model_copy(
        update={"smtp_user": "", "smtp_password": ""}
    )
    r = client.post(f"{API}/replies/sync")
    assert r.status_code == 503 and "IMAP" in r.json()["detail"]
    assert client.get(f"{API}/replies/status").json()["configured"] is False


def test_replies_endpoints_require_login(client):
    client.headers.pop("Authorization")
    assert client.post(f"{API}/replies/sync").status_code == 401
    assert client.get(f"{API}/replies/status").status_code == 401
