"""prospects: model-suggested companies, verified against the live web before a human accepts

Revision ID: f2b8d4e6a113
Revises: e5a1c3b7d902
"""

import sqlalchemy as sa
from alembic import op

revision = "f2b8d4e6a113"
down_revision = "e5a1c3b7d902"
branch_labels = None
depends_on = None


def _enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, length=32)


def upgrade() -> None:
    op.create_table(
        "prospects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("website", sa.String(300)),
        sa.Column("domain", sa.String(200)),
        sa.Column("industry", sa.String(100)),
        sa.Column("why", sa.Text()),
        sa.Column(
            "state",
            _enum("prospectstate", "new", "accepted", "rejected", "snoozed"),
            nullable=False,
        ),
        sa.Column(
            "verdict",
            _enum("verdict", "unverified", "verified", "needs_check", "failed"),
            nullable=False,
        ),
        sa.Column("verdict_note", sa.Text()),
        sa.Column("checked_at", sa.DateTime(timezone=True)),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("snoozed_until", sa.DateTime(timezone=True)),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column("emails", sa.JSON(), nullable=False),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_prospects_domain", "prospects", ["domain"])


def downgrade() -> None:
    op.drop_index("ix_prospects_domain", table_name="prospects")
    op.drop_table("prospects")
