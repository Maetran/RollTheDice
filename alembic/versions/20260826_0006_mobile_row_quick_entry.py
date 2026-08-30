"""Add mobile row quick-entry preference.

Revision ID: 20260826_0006
Revises: 20260824_0005
Create Date: 2026-08-26
"""

import sqlalchemy as sa

from alembic import op

revision = "20260826_0006"
down_revision = "20260824_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("mobile_row_quick_entry", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Accounts that already exist when this migration runs receive the feature.
    # Future accounts keep the false model/database default.
    op.execute(sa.text("UPDATE users SET mobile_row_quick_entry = :enabled").bindparams(enabled=True))


def downgrade() -> None:
    op.drop_column("users", "mobile_row_quick_entry")
