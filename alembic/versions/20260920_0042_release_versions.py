"""Persist semantic versions without creating or re-announcing old releases."""

import sqlalchemy as sa

from alembic import op

revision = "20260920_0042"
down_revision = "20260913_0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("push_releases", sa.Column("version", sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column("push_releases", "version")
