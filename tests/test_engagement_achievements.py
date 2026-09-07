"""Regression contracts for the post-rollout account-interaction awards."""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from alembic.config import Config
from sqlalchemy import select

from alembic import command
from app import main
from app.api_auth import UserPreferencesRequest, auth_update_preferences
from app.api_engagement import router as engagement_router
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.engagement import record_account_tab_engagement, record_engagement
from app.models import (
    UserAchievement,
    UserAvatar,
    UserEngagementEvent,
    ZilchAchievementUnlock,
)
from app.zilch_achievements import pending_zilch_awards
from tests.test_user_accounts import request_for


class EngagementAchievementTestCase(TestCase):
    """Account interactions fan out consistently without historic guessing."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "engagement.sqlite3"
        self.environment = patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.database_path}",
                "ROLLTHEDICE_COOKIE_DOMAIN": "",
                "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
                "ROLLTHEDICE_TURNSTILE_SECRET": "",
                "ROLLTHEDICE_ZILCH_ACCESS_MODE": "public",
                "ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "",
            },
        )
        self.environment.start()
        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)

    def tearDown(self) -> None:
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.temporary_directory.cleanup()

    def _config(self) -> Config:
        config = Config(str(main.BASE / "alembic.ini"))
        config.set_main_option("script_location", str(main.BASE / "alembic"))
        config.set_main_option("sqlalchemy.url", f"sqlite:///{self.database_path}")
        return config

    @staticmethod
    def _keys(rows) -> set[str]:
        return {str(row.achievement_key) for row in rows}

    def test_successful_settings_save_unlocks_both_collections(self) -> None:
        user = create_user("SettingsAward", "a-secure-password-123", must_change_password=False)
        identity, token = login(request_for(), user.username, "a-secure-password-123")
        request = request_for(cookie=f"rollthedice_session={token}", csrf=identity.csrf_token)

        auth_update_preferences(
            UserPreferencesRequest(
                announce_selection_mode="overlay",
                auto_write_announced=True,
                mobile_row_quick_entry=False,
                lobby_chat_popups=False,
                lobby_chat_enabled=True,
                preferred_language="en",
            ),
            request,
        )
        record_engagement(user.id, "game_switcher_used")

        with session_scope() as db:
            events = {row.event_key for row in db.scalars(select(UserEngagementEvent).where(
                UserEngagementEvent.user_id == user.id,
            ))}
            zdwa = self._keys(db.scalars(select(UserAchievement).where(UserAchievement.user_id == user.id)))
            zilch = self._keys(db.scalars(select(ZilchAchievementUnlock).where(
                ZilchAchievementUnlock.user_id == user.id,
            )))
        expected = {"settings_saved", "chat_settings_saved", "language_changed", "game_switcher_used"}
        self.assertTrue(expected <= events)
        self.assertTrue(expected <= zdwa)
        self.assertTrue({f"zilch.{key}" for key in expected} <= zilch)
        pending = pending_zilch_awards(user.id)
        self.assertEqual(pending["awards"], [])
        self.assertIsNone(pending["rank_upgrade"])

    def test_account_tab_mapping_has_no_free_form_award_key(self) -> None:
        user = create_user("TabAward", "a-secure-password-123", must_change_password=False)

        self.assertEqual(record_account_tab_engagement(user.id, "statistics")["event"], "statistics_viewed")
        self.assertEqual(record_account_tab_engagement(user.id, "avatar_changed"), {"recorded": False})
        routes = {getattr(route, "path", "") for route in engagement_router.routes}
        self.assertNotIn("/api/account/engagement", routes)
        self.assertIn("/api/account/engagement/account-tab/{tab}", routes)

        with session_scope() as db:
            events = list(db.scalars(select(UserEngagementEvent).where(UserEngagementEvent.user_id == user.id)))
        self.assertEqual([(event.event_key, event.count) for event in events], [("statistics_viewed", 1)])

    def test_avatar_backfill_is_idempotent_and_never_invents_a_change(self) -> None:
        user = create_user("ExistingAvatar", "a-secure-password-123", must_change_password=False)
        avatar_time = datetime(2026, 9, 6, 17, 23, 46, tzinfo=timezone.utc)
        with session_scope() as db:
            db.add(UserAvatar(
                user_id=user.id,
                data=b"avatar-fixture",
                sha256="a" * 64,
                updated_at=avatar_time,
            ))

        command.downgrade(self._config(), "20260907_0034")
        command.upgrade(self._config(), "head")
        command.upgrade(self._config(), "head")

        with session_scope() as db:
            events = list(db.scalars(select(UserEngagementEvent).where(UserEngagementEvent.user_id == user.id)))
            zdwa = list(db.scalars(select(UserAchievement).where(UserAchievement.user_id == user.id)))
            zilch = list(db.scalars(select(ZilchAchievementUnlock).where(
                ZilchAchievementUnlock.user_id == user.id,
            )))

        self.assertEqual([(row.event_key, row.count) for row in events], [("avatar_set", 1)])
        self.assertIn("avatar_set", self._keys(zdwa))
        self.assertNotIn("avatar_changed", self._keys(zdwa))
        self.assertEqual(self._keys(zilch), {"zilch.avatar_set"})
        zdwa_avatar = next(row for row in zdwa if row.achievement_key == "avatar_set")
        self.assertEqual(zdwa_avatar.unlocked_at.replace(tzinfo=timezone.utc), avatar_time)
        self.assertEqual(zilch[0].unlocked_at.replace(tzinfo=timezone.utc), avatar_time)
