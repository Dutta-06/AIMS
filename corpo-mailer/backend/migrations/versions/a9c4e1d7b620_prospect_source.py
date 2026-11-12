"""prospects get a source (where they were found)

Revision ID: a9c4e1d7b620
Revises: f2b8d4e6a113
"""

import sqlalchemy as sa
from alembic import op

revision = "a9c4e1d7b620"
down_revision = "f2b8d4e6a113"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("prospects") as batch:
        batch.add_column(sa.Column("source", sa.String(length=300), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("prospects") as batch:
        batch.drop_column("source")
