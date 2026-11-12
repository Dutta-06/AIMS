"""the connected Gmail account (OAuth)

Revision ID: c3e5a7b9d204
Revises: b7d3f9a2c481
"""

import sqlalchemy as sa
from alembic import op

revision = "c3e5a7b9d204"
down_revision = "b7d3f9a2c481"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gmail_connection",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("refresh_token", sa.Text(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("last_error", sa.Text()),
        sa.Column("connected_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("gmail_connection")
