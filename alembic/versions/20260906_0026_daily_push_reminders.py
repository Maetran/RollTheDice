"""Add separately opted-in, once-per-day push reminders.

Revision ID: 20260906_0026
Revises: 20260906_0025
Create Date: 2026-09-06
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260906_0026"
down_revision = "20260906_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("daily_reminder_push_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("daily_reminder_push_last_sent_on", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "daily_reminder_push_last_sent_on")
    op.drop_column("users", "daily_reminder_push_enabled")
