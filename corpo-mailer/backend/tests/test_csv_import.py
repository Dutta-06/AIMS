"""CSV import/export, tested on an anonymised copy of the team's real spreadsheet layout."""

import pytest

from app.services import csv_import as svc

API = "/api/v1"

SHEET = """\
NAME,COMPANY NAME,POINT OF CONTACT,CONTACT,POSITION,STATUS,REMARKS
harshit,Orbit AI,Ana Lopez,https://www.linkedin.com/in/ana-lopez-123/,Founder/CEO,,linkedin request
Ritwik,Lumen Labs,Ben Ito,https://www.linkedin.com/in/benito/,CEO,,
Sidharth,Quill,Cara Nwosu,https://www.linkedin.com/in/cnwosu7/,Co-Founder,Contacted,
Shivansh,Nimbus,Dev Rao,https://www.linkedin.com/in/devrao/,Co-Founder,,mail sent
Abhinash,Globex,Eli Park,https://www.linkedin.com/in/elipark/,Community Manager,,V imp to note in the proposal
Abhinash,Globex,Fay Stone,https://www.linkedin.com/in/faystone-68420713/,University Relations Lead,Responded,
Piyush,Initech,Gus Mehta,https://www.linkedin.com/in/gusm/,DevRel,,request sent
,Palisade Networks,Hal Verma,https://www.linkedin.com/in/halv/,Director,,Actually the partnerships team handles this
Harshit,Firebrand,Ivy Chan,https://www.linkedin.com/in/ivychan/,Chief Growth Officer,No response,Also Discord
,Rivet,,opensource@rivet.example,,,
Ritwik,Tandem AI,Jon Ved,https://www.linkedin.com/in/jonved/,CEO,,Mail: jon.ved@tandem.example
"""


def rows(csv_text=SHEET, **kw):
    parsed, meta = svc.parse_rows(csv_text, **kw)
    return {(r.company, r.name): r for r in parsed}, meta


# ------------------------------------------------------------------ parsing
def test_headers_are_mapped_like_the_sheet_uses_them():
    _, meta = rows()
    assert meta["columns"] == {
        "owner": "NAME",
        "company": "COMPANY NAME",
        "person": "POINT OF CONTACT",
        "contact": "CONTACT",
        "role": "POSITION",
        "status": "STATUS",
        "remarks": "REMARKS",
    }
    assert meta["ignored_columns"] == []


def test_unrecognised_columns_are_reported_not_silently_dropped():
    _, meta = rows(
        SHEET.replace("REMARKS", "REMARKS,PRIORITY", 1).replace(
            "linkedin request", "linkedin request,high", 1
        )
    )
    assert meta["ignored_columns"] == ["PRIORITY"]


def test_NAME_is_the_teammate_and_owner_spelling_is_unified():
    parsed, _ = rows()
    assert (
        parsed[("Orbit AI", "Ana Lopez")].owner == "Harshit"
    )  # harshit and Harshit are one person
    assert parsed[("Firebrand", "Ivy Chan")].owner == "Harshit"
    assert parsed[("Palisade Networks", "Hal Verma")].owner is None  # blank owner stays unassigned


def test_the_contact_cell_can_be_a_linkedin_link_or_an_email():
    parsed, _ = rows()
    assert (
        parsed[("Orbit AI", "Ana Lopez")].linkedin == "https://www.linkedin.com/in/ana-lopez-123/"
    )
    assert parsed[("Orbit AI", "Ana Lopez")].email is None
    rivet = parsed[("Rivet", None)]  # a company inbox, no person
    assert (rivet.email, rivet.linkedin, rivet.name) == ("opensource@rivet.example", None, None)


def test_statuses_are_read_in_the_sheets_words():
    parsed, _ = rows()
    assert parsed[("Quill", "Cara Nwosu")].status.value == "contacted"
    assert parsed[("Globex", "Fay Stone")].status.value == "responded"
    assert parsed[("Firebrand", "Ivy Chan")].status.value == "no_response"
    assert parsed[("Lumen Labs", "Ben Ito")].status.value == "not_contacted"  # blank


