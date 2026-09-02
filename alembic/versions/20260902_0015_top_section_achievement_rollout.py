"""Start exact upper-section 60 achievements from this rollout onward.

Revision ID: 20260902_0015
Revises: 20260902_0014
"""

from datetime import datetime, timezone

import sqlalchemy as sa

from alembic import op

revision = "20260902_0015"
down_revision = "20260902_0014"
branch_labels = None
depends_on = None

TOP_SECTION_ACHIEVEMENT_KEYS = (
    "top_section_exact_60",
    "top_section_all_exact_60",
)


def upgrade() -> None:
    bind = op.get_bind()
    user_columns = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    if "achievement_top_section_started_at" not in user_columns:
        op.add_column(
            "users",
            sa.Column("achievement_top_section_started_at", sa.DateTime(timezone=True), nullable=True),
        )
    bind.execute(
        sa.text(
            "UPDATE users SET achievement_top_section_started_at = :started_at "
            "WHERE achievement_top_section_started_at IS NULL"
        ),
        {"started_at": datetime.now(timezone.utc)},
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text("DELETE FROM user_achievements WHERE achievement_key IN :keys").bindparams(
            sa.bindparam("keys", expanding=True)
        ),
        {"keys": TOP_SECTION_ACHIEVEMENT_KEYS},
    )
    op.drop_column("users", "achievement_top_section_started_at")
