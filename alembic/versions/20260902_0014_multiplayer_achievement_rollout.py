"""Start multiplayer achievement goals from their own rollout marker.

Revision ID: 20260902_0014
Revises: 20260902_0013
"""

from datetime import datetime, timezone

import sqlalchemy as sa

from alembic import op

revision = "20260902_0014"
down_revision = "20260902_0013"
branch_labels = None
depends_on = None

MULTIPLAYER_ACHIEVEMENT_KEYS = (
    "multiplayer_2p_margin_100",
    "multiplayer_2p_margin_200",
    "multiplayer_2p_margin_350",
    "multiplayer_3p_runner_up_margin_100",
    "multiplayer_3p_runner_up_margin_200",
    "multiplayer_3p_runner_up_margin_350",
    "multiplayer_3p_last_margin_100",
    "multiplayer_3p_last_margin_200",
    "multiplayer_3p_last_margin_350",
    "multiplayer_2v2_margin_100",
    "multiplayer_2v2_margin_200",
    "multiplayer_2v2_margin_350",
    "multiplayer_close_win",
    "multiplayer_one_point_win",
    "multiplayer_blowout",
)


def upgrade() -> None:
    bind = op.get_bind()
    user_columns = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    if "achievement_multiplayer_started_at" not in user_columns:
        op.add_column(
            "users",
            sa.Column("achievement_multiplayer_started_at", sa.DateTime(timezone=True), nullable=True),
        )
    bind.execute(
        sa.text(
            "UPDATE users SET achievement_multiplayer_started_at = :started_at "
            "WHERE achievement_multiplayer_started_at IS NULL"
        ),
        {"started_at": datetime.now(timezone.utc)},
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text("DELETE FROM user_achievements WHERE achievement_key IN :keys").bindparams(
            sa.bindparam("keys", expanding=True)
        ),
        {"keys": MULTIPLAYER_ACHIEVEMENT_KEYS},
    )
    op.drop_column("users", "achievement_multiplayer_started_at")