def test_blank_status_with_strong_remarks_is_inferred_and_flagged():
    parsed, _ = rows()
    ana = parsed[("Orbit AI", "Ana Lopez")]  # "linkedin request"
    assert (ana.status.value, ana.channels) == ("contacted", ["linkedin"])
    assert any("remarks say so" in w for w in ana.warnings)
    assert parsed[("Nimbus", "Dev Rao")].channels == ["email"]  # "mail sent"
    assert parsed[("Initech", "Gus Mehta")].channels == ["linkedin"]  # "request sent"


def test_weak_hints_do_not_count_as_having_reached_out():
    parsed, _ = rows()
    for key in [("Globex", "Eli Park"), ("Palisade Networks", "Hal Verma")]:
        assert parsed[key].status.value == "not_contacted", key
    ivy = parsed[("Firebrand", "Ivy Chan")]  # "Also Discord" is a hint, not a Discord message
    assert "discord" not in ivy.channels


def test_an_email_hidden_in_the_remarks_is_used_and_flagged():
    jon = rows()[0][("Tandem AI", "Jon Ved")]
    assert jon.email == "jon.ved@tandem.example"
    assert any("taken from the remarks" in w for w in jon.warnings)
    assert jon.status.value == "not_contacted"  # "Mail: addr" is an address, not "mail sent"


def test_inference_can_be_turned_off():
    parsed, _ = rows(infer=False)
    assert parsed[("Orbit AI", "Ana Lopez")].status.value == "not_contacted"
    assert parsed[("Nimbus", "Dev Rao")].channels == []


def test_unknown_status_is_flagged_and_unreadable_contact_cells_are_kept():
    text = "COMPANY NAME,POINT OF CONTACT,CONTACT,STATUS\nAcme,Zed,call his PA,Maybe later\n"
    r = svc.parse_rows(text)[0][0]
    assert r.status.value == "not_contacted"
    assert any("Unknown status" in w for w in r.warnings) and any(
        "kept it in remarks" in w for w in r.warnings
    )
    assert r.remarks == "Contact: call his PA"


def test_explicit_channels_and_email_columns_are_honoured():
    text = 'COMPANY,PERSON,EMAIL,STATUS,CHANNELS\nAcme,Zed,Zed@Acme.com,Contacted,"email, Discord; fax"\n'
    r = svc.parse_rows(text)[0][0]
    assert (r.email, r.channels) == ("zed@acme.com", ["email", "discord"])  # unknown 'fax' dropped


def test_channels_are_dropped_for_someone_not_contacted():
    text = "COMPANY,PERSON,STATUS,CHANNELS\nAcme,Zed,,email\n"
    assert svc.parse_rows(text)[0][0].channels == []


@pytest.mark.parametrize("sep", [";", "\t"])
def test_other_delimiters_bom_and_windows_newlines(sep):
    text = "﻿" + SHEET.replace(",", sep).replace("\n", "\r\n")
    parsed, _ = svc.parse_rows(text)
    assert len(parsed) == 11 and parsed[0].company == "Orbit AI"


@pytest.mark.parametrize(
    "text,msg",
    [
        ("", "empty"),
        ("COMPANY NAME,STATUS\n", "header row and at least one"),
        ("NAME,POSITION\nharshit,CEO\n", "company column"),
    ],
)
def test_unusable_files_say_why(text, msg):
    with pytest.raises(svc.ImportError_, match=msg):
        svc.parse_rows(text)


def test_too_many_rows_is_refused():
    big = "COMPANY NAME,POINT OF CONTACT\n" + "\n".join(
        f"C{i},P{i}" for i in range(svc.MAX_ROWS + 1)
    )
    with pytest.raises(svc.ImportError_, match="more than"):
        svc.parse_rows(big)


def test_a_row_with_no_company_is_skipped_with_a_reason():
    parsed, _ = svc.parse_rows("COMPANY NAME,POINT OF CONTACT\n,Orphan\nAcme,Real\n")
    assert parsed[0].skip_reason == "No company on this row" and parsed[1].company == "Acme"


# ------------------------------------------------------------------ preview / commit
def post(client, path, csv_text=SHEET, **kw):
    return client.post(f"{API}/import/{path}", json={"csv": csv_text, **kw})


