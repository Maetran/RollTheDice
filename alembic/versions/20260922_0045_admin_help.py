"""Persist account-scoped admin help requests and independent push delivery."""

import sqlalchemy as sa

from alembic import op

revision = "20260922_0045"
down_revision = "20260922_0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("admin_help_push_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.create_table(
        "admin_help_requests",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("requester_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("game_id", sa.String(64), nullable=False),
        sa.Column("game_type", sa.String(16), nullable=False),
        sa.Column("game_name", sa.String(160), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("claimed_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("origin_game_id", sa.String(64), nullable=True),
        sa.Column("resolved_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("outcome", sa.String(16), nullable=True),
        sa.CheckConstraint("game_type IN ('zdwa', 'zilch')", name="ck_admin_help_game_type"),
        sa.CheckConstraint("outcome IS NULL OR outcome IN ('resolved', 'accidental', 'misuse')", name="ck_admin_help_outcome"),
        sa.CheckConstraint("(resolved_at IS NULL) = (outcome IS NULL)", name="ck_admin_help_resolution"),
    )
    op.create_index("ix_admin_help_open_requester", "admin_help_requests", ["requester_user_id"], unique=True,
                    sqlite_where=sa.text("resolved_at IS NULL"), postgresql_where=sa.text("resolved_at IS NULL"))
    op.create_index("ix_admin_help_active_admin", "admin_help_requests", ["claimed_by_user_id"], unique=True,
                    sqlite_where=sa.text("resolved_at IS NULL AND claimed_by_user_id IS NOT NULL"),
                    postgresql_where=sa.text("resolved_at IS NULL AND claimed_by_user_id IS NOT NULL"))
    op.create_index("ix_admin_help_queue", "admin_help_requests", ["resolved_at", "created_at"])
    op.create_index("ix_admin_help_game", "admin_help_requests", ["game_id", "resolved_at"])
    op.create_table(
        "admin_help_recipients",
        sa.Column("request_id", sa.String(32), sa.ForeignKey("admin_help_requests.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("subscription_snapshot_json", sa.Text(), nullable=False),
        sa.Column("push_claimed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_admin_help_push_pending", "admin_help_recipients", ["push_claimed_at", "request_id"])


def downgrade() -> None:
    op.drop_table("admin_help_recipients")
    op.drop_table("admin_help_requests")
    op.drop_column("users", "admin_help_push_enabled")
