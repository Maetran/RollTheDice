"""Focused persistence contracts for the private Zilch solo sprint."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from sqlalchemy import select

from app import main
from app.active_games import save_active_game
from app.auth import create_user
from app.database import configure_database, session_scope, upgrade_database
from app.game_state import games
from app.game_types import ZILCH_GAME_TYPE
from app.models import ActiveGame, CompletedGame
from app.zilch_achievements import get_zilch_achievement_profile
from app.zilch_engine import ZILCH_RULESET_VERSION
from app.zilch_results import (
    ZILCH_SOLO_RESULT_PAYLOAD_KIND,
    ZILCH_SOLO_RESULT_SCHEMA_VERSION,
    ZilchResultValidationError,
    build_zilch_result_payload,
    finalize_zilch_result,
    list_zilch_results_for_user,
    load_zilch_result,
)
from app.zilch_solo_objective import (
    ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
    ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
    ZILCH_SOLO_SPRINT_TARGET_SCORE,
)
from app.zilch_state import (
    configure_zilch_solo_game,
    finish_zilch_solo_game,
    join_zilch_player,
    new_zilch_game,
    start_zilch_game,
)
from app.zilch_statistics import get_zilch_leaderboard


class ZilchSoloResultsTestCase(TestCase):
    """Solo records must be typed, private, and never look like a match."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "zilch-solo-results.sqlite3"
        self.environment = patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.database_path}",
                "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
                "ROLLTHEDICE_TURNSTILE_SECRET": "",
            },
        )
        self.environment.start()
        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)

    def tearDown(self) -> None:
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.temporary_directory.cleanup()

    @staticmethod
    def _terminal_solo_game(
        *,
        outcome: str = "completed",
        user_id: int | None = None,
    ) -> dict:
        completed = outcome == "completed"
        total = 10_000 if completed else 500
        rounds = (
            [
                {
                    "turn_id": 1,
                    "round": 1,
                    "event": "bank",
                    "points": 500,
                    "total_after": 500,
                    "rolls_used": 1,
                    "committed_holds": [],
                },
                {
                    "turn_id": 2,
                    "round": 2,
                    "event": "zilch",
                    "reason": "no_scoring_option",
                    "discarded_points": 150,
                    "penalty": 0,
                    "total_after": 500,
                    "zilch_streak": 1,
                    "rolls_used": 1,
                    "committed_holds": [],
                },
                {
                    "turn_id": 3,
                    "round": 3,
                    "event": "bank",
                    "points": 9_500,
                    "total_after": 10_000,
                    "rolls_used": 2,
                    "committed_holds": [],
                },
            ]
            if completed
            else [
                {
                    "turn_id": 1,
                    "round": 1,
                    "event": "bank",
                    "points": 500,
                    "total_after": 500,
                    "rolls_used": 1,
                    "committed_holds": [],
                }
            ]
        )
        turns = len(rounds) if completed else len(rounds) + 1
        rolls = 4 if completed else 2
        zilchs = 1 if completed else 0
        highest = 9_500 if completed else 500
        progress = {
            "target_score": ZILCH_SOLO_SPRINT_TARGET_SCORE,
            "total_points": total,
            "turns": turns,
            "rolls": rolls,
            "zilchs": zilchs,
            "hot_dice_events": 0,
            "highest_banked_round": highest,
            "active_duration_seconds": 90,
        }
        return {
            "_id": f"zilch-solo-{outcome}-{user_id or 'guest'}",
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
                    "id": "solo-1",
                    "name": "Mani",
                    "type": "human",
                    "connection_player_id": "solo-1",
                    "user_id": user_id,
                    "cpu_strategy": None,
                }
            ],
            "_total_points": {"solo-1": total},
            "_round_points": {"solo-1": 0},
            "_zilch_zilch_streaks": {"solo-1": 0},
            "_zilch_boards": {
                "solo-1": {
                    "player_id": "solo-1",
                    "round_points": 0,
                    "total_points": total,
                    "zilch_streak": 0,
                    "rounds": rounds,
                }
            },
            "_zilch_start_roll": None,
            "_zilch_final_round": None,
            "_zilch_outcome": {"status": outcome},
            "_zilch_solo_objective": {
                "id": ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
                "version": ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
                "parameters": {},
                "progress": progress,
                "outcome": outcome,
            },
            "_zilch_solo_metrics": {
                **progress,
                "remaining_points": max(0, ZILCH_SOLO_SPRINT_TARGET_SCORE - total),
            },
        }

    def test_completed_sprint_uses_a_typed_solo_v2_payload_without_match_fields(self) -> None:
        payload = build_zilch_result_payload(self._terminal_solo_game())

        self.assertEqual(payload["schema_version"], ZILCH_SOLO_RESULT_SCHEMA_VERSION)
        self.assertEqual(payload["payload_kind"], ZILCH_SOLO_RESULT_PAYLOAD_KIND)
        self.assertEqual(payload["play_mode"], "solo")
        self.assertEqual(payload["participant_order"], ["solo-1"])
        self.assertEqual(payload["participants"][0]["participant_type"], "human")
        self.assertEqual(payload["objective"]["id"], ZILCH_SOLO_SPRINT_OBJECTIVE_ID)
        self.assertEqual(payload["objective"]["ranking"]["primary"], "turns")
        self.assertEqual(payload["outcome"], {"status": "completed", "objective_completed": True})
        self.assertEqual(payload["metrics"]["turns"], 3)
        self.assertEqual(payload["metrics"]["rolls"], 4)
        self.assertEqual(payload["metrics"]["zilch_count"], 1)
        self.assertNotIn("start_roll", payload)
        self.assertNotIn("final_round", payload)
        self.assertNotIn("winner_id", payload["outcome"])
        self.assertNotIn("tied", payload["outcome"])

    def test_abandoned_sprint_retains_its_own_metrics_without_inventing_a_winner(self) -> None:
        payload = build_zilch_result_payload(self._terminal_solo_game(outcome="abandoned"))

        self.assertEqual(payload["outcome"], {"status": "abandoned", "objective_completed": False})
        self.assertEqual(payload["metrics"]["remaining_points"], 9_500)
        self.assertEqual(payload["metrics"]["turns"], 2)
        self.assertEqual(payload["boards"]["solo-1"]["rounds"][0]["event"], "bank")

    def test_real_configured_solo_state_without_a_start_roll_is_persistable_after_abandonment(self) -> None:
        game = new_zilch_game("zilch-solo-real-state", "Solo Sprint", "1")
        configure_zilch_solo_game(game, host_user_id=41)
        join_zilch_player(game, {"id": "solo-1", "name": "Mani", "user_id": 41, "ws": None})
        start_zilch_game(game)
        finish_zilch_solo_game(game, status="abandoned")

        payload = build_zilch_result_payload(game)

        self.assertIsNone(game["_zilch_start_roll"])
        self.assertEqual(payload["outcome"]["status"], "abandoned")
        self.assertEqual(payload["metrics"]["turns"], 1)
        self.assertEqual(payload["metrics"]["remaining_points"], 10_000)

    def test_invalid_objective_or_competitive_lifecycle_is_rejected_before_write(self) -> None:
        game = self._terminal_solo_game()
        game["_zilch_solo_objective"]["id"] = "unknown-objective"
        with self.assertRaisesRegex(ZilchResultValidationError, "zilch_result_invalid_solo_objective"):
            build_zilch_result_payload(game)

        game = self._terminal_solo_game()
        game["_zilch_start_roll"] = {"phase": "resolved"}
        with self.assertRaisesRegex(ZilchResultValidationError, "zilch_result_invalid_solo_lifecycle"):
            build_zilch_result_payload(game)

    def test_solo_history_summary_exposes_objective_and_server_metrics_and_tampering_fails_closed(self) -> None:
        user = create_user("Mani", "a-secure-password-123", role="admin", must_change_password=False)
        game = self._terminal_solo_game(user_id=user.id)
        completion = finalize_zilch_result(game)

        self.assertTrue(completion["result_persisted"])
        self.assertEqual(completion["result_schema_version"], ZILCH_SOLO_RESULT_SCHEMA_VERSION)
        summary = list_zilch_results_for_user(user.id)
        self.assertEqual(len(summary), 1)
        self.assertEqual(summary[0]["play_mode"], "solo")
        self.assertEqual(summary[0]["objective"]["id"], ZILCH_SOLO_SPRINT_OBJECTIVE_ID)
        self.assertEqual(summary[0]["metrics"]["highest_banked_round"], 9_500)

        with session_scope() as db:
            row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game["_id"]))
            self.assertIsNotNone(row)
            stored = json.loads(row.snapshot_json)
            stored["metrics"]["turns"] = 99
            row.snapshot_json = json.dumps(stored)
        self.assertIsNone(load_zilch_result(game["_id"]))

    def test_recovery_repairs_only_the_known_overcounted_timer_and_finishes_the_full_pipeline(self) -> None:
        user = create_user("TimerRecovery", "a-secure-password-123", role="admin", must_change_password=False)
        game = self._terminal_solo_game(user_id=user.id)
        game["_id"] = f"{game['_id']}-timer-recovery"
        # A historical timer bug added elapsed time from the same start anchor
        # more than once.  The score and complete hold history are otherwise
        # authoritative and should still reach results, awards and ranking.
        game["_zilch_solo_objective"]["progress"]["active_duration_seconds"] = 600
        game["_zilch_solo_metrics"]["active_duration_seconds"] = 600
        game["_zilch_boards"]["solo-1"]["rounds"][0]["committed_holds"] = [
            {"id": "straight", "hot_dice": False, "combination_type": "straight"}
        ]
        game["_final_completion"] = {
            "result_persisted": False,
            "persistence_error": "zilch_result_invalid_solo_progress",
        }
        games[game["_id"]] = game
        save_active_game(game)
        try:
            main._recover_terminal_completed_games()
        finally:
            games.pop(game["_id"], None)

        with session_scope() as db:
            self.assertIsNone(db.scalar(select(ActiveGame).where(ActiveGame.game_id == game["_id"])))
            stored = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game["_id"]))
            self.assertIsNotNone(stored)
            payload = json.loads(stored.snapshot_json)
        self.assertEqual(payload["metrics"]["active_duration_seconds"], 120)
        self.assertEqual(get_zilch_leaderboard("solo_sprint")["total"], 1)
        awards = {item["key"] for item in get_zilch_achievement_profile(user.id)["unlocked"]}
        self.assertIn("zilch.first_straight", awards)
