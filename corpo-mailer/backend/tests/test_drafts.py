import pytest

"""The approval gate: nothing is sent unless a human approved this exact content."""

API = "/api/v1"


def test_unapproved_draft_cannot_be_sent(client, draft, mailer):
    r = client.post(f"{API}/drafts/{draft['id']}/send")
    assert r.status_code == 409
    assert mailer.sent == []


def test_approve_then_send(client, draft, mailer, deal_setup):
    approved = client.post(f"{API}/drafts/{draft['id']}/approve").json()
    assert approved["status"] == "approved"
    assert approved["approved_by"] == "Asha"

    sent = client.post(f"{API}/drafts/{draft['id']}/send").json()
    assert sent["status"] == "sent"
    assert mailer.sent == [
        {"to": "raj@acme.com", "subject": "Sponsor brAInwave 3", "body": "Hello Raj"}
    ]

    deal = client.get(f"{API}/deals/{deal_setup['deal']['id']}").json()
    assert deal["stage"] == "contacted"
    assert deal["last_contacted_at"] is not None
    log = client.get(f"{API}/deals/{deal_setup['deal']['id']}/interactions").json()
    assert [(i["type"], i["approved_by"], i["draft_id"]) for i in log] == [
        ("email_sent", "Asha", draft["id"])
    ]


def test_editing_after_approval_voids_it(client, draft, mailer):
    client.post(f"{API}/drafts/{draft['id']}/approve")
    edited = client.patch(f"{API}/drafts/{draft['id']}", json={"body": "Changed text"}).json()
    assert edited["status"] == "draft"
    assert edited["approved_by"] is None
    assert client.post(f"{API}/drafts/{draft['id']}/send").status_code == 409
    assert mailer.sent == []


def test_changing_recipient_email_after_approval_blocks_send(client, draft, deal_setup, mailer):
    client.post(f"{API}/drafts/{draft['id']}/approve")
    client.patch(f"{API}/contacts/{deal_setup['contact']['id']}", json={"email": "evil@x.com"})
    r = client.post(f"{API}/drafts/{draft['id']}/send")
    assert r.status_code == 409
    assert mailer.sent == []
    assert client.get(f"{API}/drafts/{draft['id']}").json()["status"] == "draft"


def test_cannot_send_twice(client, draft, mailer):
    client.post(f"{API}/drafts/{draft['id']}/approve")
    assert client.post(f"{API}/drafts/{draft['id']}/send").status_code == 200
    assert client.post(f"{API}/drafts/{draft['id']}/send").status_code == 409
    assert len(mailer.sent) == 1


def test_failed_send_stays_approved_and_records_error(client, draft, mailer):
    client.post(f"{API}/drafts/{draft['id']}/approve")
    mailer.fail = True
    assert client.post(f"{API}/drafts/{draft['id']}/send").status_code == 409
    d = client.get(f"{API}/drafts/{draft['id']}").json()
    assert d["status"] == "approved"
    assert "smtp down" in d["last_error"]
    mailer.fail = False
    assert client.post(f"{API}/drafts/{draft['id']}/send").status_code == 200


def test_do_not_contact_blocks_approval_and_send(client, draft, deal_setup, mailer):
    cid = deal_setup["contact"]["id"]
    client.patch(f"{API}/contacts/{cid}", json={"do_not_contact": True})
    assert client.post(f"{API}/drafts/{draft['id']}/approve").status_code == 409

    client.patch(f"{API}/contacts/{cid}", json={"do_not_contact": False})
    client.post(f"{API}/drafts/{draft['id']}/approve")
    client.patch(f"{API}/contacts/{cid}", json={"do_not_contact": True})
    assert client.post(f"{API}/drafts/{draft['id']}/send").status_code == 409
    assert mailer.sent == []


def test_revoke_returns_to_draft(client, draft):
    client.post(f"{API}/drafts/{draft['id']}/approve")
    r = client.post(f"{API}/drafts/{draft['id']}/revoke").json()
    assert r["status"] == "draft" and r["approved_at"] is None
    assert client.post(f"{API}/drafts/{draft['id']}/send").status_code == 409


def test_sent_draft_cannot_be_edited(client, draft):
    client.post(f"{API}/drafts/{draft['id']}/approve")
    client.post(f"{API}/drafts/{draft['id']}/send")
    assert client.patch(f"{API}/drafts/{draft['id']}", json={"body": "x"}).status_code == 409


def test_draft_contact_must_belong_to_deal_company(client, deal_setup):
    other = client.post("/api/v1/companies", json={"name": "Other"}).json()
    stranger = client.post(
        "/api/v1/contacts", json={"company_id": other["id"], "name": "S", "email": "s@o.com"}
    ).json()
    r = client.post(
        f"{API}/drafts",
        json={
            "deal_id": deal_setup["deal"]["id"],
            "contact_id": stranger["id"],
            "subject": "s",
            "body": "b",
        },
    )
    assert r.status_code == 422


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
