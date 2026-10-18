"""The table result shows each seated person's round XP and new achievements."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from app import main
from app.auth import create_user
from app.database import configure_database, session_scope, upgrade_database
from app.hausdepp_achievements import ACHIEVEMENTS
from app.hausdepp_round_summary import build_round_summary
from app.models import HausdeppAchievementUnlock, HausdeppRoundCredit


class HausdeppRoundSummaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/hausdepp-summary.sqlite3",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.first = create_user("Erstling", "test-password-123", must_change_password=False)
        self.second = create_user("Zweitling", "test-password-123", must_change_password=False)
        at = datetime(2026, 10, 17, 20, tzinfo=timezone.utc)
        with session_scope() as db:
            db.add(HausdeppRoundCredit(user_id=self.first.id, game_id="round-7", finished_at=at,
                                       facts_json=json.dumps({"cpu_count": 1})))
            db.add(HausdeppRoundCredit(user_id=self.second.id, game_id="round-7", finished_at=at,
                                       facts_json=json.dumps({"cpu_count": 1})))
            # awarded_points stores the running account total (here 412), not the award value.
            db.add(HausdeppAchievementUnlock(user_id=self.first.id, achievement_id="hausdepp_01", unlocked_at=at,
                                             source_game_id="round-7", awarded_points=412))
            db.add(HausdeppAchievementUnlock(user_id=self.first.id, achievement_id="hausdepp_02", unlocked_at=at,
                                             source_game_id="older-round", awarded_points=25))

    def tearDown(self):
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def test_round_xp_and_only_this_rounds_achievements_per_seat(self):
        participants = [{"id": "a", "is_cpu": False, "user_id": self.first.id},
                        {"id": "b", "is_cpu": False, "user_id": self.second.id},
                        {"id": "c", "is_cpu": True, "user_id": None},
                        {"id": "d", "is_cpu": False, "user_id": None}]
        summary = build_round_summary("round-7", participants)
        self.assertEqual(summary["round_id"], "round-7")
        self.assertEqual(set(summary["players"]), {"a", "b"})
        first = summary["players"]["a"]
        self.assertEqual(first["round_xp"], 2)
        award = next(item for item in ACHIEVEMENTS if item["id"] == "hausdepp_01")["points"]
        self.assertEqual(first["achievements"][0]["points"], award)
        self.assertEqual(first["xp"], 2 + award)
        self.assertEqual([item["id"] for item in first["achievements"]], ["hausdepp_01"])
        self.assertIn("de", first["achievements"][0]["name"])
        self.assertEqual(summary["players"]["b"], {"xp": 2, "round_xp": 2, "achievements": []})

    def test_a_seat_without_a_credit_shows_no_invented_xp(self):
        summary = build_round_summary("another-round", [{"id": "a", "is_cpu": False, "user_id": self.first.id}])
        self.assertEqual(summary["players"]["a"], {"xp": None, "round_xp": None, "achievements": []})
