"""Start shared ZDWA/Zilch achievement goals at a clear rollout boundary.

Revision ID: 20260907_0033
Revises: 20260906_0032
"""

from datetime import datetime, timezone

import sqlalchemy as sa

from alembic import op

revision = "20260907_0033"
down_revision = "20260906_0032"
branch_labels = None
depends_on = None

ZDWA_CROSS_GAME_KEYS = (
    "cross_game_days_1",
    "cross_game_days_10",
    "cross_game_days_50",
    "cross_game_days_100",
    "cross_game_days_500",
    "cross_game_streak_3",
    "cross_game_streak_7",
    "cross_game_streak_14",
    "cross_game_streak_30",
)
ZILCH_CROSS_GAME_KEYS = tuple(f"zilch.{key}" for key in ZDWA_CROSS_GAME_KEYS)


def upgrade() -> None:
    bind = op.get_bind()
    user_columns = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    if "achievement_cross_game_started_at" not in user_columns:
        op.add_column(
            "users",
            sa.Column("achievement_cross_game_started_at", sa.DateTime(timezone=True), nullable=True),
        )
    bind.execute(
        sa.text(
            "UPDATE users SET achievement_cross_game_started_at = :started_at "
            "WHERE achievement_cross_game_started_at IS NULL"
        ),
        {"started_at": datetime.now(timezone.utc)},
    )


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "user_achievements" in tables:
        bind.execute(
            sa.text("DELETE FROM user_achievements WHERE achievement_key IN :keys").bindparams(
                sa.bindparam("keys", expanding=True)
            ),
            {"keys": ZDWA_CROSS_GAME_KEYS},
        )
    if "zilch_achievement_unlocks" in tables:
        unlock_ids = sa.text(
            "SELECT id FROM zilch_achievement_unlocks WHERE achievement_key IN :keys"
        ).bindparams(sa.bindparam("keys", expanding=True))
        if "zilch_achievement_deliveries" in tables:
            bind.execute(
                sa.text("DELETE FROM zilch_achievement_deliveries WHERE unlock_id IN (" + unlock_ids.text + ")")
                .bindparams(sa.bindparam("keys", expanding=True)),
                {"keys": ZILCH_CROSS_GAME_KEYS},
            )
        bind.execute(
            sa.text("DELETE FROM zilch_achievement_unlocks WHERE achievement_key IN :keys").bindparams(
                sa.bindparam("keys", expanding=True)
            ),
            {"keys": ZILCH_CROSS_GAME_KEYS},
        )
    user_columns = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    if "achievement_cross_game_started_at" in user_columns:
        op.drop_column("users", "achievement_cross_game_started_at")
