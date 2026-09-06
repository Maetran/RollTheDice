"""Add the account preference for live lobby-chat popups.

Revision ID: 20260906_0022
Revises: 20260905_0021
Create Date: 2026-09-06
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260906_0022"
down_revision = "20260905_0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("lobby_chat_popups", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("users", "lobby_chat_popups")
