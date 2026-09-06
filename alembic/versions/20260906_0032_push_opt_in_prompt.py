"""Rate-limit the optional account-wide Push settings invitation.

Revision ID: 20260906_0032
Revises: 20260906_0031
Create Date: 2026-09-06
"""

import sqlalchemy as sa

from alembic import op

revision = "20260906_0032"
down_revision = "20260906_0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("push_opt_in_prompted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "push_opt_in_prompted_at")
