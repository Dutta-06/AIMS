"""The approval gate: nothing is sent unless a human approved this exact content."""

import pytest

API = "/api/v1"


def contact(client, id_):
    return client.get(f"{API}/contacts/{id_}").json()


def test_unapproved_draft_cannot_be_sent(client, draft, mailer):
    assert client.post(f"{API}/drafts/{draft['id']}/send").status_code == 409
    assert mailer.sent == []


def test_approve_then_send(client, lead, draft, mailer):
    approved = client.post(f"{API}/drafts/{draft['id']}/approve").json()
    assert approved["status"] == "approved" and approved["approved_by"] == "us@gmail.com"

    sent = client.post(f"{API}/drafts/{draft['id']}/send").json()
    assert sent["status"] == "sent"
    assert mailer.sent == [
        {"to": "raj@acme.com", "subject": "Sponsor brAInwave 3", "body": "Hello Raj"}
    ]

    c = contact(client, lead["contact"]["id"])
    assert (c["status"], c["channels"]) == ("contacted", ["email"])
    assert c["last_contacted_at"] is not None
    log = client.get(f"{API}/contacts/{c['id']}/interactions").json()
    assert [(i["type"], i["channel"], i["approved_by"], i["draft_id"]) for i in log] == [
        ("email_sent", "email", "us@gmail.com", draft["id"])
    ]


def test_approval_is_recorded_against_the_connected_gmail_account_not_a_typed_name(client, draft):
    """A name in the request body is ignored: there is no per-person identity to claim."""
    r = client.post(f"{API}/drafts/{draft['id']}/approve", json={"by": "Someone Else"})
    assert r.json()["approved_by"] == "us@gmail.com"


def test_sending_never_moves_a_responded_contact_backwards(client, lead, draft):
    cid = lead["contact"]["id"]
    client.post(f"{API}/contacts/{cid}/interactions", json={"type": "reply", "channel": "linkedin"})
    client.post(f"{API}/drafts/{draft['id']}/approve")
    client.post(f"{API}/drafts/{draft['id']}/send")
    c = contact(client, cid)
    assert c["status"] == "responded" and c["channels"] == ["linkedin", "email"]


def test_editing_after_approval_voids_it(client, draft, mailer):
    client.post(f"{API}/drafts/{draft['id']}/approve")
    edited = client.patch(f"{API}/drafts/{draft['id']}", json={"body": "Changed text"}).json()
    assert edited["status"] == "draft" and edited["approved_by"] is None
    assert client.post(f"{API}/drafts/{draft['id']}/send").status_code == 409
    assert mailer.sent == []


def test_changing_recipient_email_after_approval_blocks_send(client, lead, draft, mailer):
    client.post(f"{API}/drafts/{draft['id']}/approve")
    client.patch(f"{API}/contacts/{lead['contact']['id']}", json={"email": "evil@x.com"})
    assert client.post(f"{API}/drafts/{draft['id']}/send").status_code == 409
    assert mailer.sent == []
    assert client.get(f"{API}/drafts/{draft['id']}").json()["status"] == "draft"


def test_cannot_send_twice(client, draft, mailer):
    client.post(f"{API}/drafts/{draft['id']}/approve")
    assert client.post(f"{API}/drafts/{draft['id']}/send").status_code == 200
    assert client.post(f"{API}/drafts/{draft['id']}/send").status_code == 409
    assert len(mailer.sent) == 1


def test_failed_send_stays_approved_and_records_error(client, lead, draft, mailer):
    client.post(f"{API}/drafts/{draft['id']}/approve")
    mailer.fail = True
    assert client.post(f"{API}/drafts/{draft['id']}/send").status_code == 409
    d = client.get(f"{API}/drafts/{draft['id']}").json()
    assert d["status"] == "approved" and "smtp down" in d["last_error"]
    assert (
        contact(client, lead["contact"]["id"])["status"] == "not_contacted"
    )  # a failure is not contact
    mailer.fail = False
    assert client.post(f"{API}/drafts/{draft['id']}/send").status_code == 200


