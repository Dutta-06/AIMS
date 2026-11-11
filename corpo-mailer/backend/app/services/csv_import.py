"""Import and export the outreach tracker as CSV (the shape of the team's Google Sheet).

Design rules:
  * Preview and commit run the *same* plan, so what you review is what gets saved.
  * Re-importing is safe: people are matched (LinkedIn link, then email, then name within the
    company) and updated instead of duplicated.
  * By default an import only fills blanks and moves a status *forward* (never regresses a lead,
    never overwrites what someone typed in the app). `overwrite` makes the sheet authoritative.
  * Anything the importer had to guess is flagged on its row.
"""

import csv
import io
import re
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.db.base import utcnow
from app.models import Company, Contact
from app.models.enums import Channel, ContactStatus
from app.schemas.api import EMAIL_RE

MAX_ROWS = 5000

# header text (lower-cased) -> field. In the team's sheet NAME is the *teammate*, not the contact.
ALIASES: dict[str, set[str]] = {
    "owner": {"name", "owner", "assigned to", "assignee", "handled by", "teammate", "member"},
    "company": {"company name", "company", "organisation", "organization"},
    "person": {"point of contact", "contact person", "person", "poc", "contact name"},
    "contact": {"contact", "linkedin", "linkedin url", "profile", "link"},
    "email": {"email", "e mail", "email address"},
    "role": {"position", "role", "title", "designation", "job title"},
    "status": {"status"},
    "remarks": {"remarks", "remark", "notes", "comments"},
    "channels": {"channels", "channel"},
}

STATUS_WORDS: dict[str, ContactStatus] = {
    **dict.fromkeys(
        ["", "not contacted", "new", "todo", "to do", "pending"], ContactStatus.NOT_CONTACTED
    ),
    **dict.fromkeys(
        ["contacted", "reached", "reached out", "sent", "messaged"], ContactStatus.CONTACTED
    ),
    **dict.fromkeys(["responded", "replied", "response", "responded yes"], ContactStatus.RESPONDED),
    **dict.fromkeys(
        ["no response", "no reply", "not responded", "no resp", "ghosted"],
        ContactStatus.NO_RESPONSE,
    ),
}

# Only strong phrases count as evidence that we already reached out. "Mail: x@y.com" is an
# address, not proof of an email, and "also Discord" is a hint, not a message.
INFER: dict[Channel, re.Pattern] = {
    Channel.LINKEDIN: re.compile(
        r"linkedin\s*(request|message|dm|connect)|(connection\s*)?request\s*sent|connection\s*sent",
        re.I,
    ),
    Channel.EMAIL: re.compile(r"\b(e-?mail|mail)(ed)?\s*sent\b|\bemailed\b|\bmailed\b", re.I),
    Channel.DISCORD: re.compile(
        r"discord\s*(dm|message)|(dm|messag)\w*\s*(on|via)?\s*discord", re.I
    ),
    Channel.PERSONAL: re.compile(r"\bin person\b|\bpersonal(ly)?\b|\bwhatsapp\b", re.I),
}
LINKEDIN_RE = re.compile(r"(?:https?://)?(?:[\w-]+\.)?linkedin\.com/[^\s,;]+", re.I)


class ImportError_(ValueError):
    """The file can't be used at all; the message is safe to show."""


# ------------------------------------------------------------------ normalisation
def norm_company(name: str) -> str:
    return re.sub(r"\s+", " ", name).strip().casefold()


def norm_linkedin(url: str) -> str:
    u = re.sub(r"^https?://", "", url.strip(), flags=re.I)
    u = re.sub(r"^www\.", "", u, flags=re.I).split("?")[0].split("#")[0]
    return u.rstrip("/").lower()


def canonical_owner(name: str, seen: dict[str, str]) -> str:
    """'harshit' and 'Harshit' are one person; keep one spelling (title-cased if all one case)."""
    name = re.sub(r"\s+", " ", name).strip()
    key = name.casefold()
    if key not in seen:
        seen[key] = name.title() if name in (name.lower(), name.upper()) else name
    return seen[key]


def _status(text: str) -> ContactStatus | None:
    return STATUS_WORDS.get(re.sub(r"[\s_\-]+", " ", text.strip().lower()))


