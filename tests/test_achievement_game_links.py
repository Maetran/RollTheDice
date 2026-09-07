from __future__ import annotations

import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import select
from starlette.requests import Request

from app import main
from app.achievements import earned_achievement_payloads_for_game, sync_achievements_for_users
from app.api_users import AssignmentRequest, assign_game_participant
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.game_history import persist_runtime_game
from app.game_results import build_leaderboard_snapshot_fields, finalize_and_log_results
from app.game_types import ZILCH_GAME_TYPE
from app.leaderboard_service import game_from_leaderboard
from app.leaderboard_storage import LeaderboardFiles
from app.models import CompletedGame, GameParticipant, User, UserAchievement, ZilchAchievementUnlock
from app.zilch_achievements import sync_zilch_cross_game_achievements_for_users
from tests.support import GameStateTestCase


class AchievementGameLinkTestCase(GameStateTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "achievement-game-links.sqlite3"
        self.env_patch = patch.dict(
            os.environ,
            {"ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.database_path}"},
        )
        self.env_patch.start()
        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)

    def tearDown(self) -> None:
        self.env_patch.stop()
        configure_database(main.DATA_DIR)
        self.temporary_directory.cleanup()
        super().tearDown()

    @staticmethod
    def _enable_all_gameplay_achievements(user_id: int) -> None:
        rollout = datetime(2026, 1, 1, tzinfo=timezone.utc)
        with session_scope() as db:
            user = db.get(User, user_id)
            user.achievement_gameplay_started_at = rollout
            user.achievement_extra_started_at = rollout
            user.achievement_expansion_started_at = rollout
            user.achievement_office_hours_started_at = rollout
            user.achievement_multiplayer_started_at = rollout
            user.achievement_top_section_started_at = rollout

    @staticmethod
    def _request(*, cookie: str = "", csrf: str = "", origin: str = "") -> Request:
        headers = [(b"host", b"testserver")]
        if cookie:
            headers.append((b"cookie", cookie.encode("ascii")))
        if csrf:
            headers.append((b"x-csrf-token", csrf.encode("ascii")))
        if origin:
            headers.append((b"origin", origin.encode("ascii")))
        return Request(
            {
                "type": "http",
                "method": "PUT",
                "scheme": "http",
                "path": "/",
                "headers": headers,
                "client": ("127.0.0.1", 1234),
                "server": ("testserver", 80),
            }
        )

    def _persist_solo_result(self, user: User, *, points: int, high_scorecard: bool) -> CompletedGame:
        game = self.make_game(mode=1, players=[("p1", user.username)])
        game["_players"][0]["user_id"] = user.id
        game["_scoreboards"]["p1"] = self.high_scoreboard() if high_scorecard else self.low_scoreboard()
        snapshot = build_leaderboard_snapshot_fields(game)
        snapshot["finished_at"] = "2026-09-04T12:00:00+00:00"
        self.assertTrue(persist_runtime_game(game, {"p1": points}, snapshot))
        with session_scope() as db:
            row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game["_id"]))
            self.assertIsNotNone(row)
            return row

    def test_sync_links_only_unlocks_that_need_the_nominated_game(self) -> None:
        user = create_user("SourceProof", "source-proof-password", must_change_password=False)
        self._enable_all_gameplay_achievements(user.id)
        game = self._persist_solo_result(user, points=1_200, high_scorecard=True)

        unlocked = sync_achievements_for_users(
            {user.id},
            source_completed_game_id=game.id,
        )

        self.assertIn(user.id, unlocked)
        with session_scope() as db:
            rows = {
                row.achievement_key: row.source_completed_game_id
                for row in db.scalars(
                    select(UserAchievement).where(UserAchievement.user_id == user.id)
                )
            }
        self.assertIsNone(rows["account_created"])
        self.assertEqual(rows["career_points_1000"], game.id)
        self.assertEqual(rows["single_game_score_1200"], game.id)

        by_player = earned_achievement_payloads_for_game(game.game_id)
        self.assertIn("p1", by_player)
        self.assertIn("career_points_1000", {item["key"] for item in by_player["p1"]})
        self.assertNotIn("account_created", {item["key"] for item in by_player["p1"]})
        self.assertTrue(all(isinstance(item["unlocked_at"], str) for item in by_player["p1"]))

    def test_same_day_cross_game_awards_are_forward_only_and_keep_each_games_source(self) -> None:
        """One paired Swiss calendar day rewards both isolated collections."""

        user = create_user("DoubleDay", "double-day-password", must_change_password=False)
        rollout = datetime(2026, 9, 1, tzinfo=timezone.utc)
        zilch_time = datetime(2026, 9, 4, 17, 15, tzinfo=timezone.utc)
        zdwa_time = datetime(2026, 9, 4, 19, 45, tzinfo=timezone.utc)
        with session_scope() as db:
            managed_user = db.get(User, user.id)
            self.assertIsNotNone(managed_user)
            assert managed_user is not None
            managed_user.achievement_cross_game_started_at = rollout
            zilch = CompletedGame(
                game_id="cross-zilch",
                game_type=ZILCH_GAME_TYPE,
                game_name="Cross Zilch",
                finished_at=zilch_time,
                mode="solo",
                hardcore=False,
                snapshot_json="{}",
                imported_from_legacy=False,
                created_at=zilch_time,
            )
            db.add(zilch)
            db.flush()
            db.add(
                GameParticipant(
                    game_id=zilch.id,
                    position=0,
                    player_key="zilch-player",
                    display_name=user.username,
                    points=10_000,
                    user_id=user.id,
                )
            )
            zdwa = CompletedGame(
                game_id="cross-zdwa",
                game_name="Cross ZDWA",
                finished_at=zdwa_time,
                mode="1",
                hardcore=False,
                snapshot_json="{}",
                imported_from_legacy=False,
                created_at=zdwa_time,
            )
            db.add(zdwa)
            db.flush()
            db.add(
                GameParticipant(
                    game_id=zdwa.id,
                    position=0,
                    player_key="zdwa-player",
                    display_name=user.username,
                    points=900,
                    user_id=user.id,
                )
            )
            zdwa_id = int(zdwa.id)

        public_unlocks = sync_achievements_for_users({user.id}, source_completed_game_id=zdwa_id)
        self.assertIn(user.id, public_unlocks)
        self.assertIn("cross_game_days_1", {item["key"] for item in public_unlocks[user.id]})
        private_unlocks = sync_zilch_cross_game_achievements_for_users({user.id})
        self.assertIn(user.id, private_unlocks)
        self.assertIn("zilch.cross_game_days_1", {item["key"] for item in private_unlocks[user.id]})

        with session_scope() as db:
            public_source = db.scalar(
                select(UserAchievement.source_completed_game_id).where(
                    UserAchievement.user_id == user.id,
                    UserAchievement.achievement_key == "cross_game_days_1",
                )
            )
            private_source = db.scalar(
                select(ZilchAchievementUnlock.source_game_id).where(
                    ZilchAchievementUnlock.user_id == user.id,
                    ZilchAchievementUnlock.achievement_key == "zilch.cross_game_days_1",
                )
            )
        self.assertEqual(public_source, zdwa_id)
        self.assertEqual(private_source, "cross-zilch")

    def test_late_sync_does_not_misattribute_an_old_unlock_to_the_latest_game(self) -> None:
        user = create_user("LateSource", "late-source-password", must_change_password=False)
        self._enable_all_gameplay_achievements(user.id)
        first = self._persist_solo_result(user, points=1_200, high_scorecard=True)
        second = self._persist_solo_result(user, points=500, high_scorecard=False)

        sync_achievements_for_users(
            {user.id},
            source_completed_game_id=second.id,
        )

        with session_scope() as db:
            rows = {
                row.achievement_key: row.source_completed_game_id
                for row in db.scalars(
                    select(UserAchievement).where(UserAchievement.user_id == user.id)
                )
            }
        self.assertIsNone(rows["career_points_1000"])
        self.assertIsNone(rows["single_game_score_1200"])
        self.assertEqual(rows["normal_under_700"], second.id)
        self.assertNotIn(
            "single_game_score_1200",
            {item["key"] for item in earned_achievement_payloads_for_game(second.game_id)["p1"]},
        )
        self.assertEqual(earned_achievement_payloads_for_game(first.game_id), {})

    def test_source_aware_sync_repairs_a_recent_unlinked_materialization_race(self) -> None:
        user = create_user("RacedSource", "raced-source-password", must_change_password=False)
        self._enable_all_gameplay_achievements(user.id)
        game_state = self.make_game(mode=1, players=[("p1", user.username)])
        game_state["_players"][0]["user_id"] = user.id
        game_state["_scoreboards"]["p1"] = self.high_scoreboard()
        snapshot = build_leaderboard_snapshot_fields(game_state)
        self.assertTrue(persist_runtime_game(game_state, {"p1": 410}, snapshot))
        with session_scope() as db:
            game = db.scalar(
                select(CompletedGame).where(CompletedGame.game_id == game_state["_id"])
            )

        materialized_without_source = sync_achievements_for_users({user.id})
        repaired = sync_achievements_for_users(
            {user.id},
            source_completed_game_id=game.id,
        )

        self.assertTrue(materialized_without_source[user.id])
        self.assertEqual(repaired, {})
        self.assertEqual(
            {item["key"] for item in earned_achievement_payloads_for_game(game.game_id)["p1"]},
            {
                item["key"]
                for item in materialized_without_source[user.id]
                if item["key"] != "account_created"
            },
        )

    def test_reassignment_moves_new_awards_and_drops_the_old_source_claim(self) -> None:
        admin = create_user("SourceAdmin", "source-admin-password", role="admin", must_change_password=False)
        previous = create_user("SourcePrevious", "source-previous-password", must_change_password=False)
        replacement = create_user("SourceReplacement", "source-replacement-password", must_change_password=False)
        self._enable_all_gameplay_achievements(previous.id)
        self._enable_all_gameplay_achievements(replacement.id)
        game = self._persist_solo_result(previous, points=410, high_scorecard=True)
        sync_achievements_for_users({previous.id}, source_completed_game_id=game.id)
        with session_scope() as db:
            participant_id = db.scalar(
                select(GameParticipant.id).where(GameParticipant.game_id == game.id)
            )
        self.assertTrue(earned_achievement_payloads_for_game(game.game_id)["p1"])
        identity, raw_token = login(self._request(), admin.username, "source-admin-password")
        request = self._request(
            cookie=f"rollthedice_session={raw_token}",
            csrf=identity.csrf_token,
            origin="http://testserver",
        )

        response = assign_game_participant(
            int(participant_id),
            AssignmentRequest(user_id=replacement.id),
            request,
        )

        self.assertTrue(response["changed"])
        with session_scope() as db:
            previous_sources = list(
                db.scalars(
                    select(UserAchievement).where(
                        UserAchievement.user_id == previous.id,
                        UserAchievement.source_completed_game_id == game.id,
                    )
                )
            )
            replacement_sources = list(
                db.scalars(
                    select(UserAchievement).where(
                        UserAchievement.user_id == replacement.id,
                        UserAchievement.source_completed_game_id == game.id,
                    )
                )
            )
        self.assertEqual(previous_sources, [])
        self.assertTrue(replacement_sources)
        self.assertEqual(
            {item["key"] for item in earned_achievement_payloads_for_game(game.game_id)["p1"]},
            {row.achievement_key for row in replacement_sources},
        )

    def test_replay_players_receive_a_stable_earned_achievements_array(self) -> None:
        user = create_user("ReplaySource", "replay-source-password", must_change_password=False)
        self._enable_all_gameplay_achievements(user.id)
        game = self.make_game(mode=1, players=[("p1", user.username)])
        game["_players"][0]["user_id"] = user.id
        game["_scoreboards"]["p1"] = self.high_scoreboard()
        files = LeaderboardFiles.in_directory(Path(self.temporary_directory.name) / "leaderboards")

        completion = finalize_and_log_results(files, game)
        replay = game_from_leaderboard(files, game["_id"])

        self.assertTrue(completion["result_persisted"])
        earned = replay["players"][0]["earned_achievements"]
        self.assertIsInstance(earned, list)
        self.assertTrue(earned)
        self.assertEqual(
            {item["key"] for item in earned},
            {item["key"] for item in completion["achievement_unlocks"]["p1"]},
        )
        self.assertTrue(
            all(
                set(item) == {"key", "name", "description", "icon_key", "points", "unlocked_at"}
                for item in earned
            )
        )

    def test_already_stored_recovery_repairs_link_without_replaying_json_side_effects(self) -> None:
        user = create_user("RetrySource", "retry-source-password", must_change_password=False)
        self._enable_all_gameplay_achievements(user.id)
        game = self.make_game(mode=1, players=[("p1", user.username)])
        game["_players"][0]["user_id"] = user.id
        game["_scoreboards"]["p1"] = self.high_scoreboard()
        snapshot = build_leaderboard_snapshot_fields(game)
        self.assertTrue(persist_runtime_game(game, {"p1": 410}, snapshot))
        files = LeaderboardFiles.in_directory(Path(self.temporary_directory.name) / "retry-leaderboards")

        recovery = finalize_and_log_results(files, game)

        self.assertTrue(recovery["result_persisted"])
        self.assertTrue(recovery["result_recovered"])
        self.assertTrue(recovery["achievement_unlocks"]["p1"])
        self.assertFalse(any(path.exists() for path in [*files.legacy_paths(), files.stats]))
        with session_scope() as db:
            completed_id = db.scalar(
                select(CompletedGame.id).where(CompletedGame.game_id == game["_id"])
            )
            linked_keys = set(
                db.scalars(
                    select(UserAchievement.achievement_key).where(
                        UserAchievement.user_id == user.id,
                        UserAchievement.source_completed_game_id == completed_id,
                    )
                )
            )
        self.assertEqual(
            linked_keys,
            {item["key"] for item in recovery["achievement_unlocks"]["p1"]},
        )
        database_replay = game_from_leaderboard(files, game["_id"])
        self.assertEqual(database_replay["game_id"], game["_id"])
        self.assertEqual(
            {item["key"] for item in database_replay["players"][0]["earned_achievements"]},
            linked_keys,
        )

        second_recovery = finalize_and_log_results(files, game)

        self.assertTrue(second_recovery["result_recovered"])
        self.assertEqual(second_recovery["achievement_unlocks"], {})
        self.assertEqual(second_recovery["achievement_rank_ups"], {})
        self.assertFalse(any(path.exists() for path in [*files.legacy_paths(), files.stats]))
