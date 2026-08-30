"""Add mobile comfort preferences.

Revision ID: 20260827_0007
Revises: 20260826_0006
"""

import sqlalchemy as sa

from alembic import op

revision = "20260827_0007"
down_revision = "20260826_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("haptic_feedback", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("keep_screen_awake", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("users", "keep_screen_awake")
    op.drop_column("users", "haptic_feedback")
