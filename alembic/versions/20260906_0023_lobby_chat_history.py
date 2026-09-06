"""Persist the audience-scoped, short-lived lobby-chat history.

Revision ID: 20260906_0023
Revises: 20260906_0022
Create Date: 2026-09-06
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260906_0023"
down_revision = "20260906_0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("lobby_chat_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_table(
        "lobby_chat_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("sender_user_id", sa.Integer(), nullable=True),
        sa.Column("sender_username", sa.String(length=32), nullable=False),
        sa.Column("game_type", sa.String(length=16), nullable=False),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('message', 'presence')", name="ck_lobby_chat_messages_kind"),
        sa.CheckConstraint("game_type IN ('zdwa', 'zilch')", name="ck_lobby_chat_messages_game_type"),
        sa.ForeignKeyConstraint(["sender_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_lobby_chat_messages_created_at", "lobby_chat_messages", ["created_at"])
    op.create_table(
        "lobby_chat_message_recipients",
        sa.Column("message_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["message_id"], ["lobby_chat_messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("message_id", "user_id"),
    )
    op.create_index(
        "ix_lobby_chat_recipients_user_message",
        "lobby_chat_message_recipients",
        ["user_id", "message_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_lobby_chat_recipients_user_message", table_name="lobby_chat_message_recipients")
    op.drop_table("lobby_chat_message_recipients")
    op.drop_index("ix_lobby_chat_messages_created_at", table_name="lobby_chat_messages")
    op.drop_table("lobby_chat_messages")
    op.drop_column("users", "lobby_chat_enabled")