# ------------------------------------------------------------------ parsing
@dataclass
class ParsedRow:
    line: int
    company: str
    owner: str | None = None
    name: str | None = None
    email: str | None = None
    linkedin: str | None = None
    role: str | None = None
    status: ContactStatus = ContactStatus.NOT_CONTACTED
    channels: list[str] = field(default_factory=list)
    remarks: str | None = None
    warnings: list[str] = field(default_factory=list)
    skip_reason: str | None = None


def read_table(text: str) -> tuple[list[str], list[list[str]]]:
    text = text.lstrip("﻿")
    if not text.strip():
        raise ImportError_("The file is empty")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    rows = [r for r in csv.reader(io.StringIO(text), dialect) if any(c.strip() for c in r)]
    if len(rows) < 2:
        raise ImportError_("I need a header row and at least one data row")
    if len(rows) - 1 > MAX_ROWS:
        raise ImportError_(f"That's more than {MAX_ROWS} rows; split the file")
    return rows[0], rows[1:]


def map_headers(header: list[str]) -> tuple[dict[str, int], list[str]]:
    """field -> column index, plus the headers we don't use."""
    found: dict[str, int] = {}
    ignored: list[str] = []
    for i, h in enumerate(header):
        key = re.sub(r"[\W_]+", " ", h.lower()).strip()
        field_ = next((f for f, names in ALIASES.items() if key in names and f not in found), None)
        if field_:
            found[field_] = i
        elif h.strip():
            ignored.append(h.strip())
    if "company" not in found:
        raise ImportError_("I couldn't find a company column (looked for COMPANY NAME or COMPANY)")
    return found, ignored


def parse_rows(text: str, infer: bool = True) -> tuple[list[ParsedRow], dict]:
    header, body = read_table(text)
    cols, ignored = map_headers(header)
    owners: dict[str, str] = {}
    out: list[ParsedRow] = []

    def cell(row: list[str], f: str) -> str:
        i = cols.get(f)
        return row[i].strip() if i is not None and i < len(row) else ""

    for n, row in enumerate(body, start=2):  # line 1 is the header
        company = re.sub(r"\s+", " ", cell(row, "company"))
        if not company:
            out.append(ParsedRow(n, "", skip_reason="No company on this row"))
            continue
        r = ParsedRow(n, company)
        if cell(row, "owner"):
            r.owner = canonical_owner(cell(row, "owner"), owners)
        r.name = cell(row, "person") or None
        r.role = cell(row, "role") or None
        r.remarks = cell(row, "remarks") or None

        # CONTACT is a LinkedIn link or an email (the sheet mixes both in one column)
        raw = cell(row, "contact")
        linkedin = LINKEDIN_RE.search(raw)
        emails = EMAIL_RE.findall(raw)
        if linkedin:
            r.linkedin = linkedin.group(0)
        if emails:
            r.email = emails[0].lower()
        if raw and not (linkedin or emails):
            r.warnings.append(f"Couldn't read the contact cell ({raw[:40]!r}); kept it in remarks")
            r.remarks = f"{r.remarks}\nContact: {raw}" if r.remarks else f"Contact: {raw}"
        if cell(row, "email"):
            found = EMAIL_RE.findall(cell(row, "email"))
            if found:
                r.email = found[0].lower()
            else:
                r.warnings.append(f"Ignored an invalid email ({cell(row, 'email')[:40]!r})")

        # an address hiding in the remarks ("Mail: someone@company.com") when there is none yet
        if not r.email and r.remarks:
            hidden = list(dict.fromkeys(m.lower() for m in EMAIL_RE.findall(r.remarks)))
            if len(hidden) == 1:
                r.email = hidden[0]
                r.warnings.append(f"Email {hidden[0]} was taken from the remarks")
            elif len(hidden) > 1:
                r.warnings.append("Several emails in the remarks; add the right one by hand")

        status_text = cell(row, "status")
        status = _status(status_text)
        if status is None:
            r.warnings.append(f"Unknown status {status_text!r}; imported as Not contacted")
            status = ContactStatus.NOT_CONTACTED
        r.status = status

        channels: list[str] = []
        for token in re.split(r"[,;/|\s]+", cell(row, "channels").lower()):
            if token and token in {c.value for c in Channel}:
                channels.append(token)
        if infer and r.remarks:
            hits = [c.value for c, rx in INFER.items() if rx.search(r.remarks)]
            if hits and r.status == ContactStatus.NOT_CONTACTED:
                r.status = ContactStatus.CONTACTED
                r.warnings.append(
                    f"Marked Contacted because the remarks say so ({', '.join(hits)})"
                )
            if r.status != ContactStatus.NOT_CONTACTED:
                channels += [h for h in hits if h not in channels]
        r.channels = channels if r.status != ContactStatus.NOT_CONTACTED else []
        out.append(r)
    return out, {"columns": {f: header[i] for f, i in cols.items()}, "ignored_columns": ignored}


