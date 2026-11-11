from datetime import UTC, datetime, timedelta

API = "/api/v1"


def make_contact(client, company_id, **kw):
    body = {"company_id": company_id, "name": "P", **kw}
    return client.post(f"{API}/contacts", json=body)


# ---- companies
def test_duplicate_company_name_conflicts(client):
    assert client.post(f"{API}/companies", json={"name": "Acme"}).status_code == 201
    assert client.post(f"{API}/companies", json={"name": "Acme"}).status_code == 409


def test_company_search_and_delete_cascades(client, lead):
    cid = lead["company"]["id"]
    assert [c["name"] for c in client.get(f"{API}/companies", params={"q": "acm"}).json()] == [
        "Acme"
    ]
    assert client.delete(f"{API}/companies/{cid}").status_code == 204
    assert client.get(f"{API}/contacts").json() == []


# ---- contacts
def test_a_contact_needs_something_to_identify_them(client, lead):
    cid = lead["company"]["id"]
    assert client.post(f"{API}/contacts", json={"company_id": cid}).status_code == 422
    assert client.post(f"{API}/contacts", json={"company_id": cid, "name": "  "}).status_code == 422
    for ok in ({"name": "A"}, {"email": "a@b.com"}, {"linkedin": "https://linkedin.com/in/a"}):
        assert client.post(f"{API}/contacts", json={"company_id": cid, **ok}).status_code == 201


def test_email_is_optional_but_validated(client, lead):
    cid = lead["company"]["id"]
    assert make_contact(client, cid, linkedin="https://linkedin.com/in/x").json()["email"] is None
    assert make_contact(client, cid, email="not-an-email").status_code == 422


def test_blank_strings_become_nulls(client, lead):
    c = make_contact(client, lead["company"]["id"], role="  ", remarks="").json()
    assert (c["role"], c["remarks"]) == (None, None)


def test_new_contacts_start_not_contacted_with_no_channels(client, lead):
    c = lead["contact"]
    assert (c["status"], c["channels"], c["last_contacted_at"]) == ("not_contacted", [], None)
    assert c["company_name"] == "Acme"


def test_channels_only_make_sense_once_contacted(client, lead):
    cid = lead["contact"]["id"]
    r = client.patch(f"{API}/contacts/{cid}", json={"channels": ["email"]})
    assert r.status_code == 422
    r = client.patch(
        f"{API}/contacts/{cid}",
        json={"status": "contacted", "channels": ["email", "linkedin", "email"]},
    )
    assert r.status_code == 200 and r.json()["channels"] == ["email", "linkedin"]  # de-duplicated
    back = client.patch(f"{API}/contacts/{cid}", json={"status": "not_contacted"}).json()
    assert back["channels"] == []  # going back to not contacted clears them


def test_marking_contacted_by_hand_starts_the_follow_up_clock(client, lead):
    c = client.patch(f"{API}/contacts/{lead['contact']['id']}", json={"status": "contacted"}).json()
    assert c["last_contacted_at"] is not None


def test_unknown_channel_or_status_is_rejected(client, lead):
    cid = lead["contact"]["id"]
    assert (
        client.patch(
            f"{API}/contacts/{cid}", json={"status": "contacted", "channels": ["fax"]}
        ).status_code
        == 422
    )
    assert client.patch(f"{API}/contacts/{cid}", json={"status": "won"}).status_code == 422


def test_cannot_blank_out_the_last_identifier(client, lead):
    c = make_contact(client, lead["company"]["id"], name="Only Name").json()
    assert client.patch(f"{API}/contacts/{c['id']}", json={"name": ""}).status_code == 422
    assert client.get(f"{API}/contacts/{c['id']}").json()["name"] == "Only Name"


def test_filters(client, lead):
    cid = lead["company"]["id"]
    other = client.post(f"{API}/companies", json={"name": "Zeta"}).json()
    make_contact(client, cid, name="Ann", role="CEO", remarks="met at expo").json()
    b = make_contact(client, other["id"], name="Bob").json()
    client.patch(f"{API}/contacts/{b['id']}", json={"status": "contacted", "channels": ["discord"]})

    def names(**p):
        return sorted(x["name"] for x in client.get(f"{API}/contacts", params=p).json())

    assert names(status="contacted") == ["Bob"]
    assert names(company_id=other["id"]) == ["Bob"]
    assert names(q="expo") == ["Ann"]  # searches remarks
    assert names(q="zeta") == ["Bob"]  # and company names
    assert names(q="devrel") == ["Raj Mehta"]  # and roles


# ---- logging interactions
def log(client, cid, **body):
    return client.post(f"{API}/contacts/{cid}/interactions", json=body)


