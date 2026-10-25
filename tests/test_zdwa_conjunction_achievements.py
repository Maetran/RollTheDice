"""Focused ZDWA conjunction goals and real completion-pipeline regressions.

Completion tests seed legal preterminal scorecards, then execute the real final
write and result persistence/sync/replay pipeline. They do not replay 47 rolls.
"""
from __future__ import annotations

import asyncio
import copy
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import select

from app import database
from app.achievements import _game_metrics, sync_achievements_for_users
from app.auth import create_user
from app.database import configure_database, session_scope, upgrade_database
from app.game_engine import _compute_final_totals
from app.game_results import finalize_and_log_results
from app.game_scoring import score_field_value
from app.game_state import is_team_mode
from app.game_ws_gameplay import handle_gameplay_action
from app.game_ws_session import GameSocketSession
from app.leaderboard_service import game_from_leaderboard
from app.leaderboard_storage import LeaderboardFiles
from app.models import CompletedGame, GameParticipant, User, UserAchievement
from app.security import as_utc
from tests.support import GameStateTestCase

REPO_ROOT = Path(__file__).resolve().parent.parent

NEW_KEYS = {"lower_clean_sheet", "top_equal_with_bonuses"}
COLUMNS = ("down", "free", "up", "ang")
QUALIFYING = {
    "1": 3, "2": 6, "3": 9, "4": 12, "5": 15, "6": 18,
    "max": 30, "min": 5, "kenter": 35, "full": 43, "poker": 58, "60": 75,
}
LEGAL_DICE = {
    "1": [1, 1, 1, 2, 2], "2": [2, 2, 2, 1, 1],
    "3": [3, 3, 3, 1, 1], "4": [4, 4, 4, 1, 1],
    "5": [5, 5, 5, 1, 1], "6": [6, 6, 6, 1, 1],
    "max": [6, 6, 6, 6, 6], "min": [1, 1, 1, 1, 1],
    "kenter": [1, 2, 3, 4, 5], "full": [1, 1, 1, 2, 2],
    "poker": [2, 2, 2, 2, 1], "60": [3, 3, 3, 3, 3],
}


def qualifying_rows():
    return [{"index": index, "rows": dict(QUALIFYING)} for index in (1, 2, 3, 4)]


def snapshot_metrics(rows, *, hardcore=False):
    game = CompletedGame(
        game_id="metrics-only", game_type="zdwa", mode="1", hardcore=hardcore,
        finished_at=datetime(2026, 10, 25, 12, tzinfo=timezone.utc),
        snapshot_json=json.dumps({"scoreboards": {"p1": {"reihen": rows}}}),
    )
    participant = GameParticipant(player_key="p1", team=None, points=0)
    return _game_metrics(game, participant)


