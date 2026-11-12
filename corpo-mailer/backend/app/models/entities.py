from datetime import datetime
from urllib.parse import quote

from sqlalchemy import JSON, ForeignKey, String, Text, false
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, UTCDateTime, utcnow
from app.models.enums import (
    Channel,
    ContactStatus,
    DraftStatus,
    InteractionSource,
    InteractionType,
    ProspectState,
    Verdict,
)


def _enum(e):
    return SAEnum(e, native_enum=False, length=32, values_callable=lambda x: [m.value for m in x])


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    industry: Mapped[str | None] = mapped_column(String(100))
    website: Mapped[str | None] = mapped_column(String(300))
    source: Mapped[str | None] = mapped_column(String(200))  # where we found this lead
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    contacts: Mapped[list["Contact"]] = relationship(
        back_populates="company", cascade="all, delete-orphan", order_by="Contact.name"
    )


class Contact(Base):
    """One person (or one generic inbox) at a company: the row the team tracks outreach on."""

    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    name: Mapped[str | None] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(320), index=True)
    linkedin: Mapped[str | None] = mapped_column(String(500))
    role: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[ContactStatus] = mapped_column(
        _enum(ContactStatus), default=ContactStatus.NOT_CONTACTED
    )
    # How we have reached them, once we have. Empty while status is not_contacted.
    channels: Mapped[list[str]] = mapped_column(JSON, default=list)
    remarks: Mapped[str | None] = mapped_column(Text)
    # Never mail a contact who bounced or asked us to stop.
    do_not_contact: Mapped[bool] = mapped_column(default=False, server_default=false())
    last_contacted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    next_followup_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # Set when the reply tracker logs a new reply; cleared by a person marking it seen.
    reply_unread: Mapped[bool] = mapped_column(default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    company: Mapped[Company] = relationship(back_populates="contacts")
    interactions: Mapped[list["Interaction"]] = relationship(
        back_populates="contact", cascade="all, delete-orphan", order_by="Interaction.occurred_at"
    )
    drafts: Mapped[list["Draft"]] = relationship(cascade="all, delete-orphan")

    @property
    def company_name(self) -> str:
        return self.company.name


class Interaction(Base):
    __tablename__ = "interactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey("contacts.id", ondelete="CASCADE"))
    type: Mapped[InteractionType] = mapped_column(_enum(InteractionType))
    channel: Mapped[Channel | None] = mapped_column(_enum(Channel))
    source: Mapped[InteractionSource] = mapped_column(
        _enum(InteractionSource), default=InteractionSource.MANUAL
    )
    subject: Mapped[str | None] = mapped_column(String(500))
    content: Mapped[str | None] = mapped_column(Text)
    # RFC 5322 Message-ID of a sent email; the reply tracker matches In-Reply-To against it.
    message_id: Mapped[str | None] = mapped_column(String(500), unique=True, index=True)
    # Set on email_sent interactions: which draft, and who approved it.
    draft_id: Mapped[int | None] = mapped_column(ForeignKey("drafts.id", ondelete="SET NULL"))
    approved_by: Mapped[str | None] = mapped_column(String(100))
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    contact: Mapped[Contact] = relationship(back_populates="interactions")


class Draft(Base):
    """An outgoing email. Nothing leaves the system unless a human approves it first."""

    __tablename__ = "drafts"

    id: Mapped[int] = mapped_column(primary_key=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey("contacts.id", ondelete="CASCADE"))
    subject: Mapped[str] = mapped_column(String(500))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[DraftStatus] = mapped_column(_enum(DraftStatus), default=DraftStatus.DRAFT)
    generated_by_ai: Mapped[bool] = mapped_column(default=False)
    # Fingerprint of recipient+subject+body at approval time. Any later edit voids approval.
    approved_hash: Mapped[str | None] = mapped_column(String(64))
    approved_by: Mapped[str | None] = mapped_column(String(100))
    approved_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class MailboxState(Base):
    """Where the reply tracker left off in each mailbox folder, and how the last sync went."""

    __tablename__ = "mailbox_state"

    folder: Mapped[str] = mapped_column(String(200), primary_key=True)
    uidvalidity: Mapped[int | None] = mapped_column()
    last_uid: Mapped[int] = mapped_column(default=0)
    last_sync_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_error: Mapped[str | None] = mapped_column(Text)


class Prospect(Base):
    """A company the model suggested. It is only a suggestion until it is checked against the live
    web and a human accepts it; nothing here is ever contacted."""

    __tablename__ = "prospects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    website: Mapped[str | None] = mapped_column(String(300))
    domain: Mapped[str | None] = mapped_column(String(200), index=True)
    industry: Mapped[str | None] = mapped_column(String(100))
    why: Mapped[str | None] = mapped_column(Text)  # the model's reason: untrusted text
    source: Mapped[str | None] = mapped_column(String(300))  # e.g. the sponsor page it came from
    state: Mapped[ProspectState] = mapped_column(_enum(ProspectState), default=ProspectState.NEW)
    verdict: Mapped[Verdict] = mapped_column(_enum(Verdict), default=Verdict.UNVERIFIED)
    verdict_note: Mapped[str | None] = mapped_column(Text)  # plain-language reason for the verdict
    checked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime)  # re-check after this
    snoozed_until: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # [{"url","title","snippet","kind","fetched_at","last_modified"}]: what we actually saw
    evidence: Mapped[list[dict]] = mapped_column(JSON, default=list)
    # [{"email","source_url"}]: only addresses found written on the company's own pages
    emails: Mapped[list[dict]] = mapped_column(JSON, default=list)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    @property
    def stale(self) -> bool:
        """Checked once, but long enough ago that the answer may no longer be true."""
        return self.expires_at is not None and self.expires_at < utcnow()

    @property
    def linkedin_search_url(self) -> str:
        """A people search for the right contact. We open it for a human; we never scrape it."""
        words = f"{self.name} university relations OR partnerships OR sponsorship"
        return "https://www.linkedin.com/search/results/people/?keywords=" + quote(words)
