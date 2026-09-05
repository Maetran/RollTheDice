"""Preserve result-scoped Zilch award and rank moments.

Revision ID: 20260905_0021
Revises: 20260905_0020
Create Date: 2026-09-05

Achievement proof and presentation intentionally differ: an aggregate award
may be supported by an earlier game but become available after the current
one.  ``presentation_game_id`` captures the latter without exposing evidence.
Rank deliveries remain a one-slot inbox, so a small immutable moment table
keeps the historical transition visible in the completed-game report.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260905_0021"
down_revision = "20260905_0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "zilch_achievement_unlocks",
        sa.Column("presentation_game_id", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_zilch_achievement_unlocks_presentation_game",
        "zilch_achievement_unlocks",
        ["presentation_game_id"],
    )
    op.create_table(
        "zilch_achievement_rank_moments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "game_id",
            sa.String(length=64),
            sa.ForeignKey("zilch_achievement_evaluations.game_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("previous_rank_key", sa.String(length=32), nullable=False),
        sa.Column("rank_key", sa.String(length=32), nullable=False),
        sa.Column("previous_points", sa.Integer(), nullable=False),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("previous_points >= 0", name="ck_zilch_rank_moment_previous_points"),
        sa.CheckConstraint("points >= 0", name="ck_zilch_rank_moment_points"),
        sa.UniqueConstraint("user_id", "game_id", name="uq_zilch_rank_moment_user_game"),
    )
    op.create_index(
        "ix_zilch_rank_moments_game",
        "zilch_achievement_rank_moments",
        ["game_id", "recorded_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_zilch_rank_moments_game", table_name="zilch_achievement_rank_moments")
    op.drop_table("zilch_achievement_rank_moments")
    op.drop_index("ix_zilch_achievement_unlocks_presentation_game", table_name="zilch_achievement_unlocks")
    op.drop_column("zilch_achievement_unlocks", "presentation_game_id")
