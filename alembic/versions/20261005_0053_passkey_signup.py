"""Passkey-first signup state and account-wide passkey reminder cadence."""

import sqlalchemy as sa

from alembic import op

revision = "20261005_0053"
down_revision = "20261005_0052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("passkey_prompted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "passkey_signup_ceremonies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("state_token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("challenge", sa.LargeBinary(64), nullable=False),
        sa.Column("username", sa.String(32), nullable=False),
        sa.Column("username_normalized", sa.String(32), nullable=False),
        sa.Column("user_handle", sa.LargeBinary(32), nullable=False, unique=True),
        sa.Column("preferred_language", sa.String(2), nullable=False),
        sa.Column("request_origin", sa.String(256), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("length(challenge) BETWEEN 32 AND 64", name="ck_passkey_signup_challenge_size"),
        sa.CheckConstraint("length(user_handle) = 32", name="ck_passkey_signup_handle_size"),
        sa.CheckConstraint("preferred_language IN ('de', 'en')", name="ck_passkey_signup_language"),
    )
    op.create_index("ix_passkey_signup_expires", "passkey_signup_ceremonies", ["expires_at"])


def downgrade() -> None:
    op.drop_table("passkey_signup_ceremonies")
    op.drop_column("users", "passkey_prompted_at")
