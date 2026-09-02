"""Add the latest achievement rollout marker and historical score backfill.

Revision ID: 20260902_0012
Revises: 20260902_0011
"""

from datetime import datetime, timezone

import sqlalchemy as sa

from alembic import op

revision = "20260902_0012"
down_revision = "20260902_0011"
branch_labels = None
depends_on = None

EXACT_SCORES = (555, 666, 777, 888, 999, 1_111, 1_222, 1_333, 1_444, 1_555)
CAREER_TARGETS = (1_000, 10_000, 100_000, 500_000, 1_000_000)
GAME_TARGETS = (10, 100, 200, 500, 800, 1_000, 10_000)
SINGLE_GAME_TARGETS = (1_000, 1_100, 1_200, 1_300, 1_400, 1_500, 1_600)
HARDCORE_GAME_TARGETS = (1, 10, 30, 50, 100, 300, 500, 1_000)
HARDCORE_SCORE_TARGETS = (300, 400, 500, 600, 700, 800, 900, 1_000)


def _insert_achievement_from_query(bind, key: str, query: str, **parameters: object) -> None:
    """Insert an unlocked achievement for every user yielded by ``query``.

    The score achievements are deliberately historical.  This migration makes
    that promise true without requiring every existing player to open a
    profile first.
    """
    bind.execute(
        sa.text(
            f"""
            INSERT INTO user_achievements (user_id, achievement_key, unlocked_at)
            SELECT eligible.user_id, :achievement_key, :unlocked_at
            FROM ({query}) AS eligible
            WHERE NOT EXISTS (
                SELECT 1
                FROM user_achievements existing
                WHERE existing.user_id = eligible.user_id
                  AND existing.achievement_key = :achievement_key
            )
            """
        ),
        {"achievement_key": key, "unlocked_at": datetime.now(timezone.utc), **parameters},
    )


def upgrade() -> None:
    bind = op.get_bind()
    user_columns = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    if "achievement_expansion_started_at" not in user_columns:
        op.add_column(
            "users",
            sa.Column("achievement_expansion_started_at", sa.DateTime(timezone=True), nullable=True),
        )
    bind.execute(
        sa.text(
            "UPDATE users SET achievement_expansion_started_at = :started_at "
            "WHERE achievement_expansion_started_at IS NULL"
        ),
        {"started_at": datetime.now(timezone.utc)},
    )

    _insert_achievement_from_query(bind, "account_created", "SELECT id AS user_id FROM users")

    for target in CAREER_TARGETS:
        _insert_achievement_from_query(
            bind,
            f"career_points_{target}",
            """
            SELECT gp.user_id AS user_id
            FROM game_participants gp
            WHERE gp.user_id IS NOT NULL
            GROUP BY gp.user_id
            HAVING SUM(gp.points) >= :target
            """,
            target=target,
        )
    for target in GAME_TARGETS:
        _insert_achievement_from_query(
            bind,
            f"games_played_{target}",
            """
            SELECT gp.user_id AS user_id
            FROM game_participants gp
            WHERE gp.user_id IS NOT NULL
            GROUP BY gp.user_id
            HAVING COUNT(gp.id) >= :target
            """,
            target=target,
        )
    for target in SINGLE_GAME_TARGETS:
        _insert_achievement_from_query(
            bind,
            f"single_game_score_{target}",
            """
            SELECT gp.user_id AS user_id
            FROM game_participants gp
            WHERE gp.user_id IS NOT NULL
            GROUP BY gp.user_id
            HAVING MAX(gp.points) >= :target
            """,
            target=target,
        )
    for target in HARDCORE_GAME_TARGETS:
        _insert_achievement_from_query(
            bind,
            f"hardcore_games_{target}",
            """
            SELECT gp.user_id AS user_id
            FROM game_participants gp
            JOIN completed_games cg ON cg.id = gp.game_id
            WHERE gp.user_id IS NOT NULL AND cg.hardcore = :hardcore
            GROUP BY gp.user_id
            HAVING COUNT(gp.id) >= :target
            """,
            hardcore=True,
            target=target,
        )
    for target in HARDCORE_SCORE_TARGETS:
        _insert_achievement_from_query(
            bind,
            f"hardcore_score_{target}",
            """
            SELECT gp.user_id AS user_id
            FROM game_participants gp
            JOIN completed_games cg ON cg.id = gp.game_id
            WHERE gp.user_id IS NOT NULL AND cg.hardcore = :hardcore
            GROUP BY gp.user_id
            HAVING MAX(gp.points) >= :target
            """,
            hardcore=True,
            target=target,
        )
    for score in EXACT_SCORES:
        _insert_achievement_from_query(
            bind,
            f"exact_game_score_{score}",
            """
            SELECT DISTINCT gp.user_id AS user_id
            FROM game_participants gp
            WHERE gp.user_id IS NOT NULL AND gp.points = :score
            """,
            score=score,
        )
    _insert_achievement_from_query(
        bind,
        "normal_under_700",
        """
        SELECT DISTINCT gp.user_id AS user_id
        FROM game_participants gp
        JOIN completed_games cg ON cg.id = gp.game_id
        WHERE gp.user_id IS NOT NULL AND cg.hardcore = :hardcore AND gp.points < :score
        """,
        hardcore=False,
        score=700,
    )


def downgrade() -> None:
    bind = op.get_bind()
    keys = ["normal_under_700", *(f"exact_game_score_{score}" for score in EXACT_SCORES)]
    bind.execute(
        sa.text("DELETE FROM user_achievements WHERE achievement_key IN :keys").bindparams(sa.bindparam("keys", expanding=True)),
        {"keys": keys},
    )
    op.drop_column("users", "achievement_expansion_started_at")
