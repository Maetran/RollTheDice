"""Add opt-in game-invite push subscriptions and lobby-chat moderation.

Revision ID: 20260906_0024
Revises: 20260906_0023
Create Date: 2026-09-06
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260906_0024"
down_revision = "20260906_0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("lobby_chat_muted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "users",
        sa.Column("lobby_chat_excluded", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "users",
        sa.Column("game_invite_push_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "web_push_subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.String(length=256), nullable=False),
        sa.Column("auth", sa.String(length=128), nullable=False),
        sa.Column("product_context", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "product_context IN ('zdwa', 'zilch')",
            name="ck_web_push_subscriptions_product_context",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint"),
    )
    op.create_index("ix_web_push_subscriptions_user", "web_push_subscriptions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_web_push_subscriptions_user", table_name="web_push_subscriptions")
    op.drop_table("web_push_subscriptions")
    op.drop_column("users", "game_invite_push_enabled")
    op.drop_column("users", "lobby_chat_excluded")
    op.drop_column("users", "lobby_chat_muted")
