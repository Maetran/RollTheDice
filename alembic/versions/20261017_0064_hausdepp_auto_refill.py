"""Store the per-account Hausdepp auto-refill choice without rewriting users.

Revision ID: 20261017_0064
Revises: 20261016_0063
"""

import sqlalchemy as sa

from alembic import op

revision = "20261017_0064"
down_revision = "20261016_0063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "hausdepp_preferences",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("auto_refill", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_table("hausdepp_preferences")
