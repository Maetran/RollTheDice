"""Focused contracts for private, typed Zilch statistics and rankings."""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from sqlalchemy import select

from app import main
from app.auth import create_user
from app.database import configure_database, session_scope, upgrade_database
from app.game_history import delete_completed_game, persist_completed_game_result
from app.game_types import DEFAULT_GAME_TYPE, ZILCH_GAME_TYPE
from app.models import CompletedGame, User, ZilchAchievementUnlock, ZilchCommunityParticipant
from app.zilch_achievements import (
    ZILCH_ACHIEVEMENT_DEFINITION_VERSION,
    ZILCH_ACHIEVEMENT_POINTS_POSSIBLE,
    remove_zilch_result_from_achievements,
    zilch_achievement_points_for_keys,
    zilch_achievement_rank_for_points,
)
from app.zilch_engine import ZILCH_RULESET_VERSION
from app.zilch_results import finalize_zilch_result, validate_stored_zilch_result_payload
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
from app.zilch_statistics import (
    ZILCH_LEADERBOARD_MAX_LIMIT,
    ZilchStatisticsInputError,
    _load_player_results,
    get_zilch_leaderboard,
    get_zilch_personal_statistics,
    list_zilch_leaderboard_categories,
    validate_zilch_leaderboard_query,
)


