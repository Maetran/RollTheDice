"""Add account achievement progress and unlocked achievements.

Revision ID: 20260902_0009
Revises: 20260828_0008
"""

import sqlalchemy as sa

from alembic import op

revision = "20260902_0009"
down_revision = "20260828_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("statistics_views", sa.Integer(), nullable=False, server_default="0"))
    op.create_table(
        "user_achievements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("achievement_key", sa.String(length=64), nullable=False),
        sa.Column("unlocked_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "achievement_key", name="uq_user_achievement"),
    )
    op.create_index("ix_user_achievements_user", "user_achievements", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_user_achievements_user", table_name="user_achievements")
    op.drop_table("user_achievements")
    op.drop_column("users", "statistics_views")
