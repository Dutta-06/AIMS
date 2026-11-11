"""drop contact owner: leads are no longer assigned to teammates

Revision ID: e5a1c3b7d902
Revises: d7c2e4a91f30
"""

import sqlalchemy as sa
from alembic import op

revision = "e5a1c3b7d902"
down_revision = "d7c2e4a91f30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("contacts") as batch:
        batch.drop_index("ix_contacts_owner")
        batch.drop_column("owner")


def downgrade() -> None:
    with op.batch_alter_table("contacts") as batch:
        batch.add_column(sa.Column("owner", sa.String(length=100), nullable=True))
        batch.create_index("ix_contacts_owner", ["owner"])
