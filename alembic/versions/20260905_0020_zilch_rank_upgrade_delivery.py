"""Add reload-safe delivery for Zilch's latest rank upgrade.

Revision ID: 20260905_0020
Revises: 20260904_0019
Create Date: 2026-09-05

The table intentionally starts empty.  On the next private pending-delivery
read, the application derives an account's latest genuine transition from its
already durable Zilch award unlocks and queues it once.  This gives existing
players the same celebration without scanning general game history or granting
new awards.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260905_0020"
down_revision = "20260904_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "zilch_achievement_rank_deliveries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "source_unlock_id",
            sa.Integer(),
            sa.ForeignKey("zilch_achievement_unlocks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("previous_rank_key", sa.String(length=32), nullable=False),
        sa.Column("rank_key", sa.String(length=32), nullable=False),
        sa.Column("previous_points", sa.Integer(), nullable=False),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.Column("queued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("previous_points >= 0", name="ck_zilch_rank_delivery_previous_points"),
        sa.CheckConstraint("points >= 0", name="ck_zilch_rank_delivery_points"),
        sa.UniqueConstraint("user_id", name="uq_zilch_rank_delivery_user"),
    )
    op.create_index(
        "ix_zilch_rank_deliveries_pending",
        "zilch_achievement_rank_deliveries",
        ["acknowledged_at", "queued_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_zilch_rank_deliveries_pending", table_name="zilch_achievement_rank_deliveries")
    op.drop_table("zilch_achievement_rank_deliveries")
