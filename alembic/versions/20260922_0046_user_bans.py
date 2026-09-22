"""Time-limited and permanent account moderation with revocation history."""

import sqlalchemy as sa

from alembic import op

revision = "20260922_0046"
down_revision = "20260922_0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_bans",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope", sa.String(16), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("help_request_id", sa.String(32), nullable=True),
        sa.CheckConstraint("scope IN ('play', 'help')", name="ck_user_ban_scope"),
    )
    op.create_index("ix_user_bans_user_id", "user_bans", ["user_id"])


def downgrade() -> None:
    op.drop_table("user_bans")