def test_logging_outreach_marks_contacted_on_that_channel(client, lead):
    cid = lead["contact"]["id"]
    assert (
        log(client, cid, type="outreach", channel="linkedin", content="sent a request").status_code
        == 201
    )
    c = client.get(f"{API}/contacts/{cid}").json()
    assert (c["status"], c["channels"]) == ("contacted", ["linkedin"])
    assert c["last_contacted_at"] is not None
    log(client, cid, type="outreach", channel="discord")
    assert client.get(f"{API}/contacts/{cid}").json()["channels"] == ["linkedin", "discord"]


def test_outreach_and_reply_must_say_which_channel(client, lead):
    cid = lead["contact"]["id"]
    assert log(client, cid, type="outreach").status_code == 422
    assert log(client, cid, type="reply").status_code == 422


def test_logging_a_reply_marks_responded(client, lead):
    cid = lead["contact"]["id"]
    log(client, cid, type="outreach", channel="email")
    log(client, cid, type="reply", channel="email", content="Sounds good")
    assert client.get(f"{API}/contacts/{cid}").json()["status"] == "responded"


def test_outreach_never_moves_a_responded_contact_backwards(client, lead):
    cid = lead["contact"]["id"]
    log(client, cid, type="reply", channel="linkedin")
    log(client, cid, type="outreach", channel="email")  # a follow-up
    assert client.get(f"{API}/contacts/{cid}").json()["status"] == "responded"


def test_calls_and_notes_do_not_change_status(client, lead):
    cid = lead["contact"]["id"]
    log(client, cid, type="note", content="x")
    log(client, cid, type="call", content="y")
    c = client.get(f"{API}/contacts/{cid}").json()
    assert (
        c["status"] == "not_contacted" and c["last_contacted_at"] is not None
    )  # the call counts as contact


def test_cannot_fake_a_sent_email_via_the_log(client, lead):
    assert log(client, lead["contact"]["id"], type="email_sent").status_code == 422


def test_timeline_is_returned_oldest_first(client, lead):
    cid = lead["contact"]["id"]
    now = datetime.now(UTC)
    log(
        client,
        cid,
        type="note",
        content="second",
        occurred_at=(now - timedelta(days=1)).isoformat(),
    )
    log(
        client, cid, type="note", content="first", occurred_at=(now - timedelta(days=5)).isoformat()
    )
    assert [i["content"] for i in client.get(f"{API}/contacts/{cid}/interactions").json()] == [
        "first",
        "second",
    ]


# ---- dashboard
def test_dashboard_counts_and_follow_ups(client, lead):
    cid = lead["company"]["id"]
    now = datetime.now(UTC)
    quiet = make_contact(client, cid, name="Quiet").json()
    log(
        client,
        quiet["id"],
        type="outreach",
        channel="email",
        occurred_at=(now - timedelta(days=30)).isoformat(),
    )
    due = make_contact(client, cid, name="Due").json()
    client.patch(
        f"{API}/contacts/{due['id']}",
        json={"status": "contacted", "next_followup_at": (now - timedelta(days=1)).isoformat()},
    )
    fresh = make_contact(client, cid, name="Fresh").json()
    client.patch(f"{API}/contacts/{fresh['id']}", json={"status": "contacted"})
    future = make_contact(client, cid, name="Later").json()
    client.patch(
        f"{API}/contacts/{future['id']}",
        json={"status": "contacted", "next_followup_at": (now + timedelta(days=3)).isoformat()},
    )
    done = make_contact(client, cid, name="Done").json()
    client.patch(
        f"{API}/contacts/{done['id']}",
        json={"status": "responded", "next_followup_at": (now - timedelta(days=1)).isoformat()},
    )

    d = client.get(f"{API}/dashboard").json()
    assert d["total"] == 6
    assert d["status_counts"] == {
        "not_contacted": 1,
        "contacted": 4,
        "responded": 1,
        "no_response": 0,
    }
    assert sorted(x["name"] for x in d["needs_followup"]) == [
        "Due",
        "Quiet",
    ]  # not Fresh, Later or Done
    assert "owners" not in d


def test_do_not_contact_people_are_not_chased(client, lead):
    cid = lead["contact"]["id"]
    log(
        client,
        cid,
        type="outreach",
        channel="email",
        occurred_at=(datetime.now(UTC) - timedelta(days=30)).isoformat(),
    )
    client.patch(f"{API}/contacts/{cid}", json={"do_not_contact": True})
    assert client.get(f"{API}/dashboard").json()["needs_followup"] == []


def test_unread_replies_are_listed_separately_from_follow_ups(client, lead):
    cid = lead["contact"]["id"]
    log(
        client,
        cid,
        type="outreach",
        channel="email",
        occurred_at=(datetime.now(UTC) - timedelta(days=30)).isoformat(),
    )
    client.patch(f"{API}/contacts/{cid}", json={"reply_unread": True})
    d = client.get(f"{API}/dashboard").json()
    assert [c["id"] for c in d["new_replies"]] == [cid]
    assert d["needs_followup"] == []  # already surfaced as a reply
