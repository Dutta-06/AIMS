from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import DealStage, DraftStatus, InteractionSource, InteractionType


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LoginIn(BaseModel):
    password: str
    name: str = Field(min_length=1, max_length=100, description="Shown as the approver on sends")


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


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


# ---- contacts
class ContactIn(BaseModel):
    company_id: int
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    role: str | None = None
    linkedin: str | None = None


class ContactUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    email: EmailStr | None = None
    role: str | None = None
    linkedin: str | None = None
    do_not_contact: bool | None = None


class ContactOut(ORM):
    id: int
    company_id: int
    name: str
    email: EmailStr
    role: str | None
    linkedin: str | None
    do_not_contact: bool
    created_at: datetime


# ---- deals
class DealIn(BaseModel):
    company_id: int
    stage: DealStage = DealStage.PROSPECT
    owner: str | None = None
    target_amount: int | None = Field(default=None, ge=0)
    next_followup_at: datetime | None = None
    notes: str | None = None


class DealUpdate(BaseModel):
    stage: DealStage | None = None
    owner: str | None = None
    target_amount: int | None = Field(default=None, ge=0)
    committed_amount: int | None = Field(default=None, ge=0)
    next_followup_at: datetime | None = None
    notes: str | None = None


class DealOut(ORM):
    id: int
    company_id: int
    stage: DealStage
    owner: str | None
    target_amount: int | None
    committed_amount: int | None
    next_followup_at: datetime | None
    last_contacted_at: datetime | None
    notes: str | None
    created_at: datetime


# ---- interactions (manual logging; sends are logged by the send service)
class InteractionIn(BaseModel):
    type: InteractionType
    contact_id: int | None = None
    subject: str | None = None
    content: str | None = None
    occurred_at: datetime | None = None


class InteractionOut(ORM):
    id: int
    deal_id: int
    contact_id: int | None
    type: InteractionType
    source: InteractionSource
    subject: str | None
    content: str | None
    draft_id: int | None
    approved_by: str | None
    occurred_at: datetime


# ---- drafts
class DraftIn(BaseModel):
    deal_id: int
    contact_id: int
    subject: str = Field(min_length=1, max_length=500)
    body: str = Field(min_length=1)


class DraftUpdate(BaseModel):
    subject: str | None = Field(default=None, min_length=1, max_length=500)
    body: str | None = Field(default=None, min_length=1)


class DraftOut(ORM):
    id: int
    deal_id: int
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


# ---- dashboard
class DashboardOut(BaseModel):
    stage_counts: dict[DealStage, int]
    followups_due: list[DealOut]
    stale: list[DealOut]