class ZDWAConjunctionMetricsTestCase(unittest.TestCase):
    def test_team_metrics_require_an_explicit_own_team_and_never_fall_back_to_a_personal_board(self):
        game = CompletedGame(
            mode="2v2", hardcore=False, finished_at=datetime.now(timezone.utc),
            snapshot_json=json.dumps({"scoreboards": {
                "A": {"reihen": qualifying_rows()}, "B": {"reihen": []},
                "p1": {"reihen": qualifying_rows()},
            }}),
        )
        for team, expected in ((None, False), ("B", False), ("A", True)):
            with self.subTest(team=team):
                metrics = _game_metrics(game, GameParticipant(player_key="p1", team=team, points=0))
                self.assertEqual(metrics["lower_clean_sheet"], expected)
                self.assertEqual(metrics["top_equal_with_bonuses"], expected)
                if team is None:
                    self.assertTrue(metrics["top_totals_equal"])  # historic fallback is unchanged

    def test_qualifying_scorecard_values_are_legal_and_unlock_both_metrics(self):
        for field, dice in LEGAL_DICE.items():
            with self.subTest(field=field):
                self.assertEqual(score_field_value(field, dice), QUALIFYING[field])
        for hardcore in (False, True):
            with self.subTest(hardcore=hardcore):
                metrics = snapshot_metrics(qualifying_rows(), hardcore=hardcore)
                self.assertTrue(all(metrics[key] for key in NEW_KEYS))
                self.assertFalse(metrics["top_section_all_exact_60"])

    def test_lower_requires_every_field_in_every_row_explicitly_positive(self):
        for index in range(4):
            for field in ("kenter", "full", "poker", "60"):
                for missing in (False, True):
                    with self.subTest(index=index, field=field, missing=missing):
                        rows = qualifying_rows()
                        if missing:
                            rows[index]["rows"].pop(field)
                        else:
                            rows[index]["rows"][field] = 0
                        self.assertFalse(snapshot_metrics(rows)["lower_clean_sheet"])

    def test_new_metrics_reject_malformed_row_identity_and_values(self):
        malformed = {}
        malformed["missing row"] = qualifying_rows()[:3]
        malformed["extra row"] = qualifying_rows() + [copy.deepcopy(qualifying_rows()[0])]
        for name, bad_index in (("duplicate index", 1), ("boolean index", True), ("string index", "2")):
            rows = qualifying_rows()
            rows[1]["index"] = bad_index
            malformed[name] = rows
        for name, value in (("float", 35.0), ("boolean", True), ("negative", -1), ("text", "35"), ("null", None)):
            rows = qualifying_rows()
            rows[0]["rows"]["kenter"] = value
            malformed[name] = rows
        rows = qualifying_rows()
        rows[0]["rows"] = None
        malformed["non-map cells"] = rows
        for name, rows in malformed.items():
            with self.subTest(name=name):
                metrics = snapshot_metrics(rows)
                self.assertFalse(metrics["lower_clean_sheet"])
                self.assertFalse(metrics["top_equal_with_bonuses"])
        # New strictness must not silently rewrite old permissive metrics.
        duplicate = qualifying_rows()
        duplicate[1]["index"] = 1
        self.assertTrue(snapshot_metrics(duplicate)["top_totals_equal"])
        self.assertTrue(snapshot_metrics(duplicate)["all_top_bonuses"])

    def test_top_requires_every_upper_field_even_if_implicit_zero_would_qualify(self):
        for field in ("1", "2", "3", "4", "5", "6"):
            with self.subTest(field=field):
                rows = qualifying_rows()
                rows[0]["rows"].pop(field)
                self.assertFalse(snapshot_metrics(rows)["top_equal_with_bonuses"])
        rows = qualifying_rows()
        for row in rows:
            row["rows"].pop("1")  # Remaining upper values total60 in every row.
        metrics = snapshot_metrics(rows)
        self.assertTrue(metrics["top_totals_equal"])
        self.assertTrue(metrics["all_top_bonuses"])
        self.assertFalse(metrics["top_equal_with_bonuses"])

    def test_bonus_boundaries_use_each_games_actual_mode(self):
        cases = (
            ({"1": 3, "2": 6, "3": 6, "4": 8, "5": 10, "6": 6}, False, False),
            ({"1": 3, "2": 6, "3": 6, "4": 8, "5": 10, "6": 6}, True, False),
            ({"1": 4, "2": 6, "3": 6, "4": 8, "5": 10, "6": 6}, False, False),
            ({"1": 4, "2": 6, "3": 6, "4": 8, "5": 10, "6": 6}, True, True),
            ({"4": 8}, False, False),  # qualifying63 minus4 =59
            ({"1": 0}, False, True),  # qualifying63 minus3 =60
        )
        for changes, hardcore, expected in cases:
            with self.subTest(changes=changes, hardcore=hardcore):
                rows = qualifying_rows()
                for row in rows:
                    row["rows"].update(changes)
                metrics = snapshot_metrics(rows, hardcore=hardcore)
                self.assertEqual(metrics["top_equal_with_bonuses"], expected)
                self.assertTrue(metrics["lower_clean_sheet"])
        rows = qualifying_rows()
        rows[0]["rows"]["1"] = 4
        self.assertTrue(snapshot_metrics(rows)["all_top_bonuses"])
        self.assertFalse(snapshot_metrics(rows)["top_equal_with_bonuses"])


class RecordingSocket:
    def __init__(self):
        self.messages = []

    async def send_json(self, message):
        self.messages.append(message)