def test_do_not_contact_blocks_approval_and_send(client, lead, draft, mailer):
    cid = lead["contact"]["id"]
    client.patch(f"{API}/contacts/{cid}", json={"do_not_contact": True})
    assert client.post(f"{API}/drafts/{draft['id']}/approve").status_code == 409

    client.patch(f"{API}/contacts/{cid}", json={"do_not_contact": False})
    client.post(f"{API}/drafts/{draft['id']}/approve")
    client.patch(f"{API}/contacts/{cid}", json={"do_not_contact": True})
    assert client.post(f"{API}/drafts/{draft['id']}/send").status_code == 409
    assert mailer.sent == []


def test_a_contact_without_an_email_cannot_be_approved(client, lead, mailer):
    linkedin_only = client.post(
        f"{API}/contacts",
        json={
            "company_id": lead["company"]["id"],
            "name": "Li",
            "linkedin": "https://linkedin.com/in/li",
        },
    ).json()
    d = client.post(
        f"{API}/drafts", json={"contact_id": linkedin_only["id"], "subject": "s", "body": "b"}
    ).json()
    r = client.post(f"{API}/drafts/{d['id']}/approve")
    assert r.status_code == 409 and "no email" in r.json()["detail"]
    assert mailer.sent == []


def test_removing_the_email_after_approval_blocks_send(client, lead, draft, mailer):
    client.post(f"{API}/drafts/{draft['id']}/approve")
    client.patch(f"{API}/contacts/{lead['contact']['id']}", json={"email": None})
    # (an email can only be cleared by going through the API's blank-to-null rule)
    r = client.post(f"{API}/drafts/{draft['id']}/send")
    assert r.status_code == 409 and mailer.sent == []


def test_revoke_returns_to_draft(client, draft):
    client.post(f"{API}/drafts/{draft['id']}/approve")
    r = client.post(f"{API}/drafts/{draft['id']}/revoke").json()
    assert r["status"] == "draft" and r["approved_at"] is None
    assert client.post(f"{API}/drafts/{draft['id']}/send").status_code == 409


def test_sent_draft_cannot_be_edited(client, draft):
    client.post(f"{API}/drafts/{draft['id']}/approve")
    client.post(f"{API}/drafts/{draft['id']}/send")
    assert client.patch(f"{API}/drafts/{draft['id']}", json={"body": "x"}).status_code == 409


def test_drafts_are_listed_newest_first_and_filterable(client, lead, draft):
    second = client.post(
        f"{API}/drafts", json={"contact_id": lead["contact"]["id"], "subject": "two", "body": "b"}
    ).json()
    assert [d["id"] for d in client.get(f"{API}/drafts").json()] == [second["id"], draft["id"]]
    client.post(f"{API}/drafts/{draft['id']}/approve")
    assert [d["id"] for d in client.get(f"{API}/drafts", params={"status": "approved"}).json()] == [
        draft["id"]
    ]


def test_deleting_a_contact_deletes_their_drafts(client, lead, draft):
    client.delete(f"{API}/contacts/{lead['contact']['id']}")
    assert client.get(f"{API}/drafts").json() == []


def test_concurrent_sends_deliver_exactly_once(client, draft, db_session, mailer):
    """Two people click Send at the same moment: both loaded the draft as 'approved'."""
    from sqlalchemy.orm import sessionmaker

    from app.models import Draft
    from app.services.drafts import DraftError, send_draft

    client.post(f"{API}/drafts/{draft['id']}/approve")
    other = sessionmaker(bind=db_session.get_bind(), expire_on_commit=False)()
    stale_a = db_session.get(Draft, draft["id"])
    stale_b = other.get(Draft, draft["id"])
    assert stale_a.status == stale_b.status == "approved"

    send_draft(db_session, stale_a, mailer)
    with pytest.raises(DraftError):
        send_draft(other, stale_b, mailer)  # still believes the draft is approved
    other.close()
    assert len(mailer.sent) == 1
