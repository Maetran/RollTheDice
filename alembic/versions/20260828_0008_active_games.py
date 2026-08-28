"""Persist waiting and running games across application restarts.

Revision ID: 20260828_0008
Revises: 20260827_0007
"""

from alembic import op
import sqlalchemy as sa


revision = "20260828_0008"
down_revision = "20260827_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "active_games",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("game_id", sa.String(length=64), nullable=False),
        sa.Column("state_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("game_id"),
    )
    op.create_index("ix_active_games_updated_at", "active_games", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_active_games_updated_at", table_name="active_games")
    op.drop_table("active_games")
