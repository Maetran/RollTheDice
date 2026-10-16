"""The Hausdepp table ranks completed human outcomes, never hidden evidence."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import select

from app import main
from app.auth import create_user
from app.database import configure_database, session_scope, upgrade_database
from app.game_history import persist_completed_game_result
from app.hausdepp_leaderboard import build_hausdepp_leaderboard
from app.models import CompletedGame, User


class HausdeppLeaderboardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/hausdepp-standings.sqlite3",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.users = [create_user(name, "test-password-123", must_change_password=False)
                      for name in ("AlphaHD", "BetaHD", "GammaHD")]
        self.at = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)

    def tearDown(self):
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def store(self, game_id, accounts, *, loser=0, game_type="hausdepp"):
        # None represents a CPU seat; humans are durable account identities.
        players = [{"id": f"seat-{index}", "name": account.username if account else "Computer",
                    "is_cpu": account is None} for index, account in enumerate(accounts)]
        payload = {"schema_version": 1, "payload_kind": "hausdepp_result", "game_type": "hausdepp",
                   "game_id": game_id, "name": "Ranglistentisch", "finished_at": self.at.isoformat(),
                   "participants": players, "loser_id": players[loser]["id"],
                   "finished_order": [player["id"] for index, player in enumerate(players) if index != loser]}
        self.assertTrue(persist_completed_game_result(
            game_id=game_id, game_name=payload["name"], game_type=game_type, mode=str(len(accounts)), hardcore=False,
            finished_at=self.at, snapshot=payload,
            participants=[{"player_key": player["id"], "display_name": player["name"],
                           "user_id": account.id if account else None}
                          for player, account in zip(players, accounts)],
        ).succeeded)

    def test_all_nonlosers_receive_wins_and_equal_totals_share_places(self):
        first, second, third = self.users
        self.store("two-one", [first, second], loser=1)
        self.store("two-two", [first, second], loser=0)
        self.store("three", self.users, loser=2)
        result = build_hausdepp_leaderboard(first.id)
        self.assertEqual(result["total_players"], 3)
        self.assertEqual([entry["place"] for entry in result["entries"]], [1, 1, 3])
        self.assertEqual([entry["wins"] for entry in result["entries"]], [2, 2, 0])
        self.assertEqual([entry["rounds_played"] for entry in result["entries"]], [3, 3, 1])
        self.assertEqual([entry["win_rate"] for entry in result["entries"]], [66.7, 66.7, 0])
        self.assertEqual([entry["is_self"] for entry in result["entries"]], [True, False, False])
        for private in ('"user_id"', '"achievement_evidence"', '"game_id"', '"points"', '"losses"'):
            self.assertNotIn(private, json.dumps(result))

    def test_filters_apply_actual_table_size_and_cpu_seats_do_not_enter_standings(self):
        first, second, _third = self.users
        self.store("two", [first, second], loser=1)
        self.store("three-cpu", [first, second, None], loser=2)
        two = build_hausdepp_leaderboard(first.id, players=2)
        three = build_hausdepp_leaderboard(first.id, players=3)
        self.assertEqual([entry["wins"] for entry in two["entries"]], [1, 0])
        self.assertEqual([entry["wins"] for entry in three["entries"]], [1, 1])
        self.assertEqual(three["total_players"], 2)
        self.assertEqual(build_hausdepp_leaderboard(first.id, players=6)["entries"], [])
        self.assertEqual(len(build_hausdepp_leaderboard(first.id, limit=1)["entries"]), 1)

    def test_wrong_game_damaged_ambiguous_inactive_accounts_and_cpu_owner_are_excluded(self):
        first, second, third = self.users
        self.store("zilch", self.users, loser=1, game_type="zilch")
        self.store("damaged", self.users, loser=1)
        self.store("ambiguous", self.users, loser=1)
        self.store("cpu-forged", [first, None], loser=1)
        self.store("valid", self.users, loser=2)
        with session_scope() as db:
            damaged = db.scalar(select(CompletedGame).where(CompletedGame.game_id == "damaged"))
            damaged.snapshot_json = "{}"
            ambiguous = db.scalar(select(CompletedGame).where(CompletedGame.game_id == "ambiguous"))
            ambiguous.participants[1].user_id = first.id
            cpu = db.scalar(select(CompletedGame).where(CompletedGame.game_id == "cpu-forged"))
            cpu.participants[1].user_id = second.id
            db.get(User, third.id).is_active = False
        result = build_hausdepp_leaderboard(first.id)
        self.assertEqual(result["total_players"], 2)
        self.assertEqual([entry["wins"] for entry in result["entries"]], [1, 1])
        self.assertEqual([entry["rounds_played"] for entry in result["entries"]], [1, 1])

    def test_names_follow_accounts_and_validation_is_strict(self):
        first, second, _third = self.users
        self.store("before-rename", [first, second], loser=1)
        with session_scope() as db:
            db.get(User, first.id).username = "NeuAmTisch"
        result = build_hausdepp_leaderboard(first.id)
        self.assertEqual(result["entries"][0]["display_name"], "NeuAmTisch")
        for players in (True, 1, 7, "2"):
            with self.subTest(players=players), self.assertRaisesRegex(ValueError, "invalid_players"):
                build_hausdepp_leaderboard(first.id, players=players)
        for limit in (True, 0, 101, "50"):
            with self.subTest(limit=limit), self.assertRaisesRegex(ValueError, "invalid_limit"):
                build_hausdepp_leaderboard(first.id, limit=limit)
        with patch("app.hausdepp_leaderboard.database_schema_ready", return_value=False):
            empty = build_hausdepp_leaderboard(first.id)
        self.assertEqual((empty["total_players"], empty["entries"]), (0, []))

    def test_titles_match_private_weighted_progress_and_reading_does_not_acknowledge_it(self):
        from app.hausdepp_achievements import synchronize_hausdepp_progress
        from app.models import HausdeppPresentationReceipt

        first, second, _ = self.users
        for index in range(6):
            self.store(f"rank-human-{index}", [first, second], loser=index % 2)
        for index in range(4):
            self.store(f"rank-computer-{index}", [second, None], loser=1)
        expected = {user.id: synchronize_hausdepp_progress(user.id)["rank"] for user in (first, second)}
        with session_scope() as db:
            before = db.execute(select(HausdeppPresentationReceipt.__table__)).all()
        for players in (None, 2):
            result = build_hausdepp_leaderboard(first.id, players=players)
            for entry in result["entries"]:
                user = first if entry["display_name"] == first.username else second
                self.assertEqual(entry["rank"], {key: expected[user.id][key] for key in ("id", "name", "level")})
                self.assertEqual(set(entry["rank"]), {"id", "name", "level"})
        with session_scope() as db:
            self.assertEqual(db.execute(select(HausdeppPresentationReceipt.__table__)).all(), before)
