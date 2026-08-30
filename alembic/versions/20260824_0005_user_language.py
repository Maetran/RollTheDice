"""Add preferred UI language to users.

Revision ID: 20260824_0005
Revises: 20260824_0004
Create Date: 2026-08-24
"""

import sqlalchemy as sa

from alembic import op

revision = "20260824_0005"
down_revision = "20260824_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("preferred_language", sa.String(length=2), nullable=False, server_default="de"),
    )


def downgrade() -> None:
    op.drop_column("users", "preferred_language")
