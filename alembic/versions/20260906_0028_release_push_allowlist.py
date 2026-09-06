"""Add opted-in release notifications and private invitation sender allowlists.

Revision ID: 20260906_0028
Revises: 20260906_0027
Create Date: 2026-09-06
"""

import sqlalchemy as sa

from alembic import op

revision = "20260906_0028"
down_revision = "20260906_0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("release_push_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("game_invite_push_audience", sa.String(16), nullable=False, server_default="all"))
    op.create_table(
        "push_invite_allowed_senders",
        sa.Column("recipient_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("sender_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("recipient_user_id != sender_user_id", name="ck_push_allowlist_not_self"),
    )
    op.create_table(
        "push_releases",
        sa.Column("revision", sa.String(40), primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("summary_de", sa.String(140), nullable=False),
        sa.Column("summary_en", sa.String(140), nullable=False),
        sa.Column("game_types_json", sa.Text(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('backend', 'usability')", name="ck_push_release_kind"),
    )
    op.create_table(
        "push_release_recipients",
        sa.Column("revision", sa.String(40), sa.ForeignKey("push_releases.revision", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("product_context", sa.String(16), nullable=False),
        sa.Column("subscription_snapshot_json", sa.Text(), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("product_context IN ('zdwa', 'zilch')", name="ck_push_release_recipient_context"),
    )
    op.create_index("ix_push_release_pending", "push_release_recipients", ["claimed_at", "revision"])


def downgrade() -> None:
    op.drop_table("push_release_recipients")
    op.drop_table("push_releases")
    op.drop_table("push_invite_allowed_senders")
    op.drop_column("users", "game_invite_push_audience")
    op.drop_column("users", "release_push_enabled")
