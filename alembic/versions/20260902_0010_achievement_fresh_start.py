"""Start gameplay-specific achievements from this rollout onward.

Revision ID: 20260902_0010
Revises: 20260902_0009
"""

from datetime import datetime, timezone

import sqlalchemy as sa

from alembic import op

revision = "20260902_0010"
down_revision = "20260902_0009"
branch_labels = None
depends_on = None

HISTORICAL_ACHIEVEMENT_KEYS = (
    "account_created",
    "career_points_1000",
    "career_points_10000",
    "career_points_100000",
    "career_points_500000",
    "career_points_1000000",
    "games_played_10",
    "games_played_100",
    "games_played_200",
    "games_played_500",
    "games_played_800",
    "games_played_1000",
    "games_played_10000",
    "single_game_score_1000",
    "single_game_score_1100",
    "single_game_score_1200",
    "single_game_score_1300",
    "single_game_score_1400",
    "single_game_score_1500",
    "single_game_score_1600",
)


def upgrade() -> None:
    bind = op.get_bind()
    user_columns = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    if "achievement_gameplay_started_at" not in user_columns:
        op.add_column(
            "users",
            sa.Column("achievement_gameplay_started_at", sa.DateTime(timezone=True), nullable=True),
        )
    bind.execute(
        sa.text("UPDATE users SET achievement_gameplay_started_at = :started_at"),
        {"started_at": datetime.now(timezone.utc)},
    )
    op.execute(sa.text("UPDATE users SET statistics_views = 0"))
    retained = ", ".join(f"'{key}'" for key in HISTORICAL_ACHIEVEMENT_KEYS)
    op.execute(sa.text(f"DELETE FROM user_achievements WHERE achievement_key NOT IN ({retained})"))


def downgrade() -> None:
    op.drop_column("users", "achievement_gameplay_started_at")