# ------------------------------------------------------------------ planning
@dataclass
class _Rec:  # a contact: already in the database, or planned by an earlier row of this file
    id: int | None
    name: str | None
    email: str | None
    linkedin: str | None
    role: str | None
    owner: str | None
    status: ContactStatus
    channels: list[str]
    remarks: str | None
    first_line: int | None = None  # set for contacts created by this file


@dataclass
class PlannedRow:
    line: int
    action: str  # create | update | unchanged | skip
    company: str = ""
    company_new: bool = False
    name: str | None = None
    owner: str | None = None
    status: str = "not_contacted"
    channels: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    reason: str | None = None
    changes: list[str] = field(default_factory=list)
    # internal, for apply():
    contact_id: int | None = None
    company_key: str = ""
    values: dict = field(default_factory=dict)

    def public(self) -> dict:
        d = {
            k: v
            for k, v in self.__dict__.items()
            if k not in {"contact_id", "company_key", "values"}
        }
        return d


@dataclass
class Plan:
    rows: list[PlannedRow]
    new_companies: dict[str, str]  # key -> display name
    meta: dict

    def summary(self) -> dict:
        counts = {"create": 0, "update": 0, "unchanged": 0, "skip": 0}
        for r in self.rows:
            counts[r.action] += 1
        return {"rows": len(self.rows), **counts, "new_companies": len(self.new_companies)}


def _find(recs: list[_Rec], row: ParsedRow) -> _Rec | None:
    if row.linkedin:
        want = norm_linkedin(row.linkedin)
        hit = next((r for r in recs if r.linkedin and norm_linkedin(r.linkedin) == want), None)
        if hit:
            return hit
    if row.email:
        hit = next((r for r in recs if r.email and r.email.lower() == row.email), None)
        if hit:
            return hit
    if row.name:
        return next((r for r in recs if r.name and r.name.casefold() == row.name.casefold()), None)
    return None


def _merge(rec: _Rec, row: ParsedRow, overwrite: bool) -> tuple[dict, list[str]]:
    """What should change on an existing contact. Fill blanks; only move a status forward."""
    values: dict = {}
    notes: list[str] = []

    def put(attr: str, new, label: str):
        old = getattr(rec, attr)
        if new in (None, "") or new == old:
            return
        if old in (None, "") or overwrite:
            values[attr] = new
            notes.append(f"{label}: {old or '—'} → {new}")
            setattr(rec, attr, new)

    for attr, label in (
        ("name", "name"),
        ("email", "email"),
        ("linkedin", "LinkedIn"),
        ("role", "role"),
        ("owner", "owner"),
        ("remarks", "remarks"),
    ):
        put(attr, getattr(row, attr), label)
    if row.status != rec.status:
        advance = (
            rec.status == ContactStatus.NOT_CONTACTED and row.status != ContactStatus.NOT_CONTACTED
        )
        if advance or (overwrite and row.status != ContactStatus.NOT_CONTACTED):
            notes.append(f"status: {rec.status.value} → {row.status.value}")
            values["status"] = row.status
            rec.status = row.status
    merged = (
        list(dict.fromkeys([*rec.channels, *row.channels]))
        if rec.status != ContactStatus.NOT_CONTACTED
        else []
    )
    if merged != rec.channels:
        notes.append(f"channels: {', '.join(rec.channels) or '—'} → {', '.join(merged) or '—'}")
        values["channels"] = merged
        rec.channels = merged
    return values, notes


