"""Add isolated, retry-safe Zilch achievement persistence.

Revision ID: 20260903_0017
Revises: 20260903_0016
Create Date: 2026-09-03

Zilch awards deliberately do not reuse ``user_achievements``: that table is
the public ZDWA Ehrenberg-mark and title system.  These private tables retain
only explicitly registered post-rollout Zilch result evidence, the derived
namespaced unlock, and the reload-safe award delivery acknowledgement.
No historic completed result is scanned or backfilled by this migration.
"""

import sqlalchemy as sa

from alembic import op

revision = "20260903_0017"
down_revision = "20260903_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "zilch_achievement_evaluations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("game_id", sa.String(length=64), nullable=False, unique=True),
        sa.Column("game_type", sa.String(length=16), nullable=False),
        sa.Column("result_schema_version", sa.Integer(), nullable=False),
        sa.Column("ruleset", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("registered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=160), nullable=True),
        sa.CheckConstraint("game_type = 'zilch'", name="ck_zilch_achievement_evaluations_game_type"),
        sa.CheckConstraint("result_schema_version >= 1", name="ck_zilch_achievement_evaluations_schema"),
        sa.CheckConstraint("status IN ('pending', 'completed')", name="ck_zilch_achievement_evaluations_status"),
        sa.CheckConstraint("attempts >= 0", name="ck_zilch_achievement_evaluations_attempts"),
    )
    op.create_index(
        "ix_zilch_achievement_evaluations_status_registered",
        "zilch_achievement_evaluations",
        ["status", "registered_at"],
    )

    op.create_table(
        "zilch_achievement_evidence",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "evaluation_id",
            sa.Integer(),
            sa.ForeignKey("zilch_achievement_evaluations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_game_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("result_schema_version", sa.Integer(), nullable=False),
        sa.Column("ruleset", sa.String(length=64), nullable=False),
        sa.Column("play_mode", sa.String(length=24), nullable=False),
        sa.Column("facts_json", sa.Text(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("result_schema_version >= 1", name="ck_zilch_achievement_evidence_schema"),
        sa.CheckConstraint(
            "play_mode IN ('multiplayer', 'cpu', 'solo')",
            name="ck_zilch_achievement_evidence_play_mode",
        ),
        sa.UniqueConstraint("evaluation_id", "user_id", name="uq_zilch_achievement_evidence_evaluation_user"),
    )
    op.create_index("ix_zilch_achievement_evidence_user", "zilch_achievement_evidence", ["user_id"])
    op.create_index(
        "ix_zilch_achievement_evidence_source_game",
        "zilch_achievement_evidence",
        ["source_game_id"],
    )

    op.create_table(
        "zilch_achievement_unlocks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("achievement_key", sa.String(length=96), nullable=False),
        sa.Column("definition_version", sa.Integer(), nullable=False),
        sa.Column(
            "source_evidence_id",
            sa.Integer(),
            sa.ForeignKey("zilch_achievement_evidence.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("source_game_id", sa.String(length=64), nullable=True),
        sa.Column("unlocked_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("definition_version >= 1", name="ck_zilch_achievement_unlocks_definition"),
        sa.UniqueConstraint("user_id", "achievement_key", name="uq_zilch_achievement_unlock_user_key"),
    )
    op.create_index("ix_zilch_achievement_unlocks_user", "zilch_achievement_unlocks", ["user_id"])

    op.create_table(
        "zilch_achievement_deliveries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "unlock_id",
            sa.Integer(),
            sa.ForeignKey("zilch_achievement_unlocks.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("queued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_zilch_achievement_deliveries_pending",
        "zilch_achievement_deliveries",
        ["acknowledged_at", "queued_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_zilch_achievement_deliveries_pending", table_name="zilch_achievement_deliveries")
    op.drop_table("zilch_achievement_deliveries")
    op.drop_index("ix_zilch_achievement_unlocks_user", table_name="zilch_achievement_unlocks")
    op.drop_table("zilch_achievement_unlocks")
    op.drop_index("ix_zilch_achievement_evidence_source_game", table_name="zilch_achievement_evidence")
    op.drop_index("ix_zilch_achievement_evidence_user", table_name="zilch_achievement_evidence")
    op.drop_table("zilch_achievement_evidence")
    op.drop_index(
        "ix_zilch_achievement_evaluations_status_registered",
        table_name="zilch_achievement_evaluations",
    )
    op.drop_table("zilch_achievement_evaluations")