class ZDWAConjunctionCompletionTestCase(GameStateTestCase):
    def setUp(self):
        super().setUp()
        self.temp = tempfile.TemporaryDirectory()
        self.temp_path = Path(self.temp.name)
        self.env_patch = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp_path / 'zdwa-achievements.sqlite3'}",
        })
        self.env_patch.start()
        # Preserve any caller's configured engine without connecting to or
        # disposing it. Every engine used by these tests belongs to this temp DB.
        self.db_patch = patch.multiple(database, _engine=None, _session_factory=None,
                                       _database_url=None, _schema_ready=False)
        self.db_patch.start()
        configure_database(self.temp_path)
        upgrade_database(REPO_ROOT)
        self.files = LeaderboardFiles.in_directory(self.temp_path / "leaderboards")
        self.user_counter = 0

    def tearDown(self):
        database.get_engine().dispose()
        self.db_patch.stop()
        self.env_patch.stop()
        self.temp.cleanup()
        super().tearDown()

    def account(self, label):
        self.user_counter += 1
        user = create_user(f"{label}{self.user_counter}", "focused-regression-password", must_change_password=False)
        with session_scope() as db:
            db.get(User, user.id).achievement_gameplay_started_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
        return user

    def board(self, changes=None):
        return self.full_scoreboard({column: {**QUALIFYING, **(changes or {}).get(column, {})} for column in COLUMNS})

    def terminal_write(self, game, *, actor="p1"):
        board_key = game.get("_team_of", {}).get(actor, actor)
        boards = game["_scoreboards_by_team"] if is_team_mode(game) else game["_scoreboards"]
        board = boards[board_key]
        board.pop("15,ang")
        sockets = {}
        for player in game["_players"]:
            socket = RecordingSocket()
            player["ws"] = socket
            sockets[player["id"]] = socket
        game["_turn"] = {"player_id": actor, "roll_index": 1, "first4oak_roll": None}
        game["_rolls_used"] = 1
        game["_dice"] = [3, 3, 3, 3, 3]
        session = GameSocketSession(sockets[actor], game, None, player_id=actor)
        asyncio.run(handle_gameplay_action(
            session, "write_field", {"row": 15, "field": "ang"},
            finalize_game=lambda finished: finalize_and_log_results(self.files, finished),
        ))
        self.assertFalse(any("error" in message for message in sockets[actor].messages), sockets[actor].messages)
        self.assertEqual(board["15,ang"], 75)
        self.assertTrue(game["_finished"])
        self.assertTrue(game["_final_completion"]["result_persisted"])
        with session_scope() as db:
            completed = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game["_id"]))
            self.assertIsNotNone(completed)
            return completed.id

    def solo(self, user, *, changes=None, hardcore=False):
        game = self.make_game(mode=1, hardcore=hardcore, players=[("p1", user.username)])
        game["_players"][0]["user_id"] = user.id
        game["_scoreboards"]["p1"] = self.board(changes)
        return game, self.terminal_write(game)

    def awards(self, user_id):
        with session_scope() as db:
            return {
                row.achievement_key: (row.id, row.unlocked_at, row.source_completed_game_id)
                for row in db.scalars(select(UserAchievement).where(UserAchievement.user_id == user_id))
            }

    def test_final_write_persists_real_totals_links_awards_and_retains_first_date(self):
        user = self.account("Terminal")
        game, completed_id = self.solo(user)
        before = self.awards(user.id)
        self.assertTrue(NEW_KEYS.issubset(before))
        for key in NEW_KEYS:
            self.assertEqual(before[key][2], completed_id)
        with session_scope() as db:
            completed = db.get(CompletedGame, completed_id)
            participant = db.scalar(select(GameParticipant).where(GameParticipant.game_id == completed_id))
            self.assertEqual(participant.points, _compute_final_totals(game)["p1"])
            rows = json.loads(completed.snapshot_json)["scoreboards"]["p1"]["reihen"]
            self.assertEqual({row["index"] for row in rows}, {1, 2, 3, 4})
            self.assertEqual(rows[-1]["rows"]["60"], 75)
        replay = game_from_leaderboard(self.files, game["_id"])
        self.assertTrue(NEW_KEYS.issubset({item["key"] for item in replay["players"][0]["earned_achievements"]}))
        later = as_utc(before["lower_clean_sheet"][1]) + timedelta(days=30)
        with patch("app.achievements.utcnow", return_value=later):
            self.assertEqual(sync_achievements_for_users({user.id}, source_completed_game_id=completed_id), {})
            recovery = finalize_and_log_results(self.files, game)
        self.assertTrue(recovery["result_recovered"])
        self.assertEqual(recovery["achievement_unlocks"], {})
        self.assertEqual({key: self.awards(user.id)[key] for key in NEW_KEYS},
                         {key: before[key] for key in NEW_KEYS})

    def test_equal_totals_and_all_bonuses_cannot_be_combined_across_two_games(self):
        user = self.account("Separate")
        first_changes = {column: {"4": 8} for column in COLUMNS}  # all59, no bonus
        self.solo(user, changes=first_changes)
        second_changes = {"free": {"1": 4}, "up": {"1": 5}, "ang": {"6": 24}}
        self.solo(user, changes=second_changes)  #63/64/65/69, every bonus
        sync_achievements_for_users({user.id})
        awards = self.awards(user.id)
        self.assertIn("top_totals_equal", awards)
        self.assertIn("all_top_bonuses", awards)
        self.assertNotIn("top_equal_with_bonuses", awards)

    def test_lower_positive_cells_cannot_be_combined_across_two_games(self):
        user = self.account("SplitLower")
        self.solo(user, changes={"down": {"full": 0}})
        self.solo(user, changes={"up": {"poker": 0}})
        sync_achievements_for_users({user.id})
        self.assertNotIn("lower_clean_sheet", self.awards(user.id))

    def test_general_gameplay_rollout_boundary_is_preserved_for_new_goals(self):
        user = self.account("BeforeMarker")
        with session_scope() as db:
            db.get(User, user.id).achievement_gameplay_started_at = datetime.now(timezone.utc) + timedelta(days=1)
        self.solo(user)
        self.assertFalse(NEW_KEYS.intersection(self.awards(user.id)))

    def test_actual_completion_obeys_normal_and_hardcore_bonus_thresholds(self):
        upper40 = {"1": 4, "2": 6, "3": 6, "4": 8, "5": 10, "6": 6}
        changes = {column: upper40 for column in COLUMNS}
        normal = self.account("NormalForty")
        hardcore = self.account("HardcoreForty")
        self.solo(normal, changes=changes, hardcore=False)
        self.solo(hardcore, changes=changes, hardcore=True)
        self.assertNotIn("top_equal_with_bonuses", self.awards(normal.id))
        self.assertIn("top_equal_with_bonuses", self.awards(hardcore.id))

    def test_team_awards_follow_shared_board_and_never_an_opponents_board(self):
        for qualifying_team in ("A", "B"):
            with self.subTest(qualifying_team=qualifying_team):
                users = [self.account(f"Team{qualifying_team}Seat{i}") for i in range(4)]
                game = self.make_game(mode="2v2", players=[(f"p{i+1}", user.username) for i, user in enumerate(users)])
                for player, user in zip(game["_players"], users):
                    player["user_id"] = user.id
                for team in ("A", "B"):
                    game["_scoreboards_by_team"][team] = self.board(
                        None if team == qualifying_team else {"down": {"full": 0, "1": 4}},
                    )
                # Bogus per-player scorecards must never override the shared
                # authoritative team board used by completed result metrics.
                game["_scoreboards"] = {player["id"]: self.board() for player in game["_players"]}
                actor = "p1" if qualifying_team == "A" else "p2"
                completed_id = self.terminal_write(game, actor=actor)
                with session_scope() as db:
                    completed = db.get(CompletedGame, completed_id)
                    self.assertEqual(set(json.loads(completed.snapshot_json)["scoreboards"]), {"A", "B"})
                    teams = dict(db.execute(select(GameParticipant.player_key, GameParticipant.team).where(
                        GameParticipant.game_id == completed_id,
                    )).all())
                    self.assertEqual(teams, {"p1": "A", "p2": "B", "p3": "A", "p4": "B"})
                for index, user in enumerate(users):
                    earned = NEW_KEYS.intersection(self.awards(user.id))
                    expected = NEW_KEYS if teams[f"p{index+1}"] == qualifying_team else set()
                    self.assertEqual(earned, expected)
                    for key in earned:
                        self.assertEqual(self.awards(user.id)[key][2], completed_id)


if __name__ == "__main__":
    unittest.main()
