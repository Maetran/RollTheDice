"""Add private email identity and one-time account email actions.

Revision ID: 20260912_0037
Revises: 20260907_0036
Create Date: 2026-09-12
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260912_0037"
down_revision = "20260907_0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("email", sa.String(length=254), nullable=True))
    op.add_column("users", sa.Column("email_normalized", sa.String(length=254), nullable=True))
    op.add_column("users", sa.Column("email_confirmed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_email_normalized", "users", ["email_normalized"], unique=True)

    op.create_table(
        "pending_email_registrations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(length=32), nullable=False),
        sa.Column("username_normalized", sa.String(length=32), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("email_normalized", sa.String(length=254), nullable=False),
        sa.Column("preferred_language", sa.String(length=2), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("preferred_language IN ('de', 'en')", name="ck_pending_email_registration_language"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_pending_email_registrations_expires", "pending_email_registrations", ["expires_at"])

    op.create_table(
        "account_email_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("purpose", sa.String(length=24), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("email_normalized", sa.String(length=254), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("purpose IN ('email_verify', 'password_reset')", name="ck_account_email_token_purpose"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "ix_account_email_tokens_user_purpose",
        "account_email_tokens",
        ["user_id", "purpose", "expires_at"],
    )
    op.create_index("ix_account_email_tokens_expires", "account_email_tokens", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_account_email_tokens_expires", table_name="account_email_tokens")
    op.drop_index("ix_account_email_tokens_user_purpose", table_name="account_email_tokens")
    op.drop_table("account_email_tokens")
    op.drop_index("ix_pending_email_registrations_expires", table_name="pending_email_registrations")
    op.drop_table("pending_email_registrations")
    op.drop_index("ix_users_email_normalized", table_name="users")
    # Native SQLite DROP COLUMN (supported since 3.35) preserves rows in
    # referencing participant tables. A batch table rebuild would invoke their
    # foreign-key actions during a test or emergency downgrade.
    op.drop_column("users", "email_confirmed_at")
    op.drop_column("users", "email_normalized")
    op.drop_column("users", "email")
