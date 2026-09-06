"""Store one bounded, sanitized avatar per account.

Revision ID: 20260906_0030
Revises: 20260906_0029
Create Date: 2026-09-06
"""

import sqlalchemy as sa

from alembic import op

revision = "20260906_0030"
down_revision = "20260906_0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_avatars",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(data) BETWEEN 1 AND 65536", name="ck_user_avatar_size"),
    )


def downgrade() -> None:
    op.drop_table("user_avatars")