def test_preview_saves_nothing(client):
    r = post(client, "preview")
    assert r.status_code == 200
    assert r.json()["summary"] == {
        "rows": 11,
        "create": 11,
        "update": 0,
        "unchanged": 0,
        "skip": 0,
        "new_companies": 10,
    }
    assert (
        client.get(f"{API}/companies").json() == [] and client.get(f"{API}/contacts").json() == []
    )


def test_commit_does_what_the_preview_said(client):
    preview = post(client, "preview").json()["summary"]
    assert post(client, "commit").json() == preview
    assert len(client.get(f"{API}/companies").json()) == 10
    contacts = client.get(f"{API}/contacts").json()
    assert len(contacts) == 11  # Globex has two people under one company
    by = {(c["company_name"], c["name"]): c for c in contacts}
    ana = by[("Orbit AI", "Ana Lopez")]
    assert (ana["status"], ana["channels"], ana["owner"], ana["role"]) == (
        "contacted",
        ["linkedin"],
        "Harshit",
        "Founder/CEO",
    )
    assert by[("Rivet", None)]["email"] == "opensource@rivet.example"
    assert by[("Globex", "Eli Park")]["remarks"] == "V imp to note in the proposal"


def test_imported_contacted_rows_start_their_follow_up_clock(client):
    post(client, "commit")
    by = {(c["company_name"], c["name"]): c for c in client.get(f"{API}/contacts").json()}
    assert by[("Quill", "Cara Nwosu")]["last_contacted_at"] is not None  # the sheet has no date
    assert by[("Lumen Labs", "Ben Ito")]["last_contacted_at"] is None  # never contacted


def test_importing_twice_changes_nothing(client):
    post(client, "commit")
    again = post(client, "preview").json()["summary"]
    assert (again["create"], again["update"], again["skip"], again["new_companies"]) == (0, 0, 0, 0)
    assert again["unchanged"] == 11
    post(client, "commit")
    assert len(client.get(f"{API}/contacts").json()) == 11


def test_a_reimport_moves_status_forward_and_fills_blanks(client):
    post(client, "commit")
    updated = SHEET.replace(
        "Ritwik,Lumen Labs,Ben Ito,https://www.linkedin.com/in/benito/,CEO,,",
        "Ritwik,Lumen Labs,Ben Ito,https://www.linkedin.com/in/benito,CEO,Responded,Met at expo",
    )
    r = post(client, "preview", updated).json()
    ben = next(x for x in r["rows"] if x["name"] == "Ben Ito")
    assert ben["action"] == "update"  # matched despite the trailing slash difference
    assert {"status: not_contacted → responded", "remarks: — → Met at expo"} <= set(ben["changes"])
    assert r["summary"]["update"] == 1 and r["summary"]["create"] == 0
    post(client, "commit", updated)
    c = next(c for c in client.get(f"{API}/contacts").json() if c["name"] == "Ben Ito")
    assert (c["status"], c["remarks"]) == ("responded", "Met at expo")


def test_by_default_the_sheet_never_overwrites_work_done_in_the_app(client):
    post(client, "commit")
    cid = next(c["id"] for c in client.get(f"{API}/contacts").json() if c["name"] == "Cara Nwosu")
    client.patch(
        f"{API}/contacts/{cid}",
        json={"status": "responded", "remarks": "Call booked", "owner": "Mayank"},
    )
    # the sheet still says Contacted, with no remarks and another owner
    post(client, "commit", SHEET.replace("Sidharth,Quill", "Sidharth,Quill"))
    c = client.get(f"{API}/contacts/{cid}").json()
    assert (c["status"], c["remarks"], c["owner"]) == (
        "responded",
        "Call booked",
        "Mayank",
    )  # untouched


def test_overwrite_mode_makes_the_sheet_authoritative(client):
    post(client, "commit")
    cid = next(c["id"] for c in client.get(f"{API}/contacts").json() if c["name"] == "Cara Nwosu")
    client.patch(f"{API}/contacts/{cid}", json={"status": "responded", "owner": "Mayank"})
    post(client, "commit", SHEET, overwrite=True)
    c = client.get(f"{API}/contacts/{cid}").json()
    assert (c["status"], c["owner"]) == ("contacted", "Sidharth")


