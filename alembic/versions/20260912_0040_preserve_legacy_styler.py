"""Preserve existing Styler awards without granting any missing achievement.

Revision ID: 20260912_0040
Revises: 20260912_0039
Create Date: 2026-09-12
"""

import sqlalchemy as sa

from alembic import op

revision = "20260912_0040"
down_revision = "20260912_0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_achievements",
        sa.Column("legacy_styler", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # This is preservation metadata for existing rows, never a historic result
    # scan or INSERT. Missing tiers and new post-upgrade awards remain false.
    op.execute(sa.text(
        "UPDATE user_achievements SET legacy_styler = TRUE "
        "WHERE achievement_key IN ('styler_full_once', 'styler_full_10')"
    ))


def downgrade() -> None:
    # Native DROP COLUMN preserves the awards, their dates and source links.
    op.drop_column("user_achievements", "legacy_styler")
