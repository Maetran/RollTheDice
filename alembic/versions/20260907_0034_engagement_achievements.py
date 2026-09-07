"""Track explicit account interactions for new non-retroactive awards.

Revision ID: 20260907_0034
Revises: 20260907_0033
"""

import sqlalchemy as sa

from alembic import op

revision = "20260907_0034"
down_revision = "20260907_0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_engagement_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_key", sa.String(64), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False, server_default="1"),
        sa.UniqueConstraint("user_id", "event_key", name="uq_user_engagement_event"),
    )
    op.create_index("ix_user_engagement_events_user", "user_engagement_events", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_user_engagement_events_user", table_name="user_engagement_events")
    op.drop_table("user_engagement_events")
