"""Remember actual play days and advance reminder copy only on dispatch.

Revision ID: 20260906_0027
Revises: 20260906_0026
Create Date: 2026-09-06
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260906_0027"
down_revision = "20260906_0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("last_played_on", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("daily_reminder_push_sequence", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("users", "daily_reminder_push_sequence")
    op.drop_column("users", "last_played_on")
