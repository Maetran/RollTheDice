"""Newest Hausdepp unlocks are a signed-in timeline without private evidence."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from starlette.testclient import TestClient

from app import main
from app.achievement_feed import ACHIEVEMENT_FEED_PAGE_SIZE
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.hausdepp_achievement_feed import HAUSDEPP_ACHIEVEMENT_DIFFICULTIES, list_hausdepp_achievement_feed
from app.hausdepp_achievements import ACHIEVEMENTS
from app.models import HausdeppAchievementUnlock, User
from tests.test_user_accounts import request_for

PRIVATE_FIELDS = ("user_id", "account_id", "source_game_id", "game_id", "game_url", "avatar_url",
                  "profile_url", "awarded_points", "achievement_evidence", "facts_json")


class HausdeppAchievementFeedTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/hausdepp-feed.sqlite3",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.alpha = create_user("AlphaFeed", "test-password-123", must_change_password=False)
        self.beta = create_user("BetaFeed", "test-password-123", must_change_password=False)
        self.at = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)

    def tearDown(self):
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def unlock(self, user, achievement_id, minutes=0):
        with session_scope() as db:
            db.add(HausdeppAchievementUnlock(
                user_id=user.id, achievement_id=achievement_id, unlocked_at=self.at + timedelta(minutes=minutes),
                source_game_id=f"secret-round-{achievement_id}", awarded_points=999,
            ))

    def test_every_catalog_award_has_a_difficulty_band(self):
        self.assertEqual(set(HAUSDEPP_ACHIEVEMENT_DIFFICULTIES), {item["id"] for item in ACHIEVEMENTS})
        self.assertEqual(HAUSDEPP_ACHIEVEMENT_DIFFICULTIES["hausdepp_01"], "easy")
        self.assertEqual(HAUSDEPP_ACHIEVEMENT_DIFFICULTIES["hausdepp_02"], "medium")
        self.assertEqual(HAUSDEPP_ACHIEVEMENT_DIFFICULTIES["hausdepp_32"], "hard")
        self.assertEqual(HAUSDEPP_ACHIEVEMENT_DIFFICULTIES["hausdepp_125"], "hard")
        self.assertEqual(HAUSDEPP_ACHIEVEMENT_DIFFICULTIES["hausdepp_135"], "hard")

    def test_newest_first_with_bilingual_copy_and_no_private_evidence(self):
        self.unlock(self.alpha, "hausdepp_01", minutes=0)
        self.unlock(self.beta, "hausdepp_32", minutes=5)
        self.unlock(self.alpha, "hausdepp_unknown", minutes=10)
        result = list_hausdepp_achievement_feed(self.alpha.id)
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["pages"], 1)
        first, second = result["items"]
        self.assertEqual(first["player"], {"display_name": "BetaFeed", "is_self": False})
        self.assertEqual(first["achievement"]["id"], "hausdepp_32")
        self.assertEqual(first["achievement"]["name"], {"de": "Zehn Gebote", "en": "Ten commandments"})
        self.assertEqual(set(first["achievement"]["description"]), {"de", "en"})
        self.assertEqual((first["achievement"]["points"], first["achievement"]["difficulty"]), (100, "hard"))
        self.assertEqual(first["unlocked_at"], (self.at + timedelta(minutes=5)).isoformat())
        self.assertEqual(second["player"], {"display_name": "AlphaFeed", "is_self": True})
        serialized = json.dumps(result)
        for private in PRIVATE_FIELDS:
            self.assertNotIn(f'"{private}"', serialized)
        self.assertNotIn("secret-round", serialized)
        self.assertNotIn("999", serialized)

    def test_inactive_accounts_disappear_and_difficulty_filters_and_pages(self):
        for index, achievement in enumerate(ACHIEVEMENTS[:ACHIEVEMENT_FEED_PAGE_SIZE + 5]):
            self.unlock(self.alpha, achievement["id"], minutes=index)
        self.unlock(self.beta, "hausdepp_01", minutes=100)
        with session_scope() as db:
            db.get(User, self.beta.id).is_active = False
        first = list_hausdepp_achievement_feed(self.alpha.id)
        self.assertEqual((first["total"], first["pages"], first["has_next"]), (25, 2, True))
        self.assertEqual(len(first["items"]), ACHIEVEMENT_FEED_PAGE_SIZE)
        self.assertNotIn("BetaFeed", json.dumps(first))
        second = list_hausdepp_achievement_feed(self.alpha.id, page=2)
        self.assertEqual((len(second["items"]), second["has_previous"], second["has_next"]), (5, True, False))
        self.assertEqual(list_hausdepp_achievement_feed(self.alpha.id, page=9)["items"], [])
        easy = list_hausdepp_achievement_feed(self.alpha.id, difficulty="easy")
        self.assertTrue(easy["items"])
        self.assertEqual({item["achievement"]["difficulty"] for item in easy["items"]}, {"easy"})
        with self.assertRaises(ValueError):
            list_hausdepp_achievement_feed(self.alpha.id, difficulty="legendary")
        with self.assertRaises(ValueError):
            list_hausdepp_achievement_feed(0)

    def test_api_requires_an_account_and_validates_queries(self):
        self.unlock(self.alpha, "hausdepp_01")
        with TestClient(main.app) as client:
            self.assertEqual(client.get("/api/hausdepp/achievements/recent").status_code, 401)
            _, token = login(request_for(), self.beta.username, "test-password-123")
            client.cookies.set("rollthedice_session", token)
            response = client.get("/api/hausdepp/achievements/recent")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(response.json()["items"][0]["player"], {"display_name": "AlphaFeed", "is_self": False})
            for query in ("page=0", "difficulty=legendary"):
                self.assertEqual(client.get(f"/api/hausdepp/achievements/recent?{query}").status_code, 422)


if __name__ == "__main__":
    unittest.main()
