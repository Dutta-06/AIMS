from datetime import datetime

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, UTCDateTime, utcnow
from app.models.enums import DealStage, DraftStatus, InteractionSource, InteractionType


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
        back_populates="company", cascade="all, delete-orphan"
    )
    deals: Mapped[list["Deal"]] = relationship(
        back_populates="company", cascade="all, delete-orphan"
    )


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320), index=True)
    role: Mapped[str | None] = mapped_column(String(200))
    linkedin: Mapped[str | None] = mapped_column(String(300))
    # Never mail a contact who bounced or asked us to stop.
    do_not_contact: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    company: Mapped[Company] = relationship(back_populates="contacts")


class Deal(Base):
    __tablename__ = "deals"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    stage: Mapped[DealStage] = mapped_column(_enum(DealStage), default=DealStage.PROSPECT)
    owner: Mapped[str | None] = mapped_column(String(100))
    target_amount: Mapped[int | None] = mapped_column(Integer)
    committed_amount: Mapped[int | None] = mapped_column(Integer)
    next_followup_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_contacted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    company: Mapped[Company] = relationship(back_populates="deals")
    interactions: Mapped[list["Interaction"]] = relationship(
        back_populates="deal", cascade="all, delete-orphan", order_by="Interaction.occurred_at"
    )


class Interaction(Base):
    __tablename__ = "interactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    deal_id: Mapped[int] = mapped_column(ForeignKey("deals.id", ondelete="CASCADE"))
    contact_id: Mapped[int | None] = mapped_column(ForeignKey("contacts.id", ondelete="SET NULL"))
    type: Mapped[InteractionType] = mapped_column(_enum(InteractionType))
    source: Mapped[InteractionSource] = mapped_column(
        _enum(InteractionSource), default=InteractionSource.MANUAL
    )
    subject: Mapped[str | None] = mapped_column(String(500))
    content: Mapped[str | None] = mapped_column(Text)
    # RFC 5322 Message-ID of a sent email; the reply tracker matches In-Reply-To against it.
    message_id: Mapped[str | None] = mapped_column(String(500), index=True)
    # Set on email_sent interactions: which draft, and who approved it.
    draft_id: Mapped[int | None] = mapped_column(ForeignKey("drafts.id", ondelete="SET NULL"))
    approved_by: Mapped[str | None] = mapped_column(String(100))
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    deal: Mapped[Deal] = relationship(back_populates="interactions")


class Draft(Base):
    """An outgoing email. Nothing leaves the system unless a human approves it first."""

    __tablename__ = "drafts"

    id: Mapped[int] = mapped_column(primary_key=True)
    deal_id: Mapped[int] = mapped_column(ForeignKey("deals.id", ondelete="CASCADE"))
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
