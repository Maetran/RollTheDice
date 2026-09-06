"""An independent, account-wide preference for live friend game starts.

Revision ID: 20260906_0031
Revises: 20260906_0030
Create Date: 2026-09-06
"""

import sqlalchemy as sa

from alembic import op

revision = "20260906_0031"
down_revision = "20260906_0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("friend_activity_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    op.drop_column("users", "friend_activity_enabled")
