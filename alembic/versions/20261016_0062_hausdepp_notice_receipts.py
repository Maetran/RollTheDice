"""Confirm individual Hausdepp popup deliveries without changing earned XP."""

import sqlalchemy as sa

from alembic import op

revision = "20261016_0062"
down_revision = "20261016_0061"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Deliberately empty: existing earned achievements/ranks are presented once
    # by the new popup flow, independently of earlier summary acknowledgements.
    op.create_table(
        "hausdepp_notice_receipts",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("notice_key", sa.String(64), primary_key=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("hausdepp_notice_receipts")