class ZilchStatisticsTestCase(TestCase):
    """Statistics may consume only valid, durable, typed Zilch records."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "zilch-statistics.sqlite3"
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
        self.sequence = 0

    def tearDown(self) -> None:
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.temporary_directory.cleanup()

    def _user(self, username: str, *, active: bool = True, role: str = "user") -> User:
        user = create_user(username, f"{username}-secure-password-123", role=role, must_change_password=False)
        if not active:
            with session_scope() as db:
                persisted = db.get(User, user.id)
                assert persisted is not None
                persisted.is_active = False
        return user

    def _next_id(self, prefix: str) -> str:
        self.sequence += 1
        return f"{prefix}-{self.sequence}"

    @staticmethod
    def _time(index: int) -> tuple[str, str]:
        started = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc) + timedelta(hours=index)
        return started.isoformat(), (started + timedelta(minutes=5)).isoformat()

    @staticmethod
    def _player(player_id: str, user: User) -> dict:
        return {"id": player_id, "name": user.username, "user_id": user.id, "ws": None}

    @staticmethod
    def _bank_round(*, turn: int, points: int, total_after: int, hot_dice: bool = False) -> dict:
        return {
            "turn_id": turn,
            "round": turn,
            "event": "bank",
            "points": points,
            "total_after": total_after,
            "rolls_used": 1,
            "committed_holds": [{"id": f"hold-{turn}", "hot_dice": True}] if hot_dice else [],
        }

    @staticmethod
    def _zilch_round(*, turn: int, total_after: int, penalty: int = 0) -> dict:
        return {
            "turn_id": turn,
            "round": turn,
            "event": "zilch",
            "reason": "no_scoring_option",
            "discarded_points": 0,
            "penalty": penalty,
            "total_after": total_after,
            "zilch_streak": 1,
            "rolls_used": 1,
            "committed_holds": [],
        }

    def _persist_competitive(
        self,
        *,
        human_one: User,
        human_two: User | None = None,
        cpu_strategy: str | None = None,
        first_score: int = 10_000,
        second_score: int = 9_000,
        hot_dice: bool = False,
    ) -> str:
        """Create a real v1 terminal payload through the game/result boundary."""
        game_id = self._next_id("cpu" if cpu_strategy else "hvh")
        game = new_zilch_game(game_id, "Statistics fixture", 2)
        first_id = "human-one"
        if cpu_strategy is None:
            assert human_two is not None
            second_id = "human-two"
            join_zilch_player(game, self._player(first_id, human_one))
            join_zilch_player(game, self._player(second_id, human_two))
        else:
            cpu = configure_zilch_cpu_game(game, host_user_id=human_one.id, cpu_strategy=cpu_strategy)
            second_id = str(cpu["id"])
            join_zilch_player(game, self._player(first_id, human_one))
        start_zilch_game(game)
        record_zilch_start_roll(game, first_id, 6)
        record_zilch_start_roll(game, second_id, 2)
        started_at, finished_at = self._time(self.sequence)
        game["_started_at"] = started_at
        game["_finished_at"] = finished_at
        game["_total_points"] = {first_id: first_score, second_id: second_score}
        game["_round_points"] = {first_id: 0, second_id: 0}
        game["_zilch_zilch_streaks"] = {first_id: 0, second_id: 0}
        game["_zilch_boards"] = {
            first_id: {
                "player_id": first_id,
                "round_points": 0,
                "total_points": first_score,
                "zilch_streak": 0,
                "rounds": [self._bank_round(turn=1, points=first_score, total_after=first_score, hot_dice=hot_dice)],
            },
            second_id: {
                "player_id": second_id,
                "round_points": 0,
                "total_points": second_score,
                "zilch_streak": 0,
                "rounds": [self._bank_round(turn=2, points=second_score, total_after=second_score)],
            },
        }
        finish_zilch_game(game)
        response = finalize_zilch_result(game)
        self.assertTrue(response["result_persisted"])
        return game_id

    def _persist_solo(
        self,
        *,
        user: User,
        turns: int,
        rolls: int,
        zilchs: int = 0,
        active_duration_seconds: int = 30,
        outcome: str = "completed",
    ) -> str:
        """Build a valid v2 Sprint terminal state with controlled metrics."""
        self.assertGreaterEqual(turns, 1)
        self.assertGreaterEqual(rolls, turns)
        self.assertLessEqual(zilchs, turns - 1 if outcome == "completed" else turns)
        game_id = self._next_id("solo")
        participant_id = "solo-human"
        total = 10_000 if outcome == "completed" else 500
        rounds: list[dict] = []
        current_total = 0
        remaining_banks = max(1, turns - zilchs)
        bank_index = 0
        for turn in range(1, turns + 1):
            if turn <= zilchs:
                rounds.append(self._zilch_round(turn=turn, total_after=current_total))
                continue
            bank_index += 1
            is_final_bank = bank_index == remaining_banks
            points = total - current_total if is_final_bank else min(500, total - current_total)
            current_total += points
            rounds.append(self._bank_round(turn=turn, points=points, total_after=current_total))
        highest = max((entry.get("points", 0) for entry in rounds), default=0)
        started = datetime(2026, 2, 1, 12, 0, tzinfo=timezone.utc) + timedelta(hours=self.sequence)
        finished = started + timedelta(seconds=max(active_duration_seconds, 60))
        progress = {
            "target_score": ZILCH_SOLO_SPRINT_TARGET_SCORE,
            "total_points": total,
            "turns": turns,
            "rolls": rolls,
            "zilchs": zilchs,
            "hot_dice_events": 0,
            "highest_banked_round": highest,
            "active_duration_seconds": active_duration_seconds,
        }
        game = {
            "_id": game_id,
            "_name": "Sprint fixture",
            "_game_type": ZILCH_GAME_TYPE,
            "_mode": "1",
            "_play_mode": "solo",
            "_started": False,
            "_finished": True,
            "_aborted": False,
            "_started_at": started.isoformat(),
            "_finished_at": finished.isoformat(),
            "_target_score": ZILCH_SOLO_SPRINT_TARGET_SCORE,
            "_zilch_ruleset": ZILCH_RULESET_VERSION,
            "_participants": [
                {
                    "id": participant_id,
                    "name": user.username,
                    "type": "human",
                    "connection_player_id": participant_id,
                    "user_id": user.id,
                    "cpu_strategy": None,
                }
            ],
            "_total_points": {participant_id: total},
            "_round_points": {participant_id: 0},
            "_zilch_zilch_streaks": {participant_id: 0},
            "_zilch_boards": {
                participant_id: {
                    "player_id": participant_id,
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
        response = finalize_zilch_result(game)
        self.assertTrue(response["result_persisted"])
        return game_id

    def test_personal_statistics_keep_human_cpu_and_solo_modes_separate(self) -> None:
        alice = self._user("Alice")
        bob = self._user("Bob")
        self._persist_competitive(human_one=alice, human_two=bob, first_score=10_000, second_score=9_000, hot_dice=True)
        self._persist_competitive(human_one=alice, human_two=bob, first_score=10_000, second_score=10_000)
        self._persist_competitive(
            human_one=alice,
            cpu_strategy="normal",
            first_score=10_000,
            second_score=9_000,
        )
        self._persist_competitive(
            human_one=alice,
            cpu_strategy="aggressive",
            first_score=9_000,
            second_score=10_000,
        )
        self._persist_solo(user=alice, turns=3, rolls=4, zilchs=1, active_duration_seconds=45)
        self._persist_solo(user=alice, turns=2, rolls=3, outcome="abandoned", active_duration_seconds=30)

        statistics = get_zilch_personal_statistics(alice.id)

        self.assertEqual(statistics["overview"]["completed_records"], 6)
        self.assertEqual(statistics["overview"]["games_by_mode"], {"multiplayer": 2, "cpu": 2, "solo": 2})
        self.assertEqual(statistics["multiplayer"]["games"], 2)
        self.assertEqual(statistics["multiplayer"]["wins"], 1)
        self.assertEqual(statistics["multiplayer"]["ties"], 1)
        self.assertEqual(statistics["multiplayer"]["losses"], 0)
        # Draws are visible but do not dilute a decisive-result rate.
        self.assertEqual(statistics["multiplayer"]["win_rate"], 1.0)
        self.assertEqual(statistics["cpu"]["overall"]["games"], 2)
        self.assertEqual(statistics["cpu"]["overall"]["wins"], 1)
        self.assertEqual(statistics["cpu"]["overall"]["losses"], 1)
        self.assertEqual(statistics["cpu"]["overall"]["win_rate"], 0.5)
        self.assertEqual(statistics["cpu"]["by_strategy"]["normal"]["wins"], 1)
        self.assertEqual(statistics["cpu"]["by_strategy"]["aggressive"]["losses"], 1)
        self.assertEqual(statistics["solo"]["runs"], 2)
        self.assertEqual(statistics["solo"]["completed"], 1)
        self.assertEqual(statistics["solo"]["abandoned"], 1)
        self.assertEqual(statistics["solo"]["completion_rate"], 0.5)
        self.assertEqual(statistics["solo"]["best_run"]["turns"], 3)

    def test_source_history_is_processed_in_bounded_database_pages(self) -> None:
        alice = self._user("PagedAlice")
        bob = self._user("PagedBob")
        self._persist_competitive(human_one=alice, human_two=bob)
        self._persist_competitive(human_one=alice, human_two=bob)

        # The ranking must remain complete when the durable source spans
        # multiple DB pages; the public response limit is unrelated to this
        # internal source scan.
        with patch("app.zilch_statistics.ZILCH_STATISTICS_SOURCE_PAGE_SIZE", 1):
            statistics = get_zilch_personal_statistics(alice.id)

        self.assertEqual(statistics["overview"]["completed_records"], 2)
        self.assertEqual(statistics["multiplayer"]["games"], 2)

    def test_personal_source_paging_does_not_skip_a_later_game_after_duplicate_account_seats(self) -> None:
        alice = self._user("DuplicateSeatAlice")
        bob = self._user("DuplicateSeatBob")
        duplicate_seat_game = self._persist_competitive(human_one=alice, human_two=alice)
        later_game = self._persist_competitive(human_one=alice, human_two=bob)

        # The EXISTS-based source filter must page durable game rows, not
        # duplicate participant join rows that would shrink a LIMIT page.
        with patch("app.zilch_statistics.ZILCH_STATISTICS_SOURCE_PAGE_SIZE", 1):
            records = _load_player_results(user_id=alice.id)

        self.assertEqual({record.game_id for record in records}, {duplicate_seat_game, later_game})

    def test_solo_leaderboard_uses_one_best_successful_run_and_full_lexicographic_order(self) -> None:
        alice = self._user("SoloAlice")
        bob = self._user("SoloBob")
        carol = self._user("SoloCarol")
        inactive = self._user("SoloArchived", active=False)
        # Alice has two successful records but only her best may produce one
        # rank row.  Bob beats that best at the rolls tie-break.
        self._persist_solo(user=alice, turns=3, rolls=9, zilchs=0, active_duration_seconds=60)
        self._persist_solo(user=alice, turns=2, rolls=8, zilchs=1, active_duration_seconds=55)
        self._persist_solo(user=alice, turns=1, rolls=2, outcome="abandoned", active_duration_seconds=10)
        self._persist_solo(user=bob, turns=2, rolls=7, zilchs=1, active_duration_seconds=120)
        self._persist_solo(user=carol, turns=2, rolls=8, zilchs=0, active_duration_seconds=90)
        self._persist_solo(user=inactive, turns=1, rolls=1, zilchs=0, active_duration_seconds=5)

        ranking = get_zilch_leaderboard("solo_sprint", current_user_id=alice.id)

        self.assertEqual(ranking["ranking"], "competition")
        self.assertEqual(ranking["objective"], {"id": ZILCH_SOLO_SPRINT_OBJECTIVE_ID, "version": 1})
        self.assertEqual(ranking["total"], 3)
        self.assertEqual([entry["display_name"] for entry in ranking["entries"]], ["SoloBob", "SoloCarol", "SoloAlice"])
        self.assertEqual([entry["username"] for entry in ranking["entries"]], ["SoloBob", "SoloCarol", "SoloAlice"])
        self.assertTrue(all(isinstance(entry.get("zilch_achievement_rank"), dict) for entry in ranking["entries"]))
        self.assertEqual(ranking["entries"][2]["games"], 2)
        self.assertEqual(ranking["entries"][2]["values"]["turns"], 2)
        self.assertEqual(ranking["own_entry"]["display_name"], "SoloAlice")
        self.assertNotIn("SoloArchived", [entry["display_name"] for entry in ranking["entries"]])

    def test_match_leaderboards_use_competition_ranking_and_cpu_strategies_stay_separate(self) -> None:
        alice = self._user("RankAlice")
        bob = self._user("RankBob")
        carol = self._user("RankCarol")
        # Inactive accounts retain their private historic report but must not
        # occupy a public-private-preview ranking row.
        opponent_one = self._user("OpponentOne", active=False)
        opponent_two = self._user("OpponentTwo", active=False)
        self._persist_competitive(human_one=alice, human_two=opponent_one, first_score=10_000, second_score=9_000)
        self._persist_competitive(human_one=bob, human_two=opponent_two, first_score=10_000, second_score=9_000)
        self._persist_competitive(human_one=carol, human_two=opponent_two, first_score=9_000, second_score=10_000)
        self._persist_competitive(human_one=alice, cpu_strategy="conservative", first_score=10_000, second_score=9_000)
        self._persist_competitive(human_one=bob, cpu_strategy="normal", first_score=10_000, second_score=9_000)

        human_ranking = get_zilch_leaderboard("multiplayer_wins")
        human_entries = {entry["display_name"]: entry for entry in human_ranking["entries"]}
        self.assertEqual(human_entries["RankAlice"]["rank"], 1)
        self.assertEqual(human_entries["RankBob"]["rank"], 1)
        self.assertEqual(human_entries["RankCarol"]["rank"], 3)
        self.assertEqual(human_entries["RankAlice"]["username"], "RankAlice")
        self.assertIn("zilch_achievement_rank", human_entries["RankAlice"])

        conservative = get_zilch_leaderboard("cpu_wins", strategy="conservative")
        self.assertEqual(conservative["total"], 1)
        self.assertEqual(conservative["entries"][0]["display_name"], "RankAlice")
        self.assertEqual(conservative["entries"][0]["values"]["wins"], 1)
        normal = get_zilch_leaderboard("cpu_wins", strategy="normal")
        self.assertEqual(normal["total"], 1)
        self.assertEqual(normal["entries"][0]["display_name"], "RankBob")

    def test_achievement_points_rank_only_active_accounts_with_registered_zilch_evidence(self) -> None:
        alice = self._user("AchievementAlice")
        bob = self._user("AchievementBob")
        carol = self._user("AchievementCarol")
        archived = self._user("AchievementArchived")
        no_game = self._user("AchievementNoGame")
        abandoned_only = self._user("AchievementAbandoned")
        for player in (alice, bob, carol, archived):
            self._persist_solo(
                user=player,
                turns=25,
                rolls=45,
                zilchs=1,
                active_duration_seconds=120,
            )
        self._persist_solo(
            user=abandoned_only,
            turns=2,
            rolls=3,
            outcome="abandoned",
        )

        # Give Alice and Bob the same additional, known Zilch award.  A row
        # without registered evidence must never be enough to manufacture a
        # leaderboard place, and an inactive account must disappear even
        # while its private evidence remains durable.
        with session_scope() as db:
            persisted_archived = db.get(User, archived.id)
            assert persisted_archived is not None
            persisted_archived.is_active = False
            unlocked_at = datetime(2026, 8, 1, tzinfo=timezone.utc)
            for user_id in (alice.id, bob.id, no_game.id):
                db.add(
                    ZilchAchievementUnlock(
                        user_id=user_id,
                        achievement_key="zilch.first_hvh_win",
                        definition_version=ZILCH_ACHIEVEMENT_DEFINITION_VERSION,
                        source_evidence_id=None,
                        source_game_id=None,
                        unlocked_at=unlocked_at,
                    )
                )

        # Force multiple account pages to exercise the bounded keyset scan.
        with patch(
            "app.zilch_statistics.ZILCH_ACHIEVEMENT_LEADERBOARD_ACCOUNT_PAGE_SIZE",
            1,
        ):
            ranking = get_zilch_leaderboard(
                "achievement_points",
                current_user_id=bob.id,
            )

        self.assertEqual(ranking["ranking"], "competition")
        self.assertEqual(ranking["sorting"]["keys"], ["points"])
        self.assertEqual(ranking["total"], 3)
        self.assertEqual(
            [entry["display_name"] for entry in ranking["entries"]],
            ["AchievementAlice", "AchievementBob", "AchievementCarol"],
        )
        self.assertEqual([entry["rank"] for entry in ranking["entries"]], [1, 1, 3])
        self.assertEqual(ranking["own_entry"]["user_id"], bob.id)
        self.assertNotIn(
            "AchievementArchived",
            {entry["display_name"] for entry in ranking["entries"]},
        )
        self.assertNotIn(
            "AchievementNoGame",
            {entry["display_name"] for entry in ranking["entries"]},
        )
        self.assertNotIn(
            "AchievementAbandoned",
            {entry["display_name"] for entry in ranking["entries"]},
        )

        with session_scope() as db:
            keys_by_user = {
                user_id: set(
                    db.scalars(
                        select(ZilchAchievementUnlock.achievement_key).where(
                            ZilchAchievementUnlock.user_id == user_id
                        )
                    )
                )
                for user_id in (alice.id, bob.id, carol.id)
            }
        entries_by_id = {entry["user_id"]: entry for entry in ranking["entries"]}
        for user_id, keys in keys_by_user.items():
            expected_points = zilch_achievement_points_for_keys(keys)
            entry = entries_by_id[user_id]
            self.assertEqual(entry["primary_value"], expected_points)
            self.assertEqual(entry["values"]["points"], expected_points)
            self.assertEqual(
                entry["values"]["points_possible"],
                ZILCH_ACHIEVEMENT_POINTS_POSSIBLE,
            )
            self.assertEqual(
                entry["achievement_rank"],
                zilch_achievement_rank_for_points(expected_points),
            )
            self.assertEqual(
                entry["zilch_achievement_rank"],
                zilch_achievement_rank_for_points(expected_points),
            )
            self.assertEqual(entry["username"], entry["display_name"])
            self.assertEqual(entry["games"], 1)

    def test_achievement_rank_eligibility_uses_durable_qualified_participation(self) -> None:
        player = self._user("AchievementDeletedSource", role="admin")
        game_id = self._persist_solo(
            user=player,
            turns=25,
            rolls=45,
            active_duration_seconds=120,
        )

        delete_completed_game(
            game_id=game_id,
            admin_user_id=player.id,
            reason="Durable participant ledger fixture",
        )
        remove_zilch_result_from_achievements(game_id)

        with session_scope() as db:
            self.assertEqual(
                db.scalar(
                    select(ZilchCommunityParticipant).where(
                        ZilchCommunityParticipant.game_id == game_id,
                        ZilchCommunityParticipant.user_id == player.id,
                    )
                ).user_id,
                player.id,
            )
            self.assertFalse(
                list(
                    db.scalars(
                        select(ZilchAchievementUnlock).where(
                            ZilchAchievementUnlock.user_id == player.id
                        )
                    )
                )
            )

        ranking = get_zilch_leaderboard("achievement_points", current_user_id=player.id)
        self.assertEqual(ranking["total"], 1)
        self.assertEqual(ranking["entries"][0]["user_id"], player.id)
        self.assertEqual(ranking["entries"][0]["primary_value"], 0)
        self.assertEqual(ranking["entries"][0]["games"], 1)

    def test_corrupt_rows_and_non_zilch_rows_are_skipped_and_deletion_removes_statistics(self) -> None:
        admin = self._user("StatisticsAdmin", role="admin")
        alice = self._user("HistoryAlice")
        bob = self._user("HistoryBob")
        game_id = self._persist_competitive(human_one=alice, human_two=bob)
        # A ZDWA row is deliberately not part of the query before JSON parse.
        stored = persist_completed_game_result(
            game_id="zdwa-statistics-isolation",
            game_name="ZDWA",
            game_type=DEFAULT_GAME_TYPE,
            mode="1",
            hardcore=False,
            finished_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            snapshot={"not": "a zilch result"},
            participants=[{"player_key": "legacy", "display_name": "HistoryAlice", "points": 1, "user_id": alice.id}],
        )
        self.assertTrue(stored.succeeded)
        with session_scope() as db:
            row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game_id))
            assert row is not None
            row.snapshot_json = json.dumps({"game_id": game_id, "broken": True})
        self.assertEqual(get_zilch_personal_statistics(alice.id)["overview"]["completed_records"], 0)

        # Recreate a valid Zilch row, then delete it through the typed
        # tombstone path: no cache exists to retain the old result.
        valid_id = self._persist_competitive(human_one=alice, human_two=bob)
        self.assertEqual(get_zilch_personal_statistics(alice.id)["overview"]["completed_records"], 1)
        with session_scope() as db:
            row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == valid_id))
            assert row is not None
            invalid_mode = json.loads(row.snapshot_json)
        invalid_mode["play_mode"] = "unknown-mode"
        self.assertIsNone(validate_stored_zilch_result_payload(invalid_mode, expected_game_id=valid_id))
        invalid_mode["play_mode"] = "multiplayer"
        invalid_mode["mode"] = "1"
        self.assertIsNone(validate_stored_zilch_result_payload(invalid_mode, expected_game_id=valid_id))
        invalid_mode["mode"] = "2"
        invalid_mode["participant_order"] = 1
        self.assertIsNone(validate_stored_zilch_result_payload(invalid_mode, expected_game_id=valid_id))
        deletion = delete_completed_game(
            game_id=valid_id,
            admin_user_id=admin.id,
            reason="Private Zilch statistics deletion fixture",
        )
        self.assertEqual(deletion["game_type"], ZILCH_GAME_TYPE)
        self.assertEqual(get_zilch_personal_statistics(alice.id)["overview"]["completed_records"], 0)

    def test_query_validation_pagination_and_category_metadata_are_safe(self) -> None:
        self.assertEqual(
            validate_zilch_leaderboard_query("cpu_wins", strategy="normal", offset=2, limit=500),
            ("cpu_wins", "normal", 2, ZILCH_LEADERBOARD_MAX_LIMIT),
        )
        self.assertEqual(
            validate_zilch_leaderboard_query("achievement_points", offset=1, limit=25),
            ("achievement_points", None, 1, 25),
        )
        with self.assertRaisesRegex(ZilchStatisticsInputError, "zilch_statistics_invalid_leaderboard_category"):
            get_zilch_leaderboard("unknown")
        with self.assertRaisesRegex(ZilchStatisticsInputError, "zilch_statistics_invalid_cpu_strategy"):
            get_zilch_leaderboard("cpu_wins", strategy="cheat")
        with self.assertRaisesRegex(ZilchStatisticsInputError, "zilch_statistics_invalid_offset"):
            get_zilch_leaderboard("solo_sprint", offset=-1)
        categories = list_zilch_leaderboard_categories()
        self.assertEqual(
            [entry["id"] for entry in categories],
            ["solo_sprint", "multiplayer_wins", "cpu_wins", "achievement_points"],
        )
        self.assertEqual(categories[2]["strategies"], ["aggressive", "conservative", "normal"])
        self.assertEqual(categories[3]["sorting"]["keys"], ["points"])

    def test_unknown_schema_and_incomplete_historic_hot_dice_are_never_counted_as_zero(self) -> None:
        alice = self._user("MetricsAlice")
        bob = self._user("MetricsBob")
        game_id = self._persist_competitive(human_one=alice, human_two=bob)
        with session_scope() as db:
            row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game_id))
            assert row is not None
            historic = json.loads(row.snapshot_json)
            # Older v1 Zilch-loss rows can lack their previous hold list.  It
            # remains a valid historic result, but the player metric is
            # intentionally unknown rather than a fabricated zero.
            historic["boards"]["human-one"]["rounds"].append(
                {
                    "turn_id": 3,
                    "round": 2,
                    "event": "zilch",
                    "reason": "no_scoring_option",
                    "discarded_points": 0,
                    "penalty": 0,
                    "total_after": 10_000,
                    "zilch_streak": 1,
                    "rolls_used": 1,
                }
            )
            # This historic fixture changes a real Zilch event, so the
            # corresponding non-optional summary stays authoritative.  Only
            # its omitted hold detail makes Hot Dice unknown.
            historic["metrics"]["zilch_count"] = 1
            row.snapshot_json = json.dumps(historic)
        statistics = get_zilch_personal_statistics(alice.id)
        self.assertIsNone(statistics["overview"]["hot_dice_events"])
        self.assertFalse(statistics["overview"]["hot_dice_events_complete"])

        unknown_schema = dict(historic)
        unknown_schema["schema_version"] = 999
        self.assertIsNone(validate_stored_zilch_result_payload(unknown_schema, expected_game_id=game_id))

    def test_board_metric_damage_is_fail_closed_for_statistics(self) -> None:
        alice = self._user("MetricDamageAlice")
        bob = self._user("MetricDamageBob")
        game_id = self._persist_competitive(human_one=alice, human_two=bob)
        with session_scope() as db:
            row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game_id))
            assert row is not None
            damaged = json.loads(row.snapshot_json)
            damaged["boards"]["human-one"]["rounds"][0]["points"] += 50
            row.snapshot_json = json.dumps(damaged)

        self.assertIsNone(validate_stored_zilch_result_payload(damaged, expected_game_id=game_id))
        self.assertEqual(get_zilch_personal_statistics(alice.id)["overview"]["completed_records"], 0)
