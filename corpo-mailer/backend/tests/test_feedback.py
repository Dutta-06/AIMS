"""Human feedback on drafts (email and LinkedIn notes): revise, undo, and the gate that stays shut."""

import json

API = "/api/v1"
NEW = {"subject": "A shorter pitch", "body": "Hi Raj, a quick note about brAInwave 3."}


def say(llm, subject="S", body="B"):
    return json.dumps({"subject": subject, "body": body})


def note(body):
    return json.dumps({"body": body})


def revise(client, draft, feedback="make it shorter"):
    return client.post(f"{API}/drafts/{draft['id']}/revise", json={"feedback": feedback})


def get(client, draft):
    return client.get(f"{API}/drafts/{draft['id']}").json()


def contact(client, lead):
    return client.get(f"{API}/contacts/{lead['contact']['id']}").json()


# ------------------------------------------------------------------ email: revise
def test_feedback_rewrites_the_draft_and_keeps_the_old_version(client, draft, llm):
    llm.reply = json.dumps(NEW)
    r = revise(client, draft, "make it shorter and mention the demo day")
    assert r.status_code == 200
    d = r.json()
    assert (d["subject"], d["body"]) == (NEW["subject"], NEW["body"]) and d["status"] == "draft"
    (old,) = d["history"]
    assert (old["subject"], old["body"], old["feedback"]) == (
        "Sponsor brAInwave 3",
        "Hello Raj",
        "make it shorter and mention the demo day",
    )


def test_the_model_sees_the_current_text_the_feedback_and_the_event_facts(client, draft, llm):
    llm.reply = json.dumps(NEW)
    revise(client, draft, "warmer please")
    sent_to_model = llm.calls[-1]
    assert "Hello Raj" in sent_to_model["user"] and "warmer please" in sent_to_model["user"]
    assert "brAInwave 3" in sent_to_model["user"] and "Raj Mehta" in sent_to_model["user"]
    assert "Never invent" in sent_to_model["system"]  # the facts-only rules still apply


def test_a_human_edit_made_before_revising_is_what_gets_revised_and_saved_in_history(
    client, draft, llm
):
    client.patch(f"{API}/drafts/{draft['id']}", json={"body": "My own wording"})
    llm.reply = json.dumps(NEW)
    d = revise(client, draft).json()
    assert "My own wording" in llm.calls[-1]["user"] and d["history"][0]["body"] == "My own wording"


def test_the_signature_is_kept_out_of_the_model_and_put_back(client, draft, llm, imap_settings):
    imap_settings.sender_signature = "Asha, brAInwave Team"
    client.patch(f"{API}/drafts/{draft['id']}", json={"body": "Hello Raj\n\nAsha, brAInwave Team"})
    llm.reply = json.dumps(NEW)
    d = revise(client, draft).json()
    assert "Asha, brAInwave Team" not in llm.calls[-1]["user"]
    assert d["body"] == NEW["body"] + "\n\nAsha, brAInwave Team"


def test_revising_voids_any_approval_and_the_new_text_must_be_approved_again(
    client, draft, llm, mailer
):
    client.post(f"{API}/drafts/{draft['id']}/approve")
    llm.reply = json.dumps(NEW)
    d = revise(client, draft).json()
    assert d["status"] == "draft" and d["approved_by"] is None and d["approved_at"] is None
    assert (
        client.post(f"{API}/drafts/{draft['id']}/send").status_code == 409
    )  # not approved any more
    assert mailer.sent == []
    client.post(f"{API}/drafts/{draft['id']}/approve")
    assert client.post(f"{API}/drafts/{draft['id']}/send").status_code == 200
    assert mailer.sent[0]["body"] == NEW["body"]  # what went out is what was approved


def test_a_sent_draft_cannot_be_revised(client, draft, llm):
    client.post(f"{API}/drafts/{draft['id']}/approve")
    client.post(f"{API}/drafts/{draft['id']}/send")
    calls = len(llm.calls)
    assert revise(client, draft).status_code == 409 and len(llm.calls) == calls


def test_feedback_is_required_and_bounded(client, draft):
    assert revise(client, draft, "").status_code == 422
    assert revise(client, draft, "x").status_code == 422
    assert revise(client, draft, "x" * 1001).status_code == 422


