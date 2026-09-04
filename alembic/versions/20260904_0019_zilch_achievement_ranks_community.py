"""Add Zilch rank sources and the monotonic community milestone ledger.

Revision ID: 20260904_0019
Revises: 20260904_0018
Create Date: 2026-09-04

The bootstrap is intentionally restricted to the explicit Zilch achievement
evaluation/evidence boundary.  It never scans the general completed-game
table, so results predating the original award rollout cannot enter the
community counter by accident.  Typed deletion tombstones are excluded.
Existing qualifying registered sources seed the ledger and reconstruct every
already reached threshold at its exact Nth game.  Recipients are derived only
from qualifying account evidence at or before that ordinal and active accounts
at rollout time.  A durable catalog-version marker then makes the application
materialize personal and community unlocks from that explicit evidence once.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import sqlalchemy as sa

from alembic import op

revision = "20260904_0019"
down_revision = "20260904_0018"
branch_labels = None
depends_on = None

_COMMUNITY_MILESTONES = (
    ("zilch.community_games_100", 100),
    ("zilch.community_games_500", 500),
    ("zilch.community_games_1000", 1_000),
    ("zilch.community_games_5000", 5_000),
    ("zilch.community_games_10000", 10_000),
)
_KNOWN_RULESET = "zilch-house-v1"
_KNOWN_RESULT_SCHEMAS = {1, 2}


def _qualifies(row) -> bool:
    try:
        facts = json.loads(str(row["facts_json"]))
    except (TypeError, ValueError, json.JSONDecodeError):
        return False
    if not isinstance(facts, dict):
        return False
    mode = facts.get("play_mode")
    schema_version = facts.get("schema_version")
    ruleset = facts.get("ruleset")
    if (
        type(schema_version) is not int
        or schema_version not in _KNOWN_RESULT_SCHEMAS
        or schema_version != int(row["evidence_schema_version"])
        or schema_version != int(row["evaluation_schema_version"])
        or mode != row["evidence_play_mode"]
        or ruleset != _KNOWN_RULESET
        or ruleset != row["evidence_ruleset"]
        or ruleset != row["evaluation_ruleset"]
    ):
        return False
    outcome = facts.get("outcome")
    if mode == "solo":
        return outcome == "completed"
    return mode in {"multiplayer", "cpu"} and outcome in {"win", "loss", "tie"}


def _bootstrap_registered_games(bind) -> list[dict[str, object]]:
    rows = bind.execute(
        sa.text(
            """
            SELECT evaluation.game_id,
                   COALESCE(evaluation.evaluated_at, evaluation.registered_at) AS counted_at,
                   evaluation.id AS evaluation_id,
                   evaluation.result_schema_version AS evaluation_schema_version,
                   evaluation.ruleset AS evaluation_ruleset,
                   evidence.user_id,
                   evidence.result_schema_version AS evidence_schema_version,
                   evidence.ruleset AS evidence_ruleset,
                   evidence.play_mode AS evidence_play_mode,
                   evidence.facts_json
              FROM zilch_achievement_evaluations AS evaluation
              JOIN zilch_achievement_evidence AS evidence
                ON evidence.evaluation_id = evaluation.id
             WHERE evaluation.status = 'completed'
               AND evaluation.game_type = 'zilch'
               AND evidence.source_game_id = evaluation.game_id
               AND NOT EXISTS (
                   SELECT 1
                     FROM deleted_games AS deleted
                    WHERE deleted.game_id = evaluation.game_id
                      AND deleted.game_type = 'zilch'
               )
             ORDER BY COALESCE(evaluation.evaluated_at, evaluation.registered_at),
                      evaluation.id,
                      evidence.id
            """
        )
    ).mappings()
    ordered: list[dict[str, object]] = []
    by_game: dict[str, dict[str, object]] = {}
    for row in rows:
        game_id = str(row["game_id"])
        entry = by_game.get(game_id)
        if entry is None:
            entry = {
                "game_id": game_id,
                "counted_at": row["counted_at"],
                "qualifies": False,
                "participant_user_ids": set(),
            }
            by_game[game_id] = entry
            ordered.append(entry)
        if _qualifies(row):
            entry["qualifies"] = True
            participants = entry["participant_user_ids"]
            if isinstance(participants, set):
                participants.add(int(row["user_id"]))
    return [entry for entry in ordered if entry["qualifies"] is True]


def upgrade() -> None:
    op.create_table(
        "zilch_community_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("qualified_games", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("achievement_catalog_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_zilch_community_state_singleton"),
        sa.CheckConstraint("qualified_games >= 0", name="ck_zilch_community_state_games"),
        sa.CheckConstraint(
            "achievement_catalog_version >= 0",
            name="ck_zilch_community_state_catalog_version",
        ),
    )
    op.create_table(
        "zilch_community_games",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("game_id", sa.String(length=64), nullable=False, unique=True),
        sa.Column("ordinal", sa.Integer(), nullable=False, unique=True),
        sa.Column("counted_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("ordinal >= 1", name="ck_zilch_community_games_ordinal"),
    )
    op.create_index("ix_zilch_community_games_counted", "zilch_community_games", ["counted_at"])
    op.create_table(
        "zilch_community_participants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "game_id",
            sa.String(length=64),
            sa.ForeignKey("zilch_community_games.game_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("qualified_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("game_id", "user_id", name="uq_zilch_community_participant_game_user"),
    )
    op.create_index(
        "ix_zilch_community_participants_user",
        "zilch_community_participants",
        ["user_id"],
    )
    op.create_table(
        "zilch_community_milestones",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("achievement_key", sa.String(length=96), nullable=False, unique=True),
        sa.Column("threshold", sa.Integer(), nullable=False, unique=True),
        sa.Column("reached_ordinal", sa.Integer(), nullable=False),
        sa.Column(
            "trigger_game_id",
            sa.String(length=64),
            sa.ForeignKey("zilch_community_games.game_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("reached_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("threshold >= 1", name="ck_zilch_community_milestones_threshold"),
        sa.CheckConstraint(
            "reached_ordinal = threshold",
            name="ck_zilch_community_milestones_ordinal",
        ),
    )
    op.create_index(
        "ix_zilch_community_milestones_reached",
        "zilch_community_milestones",
        ["reached_at"],
    )
    op.create_table(
        "zilch_community_recipients",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "milestone_id",
            sa.Integer(),
            sa.ForeignKey("zilch_community_milestones.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("awarded_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("milestone_id", "user_id", name="uq_zilch_community_recipient"),
    )
    op.create_index(
        "ix_zilch_community_recipients_user",
        "zilch_community_recipients",
        ["user_id"],
    )
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        # ``zilch_achievement_deliveries`` references this table with
        # ON DELETE CASCADE.  A batch rebuild would drop the parent table and
        # silently delete every existing delivery while foreign keys are on.
        # SQLite 3.35+ is already required by the runtime's UPDATE ... RETURNING
        # counter and supports both native ADD COLUMN and DROP COLUMN.
        op.execute(
            """
            ALTER TABLE zilch_achievement_unlocks
            ADD COLUMN source_community_recipient_id INTEGER
                REFERENCES zilch_community_recipients(id) ON DELETE SET NULL
            """
        )
    else:
        op.add_column(
            "zilch_achievement_unlocks",
            sa.Column("source_community_recipient_id", sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            "fk_zilch_achievement_unlocks_community_recipient",
            "zilch_achievement_unlocks",
            "zilch_community_recipients",
            ["source_community_recipient_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index(
        "ix_zilch_achievement_unlocks_community_source",
        "zilch_achievement_unlocks",
        ["source_community_recipient_id"],
    )

    registered_games = _bootstrap_registered_games(bind)
    first_ordinal_by_user: dict[int, int] = {}
    for ordinal, item in enumerate(registered_games, start=1):
        bind.execute(
            sa.text(
                """
                INSERT INTO zilch_community_games (game_id, ordinal, counted_at)
                VALUES (:game_id, :ordinal, :counted_at)
                """
            ),
            {
                "game_id": item["game_id"],
                "ordinal": ordinal,
                "counted_at": item["counted_at"],
            },
        )
        participants = item.get("participant_user_ids")
        if not isinstance(participants, set):
            continue
        for user_id in sorted(int(value) for value in participants):
            bind.execute(
                sa.text(
                    """
                    INSERT INTO zilch_community_participants (game_id, user_id, qualified_at)
                    VALUES (:game_id, :user_id, :qualified_at)
                    """
                ),
                {
                    "game_id": item["game_id"],
                    "user_id": user_id,
                    "qualified_at": item["counted_at"],
                },
            )
            first_ordinal_by_user.setdefault(user_id, ordinal)

    active_user_ids = {
        int(user_id)
        for user_id in bind.execute(sa.text("SELECT id FROM users WHERE is_active = :active"), {"active": True}).scalars()
    }
    for achievement_key, threshold in _COMMUNITY_MILESTONES:
        if threshold > len(registered_games):
            continue
        trigger = registered_games[threshold - 1]
        bind.execute(
            sa.text(
                """
                INSERT INTO zilch_community_milestones
                    (achievement_key, threshold, reached_ordinal, trigger_game_id, reached_at)
                VALUES
                    (:achievement_key, :threshold, :threshold, :trigger_game_id, :reached_at)
                """
            ),
            {
                "achievement_key": achievement_key,
                "threshold": threshold,
                "trigger_game_id": trigger["game_id"],
                "reached_at": trigger["counted_at"],
            },
        )
        milestone_id = bind.execute(
            sa.text(
                "SELECT id FROM zilch_community_milestones WHERE achievement_key = :achievement_key"
            ),
            {"achievement_key": achievement_key},
        ).scalar_one()
        for user_id, first_ordinal in sorted(first_ordinal_by_user.items()):
            if user_id not in active_user_ids or first_ordinal > threshold:
                continue
            bind.execute(
                sa.text(
                    """
                    INSERT INTO zilch_community_recipients (milestone_id, user_id, awarded_at)
                    VALUES (:milestone_id, :user_id, :awarded_at)
                    """
                ),
                {
                    "milestone_id": milestone_id,
                    "user_id": user_id,
                    "awarded_at": trigger["counted_at"],
                },
            )
    bind.execute(
        sa.text(
            """
            INSERT INTO zilch_community_state
                (id, qualified_games, achievement_catalog_version, updated_at)
            VALUES
                (1, :qualified_games, 0, :updated_at)
            """
        ),
        {
            "qualified_games": len(registered_games),
            "updated_at": datetime.now(timezone.utc),
        },
    )


def downgrade() -> None:
    bind = op.get_bind()
    for achievement_key, _threshold in _COMMUNITY_MILESTONES:
        bind.execute(
            sa.text(
                """
                DELETE FROM zilch_achievement_deliveries
                 WHERE unlock_id IN (
                     SELECT id
                       FROM zilch_achievement_unlocks
                      WHERE achievement_key = :achievement_key
                 )
                """
            ),
            {"achievement_key": achievement_key},
        )
        bind.execute(
            sa.text("DELETE FROM zilch_achievement_unlocks WHERE achievement_key = :achievement_key"),
            {"achievement_key": achievement_key},
        )
    op.drop_index(
        "ix_zilch_achievement_unlocks_community_source",
        table_name="zilch_achievement_unlocks",
    )
    if bind.dialect.name == "sqlite":
        op.execute("ALTER TABLE zilch_achievement_unlocks DROP COLUMN source_community_recipient_id")
    else:
        op.drop_constraint(
            "fk_zilch_achievement_unlocks_community_recipient",
            "zilch_achievement_unlocks",
            type_="foreignkey",
        )
        op.drop_column("zilch_achievement_unlocks", "source_community_recipient_id")
    op.drop_index(
        "ix_zilch_community_recipients_user",
        table_name="zilch_community_recipients",
    )
    op.drop_table("zilch_community_recipients")
    op.drop_index(
        "ix_zilch_community_milestones_reached",
        table_name="zilch_community_milestones",
    )
    op.drop_table("zilch_community_milestones")
    op.drop_index(
        "ix_zilch_community_participants_user",
        table_name="zilch_community_participants",
    )
    op.drop_table("zilch_community_participants")
    op.drop_index("ix_zilch_community_games_counted", table_name="zilch_community_games")
    op.drop_table("zilch_community_games")
    op.drop_table("zilch_community_state")
