"""Persist the account-wide waiting-room push cooldown.

Revision ID: 20260906_0025
Revises: 20260906_0024
Create Date: 2026-09-06
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260906_0025"
down_revision = "20260906_0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("game_invite_push_last_sent_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "game_invite_push_last_sent_at")
