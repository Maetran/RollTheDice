"""Real database races between a profile read and account-tab award syncing."""

from __future__ import annotations

import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from unittest import TestCase
from unittest.mock import patch

from sqlalchemy import event, select

from app import main
from app.achievements import sync_engagement_achievements_for_users
from app.api_users import public_player_profile
from app.auth import create_user
from app.database import configure_database, get_engine, session_scope, upgrade_database
from app.models import UserAchievement, UserEngagementEvent
from app.security import utcnow


class AchievementSyncConcurrencyTest(TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.directory.name}/achievement-race.sqlite3",
        })
        self.environment.start()
        configure_database(Path(self.directory.name))
        upgrade_database(main.BASE)
        self.user = create_user("Parallel_Profile", "a-secure-password-123", must_change_password=False)
        self.event_time = utcnow()
        with session_scope() as db:
            db.add(UserEngagementEvent(
                user_id=self.user.id, event_key="statistics_viewed", count=1,
                first_seen_at=self.event_time, last_seen_at=self.event_time,
            ))

    def tearDown(self):
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.directory.cleanup()

    def test_profile_and_tab_sync_can_unlock_the_same_achievement_concurrently(self):
        inserts_ready = Barrier(2)

        def synchronize_award_inserts(_connection, _cursor, statement, parameters, _context, _many):
            if statement.startswith("INSERT INTO user_achievements") and "statistics_viewed" in parameters:
                # Both transactions observed the award as missing. Stop before
                # either SQL INSERT runs, reproducing the browser race without
                # sleeps, retries or a mocked database/achievement result.
                inserts_ready.wait(timeout=5)

        engine = get_engine()
        event.listen(engine, "before_cursor_execute", synchronize_award_inserts)
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                profile = pool.submit(public_player_profile, self.user.username)
                engagement = pool.submit(sync_engagement_achievements_for_users, {self.user.id})
                payload = profile.result(timeout=10)
                engagement.result(timeout=10)
        finally:
            event.remove(engine, "before_cursor_execute", synchronize_award_inserts)

        keys = [item["key"] for item in payload["player"]["achievements"]["unlocked"]]
        self.assertEqual(keys.count("statistics_viewed"), 1)
        self.assertNotIn("history_viewed", keys)
        with session_scope() as db:
            rows = list(db.scalars(select(UserAchievement).where(
                UserAchievement.user_id == self.user.id, UserAchievement.achievement_key == "statistics_viewed",
            )))
            self.assertEqual(len(rows), 1)
            original_unlocked_at = rows[0].unlocked_at
        sync_engagement_achievements_for_users({self.user.id})
        public_player_profile(self.user.username)
        with session_scope() as db:
            award = db.scalar(select(UserAchievement).where(
                UserAchievement.user_id == self.user.id, UserAchievement.achievement_key == "statistics_viewed",
            ))
            self.assertEqual(award.unlocked_at, original_unlocked_at)
            self.assertIsNone(award.source_completed_game_id)
