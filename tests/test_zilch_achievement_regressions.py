"""Critical isolation and fail-closed contracts for private Zilch awards.

These checks deliberately cover the gaps that are easy to miss when the
normal award catalog happens to work: the three CPU strategy distinctions,
durable result corruption, and the established ZDWA achievement currency.
They use the authoritative Zilch result boundary; no browser state or
client-provided award data participates in the fixtures.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from sqlalchemy import func, select

from app import main
from app.achievements import achievement_points_for_keys, achievement_rank_for_keys
from app.auth import create_user
from app.database import configure_database, session_scope, upgrade_database
from app.game_history import persist_completed_game_result
from app.game_types import ZILCH_GAME_TYPE
from app.models import (
    CompletedGame,
    UserAchievement,
    ZilchAchievementEvaluation,
    ZilchAchievementEvidence,
    ZilchAchievementUnlock,
)
from app.zilch_achievements import (
    ZilchAchievementError,
    ZilchAchievementSyncError,
    get_zilch_achievement_profile,
    recover_pending_zilch_achievement_evaluations,
    register_zilch_result_for_achievements,
)
from app.zilch_results import build_zilch_result_payload, finalize_zilch_result
from app.zilch_state import (
    configure_zilch_cpu_game,
    finish_zilch_game,
    join_zilch_player,
    new_zilch_game,
    record_zilch_start_roll,
    start_zilch_game,
)


class ZilchAchievementRegressionTestCase(TestCase):
    """Protect the boundary between Zilch awards and the mature ZDWA system."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "zilch-achievement-regressions.sqlite3"
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

    @staticmethod
    def _player(player_id: str, name: str, user_id: int | None) -> dict:
        return {"id": player_id, "name": name, "user_id": user_id, "ws": None}

    def _terminal_cpu_win(self, user, strategy: str) -> dict:
        """Build an authoritative CPU win using the shared game-state path."""

        self.sequence += 1
        game = new_zilch_game(f"zilch-achievement-regression-{self.sequence}", "Award regression", 2)
        cpu = configure_zilch_cpu_game(game, host_user_id=user.id, cpu_strategy=strategy)
        human_id = "human"
        cpu_id = str(cpu["id"])
        join_zilch_player(game, self._player(human_id, user.username, user.id))
        start_zilch_game(game)
        record_zilch_start_roll(game, human_id, 6)
        record_zilch_start_roll(game, cpu_id, 2)
        game["_total_points"] = {human_id: 10_000, cpu_id: 9_600}
        game["_round_points"] = {human_id: 0, cpu_id: 0}
        game["_zilch_zilch_streaks"] = {human_id: 0, cpu_id: 0}
        game["_zilch_boards"] = {
            human_id: {
                "player_id": human_id,
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
                "total_points": 9_600,
                "zilch_streak": 0,
                "rounds": [
                    {
                        "turn_id": 2,
                        "round": 1,
                        "event": "bank",
                        "points": 9_600,
                        "total_after": 9_600,
                        "rolls_used": 1,
                        "committed_holds": [],
                    }
                ],
            },
        }
        game["_zilch_final_round"] = {
            "triggered_by": human_id,
            "target_score": 10_000,
            "pending_player_ids": [],
        }
        finish_zilch_game(game)
        return game

    @staticmethod
    def _award_keys(user_id: int) -> set[str]:
        return {str(item["key"]) for item in get_zilch_achievement_profile(user_id)["unlocked"]}

    @staticmethod
    def _zdwa_state(user_id: int) -> tuple[set[str], int, dict]:
        with session_scope() as db:
            keys = {
                str(key)
                for key in db.scalars(
                    select(UserAchievement.achievement_key).where(UserAchievement.user_id == user_id)
                )
            }
        return keys, achievement_points_for_keys(keys), achievement_rank_for_keys(keys)

    def _persist_without_registration(self, game: dict, *, snapshot_json: str | None = None) -> str:
        """Write a typed row without calling the post-rollout source boundary."""

        payload = build_zilch_result_payload(game)
        result = persist_completed_game_result(
            game_id=payload["game_id"],
            game_name=payload["game_name"],
            game_type=ZILCH_GAME_TYPE,
            mode=payload["mode"],
            hardcore=False,
            finished_at=datetime.fromisoformat(str(payload["finished_at"]).replace("Z", "+00:00")),
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
        if snapshot_json is not None:
            with session_scope() as db:
                row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == payload["game_id"]))
                self.assertIsNotNone(row)
                row.snapshot_json = snapshot_json
        return str(payload["game_id"])

    def test_all_cpu_strategies_unlock_only_their_matching_private_awards(self) -> None:
        human = create_user("Mani", "mani-secure-password-123", role="admin", must_change_password=False)
        before_zdwa = self._zdwa_state(human.id)

        for strategy in ("conservative", "normal", "aggressive"):
            completion = finalize_zilch_result(self._terminal_cpu_win(human, strategy))
            self.assertTrue(completion["result_persisted"])
            self.assertFalse(completion["achievement_sync_pending"])

        awards = self._award_keys(human.id)
        self.assertTrue(
            {
                "zilch.first_game",
                "zilch.first_cpu_win",
                "zilch.cpu_win_conservative",
                "zilch.cpu_win_normal",
                "zilch.cpu_win_aggressive",
            }
            <= awards
        )
        self.assertEqual(self._zdwa_state(human.id), before_zdwa)
        with session_scope() as db:
            self.assertEqual(
                db.scalar(select(func.count()).select_from(UserAchievement).where(UserAchievement.user_id == human.id)),
                len(before_zdwa[0]),
            )
            self.assertFalse(
                list(
                    db.scalars(
                        select(UserAchievement).where(
                            UserAchievement.user_id == human.id,
                            UserAchievement.achievement_key.like("zilch.%"),
                        )
                    )
                )
            )

    def test_corrupt_or_unknown_schema_is_never_registered_or_backfilled(self) -> None:
        human = create_user("Mani", "mani-secure-password-123", role="admin", must_change_password=False)
        malformed_game_id = self._persist_without_registration(self._terminal_cpu_win(human, "normal"), snapshot_json="{")

        unknown_schema_game = self._terminal_cpu_win(human, "aggressive")
        payload = build_zilch_result_payload(unknown_schema_game)
        payload["schema_version"] = 999
        unknown_schema_game_id = self._persist_without_registration(
            unknown_schema_game,
            snapshot_json=json.dumps(payload),
        )

        for game_id in (malformed_game_id, unknown_schema_game_id):
            with self.subTest(game_id=game_id):
                with self.assertRaises((ZilchAchievementError, ZilchAchievementSyncError)):
                    register_zilch_result_for_achievements(game_id)

        # Recovery is a bounded queue for explicit, valid registrations.  It
        # must never scan these historical/corrupt completed rows to award an
        # account merely because it exists in CompletedGame.
        self.assertEqual(
            recover_pending_zilch_achievement_evaluations(),
            {"processed": 0, "completed": [], "failed": []},
        )
        self.assertFalse(self._award_keys(human.id))
        with session_scope() as db:
            for model in (ZilchAchievementEvaluation, ZilchAchievementEvidence, ZilchAchievementUnlock):
                self.assertEqual(db.scalar(select(func.count()).select_from(model)), 0)