def test_the_same_person_twice_in_one_file_is_imported_once(client):
    dup = SHEET + "Ritwik,Lumen Labs,Ben Ito,https://linkedin.com/in/benito?trk=x,CEO,,\n"
    r = post(client, "preview", dup).json()
    assert r["summary"]["skip"] == 1
    assert next(x for x in r["rows"] if x["action"] == "skip")["reason"] == "Same person as line 3"


def test_existing_people_are_found_by_email_then_by_name(client):
    co = client.post(f"{API}/companies", json={"name": "ACME  Corp"}).json()  # spacing/case differ
    a = client.post(
        f"{API}/contacts",
        json={"company_id": co["id"], "name": "Old Name", "email": "pat@acme.com"},
    ).json()
    b = client.post(f"{API}/contacts", json={"company_id": co["id"], "name": "Sam Roe"}).json()
    text = "COMPANY NAME,POINT OF CONTACT,EMAIL,POSITION\nacme corp,Pat Q,pat@acme.com,CTO\nAcme Corp,sam roe,,Lead\n"
    r = post(client, "commit", text).json()
    assert (r["create"], r["update"], r["new_companies"]) == (
        0,
        2,
        0,
    )  # no duplicates, no new company
    assert client.get(f"{API}/contacts/{a['id']}").json()["role"] == "CTO"
    assert client.get(f"{API}/contacts/{b['id']}").json()["role"] == "Lead"


def test_a_company_only_row_creates_just_the_company(client):
    r = post(client, "commit", "COMPANY NAME,POINT OF CONTACT\nSolo Inc,\n").json()
    assert r["new_companies"] == 1 and client.get(f"{API}/contacts").json() == []
    assert (
        post(client, "preview", "COMPANY NAME,POINT OF CONTACT\nSolo Inc,\n").json()["summary"][
            "new_companies"
        ]
        == 0
    )


def test_bad_files_return_a_readable_422(client):
    r = post(client, "preview", "NAME,POSITION\nharshit,CEO\n")
    assert r.status_code == 422 and "company column" in r.json()["detail"]
    assert post(client, "commit", "").status_code == 422


def test_import_requires_the_request_header(client):
    client.headers.pop("X-Corpo-Mailer")
    assert post(client, "commit").status_code == 403


# ------------------------------------------------------------------ export
def test_export_has_the_sheets_columns_first_and_readable_status_labels(client):
    post(client, "commit")
    r = client.get(f"{API}/export.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    lines = r.text.splitlines()
    assert (
        lines[0]
        == "NAME,COMPANY NAME,POINT OF CONTACT,CONTACT,POSITION,STATUS,REMARKS,EMAIL,CHANNELS"
    )
    assert any(
        ln.startswith(
            "Harshit,Orbit AI,Ana Lopez,https://www.linkedin.com/in/ana-lopez-123/,Founder/CEO,Contacted"
        )
        for ln in lines
    )
    assert any(",Responded," in ln for ln in lines) and any(",No response," in ln for ln in lines)


def test_export_then_import_is_a_no_op(client):
    post(client, "commit")
    exported = client.get(f"{API}/export.csv").text
    s = post(client, "preview", exported).json()["summary"]
    assert (s["create"], s["update"], s["skip"], s["new_companies"]) == (0, 0, 0, 0)
    assert s["unchanged"] == 11


def test_export_into_a_fresh_database_recreates_the_same_people(client, db_session):
    post(client, "commit")
    exported = client.get(f"{API}/export.csv").text
    for c in client.get(f"{API}/companies").json():
        client.delete(f"{API}/companies/{c['id']}")
    post(client, "commit", exported)
    by = {(c["company_name"], c["name"]): c for c in client.get(f"{API}/contacts").json()}
    assert len(by) == 11
    ana = by[("Orbit AI", "Ana Lopez")]
    assert (ana["status"], ana["channels"], ana["owner"]) == ("contacted", ["linkedin"], "Harshit")
    assert by[("Tandem AI", "Jon Ved")]["email"] == "jon.ved@tandem.example"
