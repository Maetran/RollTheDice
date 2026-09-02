"""Start the office-hours achievement series from its own rollout marker.

Revision ID: 20260902_0013
Revises: 20260902_0012
"""

from datetime import datetime, timezone

import sqlalchemy as sa

from alembic import op

revision = "20260902_0013"
down_revision = "20260902_0012"
branch_labels = None
depends_on = None

OFFICE_HOURS_SERIES_KEYS = (
    "office_hours_10",
    "office_hours_25",
    "office_hours_50",
)


def upgrade() -> None:
    bind = op.get_bind()
    user_columns = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    if "achievement_office_hours_started_at" not in user_columns:
        op.add_column(
            "users",
            sa.Column("achievement_office_hours_started_at", sa.DateTime(timezone=True), nullable=True),
        )
    bind.execute(
        sa.text(
            "UPDATE users SET achievement_office_hours_started_at = :started_at "
            "WHERE achievement_office_hours_started_at IS NULL"
        ),
        {"started_at": datetime.now(timezone.utc)},
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text("DELETE FROM user_achievements WHERE achievement_key IN :keys").bindparams(
            sa.bindparam("keys", expanding=True)
        ),
        {"keys": OFFICE_HOURS_SERIES_KEYS},
    )
    op.drop_column("users", "achievement_office_hours_started_at")
