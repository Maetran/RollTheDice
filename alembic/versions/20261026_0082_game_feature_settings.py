"""Persist owner-managed feature releases, game beta labels and audit history."""

import sqlalchemy as sa

from alembic import op

revision = "20261026_0082"
down_revision = "20261025_0081"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "feature_policy_lock",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.CheckConstraint("id = 1", name="ck_feature_policy_lock_singleton"),
    )
    op.bulk_insert(sa.table("feature_policy_lock", sa.column("id", sa.Integer())), [{"id": 1}])
    op.create_table(
        "feature_flags",
        sa.Column("key", sa.String(80), primary_key=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("beta", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint("status IN ('off', 'internal', 'public')", name="ck_feature_flags_status"),
        sa.CheckConstraint("beta IN (true, false) AND (status = 'public' OR beta = false)", name="ck_feature_flags_beta"),
        sa.CheckConstraint("version > 0", name="ck_feature_flags_version"),
    )
    op.create_table(
        "game_presentations",
        sa.Column("game", sa.String(16), primary_key=True),
        sa.Column("beta", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint("game IN ('zdwa', 'zilch', 'hausdepp', 'watten')", name="ck_game_presentations_game"),
        sa.CheckConstraint("beta IN (true, false)", name="ck_game_presentations_beta"),
        sa.CheckConstraint("version > 0", name="ck_game_presentations_version"),
    )
    op.create_table(
        "feature_flag_audit",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("target_type", sa.String(16), nullable=False),
        sa.Column("target_key", sa.String(80), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=False),
        sa.Column("actor_username", sa.String(32), nullable=False),
        sa.Column("before_json", sa.Text(), nullable=False),
        sa.Column("after_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("target_type IN ('feature', 'game')", name="ck_feature_flag_audit_target"),
    )
    op.create_index("ix_feature_flag_audit_created_at", "feature_flag_audit", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_feature_flag_audit_created_at", "feature_flag_audit")
    op.drop_table("feature_flag_audit")
    op.drop_table("game_presentations")
    op.drop_table("feature_flags")
    op.drop_table("feature_policy_lock")
