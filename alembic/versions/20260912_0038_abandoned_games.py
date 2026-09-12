"""Store account-safe records for started games that were abandoned.

Revision ID: 20260912_0038
Revises: 20260912_0037
Create Date: 2026-09-12
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260912_0038"
down_revision = "20260912_0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "abandoned_games",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("game_id", sa.String(length=64), nullable=False, unique=True),
        sa.Column("game_type", sa.String(length=16), nullable=False),
        sa.Column("game_name", sa.String(length=160), nullable=False),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("hardcore", sa.Boolean(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("abandoned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.String(length=32), nullable=False),
        sa.Column("aborted_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("game_type IN ('zdwa', 'zilch')", name="ck_abandoned_games_game_type"),
        sa.CheckConstraint("reason IN ('manual', 'inactivity_timeout')", name="ck_abandoned_games_reason"),
    )
    op.create_index(
        "ix_abandoned_games_game_type_abandoned_at",
        "abandoned_games",
        ["game_type", "abandoned_at"],
    )
    op.create_index("ix_abandoned_games_abandoned_at", "abandoned_games", ["abandoned_at"])

    op.create_table(
        "abandoned_game_participants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "abandoned_game_id",
            sa.Integer(),
            sa.ForeignKey("abandoned_games.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("was_abort_initiator", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("abandoned_game_id", "user_id", name="uq_abandoned_game_participant_user"),
    )
    op.create_index("ix_abandoned_game_participants_user", "abandoned_game_participants", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_abandoned_game_participants_user", table_name="abandoned_game_participants")
    op.drop_table("abandoned_game_participants")
    op.drop_index("ix_abandoned_games_abandoned_at", table_name="abandoned_games")
    op.drop_index("ix_abandoned_games_game_type_abandoned_at", table_name="abandoned_games")
    op.drop_table("abandoned_games")