def plan_import(db: Session, text: str, overwrite: bool = False, infer: bool = True) -> Plan:
    parsed, meta = parse_rows(text, infer)
    companies = {
        norm_company(c.name): c
        for c in db.scalars(select(Company).options(joinedload(Company.contacts))).unique()
    }
    recs: dict[str, list[_Rec]] = {
        key: [
            _Rec(
                c.id,
                c.name,
                c.email,
                c.linkedin,
                c.role,
                c.owner,
                c.status,
                list(c.channels),
                c.remarks,
            )
            for c in comp.contacts
        ]
        for key, comp in companies.items()
    }
    new_companies: dict[str, str] = {}
    rows: list[PlannedRow] = []

    for p in parsed:
        if p.skip_reason:
            rows.append(PlannedRow(p.line, "skip", reason=p.skip_reason))
            continue
        key = norm_company(p.company)
        is_new = key not in companies and key not in new_companies
        if is_new:
            new_companies[key] = p.company
            recs[key] = []
        row = PlannedRow(
            p.line,
            "unchanged",
            company=p.company,
            company_new=is_new,
            name=p.name,
            owner=p.owner,
            status=p.status.value,
            channels=p.channels,
            warnings=list(p.warnings),
            company_key=key,
        )
        if not (p.name or p.email or p.linkedin):
            row.reason = "No person on this row"
            row.action = "create" if is_new else "unchanged"
            if is_new:
                row.changes = ["new company"]
            rows.append(row)
            continue
        rec = _find(recs[key], p)
        if rec is None:
            rec = _Rec(
                None,
                p.name,
                p.email,
                p.linkedin,
                p.role,
                p.owner,
                p.status,
                list(p.channels),
                p.remarks,
                first_line=p.line,
            )
            recs[key].append(rec)
            row.action = "create"
            row.values = {
                "name": p.name,
                "email": p.email,
                "linkedin": p.linkedin,
                "role": p.role,
                "owner": p.owner,
                "status": p.status,
                "channels": list(p.channels),
                "remarks": p.remarks,
            }
            row.changes = ["new company, new contact"] if is_new else ["new contact"]
        elif rec.first_line is not None:
            row.action = "skip"
            row.reason = f"Same person as line {rec.first_line}"
        else:
            row.contact_id = rec.id
            row.values, row.changes = _merge(rec, p, overwrite)
            row.action = "update" if row.values else "unchanged"
        rows.append(row)
    return Plan(rows, new_companies, meta)


def apply_plan(db: Session, plan: Plan) -> dict:
    ids: dict[str, int] = {norm_company(c.name): c.id for c in db.scalars(select(Company)).all()}
    for key, name in plan.new_companies.items():
        c = Company(name=name, source="CSV import")
        db.add(c)
        db.flush()
        ids[key] = c.id
    now = utcnow()
    for row in plan.rows:
        if row.action == "create" and row.values:
            v = dict(row.values)
            contact = Contact(company_id=ids[row.company_key], **v)
            if contact.status != ContactStatus.NOT_CONTACTED:
                contact.last_contacted_at = now  # the real date isn't in the sheet
            db.add(contact)
        elif row.action == "update":
            contact = db.get(Contact, row.contact_id)
            for attr, val in row.values.items():
                setattr(contact, attr, val)
            if contact.status != ContactStatus.NOT_CONTACTED and contact.last_contacted_at is None:
                contact.last_contacted_at = now
    db.commit()
    return plan.summary()


# ------------------------------------------------------------------ export
LABEL = {
    ContactStatus.NOT_CONTACTED: "",
    ContactStatus.CONTACTED: "Contacted",
    ContactStatus.RESPONDED: "Responded",
    ContactStatus.NO_RESPONSE: "No response",
}
EXPORT_HEADER = [
    "NAME",
    "COMPANY NAME",
    "POINT OF CONTACT",
    "CONTACT",
    "POSITION",
    "STATUS",
    "REMARKS",
    "EMAIL",
    "CHANNELS",
]


def export_csv(db: Session) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(EXPORT_HEADER)
    contacts = db.scalars(
        select(Contact)
        .join(Company)
        .options(joinedload(Contact.company))
        .order_by(Company.name, Contact.name)
    ).unique()
    for c in contacts:
        w.writerow(
            [
                c.owner or "",
                c.company.name,
                c.name or "",
                c.linkedin or c.email or "",
                c.role or "",
                LABEL[c.status],
                c.remarks or "",
                c.email or "",
                ", ".join(c.channels),
            ]
        )
    return out.getvalue()
