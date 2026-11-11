import pytest

from app.services.drafting import GenerationError, parse_draft

API = "/api/v1"


def gen(client, deal_setup, **extra):
    return client.post(
        f"{API}/drafts/generate",
        json={
            "deal_id": deal_setup["deal"]["id"],
            "contact_id": deal_setup["contact"]["id"],
            **extra,
        },
    )


def test_generated_draft_is_unapproved_and_unsent(client, deal_setup, mailer):
    r = gen(client, deal_setup)
    assert r.status_code == 201
    d = r.json()
    assert d["status"] == "draft" and d["generated_by_ai"] is True
    assert d["approved_by"] is None and d["sent_at"] is None
    assert mailer.sent == []
    # ...and it cannot be sent until a human approves it.
    assert client.post(f"{API}/drafts/{d['id']}/send").status_code == 409
    assert mailer.sent == []


def test_prompt_includes_history_for_followups(client, deal_setup, llm):
    did = deal_setup["deal"]["id"]
    client.post(
        f"{API}/deals/{did}/interactions",
        json={"type": "call", "content": "Said to ping after Diwali"},
    )
    assert (
        gen(client, deal_setup, kind="followup", instructions="Mention Diwali").status_code == 201
    )
    prompt = llm.calls[0]["user"]
    assert "Said to ping after Diwali" in prompt
    assert "Mention Diwali" in prompt
    assert "Acme" in prompt and "Raj" in prompt
    assert "brAInwave 3" in prompt  # event pitch comes from settings


def test_do_not_contact_is_refused_without_calling_llm(client, deal_setup, llm):
    client.patch(f"{API}/contacts/{deal_setup['contact']['id']}", json={"do_not_contact": True})
    assert gen(client, deal_setup).status_code == 409
    assert llm.calls == []


def test_llm_failure_returns_502_and_creates_nothing(client, deal_setup, llm):
    llm.fail = True
    assert gen(client, deal_setup).status_code == 502
    assert client.get(f"{API}/drafts").json() == []


def test_garbage_reply_returns_502(client, deal_setup, llm):
    llm.reply = "Sure! Here is your email."
    assert gen(client, deal_setup).status_code == 502
    assert client.get(f"{API}/drafts").json() == []


def test_contact_must_belong_to_deal(client, deal_setup):
    other = client.post(f"{API}/companies", json={"name": "Other"}).json()
    c = client.post(
        f"{API}/contacts", json={"company_id": other["id"], "name": "S", "email": "s@o.com"}
    ).json()
    r = client.post(
        f"{API}/drafts/generate",
        json={"deal_id": deal_setup["deal"]["id"], "contact_id": c["id"]},
    )
    assert r.status_code == 422


def test_parse_draft_handles_code_fences_and_chatter():
    text = 'Here you go:\n```json\n{"subject": " Hi ", "body": "Line1\\nLine2"}\n```\nThanks!'
    assert parse_draft(text) == ("Hi", "Line1\nLine2")


@pytest.mark.parametrize(
    "text", ["", "no json", '{"subject": "x"}', '{"subject": "", "body": "b"}', "{not json}"]
)
def test_parse_draft_rejects_bad_replies(text):
    with pytest.raises(GenerationError):
        parse_draft(text)
