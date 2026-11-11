from datetime import UTC, datetime, timedelta

API = "/api/v1"


def test_requires_auth(client):
    client.headers.pop("Authorization")
    assert client.get(f"{API}/companies").status_code == 401
    assert client.get(f"{API}/drafts").status_code == 401


def test_wrong_password_rejected(client):
    r = client.post(f"{API}/auth/login", json={"password": "nope", "name": "x"})
    assert r.status_code == 401


def test_duplicate_company_name_conflicts(client):
    assert client.post(f"{API}/companies", json={"name": "Acme"}).status_code == 201
    assert client.post(f"{API}/companies", json={"name": "Acme"}).status_code == 409


def test_company_search_and_delete_cascades(client, deal_setup):
    cid = deal_setup["company"]["id"]
    assert [c["name"] for c in client.get(f"{API}/companies", params={"q": "acm"}).json()] == [
        "Acme"
    ]
    assert client.delete(f"{API}/companies/{cid}").status_code == 204
    assert client.get(f"{API}/contacts").json() == []
    assert client.get(f"{API}/deals").json() == []


def test_invalid_contact_email_rejected(client, deal_setup):
    r = client.post(
        f"{API}/contacts",
        json={"company_id": deal_setup["company"]["id"], "name": "x", "email": "not-an-email"},
    )
    assert r.status_code == 422


def test_manual_interaction_logging(client, deal_setup):
    did = deal_setup["deal"]["id"]
    r = client.post(f"{API}/deals/{did}/interactions", json={"type": "call", "content": "Intro"})
    assert r.status_code == 201 and r.json()["source"] == "manual"
    assert client.get(f"{API}/deals/{did}").json()["last_contacted_at"] is not None
    # A note does not count as contact.
    d2 = client.post(f"{API}/deals", json={"company_id": deal_setup["company"]["id"]}).json()
    client.post(f"{API}/deals/{d2['id']}/interactions", json={"type": "note", "content": "x"})
    assert client.get(f"{API}/deals/{d2['id']}").json()["last_contacted_at"] is None


def test_cannot_fake_a_sent_email_via_interaction_log(client, deal_setup):
    r = client.post(
        f"{API}/deals/{deal_setup['deal']['id']}/interactions", json={"type": "email_sent"}
    )
    assert r.status_code == 422


def test_dashboard_followups_and_stale(client, deal_setup):
    cid = deal_setup["company"]["id"]
    now = datetime.now(UTC)
    due = client.post(
        f"{API}/deals",
        json={"company_id": cid, "next_followup_at": (now - timedelta(days=1)).isoformat()},
    ).json()
    future = client.post(
        f"{API}/deals",
        json={"company_id": cid, "next_followup_at": (now + timedelta(days=3)).isoformat()},
    ).json()
    stale = client.post(f"{API}/deals", json={"company_id": cid}).json()
    client.post(
        f"{API}/deals/{stale['id']}/interactions",
        json={"type": "call", "occurred_at": (now - timedelta(days=30)).isoformat()},
    )
    declined = client.post(
        f"{API}/deals",
        json={
            "company_id": cid,
            "stage": "declined",
            "next_followup_at": (now - timedelta(days=1)).isoformat(),
        },
    ).json()

    dash = client.get(f"{API}/dashboard").json()
    assert [d["id"] for d in dash["followups_due"]] == [due["id"]]
    assert [d["id"] for d in dash["stale"]] == [stale["id"]]
    ids = {d["id"] for d in dash["followups_due"] + dash["stale"]}
    assert future["id"] not in ids and declined["id"] not in ids
    assert dash["stage_counts"]["prospect"] == 4 and dash["stage_counts"]["declined"] == 1
