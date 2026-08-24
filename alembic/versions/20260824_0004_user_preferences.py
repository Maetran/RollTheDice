"""Add per-user gameplay preferences.

Revision ID: 20260824_0004
Revises: 20260820_0003
Create Date: 2026-08-24
"""

from alembic import op
import sqlalchemy as sa


revision = "20260824_0004"
down_revision = "20260820_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("announce_selection_mode", sa.String(length=16), nullable=False, server_default="overlay"),
    )
    op.add_column(
        "users",
        sa.Column("auto_write_announced", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("users", "auto_write_announced")
    op.drop_column("users", "announce_selection_mode")
