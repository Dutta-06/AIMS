import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.models.enums import (
    Channel,
    ContactStatus,
    DraftStatus,
    InteractionSource,
    InteractionType,
    ProspectState,
    Verdict,
)
from app.services.drafting import DraftKind


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


def _blank_to_none(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def _dedupe(channels: list[Channel]) -> list[Channel]:
    return list(dict.fromkeys(channels))


# ---- companies
class CompanyIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    industry: str | None = None
    website: str | None = None
    source: str | None = None
    notes: str | None = None


class CompanyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    industry: str | None = None
    website: str | None = None
    source: str | None = None
    notes: str | None = None


class CompanyOut(ORM, CompanyIn):
    id: int
    created_at: datetime


# ---- contacts (the rows the team tracks)
class ContactIn(BaseModel):
    company_id: int
    name: str | None = Field(default=None, max_length=200)
    email: EmailStr | None = None
    linkedin: str | None = Field(default=None, max_length=500)
    role: str | None = Field(default=None, max_length=200)
    status: ContactStatus = ContactStatus.NOT_CONTACTED
    channels: list[Channel] = []
    remarks: str | None = None
    next_followup_at: datetime | None = None

    _clean = field_validator("name", "email", "linkedin", "role", "remarks", mode="before")(
        _blank_to_none
    )

    @model_validator(mode="after")
    def _identifiable(self):
        if not (self.name or self.email or self.linkedin):
            raise ValueError("Give the contact a name, an email or a LinkedIn link")
        self.channels = _dedupe(self.channels)
        return self


class ContactUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    email: EmailStr | None = None
    linkedin: str | None = Field(default=None, max_length=500)
    role: str | None = Field(default=None, max_length=200)
    status: ContactStatus | None = None
    channels: list[Channel] | None = None
    remarks: str | None = None
    do_not_contact: bool | None = None
    next_followup_at: datetime | None = None
    reply_unread: bool | None = None

    _clean = field_validator("name", "email", "linkedin", "role", "remarks", mode="before")(
        _blank_to_none
    )

    @field_validator("channels")
    @classmethod
    def _dedupe_channels(cls, v):
        return _dedupe(v) if v is not None else v


class ContactOut(ORM):
    id: int
    company_id: int
    company_name: str
    name: str | None
    email: str | None
    linkedin: str | None
    role: str | None
    status: ContactStatus
    channels: list[Channel]
    remarks: str | None
    do_not_contact: bool
    last_contacted_at: datetime | None
    next_followup_at: datetime | None
    reply_unread: bool
    created_at: datetime
    updated_at: datetime


# ---- interactions (manual logging; sent emails are logged by the send gate)
class InteractionIn(BaseModel):
    type: InteractionType
    channel: Channel | None = None
    subject: str | None = None
    content: str | None = None
    occurred_at: datetime | None = None

    @model_validator(mode="after")
    def _channel_rules(self):
        if self.type in (InteractionType.OUTREACH, InteractionType.REPLY) and self.channel is None:
            raise ValueError("Say which channel (email, linkedin, discord or personal)")
        return self


class InteractionOut(ORM):
    id: int
    contact_id: int
    type: InteractionType
    channel: Channel | None
    source: InteractionSource
    subject: str | None
    content: str | None
    draft_id: int | None
    approved_by: str | None
    occurred_at: datetime


# ---- drafts
class DraftIn(BaseModel):
    contact_id: int
    subject: str = Field(min_length=1, max_length=500)
    body: str = Field(min_length=1)


class DraftUpdate(BaseModel):
    subject: str | None = Field(default=None, min_length=1, max_length=500)
    body: str | None = Field(default=None, min_length=1)


class DraftOut(ORM):
    id: int
    contact_id: int
    subject: str
    body: str
    status: DraftStatus
    generated_by_ai: bool
    approved_by: str | None
    approved_at: datetime | None
    sent_at: datetime | None
    last_error: str | None
    created_at: datetime


class GenerateIn(BaseModel):
    contact_id: int
    kind: DraftKind = DraftKind.INTRO
    instructions: str | None = Field(default=None, max_length=1000)


# ---- dashboard
class DashboardOut(BaseModel):
    total: int
    status_counts: dict[ContactStatus, int]
    needs_followup: list[ContactOut]
    new_replies: list[ContactOut]


class SyncOut(BaseModel):
    fetched: int
    replies: int
    bounces: int
    ignored: int
    unmatched: int


class ReplyStatusOut(BaseModel):
    configured: bool
    polling: bool
    last_sync_at: datetime | None
    last_error: str | None


EMAIL_RE = re.compile(r"[\w.+'-]+@[\w-]+(?:\.[\w-]+)+")


# ---- discovery
class EvidenceOut(BaseModel):
    url: str
    title: str = ""
    kind: str = "page"
    snippet: str = ""
    fetched_at: str | None = None
    last_modified: str | None = None
    signal: bool = False


class FoundEmail(BaseModel):
    email: str
    source_url: str


class ProspectOut(ORM):
    id: int
    name: str
    website: str | None
    domain: str | None
    industry: str | None
    why: str | None
    state: ProspectState
    verdict: Verdict
    verdict_note: str | None
    checked_at: datetime | None
    expires_at: datetime | None
    snoozed_until: datetime | None
    stale: bool
    evidence: list[EvidenceOut]
    emails: list[FoundEmail]
    linkedin_search_url: str
    company_id: int | None
    created_at: datetime


class SuggestIn(BaseModel):
    count: int = Field(default=8, ge=1, le=20)
    focus: str | None = Field(default=None, max_length=300)


class SuggestOut(BaseModel):
    added: list[ProspectOut]
    skipped_duplicates: int


class VerifyIn(BaseModel):
    website: str | None = Field(default=None, max_length=300, description="Correct the address")


class SnoozeIn(BaseModel):
    days: int = Field(default=30, ge=1, le=365)


class AcceptOut(BaseModel):
    company_id: int
    prospect: ProspectOut
