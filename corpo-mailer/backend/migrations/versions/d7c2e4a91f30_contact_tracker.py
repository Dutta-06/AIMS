"""contact tracker: contacts become the tracked rows; deals and money go away

Each company's deal state is folded into its contacts (stage -> status, plus owner, notes,
follow-up date and unread-reply flag), interactions and drafts now hang off the contact, and the
deals table is dropped. Existing rows keep their ids. The new tables are built beside the old ones
and swapped in, which behaves the same on SQLite and PostgreSQL.

Revision ID: d7c2e4a91f30
Revises: 9a883795116c
"""

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "d7c2e4a91f30"
down_revision = "9a883795116c"
branch_labels = None
depends_on = None

STAGE_TO_STATUS = {
    "prospect": "not_contacted",
    "contacted": "contacted",
    "no_response": "no_response",
}  # every other stage means they answered


def _enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, length=32)


STATUS = ("not_contacted", "contacted", "responded", "no_response")
CHANNEL = ("email", "linkedin", "discord", "personal")
ITYPE = ("email_sent", "email_reply", "outreach", "reply", "call", "meeting", "note")
DT = sa.DateTime(timezone=True)


def _new_tables() -> None:
    op.create_table(
        "contacts_new",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=True),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("linkedin", sa.String(length=500), nullable=True),
        sa.Column("role", sa.String(length=200), nullable=True),
        sa.Column("owner", sa.String(length=100), nullable=True),
        sa.Column("status", _enum("contactstatus", *STATUS), nullable=False),
        sa.Column("channels", sa.JSON(), nullable=False),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("do_not_contact", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("last_contacted_at", DT, nullable=True),
        sa.Column("next_followup_at", DT, nullable=True),
        sa.Column("reply_unread", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", DT, nullable=False),
        sa.Column("updated_at", DT, nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "drafts_new",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("contact_id", sa.Integer(), nullable=False),
        sa.Column("subject", sa.String(length=500), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", _enum("draftstatus", "draft", "approved", "sending", "sent"), nullable=False),
        sa.Column("generated_by_ai", sa.Boolean(), nullable=False),
        sa.Column("approved_hash", sa.String(length=64), nullable=True),
        sa.Column("approved_by", sa.String(length=100), nullable=True),
        sa.Column("approved_at", DT, nullable=True),
        sa.Column("sent_at", DT, nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", DT, nullable=False),
        sa.ForeignKeyConstraint(["contact_id"], ["contacts_new.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "interactions_new",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("contact_id", sa.Integer(), nullable=False),
        sa.Column("type", _enum("interactiontype", *ITYPE), nullable=False),
        sa.Column("channel", _enum("channel", *CHANNEL), nullable=True),
        sa.Column("source", _enum("interactionsource", "manual", "auto"), nullable=False),
        sa.Column("subject", sa.String(length=500), nullable=True),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("message_id", sa.String(length=500), nullable=True),
        sa.Column("draft_id", sa.Integer(), nullable=True),
        sa.Column("approved_by", sa.String(length=100), nullable=True),
        sa.Column("occurred_at", DT, nullable=False),
        sa.ForeignKeyConstraint(["contact_id"], ["contacts_new.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["draft_id"], ["drafts_new.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )


def _copy_data() -> None:
    bind = op.get_bind()
    m = sa.MetaData()
    old_contacts = sa.Table(
        "contacts", m, sa.Column("id", sa.Integer), sa.Column("company_id", sa.Integer),
        sa.Column("name", sa.String), sa.Column("email", sa.String), sa.Column("role", sa.String),
        sa.Column("linkedin", sa.String), sa.Column("do_not_contact", sa.Boolean),
        sa.Column("created_at", DT),
    )
    old_deals = sa.Table(
        "deals", m, sa.Column("id", sa.Integer), sa.Column("company_id", sa.Integer),
        sa.Column("stage", sa.String), sa.Column("owner", sa.String),
        sa.Column("next_followup_at", DT), sa.Column("last_contacted_at", DT),
        sa.Column("notes", sa.Text), sa.Column("reply_unread", sa.Boolean),
        sa.Column("created_at", DT),
    )
    old_inter = sa.Table(
        "interactions", m, sa.Column("id", sa.Integer), sa.Column("deal_id", sa.Integer),
        sa.Column("contact_id", sa.Integer), sa.Column("type", sa.String),
        sa.Column("source", sa.String), sa.Column("subject", sa.String),
        sa.Column("content", sa.Text), sa.Column("message_id", sa.String),
        sa.Column("draft_id", sa.Integer), sa.Column("approved_by", sa.String),
        sa.Column("occurred_at", DT),
    )
    old_drafts = sa.Table(
        "drafts", m, sa.Column("id", sa.Integer), sa.Column("contact_id", sa.Integer),
        sa.Column("subject", sa.String), sa.Column("body", sa.Text), sa.Column("status", sa.String),
        sa.Column("generated_by_ai", sa.Boolean), sa.Column("approved_hash", sa.String),
        sa.Column("approved_by", sa.String), sa.Column("approved_at", DT), sa.Column("sent_at", DT),
        sa.Column("last_error", sa.Text), sa.Column("created_at", DT),
    )
    new_contacts = sa.table(
        "contacts_new", *[sa.column(c) for c in (
            "id", "company_id", "name", "email", "linkedin", "role", "owner", "status", "remarks",
            "do_not_contact", "reply_unread")],
        sa.column("channels", sa.JSON), sa.column("last_contacted_at", DT),
        sa.column("next_followup_at", DT), sa.column("created_at", DT), sa.column("updated_at", DT),
    )
    new_drafts = sa.table(
        "drafts_new", *[sa.column(c) for c in (
            "id", "contact_id", "subject", "body", "status", "generated_by_ai", "approved_hash",
            "approved_by", "last_error")],
        sa.column("approved_at", DT), sa.column("sent_at", DT), sa.column("created_at", DT),
    )
    new_inter = sa.table(
        "interactions_new", *[sa.column(c) for c in (
            "id", "contact_id", "type", "channel", "source", "subject", "content", "message_id",
            "draft_id", "approved_by")], sa.column("occurred_at", DT),
    )

    contacts = list(bind.execute(sa.select(old_contacts).order_by(old_contacts.c.id)))
    deals = list(bind.execute(sa.select(old_deals).order_by(old_deals.c.id)))
    inters = list(bind.execute(sa.select(old_inter).order_by(old_inter.c.id)))
    drafts = list(bind.execute(sa.select(old_drafts).order_by(old_drafts.c.id)))
    now = datetime.now(UTC)

    deal_of_company = {}
    for d in deals:
        deal_of_company.setdefault(d.company_id, d)  # a company's first deal supplies the state
    company_of_deal = {d.id: d.company_id for d in deals}
    emailed = {i.contact_id for i in inters if i.type == "email_sent" and i.contact_id}
    first_contact: dict[int, int] = {}
    for c in contacts:
        first_contact.setdefault(c.company_id, c.id)
    replied_contact = {}  # company -> contact with the latest reply
    for i in inters:
        if i.type == "email_reply" and i.contact_id:
            replied_contact[company_of_deal.get(i.deal_id)] = i.contact_id

    rows = []
    for c in contacts:
        d = deal_of_company.get(c.company_id)
        status = STAGE_TO_STATUS.get(d.stage, "responded") if d else "not_contacted"
        unread = bool(d and d.reply_unread and replied_contact.get(c.company_id, first_contact[c.company_id]) == c.id)
        rows.append({
            "id": c.id, "company_id": c.company_id, "name": c.name, "email": c.email,
            "linkedin": c.linkedin, "role": c.role, "owner": d.owner if d else None,
            "status": status, "channels": ["email"] if (c.id in emailed and status != "not_contacted") else [],
            "remarks": d.notes if d else None, "do_not_contact": bool(c.do_not_contact),
            "last_contacted_at": d.last_contacted_at if d else None,
            "next_followup_at": d.next_followup_at if d else None, "reply_unread": unread,
            "created_at": c.created_at or now, "updated_at": c.created_at or now,
        })
    # A company that had a deal but no contacts keeps its history on a placeholder contact.
    next_id = max((c.id for c in contacts), default=0) + 1
    placeholder: dict[int, int] = {}
    for company_id, d in deal_of_company.items():
        if company_id not in first_contact:
            placeholder[company_id] = next_id
            rows.append({
                "id": next_id, "company_id": company_id, "name": "General contact", "email": None,
                "linkedin": None, "role": None, "owner": d.owner,
                "status": STAGE_TO_STATUS.get(d.stage, "responded"), "channels": [],
                "remarks": d.notes, "do_not_contact": False, "last_contacted_at": d.last_contacted_at,
                "next_followup_at": d.next_followup_at, "reply_unread": False,
                "created_at": d.created_at or now, "updated_at": d.created_at or now,
            })
            next_id += 1
    if rows:
        op.bulk_insert(new_contacts, rows)

    if drafts:
        op.bulk_insert(new_drafts, [
            {"id": x.id, "contact_id": x.contact_id, "subject": x.subject, "body": x.body,
             "status": x.status, "generated_by_ai": bool(x.generated_by_ai),
             "approved_hash": x.approved_hash, "approved_by": x.approved_by,
             "approved_at": x.approved_at, "sent_at": x.sent_at, "last_error": x.last_error,
             "created_at": x.created_at or now} for x in drafts])

    irows = []
    for i in inters:
        company = company_of_deal.get(i.deal_id)
        target = i.contact_id or first_contact.get(company) or placeholder.get(company)
        if target is None:
            continue  # an interaction whose deal and company are both gone
        irows.append({
            "id": i.id, "contact_id": target, "type": i.type,
            "channel": "email" if i.type in ("email_sent", "email_reply") else None,
            "source": i.source, "subject": i.subject, "content": i.content,
            "message_id": i.message_id, "draft_id": i.draft_id, "approved_by": i.approved_by,
            "occurred_at": i.occurred_at or now,
        })
    if irows:
        op.bulk_insert(new_inter, irows)


def upgrade() -> None:
    _new_tables()
    _copy_data()
    # Out with the old (the referencing tables first), then give the new ones their real names.
    op.drop_index("ix_interactions_message_id", table_name="interactions")
    op.drop_table("interactions")
    op.drop_table("drafts")
    op.drop_table("deals")
    op.drop_index("ix_contacts_email", table_name="contacts")
    op.drop_table("contacts")
    op.rename_table("contacts_new", "contacts")
    op.rename_table("drafts_new", "drafts")
    op.rename_table("interactions_new", "interactions")
    op.create_index("ix_contacts_email", "contacts", ["email"], unique=False)
    op.create_index("ix_contacts_owner", "contacts", ["owner"], unique=False)
    op.create_index("ix_interactions_message_id", "interactions", ["message_id"], unique=True)
    if op.get_bind().dialect.name == "postgresql":
        # Rows were inserted with explicit ids; move each sequence past them.
        for table in ("contacts", "drafts", "interactions"):
            op.execute(
                f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                f"COALESCE((SELECT MAX(id) FROM {table}), 1), (SELECT COUNT(*) > 0 FROM {table}))"
            )


def downgrade() -> None:
    """Rebuilds the old empty tables. Data cannot be mapped back (a contact's state would have to
    be split across deals again), so downgrading discards contacts, drafts and interactions."""
    op.drop_index("ix_interactions_message_id", table_name="interactions")
    op.drop_table("interactions")
    op.drop_table("drafts")
    op.drop_index("ix_contacts_owner", table_name="contacts")
    op.drop_index("ix_contacts_email", table_name="contacts")
    op.drop_table("contacts")
    op.create_table(
        "contacts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("role", sa.String(length=200), nullable=True),
        sa.Column("linkedin", sa.String(length=300), nullable=True),
        sa.Column("do_not_contact", sa.Boolean(), nullable=False),
        sa.Column("created_at", DT, nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_contacts_email", "contacts", ["email"], unique=False)
    op.create_table(
        "deals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("stage", _enum("dealstage", "prospect", "contacted", "replied", "in_discussion",
                                 "proposal_sent", "committed", "paid", "declined", "no_response"), nullable=False),
        sa.Column("owner", sa.String(length=100), nullable=True),
        sa.Column("target_amount", sa.Integer(), nullable=True),
        sa.Column("committed_amount", sa.Integer(), nullable=True),
        sa.Column("next_followup_at", DT, nullable=True),
        sa.Column("last_contacted_at", DT, nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("reply_unread", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", DT, nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "drafts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("deal_id", sa.Integer(), nullable=False),
        sa.Column("contact_id", sa.Integer(), nullable=False),
        sa.Column("subject", sa.String(length=500), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", _enum("draftstatus", "draft", "approved", "sending", "sent"), nullable=False),
        sa.Column("generated_by_ai", sa.Boolean(), nullable=False),
        sa.Column("approved_hash", sa.String(length=64), nullable=True),
        sa.Column("approved_by", sa.String(length=100), nullable=True),
        sa.Column("approved_at", DT, nullable=True),
        sa.Column("sent_at", DT, nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", DT, nullable=False),
        sa.ForeignKeyConstraint(["contact_id"], ["contacts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["deal_id"], ["deals.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "interactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("deal_id", sa.Integer(), nullable=False),
        sa.Column("contact_id", sa.Integer(), nullable=True),
        sa.Column("type", _enum("interactiontype", "email_sent", "email_reply", "call", "meeting", "note"), nullable=False),
        sa.Column("source", _enum("interactionsource", "manual", "auto"), nullable=False),
        sa.Column("subject", sa.String(length=500), nullable=True),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("message_id", sa.String(length=500), nullable=True),
        sa.Column("draft_id", sa.Integer(), nullable=True),
        sa.Column("approved_by", sa.String(length=100), nullable=True),
        sa.Column("occurred_at", DT, nullable=False),
        sa.ForeignKeyConstraint(["contact_id"], ["contacts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["deal_id"], ["deals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["draft_id"], ["drafts.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_interactions_message_id", "interactions", ["message_id"], unique=True)