def test_a_model_failure_or_junk_reply_changes_nothing(client, draft, llm):
    llm.fail = True
    assert revise(client, draft).status_code == 502
    llm.fail = False
    for junk in ("sorry, no", '{"subject": "only"}', '{"subject": "", "body": ""}'):
        llm.reply = junk
        assert revise(client, draft).status_code == 502
    d = get(client, draft)
    assert (d["subject"], d["body"], d["history"]) == ("Sponsor brAInwave 3", "Hello Raj", [])


def test_do_not_contact_blocks_revising(client, draft, lead, llm):
    client.patch(f"{API}/contacts/{lead['contact']['id']}", json={"do_not_contact": True})
    calls = len(llm.calls)
    assert revise(client, draft).status_code == 502 and len(llm.calls) == calls


# ------------------------------------------------------------------ email: undo
def test_undo_steps_back_through_revisions(client, draft, llm):
    llm.queue = [say(llm, "S2", "B2"), say(llm, "S3", "B3")]
    revise(client, draft, "one")
    revise(client, draft, "two")
    assert get(client, draft)["body"] == "B3" and len(get(client, draft)["history"]) == 2
    u = client.post(f"{API}/drafts/{draft['id']}/undo").json()
    assert (u["body"], len(u["history"])) == ("B2", 1)
    u = client.post(f"{API}/drafts/{draft['id']}/undo").json()
    assert (u["subject"], u["body"], u["history"]) == ("Sponsor brAInwave 3", "Hello Raj", [])
    assert client.post(f"{API}/drafts/{draft['id']}/undo").status_code == 409  # nothing earlier


def test_undo_also_voids_approval(client, draft, llm):
    llm.reply = json.dumps(NEW)
    revise(client, draft)
    client.post(f"{API}/drafts/{draft['id']}/approve")
    d = client.post(f"{API}/drafts/{draft['id']}/undo").json()
    assert d["status"] == "draft" and d["approved_by"] is None


def test_history_keeps_only_the_latest_twenty(client, draft, llm):
    for i in range(23):
        llm.reply = say(llm, f"S{i}", f"B{i}")
        revise(client, draft, f"change {i}")
    h = get(client, draft)["history"]
    assert len(h) == 20 and h[-1]["body"] == "B21"


def test_a_sent_draft_cannot_be_undone(client, draft, llm):
    llm.reply = json.dumps(NEW)
    revise(client, draft)
    client.post(f"{API}/drafts/{draft['id']}/approve")
    client.post(f"{API}/drafts/{draft['id']}/send")
    assert client.post(f"{API}/drafts/{draft['id']}/undo").status_code == 409


# ------------------------------------------------------------------ LinkedIn notes
def gen_note(client, lead, **kw):
    return client.post(
        f"{API}/drafts/generate",
        json={"contact_id": lead["contact"]["id"], "channel": "linkedin", **kw},
    )


def test_a_linkedin_note_is_short_has_no_subject_or_signature_and_needs_no_email(
    client, llm, imap_settings
):
    imap_settings.sender_signature = "Asha, brAInwave Team"
    co = client.post(f"{API}/companies", json={"name": "NoMail"}).json()
    c = client.post(
        f"{API}/contacts",
        json={"company_id": co["id"], "name": "Priya", "linkedin": "https://linkedin.com/in/priya"},
    ).json()
    llm.reply = note("Hi Priya, we're organising brAInwave 3 at DTU and would love to connect.")
    r = client.post(f"{API}/drafts/generate", json={"contact_id": c["id"], "channel": "linkedin"})
    assert r.status_code == 201
    d = r.json()
    assert (d["channel"], d["subject"], d["status"], d["generated_by_ai"]) == (
        "linkedin",
        "LinkedIn note",
        "draft",
        True,
    )
    assert d["body"] == "Hi Priya, we're organising brAInwave 3 at DTU and would love to connect."
    assert "LinkedIn" in llm.calls[0]["system"] and "280" in llm.calls[0]["system"]


def test_email_drafts_still_need_an_email_address(client, llm):
    co = client.post(f"{API}/companies", json={"name": "NoMail"}).json()
    c = client.post(f"{API}/contacts", json={"company_id": co["id"], "name": "Priya"}).json()
    assert client.post(f"{API}/drafts/generate", json={"contact_id": c["id"]}).status_code == 409


def test_a_too_long_note_is_sent_back_for_a_shorter_one(client, lead, llm):
    llm.queue = [note("x" * 400), note("Short and sweet.")]
    d = gen_note(client, lead).json()
    assert d["body"] == "Short and sweet." and len(llm.calls) == 2
    assert "400 characters" in llm.calls[1]["user"]


