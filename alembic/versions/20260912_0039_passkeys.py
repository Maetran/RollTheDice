"""Add dormant WebAuthn passkey credential and ceremony storage.

Revision ID: 20260912_0039
Revises: 20260912_0038
Create Date: 2026-09-12
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260912_0039"
down_revision = "20260912_0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("webauthn_user_handle", sa.LargeBinary(length=32), nullable=True))
    op.create_index("ix_users_webauthn_user_handle", "users", ["webauthn_user_handle"], unique=True)

    op.create_table(
        "passkey_credentials",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("credential_id", sa.LargeBinary(length=1024), nullable=False),
        sa.Column("credential_public_key", sa.LargeBinary(length=8192), nullable=False),
        sa.Column("sign_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("device_type", sa.String(length=24), nullable=False, server_default="single_device"),
        sa.Column("backed_up", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("label", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("length(credential_id) BETWEEN 1 AND 1024", name="ck_passkey_credentials_id_size"),
        sa.CheckConstraint(
            "length(credential_public_key) BETWEEN 1 AND 8192",
            name="ck_passkey_credentials_public_key_size",
        ),
        sa.CheckConstraint("sign_count >= 0", name="ck_passkey_credentials_sign_count"),
        sa.UniqueConstraint("credential_id", name="uq_passkey_credentials_credential_id"),
    )
    op.create_index(
        "ix_passkey_credentials_user_last_used",
        "passkey_credentials",
        ["user_id", "last_used_at"],
    )

    op.create_table(
        "webauthn_ceremonies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("state_token_hash", sa.String(length=64), nullable=False),
        sa.Column("purpose", sa.String(length=16), nullable=False),
        sa.Column("challenge", sa.LargeBinary(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "purpose IN ('registration', 'authentication')",
            name="ck_webauthn_ceremonies_purpose",
        ),
        sa.CheckConstraint(
            "(purpose = 'registration' AND user_id IS NOT NULL AND session_id IS NOT NULL) "
            "OR (purpose = 'authentication' AND user_id IS NULL AND session_id IS NULL)",
            name="ck_webauthn_ceremonies_subject",
        ),
        sa.CheckConstraint("length(challenge) BETWEEN 32 AND 64", name="ck_webauthn_ceremonies_challenge_size"),
        sa.UniqueConstraint("state_token_hash"),
    )
    op.create_index("ix_webauthn_ceremonies_expires", "webauthn_ceremonies", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_webauthn_ceremonies_expires", table_name="webauthn_ceremonies")
    op.drop_table("webauthn_ceremonies")
    op.drop_index("ix_passkey_credentials_user_last_used", table_name="passkey_credentials")
    op.drop_table("passkey_credentials")
    op.drop_index("ix_users_webauthn_user_handle", table_name="users")
    # Keep existing game participants intact during a downgrade; SQLite's
    # native form avoids rebuilding the referenced users table.
    op.drop_column("users", "webauthn_user_handle")
