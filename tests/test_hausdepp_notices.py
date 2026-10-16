"""Earned progress is delivered once without replaying XP or private facts."""

import json
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from alembic.config import Config
from sqlalchemy import func, select, text
from starlette.testclient import TestClient

from alembic import command
from app import main
from app.auth import login
from app.database import session_scope
from app.hausdepp_achievements import acknowledge_hausdepp_presentation, synchronize_hausdepp_progress
from app.hausdepp_notices import acknowledge_hausdepp_notice, pending_hausdepp_notices
from app.models import HausdeppAchievementUnlock, HausdeppNoticeReceipt, HausdeppRoundCredit
from tests import test_hausdepp_achievements as fixtures
from tests.test_user_accounts import request_for


class HausdeppNoticeTests(unittest.TestCase):
    setUp = fixtures.HausdeppAchievementTests.setUp
    tearDown = fixtures.HausdeppAchievementTests.tearDown
    payload = fixtures.HausdeppAchievementTests.payload
    store = fixtures.HausdeppAchievementTests.store

    def test_previously_acknowledged_summary_is_replayed_once_without_awarding_again(self):
        self.store(self.payload(flags=("hausdepp_17",)))
        before = synchronize_hausdepp_progress(self.user.id)
        acknowledge_hausdepp_presentation(self.user.id, before["presentation"]["revision"])
        queue = pending_hausdepp_notices(self.user.id)
        self.assertEqual([item["key"] for item in queue["notices"]],
                         ["achievement:hausdepp_01", "achievement:hausdepp_17", "rank:rank_02"])
        self.assertEqual(pending_hausdepp_notices(self.user.id), queue)
        for item in queue["notices"]:
            self.assertEqual(acknowledge_hausdepp_notice(self.user.id, item["key"])["key"], item["key"])
        self.assertEqual(pending_hausdepp_notices(self.user.id)["notices"], [])
        self.assertEqual(synchronize_hausdepp_progress(self.user.id)["scoring"], before["scoring"])
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppRoundCredit)), 1)
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppAchievementUnlock)), 2)

    def test_repeated_goal_explains_source_time_count_without_foreign_evidence(self):
        for index in range(3):
            self.store(self.payload(f"own-{index}", flags=("hausdepp_33",), foreign_flags=("hausdepp_19",),
                                    at=self.at + timedelta(minutes=index)))
        notice = next(item for item in pending_hausdepp_notices(self.user.id)["notices"]
                      if item["key"] == "achievement:hausdepp_33")
        self.assertEqual(notice["evidence"], {"current": 3, "target": 3, "current_condition_proven": True})
        self.assertIn("3 von 3", notice["reason"]["de"])
        self.assertEqual(notice["source"]["players"], 2)
        self.assertEqual(notice["source"]["finished_at"], (self.at + timedelta(minutes=2)).isoformat())
        encoded = json.dumps(pending_hausdepp_notices(self.user.id))
        for private in ("PRIVATE-", "foreign_flags", "opponents", "own-0", "hausdepp_19", "facts_json", "hand"):
            self.assertNotIn(private, encoded)

    def test_skipped_ranks_are_each_presented_and_initial_einstein_is_not_an_upgrade(self):
        self.store(self.payload(flags=("hausdepp_17", "hausdepp_18", "hausdepp_19")))
        queue = pending_hausdepp_notices(self.user.id)
        ranks = [item for item in queue["notices"] if item["kind"] == "rank"]
        self.assertEqual([item["rank"]["level"] for item in ranks], [2, 3, 4, 5])
        self.assertTrue(all(item["points"] == 0 for item in ranks))
        self.assertIn("Naturgesetzen", ranks[1]["quote"]["de"])
        for item in queue["notices"]:
            for key in ("name", "condition", "reason"):
                self.assertEqual(set(item[key]), {"de", "en"})

    def test_retained_unlock_does_not_claim_later_higher_balancing_goal_was_met(self):
        self.store(self.payload())
        synchronize_hausdepp_progress(self.user.id)
        with session_scope() as db:
            db.add(HausdeppAchievementUnlock(user_id=self.user.id, achievement_id="hausdepp_03",
                                            source_game_id="round-1", unlocked_at=self.at, awarded_points=30))
        notice = next(item for item in pending_hausdepp_notices(self.user.id)["notices"]
                      if item["key"] == "achievement:hausdepp_03")
        self.assertFalse(notice["evidence"]["current_condition_proven"])
        self.assertEqual((notice["evidence"]["current"], notice["evidence"]["target"]), (1, 3))
        self.assertIn("damals", notice["reason"]["de"])
        self.assertIn("at the time", notice["reason"]["en"])

    def test_specific_stale_ack_cannot_hide_a_new_achievement_or_rank(self):
        self.store(self.payload())
        old = pending_hausdepp_notices(self.user.id)
        self.store(self.payload("new", flags=("hausdepp_18",)))
        for notice in old["notices"]:
            acknowledge_hausdepp_notice(self.user.id, notice["key"])
        new = pending_hausdepp_notices(self.user.id)
        self.assertIn("achievement:hausdepp_18", {item["key"] for item in new["notices"]})
        self.assertIn("rank:rank_03", {item["key"] for item in new["notices"]})

    def test_concurrent_repeated_ack_is_one_receipt_and_never_replays_xp(self):
        self.store(self.payload())
        before = pending_hausdepp_notices(self.user.id)
        with ThreadPoolExecutor(max_workers=3) as executor:
            results = list(executor.map(lambda _: acknowledge_hausdepp_notice(self.user.id, "achievement:hausdepp_01"), range(3)))
        self.assertTrue(all(result["acknowledged"] for result in results))
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppNoticeReceipt)), 1)
        self.assertEqual(pending_hausdepp_notices(self.user.id)["points"], before["points"])

    def test_no_foreign_or_unearned_award_can_be_acknowledged(self):
        self.store(self.payload(flags=("hausdepp_19",)))
        self.assertEqual(pending_hausdepp_notices(self.other.id)["notices"], [])
        for key in ("achievement:hausdepp_19", "rank:rank_24", "garbage", "rank:rank_01"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                acknowledge_hausdepp_notice(self.other.id, key)
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppNoticeReceipt)), 0)

    def test_http_identity_csrf_no_store_and_account_scoped_ack(self):
        self.store(self.payload(flags=("hausdepp_17",)))
        with TestClient(main.app) as client:
            url = "/api/hausdepp/progress-notices"
            ack = f"{url}/achievement:hausdepp_17/acknowledge"
            self.assertEqual(client.get(url).status_code, 401)
            self.assertEqual(client.post(ack).status_code, 401)
            identity, token = login(request_for(), self.user.username, "test-password-123")
            client.cookies.set("rollthedice_session", token)
            response = client.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(client.post(ack).status_code, 403)
            self.assertEqual(client.post(ack, headers={"X-CSRF-Token": identity.csrf_token}).status_code, 200)
            foreign, token = login(request_for(), self.other.username, "test-password-123")
            client.cookies.set("rollthedice_session", token)
            self.assertEqual(client.get(url + f"?user_id={self.user.id}").json()["notices"], [])
            self.assertEqual(client.post(ack, headers={"X-CSRF-Token": foreign.csrf_token}).status_code, 400)

    def test_migration_preserves_existing_credits_unlocks_and_summary_receipts(self):
        self.store(self.payload(flags=("hausdepp_17",)))
        progress = synchronize_hausdepp_progress(self.user.id)
        acknowledge_hausdepp_presentation(self.user.id, progress["presentation"]["revision"])
        tables = ("hausdepp_round_credits", "hausdepp_achievement_unlocks", "hausdepp_presentation_receipts")
        def snapshots():
            with session_scope() as db:
                return {table: [dict(row) for row in db.execute(text(f"SELECT * FROM {table}")).mappings()] for table in tables}
        before = snapshots()
        config = Config(str(main.BASE / "alembic.ini"))
        config.set_main_option("script_location", str(main.BASE / "alembic"))
        config.set_main_option("sqlalchemy.url", os.environ["ROLLTHEDICE_DATABASE_URL"])
        command.downgrade(config, "20261016_0061")
        command.upgrade(config, "head")
        self.assertEqual(snapshots(), before)
        self.assertEqual(len(pending_hausdepp_notices(self.user.id)["notices"]), 3)
