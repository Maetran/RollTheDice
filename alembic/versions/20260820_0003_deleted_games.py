"""Add permanent game-deletion tombstones.

Revision ID: 20260820_0003
Revises: 20260820_0002
Create Date: 2026-08-20
"""

import sqlalchemy as sa

from alembic import op

revision = "20260820_0003"
down_revision = "20260820_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "deleted_games",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("game_id", sa.String(length=64), nullable=False, unique=True),
        sa.Column("game_name", sa.String(length=160), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("hardcore", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "deleted_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=False),
    )
    op.create_index("ix_deleted_games_deleted_at", "deleted_games", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_deleted_games_deleted_at", table_name="deleted_games")
    op.drop_table("deleted_games")
