"""Focused persistence contracts for private, server-derived Zilch awards.

These tests deliberately write typed Zilch results through the shared result
writer and then invoke the isolated registration boundary.  They must never
depend on a browser event or on the public ZDWA achievement tables.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from alembic.config import Config
from sqlalchemy import func, inspect, select

from alembic import command
from app import main
from app.auth import create_user
from app.database import configure_database, get_engine, session_scope, upgrade_database
from app.game_history import delete_completed_game, persist_completed_game_result
from app.game_types import ZILCH_GAME_TYPE
from app.models import (
    CompletedGame,
    ZilchAchievementDelivery,
    ZilchAchievementEvaluation,
    ZilchAchievementEvidence,
    ZilchAchievementUnlock,
)
from app.zilch_achievements import (
    ZILCH_ACHIEVEMENT_BY_KEY,
    ZILCH_ACHIEVEMENT_NAMESPACE,
    _register_evaluation,
    acknowledge_zilch_award,
    get_zilch_achievement_profile,
    pending_zilch_awards,
    recover_deleted_zilch_achievement_sources,
    recover_pending_zilch_achievement_evaluations,
    register_zilch_result_for_achievements,
    remove_zilch_result_from_achievements,
    zilch_achievement_definitions_payload,
)
from app.zilch_engine import ZILCH_RULESET_VERSION
from app.zilch_results import build_zilch_result_payload
from app.zilch_solo_objective import (
    ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
    ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
    ZILCH_SOLO_SPRINT_TARGET_SCORE,
)
from app.zilch_state import (
    configure_zilch_cpu_game,
    finish_zilch_game,
    join_zilch_player,
    new_zilch_game,
    record_zilch_start_roll,
    start_zilch_game,
)


class ZilchAchievementPersistenceTestCase(TestCase):
    """Awards are isolated, explicit, idempotent and reversible by source."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "zilch-achievements.sqlite3"
        self.environment = patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.database_path}",
                "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
                "ROLLTHEDICE_TURNSTILE_SECRET": "",
                "ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "",
            },
        )
        self.environment.start()
        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)
        self.sequence = 0

    def tearDown(self) -> None:
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.temporary_directory.cleanup()

    def _user(self, username: str, *, role: str = "user"):
        return create_user(username, f"{username}-secure-password-123", role=role, must_change_password=False)

    @staticmethod
    def _player(player_id: str, name: str, user_id: int | None) -> dict:
        return {"id": player_id, "name": name, "user_id": user_id, "ws": None}

    def _store(self, game: dict) -> str:
        """Store without finalizer registration to prove there is no backfill."""

        payload = build_zilch_result_payload(game)
        finished_at = datetime.fromisoformat(str(payload["finished_at"]).replace("Z", "+00:00"))
        result = persist_completed_game_result(
            game_id=payload["game_id"],
            game_name=payload["game_name"],
            game_type=ZILCH_GAME_TYPE,
            mode=payload["mode"],
            hardcore=False,
            finished_at=finished_at,
            snapshot=payload,
            participants=[
                {
                    "position": participant["position"],
                    "player_key": participant["player_key"],
                    "display_name": participant["display_name"],
                    "team": None,
                    "points": int(payload["totals"][participant["participant_id"]]),
                    "user_id": participant.get("user_id"),
                }
                for participant in payload["participants"]
            ],
        )
        self.assertTrue(result.succeeded, result)
        return str(payload["game_id"])

    def _competitive_game(self, one, two, *, game_id: str | None = None) -> dict:
        self.sequence += 1
        game = new_zilch_game(game_id or f"zilch-award-hvh-{self.sequence}", "Achievement fixture", 2)
        join_zilch_player(game, self._player("p1", one.username, one.id))
        join_zilch_player(game, self._player("p2", two.username, two.id))
        start_zilch_game(game)
        record_zilch_start_roll(game, "p1", 6)
        record_zilch_start_roll(game, "p2", 2)
        game["_total_points"] = {"p1": 10_000, "p2": 9_700}
        game["_round_points"] = {"p1": 0, "p2": 0}
        game["_zilch_zilch_streaks"] = {"p1": 0, "p2": 0}
        game["_zilch_boards"] = {
            "p1": {
                "player_id": "p1",
                "round_points": 0,
                "total_points": 10_000,
                "zilch_streak": 0,
                "rounds": [
                    {
                        "turn_id": 1,
                        "round": 1,
                        "event": "bank",
                        "points": 8_000,
                        "total_after": 8_000,
                        "rolls_used": 2,
                        "committed_holds": [
                            {
                                "id": "hold-straight-hot",
                                "hot_dice": True,
                                "combination_type": "straight",
                            }
                        ],
                    },
                    {
                        "turn_id": 3,
                        "round": 2,
                        "event": "zilch",
                        "reason": "no_scoring_option",
                        "discarded_points": 150,
                        "penalty": 0,
                        "total_after": 8_000,
                        "zilch_streak": 1,
                        "rolls_used": 1,
                        "committed_holds": [],
                    },
                    {
                        "turn_id": 5,
                        "round": 3,
                        "event": "bank",
                        "points": 2_000,
                        "total_after": 10_000,
                        "rolls_used": 2,
                        "committed_holds": [],
                    },
                ],
            },
            "p2": {
                "player_id": "p2",
                "round_points": 0,
                "total_points": 9_700,
                "zilch_streak": 0,
                "rounds": [
                    {
                        "turn_id": 2,
                        "round": 1,
                        "event": "bank",
                        "points": 9_700,
                        "total_after": 9_700,
                        "rolls_used": 2,
                        "committed_holds": [],
                    }
                ],
            },
        }
        game["_zilch_final_round"] = {
            "triggered_by": "p1",
            "target_score": 10_000,
            "pending_player_ids": [],
        }
        finish_zilch_game(game)
        return game

    def _cpu_game(self, human, *, strategy: str = "normal") -> dict:
        self.sequence += 1
        game_id = f"zilch-award-cpu-{self.sequence}"
        game = new_zilch_game(game_id, "CPU award fixture", 2)
        cpu = configure_zilch_cpu_game(game, host_user_id=human.id, cpu_strategy=strategy)
        cpu_id = str(cpu["id"])
        join_zilch_player(game, self._player("human", human.username, human.id))
        start_zilch_game(game)
        record_zilch_start_roll(game, "human", 6)
        record_zilch_start_roll(game, cpu_id, 2)
        game["_total_points"] = {"human": 10_000, cpu_id: 9_500}
        game["_round_points"] = {"human": 0, cpu_id: 0}
        game["_zilch_zilch_streaks"] = {"human": 0, cpu_id: 0}
        game["_zilch_boards"] = {
            "human": {
                "player_id": "human",
                "round_points": 0,
                "total_points": 10_000,
                "zilch_streak": 0,
                "rounds": [
                    {
                        "turn_id": 1,
                        "round": 1,
                        "event": "bank",
                        "points": 10_000,
                        "total_after": 10_000,
                        "rolls_used": 1,
                        "committed_holds": [],
                    }
                ],
            },
            cpu_id: {
                "player_id": cpu_id,
                "round_points": 0,
                "total_points": 9_500,
                "zilch_streak": 0,
                "rounds": [
                    {
                        "turn_id": 2,
                        "round": 1,
                        "event": "bank",
                        "points": 9_500,
                        "total_after": 9_500,
                        "rolls_used": 1,
                        "committed_holds": [],
                    }
                ],
            },
        }
        game["_zilch_final_round"] = {
            "triggered_by": "human",
            "target_score": 10_000,
            "pending_player_ids": [],
        }
        finish_zilch_game(game)
        return game

    def _solo_game(self, human) -> dict:
        self.sequence += 1
        participant_id = "solo-human"
        return {
            "_id": f"zilch-award-solo-{self.sequence}",
            "_name": "Solo Sprint",
            "_game_type": ZILCH_GAME_TYPE,
            "_mode": "1",
            "_play_mode": "solo",
            "_started": False,
            "_finished": True,
            "_aborted": False,
            "_started_at": "2026-09-03T12:00:00+00:00",
            "_finished_at": "2026-09-03T12:02:00+00:00",
            "_target_score": ZILCH_SOLO_SPRINT_TARGET_SCORE,
            "_zilch_ruleset": ZILCH_RULESET_VERSION,
            "_participants": [
                {
                    "id": participant_id,
                    "name": human.username,
                    "type": "human",
                    "connection_player_id": participant_id,
                    "user_id": human.id,
                    "cpu_strategy": None,
                }
            ],
            "_total_points": {participant_id: 10_000},
            "_round_points": {participant_id: 0},
            "_zilch_zilch_streaks": {participant_id: 0},
            "_zilch_boards": {
                participant_id: {
                    "player_id": participant_id,
                    "round_points": 0,
                    "total_points": 10_000,
                    "zilch_streak": 0,
                    "rounds": [
                        {
                            "turn_id": 1,
                            "round": 1,
                            "event": "bank",
                            "points": 10_000,
                            "total_after": 10_000,
                            "rolls_used": 3,
                            "committed_holds": [],
                        }
                    ],
                }
            },
            "_zilch_start_roll": None,
            "_zilch_final_round": None,
            "_zilch_outcome": {"status": "completed"},
            "_zilch_solo_objective": {
                "id": ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
                "version": ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
                "parameters": {},
                "progress": {
                    "target_score": 10_000,
                    "total_points": 10_000,
                    "turns": 1,
                    "rolls": 3,
                    "zilchs": 0,
                    "hot_dice_events": 0,
                    "highest_banked_round": 10_000,
                    "active_duration_seconds": 120,
                },
                "outcome": "completed",
            },
            "_zilch_solo_metrics": {
                "target_score": 10_000,
                "total_points": 10_000,
                "turns": 1,
                "rolls": 3,
                "zilchs": 0,
                "hot_dice_events": 0,
                "highest_banked_round": 10_000,
                "active_duration_seconds": 120,
                "remaining_points": 0,
            },
        }

    @staticmethod
    def _keys(profile: dict) -> set[str]:
        return {str(item["key"]) for item in profile["unlocked"]}

    def test_catalog_is_namespaced_localized_and_has_no_shared_rank_payload(self) -> None:
        catalog = zilch_achievement_definitions_payload()

        self.assertEqual(catalog["version"], 1)
        self.assertNotIn("player", catalog)
        self.assertEqual({item["key"] for item in catalog["definitions"]}, set(ZILCH_ACHIEVEMENT_BY_KEY))
        for definition in catalog["definitions"]:
            self.assertTrue(definition["key"].startswith(ZILCH_ACHIEVEMENT_NAMESPACE))
            self.assertTrue(definition["title_key"].startswith("zilch.achievement."))
            self.assertTrue(definition["description_key"].startswith("zilch.achievement."))
            self.assertNotIn("points", definition)
            self.assertNotIn("rank", definition)

    def test_achievement_migration_upgrades_and_downgrades_without_touching_result_tables(self) -> None:
        config = Config(str(main.BASE / "alembic.ini"))
        config.set_main_option("script_location", str(main.BASE / "alembic"))
        config.set_main_option("sqlalchemy.url", f"sqlite:///{self.database_path}")

        before = set(inspect(get_engine()).get_table_names())
        self.assertTrue(
            {
                "completed_games",
                "game_participants",
                "zilch_achievement_evaluations",
                "zilch_achievement_evidence",
                "zilch_achievement_unlocks",
                "zilch_achievement_deliveries",
            }
            <= before
        )
        command.downgrade(config, "20260903_0016")
        downgraded = set(inspect(get_engine()).get_table_names())
        self.assertIn("completed_games", downgraded)
        self.assertIn("game_participants", downgraded)
        self.assertFalse({name for name in downgraded if name.startswith("zilch_achievement_")})
        command.upgrade(config, "head")
        upgraded = set(inspect(get_engine()).get_table_names())
        self.assertTrue(
            {
                "zilch_achievement_evaluations",
                "zilch_achievement_evidence",
                "zilch_achievement_unlocks",
                "zilch_achievement_deliveries",
            }
            <= upgraded
        )

    def test_explicit_multiplayer_registration_is_idempotent_and_delivers_awards(self) -> None:
        mani = self._user("Mani", role="admin")
        preview = self._user("Preview")
        game_id = self._store(self._competitive_game(mani, preview))

        # A typed result alone never causes a historic or on-read backfill.
        self.assertFalse(get_zilch_achievement_profile(mani.id)["unlocked"])
        registration = register_zilch_result_for_achievements(game_id)
        self.assertEqual(registration.status, "evaluated")
        mani_keys = self._keys(get_zilch_achievement_profile(mani.id))
        self.assertTrue(
            {
                "zilch.first_game",
                "zilch.first_hvh_win",
                "zilch.banked_round_500",
                "zilch.banked_round_1000",
                "zilch.banked_round_1500",
                "zilch.banked_round_2000",
                "zilch.exact_10000",
                "zilch.first_straight",
                "zilch.first_hot_dice",
            }
            <= mani_keys
        )
        profile = get_zilch_achievement_profile(mani.id)
        self.assertEqual(profile["player"], {"id": mani.id, "username": "Mani"})

        repeated = register_zilch_result_for_achievements(game_id)
        self.assertEqual(repeated.status, "already_evaluated")
        pending = pending_zilch_awards(mani.id)
        self.assertEqual({item["key"] for item in pending["awards"]}, mani_keys)
        first_ack = acknowledge_zilch_award(mani.id, "zilch.first_game")
        second_ack = acknowledge_zilch_award(mani.id, "zilch.first_game")
        self.assertEqual(first_ack, second_ack)
        self.assertNotIn("zilch.first_game", {item["key"] for item in pending_zilch_awards(mani.id)["awards"]})
        with session_scope() as db:
            self.assertEqual(
                db.scalar(
                    select(func.count())
                    .select_from(ZilchAchievementEvaluation)
                    .where(ZilchAchievementEvaluation.game_id == game_id)
                ),
                1,
            )
            self.assertEqual(
                db.scalar(
                    select(func.count())
                    .select_from(ZilchAchievementUnlock)
                    .where(ZilchAchievementUnlock.user_id == mani.id)
                ),
                len(mani_keys),
            )
            self.assertEqual(
                db.scalar(
                    select(func.count())
                    .select_from(ZilchAchievementDelivery)
                    .join(ZilchAchievementUnlock)
                    .where(ZilchAchievementUnlock.user_id == mani.id)
                ),
                len(mani_keys),
            )

    def test_cpu_result_has_only_the_human_as_evidence_and_recipient(self) -> None:
        mani = self._user("Mani", role="admin")
        game_id = self._store(self._cpu_game(mani, strategy="normal"))

        register_zilch_result_for_achievements(game_id)

        keys = self._keys(get_zilch_achievement_profile(mani.id))
        self.assertIn("zilch.first_cpu_win", keys)
        self.assertIn("zilch.cpu_win_normal", keys)
        with session_scope() as db:
            evidence = list(
                db.scalars(select(ZilchAchievementEvidence).where(ZilchAchievementEvidence.source_game_id == game_id))
            )
            self.assertEqual([row.user_id for row in evidence], [mani.id])
            self.assertFalse(
                list(db.scalars(select(ZilchAchievementUnlock).where(ZilchAchievementUnlock.user_id.is_(None))))
            )

    def test_solo_registration_and_source_deletion_revoke_unlocks_and_delivery(self) -> None:
        mani = self._user("Mani", role="admin")
        game_id = self._store(self._solo_game(mani))

        register_zilch_result_for_achievements(game_id)
        keys = self._keys(get_zilch_achievement_profile(mani.id))
        self.assertIn("zilch.solo_sprint_completed", keys)
        self.assertIn("zilch.solo_sprint_without_zilch", keys)

        removed = remove_zilch_result_from_achievements(game_id)
        self.assertEqual(removed["affected_user_ids"], [mani.id])
        self.assertEqual(set(removed["revoked_by_user"][mani.id]), keys)
        self.assertFalse(get_zilch_achievement_profile(mani.id)["unlocked"])
        with session_scope() as db:
            self.assertFalse(
                list(
                    db.scalars(
                        select(ZilchAchievementEvidence).where(ZilchAchievementEvidence.source_game_id == game_id)
                    )
                )
            )
            self.assertIsNone(
                db.scalar(select(ZilchAchievementEvaluation).where(ZilchAchievementEvaluation.game_id == game_id))
            )
            self.assertFalse(
                list(db.scalars(select(ZilchAchievementUnlock).where(ZilchAchievementUnlock.user_id == mani.id)))
            )
            self.assertFalse(list(db.scalars(select(ZilchAchievementDelivery))))

    def test_tombstone_recovery_cleans_only_deleted_zilch_sources_after_interrupted_cleanup(self) -> None:
        mani = self._user("Mani", role="admin")
        preview = self._user("Preview")
        deleted_game_id = self._store(self._solo_game(mani))
        retained_game_id = self._store(self._solo_game(preview))
        register_zilch_result_for_achievements(deleted_game_id)
        register_zilch_result_for_achievements(retained_game_id)

        # Simulate the narrow failure window after the durable result deletion
        # has committed its typed tombstone but before the award cleanup call.
        deleted = delete_completed_game(
            game_id=deleted_game_id,
            admin_user_id=mani.id,
            reason="Transient award cleanup failure fixture",
        )
        self.assertEqual(deleted["game_type"], ZILCH_GAME_TYPE)
        self.assertTrue(get_zilch_achievement_profile(mani.id)["unlocked"])

        recovery = recover_deleted_zilch_achievement_sources()
        self.assertEqual(recovery["processed"], 1)
        self.assertEqual([item["game_id"] for item in recovery["cleaned"]], [deleted_game_id])
        self.assertFalse(recovery["failed"])
        self.assertFalse(get_zilch_achievement_profile(mani.id)["unlocked"])
        self.assertTrue(get_zilch_achievement_profile(preview.id)["unlocked"])
        with session_scope() as db:
            self.assertFalse(
                list(
                    db.scalars(
                        select(ZilchAchievementEvidence).where(
                            ZilchAchievementEvidence.source_game_id == deleted_game_id
                        )
                    )
                )
            )
            self.assertTrue(
                list(
                    db.scalars(
                        select(ZilchAchievementEvidence).where(
                            ZilchAchievementEvidence.source_game_id == retained_game_id
                        )
                    )
                )
            )
        self.assertEqual(recover_deleted_zilch_achievement_sources()["processed"], 0)

    def test_pending_recovery_processes_only_explicit_registration_and_partial_history_fails_closed(self) -> None:
        mani = self._user("Mani", role="admin")
        preview = self._user("Preview")
        ignored_game_id = self._store(self._competitive_game(mani, preview, game_id="zilch-unregistered-history"))
        game_id = self._store(self._competitive_game(mani, preview, game_id="zilch-pending-award"))
        with session_scope() as db:
            row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game_id))
            self.assertIsNotNone(row)
            payload = json.loads(row.snapshot_json)
            # Historic v1 loss history may not contain committed holds.  The
            # typed result remains valid, but combination/Hot-Dice awards are
            # deliberately unknown rather than treated as false or true.
            payload["boards"]["p1"]["rounds"][1].pop("committed_holds")
            row.snapshot_json = json.dumps(payload)

        self.assertEqual(_register_evaluation(game_id), "registered")
        recovery = recover_pending_zilch_achievement_evaluations()
        self.assertEqual(recovery["processed"], 1)
        self.assertEqual(recovery["completed"], [game_id])
        self.assertNotIn("zilch.first_hot_dice", self._keys(get_zilch_achievement_profile(mani.id)))
        self.assertNotIn("zilch.first_straight", self._keys(get_zilch_achievement_profile(mani.id)))
        with session_scope() as db:
            registered_sources = set(db.scalars(select(ZilchAchievementEvidence.source_game_id)))
        self.assertEqual(registered_sources, {game_id})
        self.assertNotIn(ignored_game_id, registered_sources)
