"""Start the additional achievement series from its own rollout marker.

Revision ID: 20260902_0011
Revises: 20260902_0010
"""

from datetime import datetime, timezone

import sqlalchemy as sa

from alembic import op

revision = "20260902_0011"
down_revision = "20260902_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    user_columns = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    if "achievement_extra_started_at" not in user_columns:
        op.add_column(
            "users",
            sa.Column("achievement_extra_started_at", sa.DateTime(timezone=True), nullable=True),
        )
    bind.execute(
        sa.text(
            "UPDATE users SET achievement_extra_started_at = :started_at "
            "WHERE achievement_extra_started_at IS NULL"
        ),
        {"started_at": datetime.now(timezone.utc)},
    )


def downgrade() -> None:
    op.drop_column("users", "achievement_extra_started_at")