def test_a_model_that_keeps_overrunning_saves_nothing(client, lead, llm):
    llm.reply = note("x" * 400)
    r = gen_note(client, lead)
    assert r.status_code == 502 and "too long" in r.json()["detail"]
    assert client.get(f"{API}/drafts").json() == []


def test_notes_can_be_revised_and_stay_within_the_limit(client, lead, llm):
    llm.reply = note("Hi Raj, would love to connect about brAInwave 3.")
    d = gen_note(client, lead).json()
    llm.queue = [note("y" * 350), note("Hi Raj, a warmer hello about brAInwave 3!")]
    r = revise(client, d, "warmer")
    assert r.status_code == 200
    assert (
        r.json()["body"] == "Hi Raj, a warmer hello about brAInwave 3!"
        and r.json()["subject"] == "LinkedIn note"
    )
    assert r.json()["history"][0]["body"] == "Hi Raj, would love to connect about brAInwave 3."
    assert "CURRENT NOTE" in llm.calls[-1]["user"]


def test_only_email_or_linkedin_drafts_exist(client, lead):
    for ch in ("discord", "personal", "carrier-pigeon"):
        r = client.post(
            f"{API}/drafts/generate", json={"contact_id": lead["contact"]["id"], "channel": ch}
        )
        assert r.status_code == 422
        r = client.post(
            f"{API}/drafts",
            json={"contact_id": lead["contact"]["id"], "channel": ch, "subject": "s", "body": "b"},
        )
        assert r.status_code == 422


# ------------------------------------------------------------------ the gate stays shut
def test_a_linkedin_note_can_never_be_approved_or_emailed(client, lead, llm, mailer):
    llm.reply = note("Hi Raj!")
    d = gen_note(client, lead).json()
    for action in ("approve", "send"):
        r = client.post(f"{API}/drafts/{d['id']}/{action}")
        assert r.status_code == 409 and "LinkedIn" in r.json()["detail"]
    assert mailer.sent == [] and get(client, d)["status"] == "draft"


def test_marking_a_note_sent_records_the_linkedin_outreach_without_sending_anything(
    client, lead, llm, mailer
):
    llm.reply = note("Hi Raj!")
    d = gen_note(client, lead).json()
    done = client.post(f"{API}/drafts/{d['id']}/mark-sent").json()
    assert done["status"] == "sent" and done["sent_at"]
    c = contact(client, lead)
    assert (c["status"], c["channels"]) == ("contacted", ["linkedin"]) and c["last_contacted_at"]
    (item,) = [
        i
        for i in client.get(f"{API}/contacts/{c['id']}/interactions").json()
        if i["draft_id"] == d["id"]
    ]
    assert (item["type"], item["channel"], item["content"]) == ("outreach", "linkedin", "Hi Raj!")
    assert mailer.sent == []
    assert client.post(f"{API}/drafts/{d['id']}/mark-sent").status_code == 409  # not twice


def test_an_email_can_never_be_marked_sent_by_hand(client, draft, lead):
    """Otherwise 'I sent it' would be a way round the approval gate."""
    r = client.post(f"{API}/drafts/{draft['id']}/mark-sent")
    assert r.status_code == 409
    assert (
        get(client, draft)["status"] == "draft"
        and contact(client, lead)["status"] == "not_contacted"
    )


def test_do_not_contact_blocks_marking_a_note_sent(client, lead, llm):
    llm.reply = note("Hi Raj!")
    d = gen_note(client, lead).json()
    client.patch(f"{API}/contacts/{lead['contact']['id']}", json={"do_not_contact": True})
    assert client.post(f"{API}/drafts/{d['id']}/mark-sent").status_code == 409
    assert get(client, d)["status"] == "draft"


def test_editing_a_note_by_hand_works_and_a_sent_note_is_locked(client, lead, llm):
    llm.reply = note("Hi Raj!")
    d = gen_note(client, lead).json()
    assert (
        client.patch(f"{API}/drafts/{d['id']}", json={"body": "Hello Raj!"}).json()["body"]
        == "Hello Raj!"
    )
    client.post(f"{API}/drafts/{d['id']}/mark-sent")
    assert client.patch(f"{API}/drafts/{d['id']}", json={"body": "again"}).status_code == 409
    assert revise(client, d).status_code == 409
