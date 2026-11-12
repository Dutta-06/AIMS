"""drafts get a channel (email or linkedin) and a revision history

Revision ID: b7d3f9a2c481
Revises: a9c4e1d7b620
"""

import sqlalchemy as sa
from alembic import op

revision = "b7d3f9a2c481"
down_revision = "a9c4e1d7b620"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("drafts") as batch:
        batch.add_column(
            sa.Column(
                "channel",
                sa.Enum(
                    "email",
                    "linkedin",
                    "discord",
                    "personal",
                    name="channel",
                    native_enum=False,
                    length=32,
                ),
                nullable=False,
                server_default="email",
            )
        )
        batch.add_column(
            sa.Column("history", sa.JSON(), nullable=False, server_default=sa.text("'[]'"))
        )


def downgrade() -> None:
    with op.batch_alter_table("drafts") as batch:
        batch.drop_column("history")
        batch.drop_column("channel")
