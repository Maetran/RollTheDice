"""Historical account ownership and private merge provenance."""

import sqlalchemy as sa

from alembic import op

revision = "20261025_0081"
down_revision = "20261025_0080"
branch_labels = None
depends_on = None


def _user(name, *, primary_key=False):
    return sa.Column(name, sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"),
                     primary_key=primary_key, nullable=False)


def _operation():
    return sa.Column("operation_id", sa.String(32),
                     sa.ForeignKey("account_merge_operations.id", ondelete="RESTRICT"), nullable=False)


def upgrade() -> None:
    op.add_column("active_games", sa.Column("admission_revision", sa.Integer(), nullable=False, server_default="0"))
    op.create_table(
        "account_merge_operations",
        sa.Column("id", sa.String(32), primary_key=True),
        _user("actor_user_id"), _user("source_user_id"), _user("target_user_id"),
        sa.Column("idempotency_key", sa.String(64), nullable=False, unique=True),
        sa.Column("preview_fingerprint", sa.String(64), nullable=False),
        sa.Column("policy_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("summary_json", sa.Text(), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("source_user_id != target_user_id", name="ck_account_merge_distinct_accounts"),
    )
    op.create_index("ix_account_merge_target_created", "account_merge_operations", ["target_user_id", "created_at"])
    op.create_table(
        "account_progress_origins", _user("origin_user_id", primary_key=True), _user("owner_user_id"), _operation(),
        sa.CheckConstraint("origin_user_id != owner_user_id", name="ck_progress_origin_distinct_owner"),
    )
    op.create_index("ix_progress_origins_owner", "account_progress_origins", ["owner_user_id"])
    op.create_table(
        "game_account_memberships",
        sa.Column("game_id", sa.String(64), sa.ForeignKey("active_games.game_id", ondelete="CASCADE"), primary_key=True),
        _user("user_id", primary_key=True),
        sa.Column("admission_revision", sa.Integer(), nullable=False),
        sa.Column("admitted_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_game_account_membership_user", "game_account_memberships", ["user_id"])
    op.create_table(
        "account_merge_game_resolutions", _user("owner_user_id", primary_key=True),
        sa.Column("game_type", sa.String(16), primary_key=True),
        sa.Column("game_id", sa.String(64), primary_key=True), _user("origin_user_id"),
        sa.Column("participant_id", sa.Integer(), nullable=False),
        sa.Column("player_key", sa.String(64), nullable=False),
        sa.Column("source_fingerprint", sa.String(64), nullable=False),
        sa.Column("policy_version", sa.Integer(), nullable=False), _operation(),
        sa.CheckConstraint("game_type IN ('zdwa', 'zilch', 'hausdepp', 'watten')", name="ck_merge_resolution_game_type"),
    )
    op.create_table(
        "merged_award_backings", sa.Column("id", sa.Integer(), primary_key=True), _user("owner_user_id"),
        sa.Column("game_type", sa.String(16), nullable=False),
        sa.Column("achievement_key", sa.String(64), nullable=False),
        sa.Column("support_key", sa.String(128), nullable=False), _user("origin_user_id"),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("original_unlocked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("continuity_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("credited_amount", sa.Integer(), nullable=False),
        sa.Column("context_json", sa.Text(), nullable=False), _operation(),
        sa.Column("invalidated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("owner_user_id", "game_type", "achievement_key", "support_key", name="uq_merged_award_support"),
        sa.CheckConstraint("game_type IN ('zdwa', 'zilch', 'hausdepp', 'watten')", name="ck_merged_award_game_type"),
        sa.CheckConstraint("kind IN ('original', 'native_observed', 'merge_threshold')", name="ck_merged_award_kind"),
        sa.CheckConstraint("credited_amount >= 0", name="ck_merged_award_nonnegative"),
    )
    op.create_index("ix_merged_award_owner_key", "merged_award_backings", ["owner_user_id", "game_type", "achievement_key"])


def downgrade() -> None:
    for name in ("account_merge_operations", "game_account_memberships"):
        if op.get_bind().execute(sa.select(sa.func.count()).select_from(sa.table(name))).scalar_one():
            raise RuntimeError("Cannot discard account merge provenance or live admissions")
    op.drop_table("merged_award_backings")
    op.drop_table("account_merge_game_resolutions")
    op.drop_table("game_account_memberships")
    op.drop_table("account_progress_origins")
    op.drop_table("account_merge_operations")
    op.drop_column("active_games", "admission_revision")
