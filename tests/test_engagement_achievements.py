"""Regression contracts for the post-rollout account-interaction awards."""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from alembic.config import Config
from fastapi import HTTPException
from sqlalchemy import select

from alembic import command
from app import main
from app.api_auth import (
    LanguagePreferenceRequest,
    UserPreferencesRequest,
    auth_update_language,
    auth_update_preferences,
)
from app.api_engagement import history_engagement
from app.api_engagement import router as engagement_router
from app.api_users import own_game_history, public_player_profile
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.engagement import record_account_tab_engagement, record_engagement
from app.models import (
    UserAchievement,
    UserAvatar,
    UserEngagementEvent,
    ZilchAchievementDelivery,
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

    def test_history_read_does_not_award_until_authenticated_visible_action(self) -> None:
        user = create_user("VisibleHistory", "a-secure-password-123", must_change_password=False)
        identity, token = login(request_for(), user.username, "a-secure-password-123")
        request = request_for(cookie=f"rollthedice_session={token}", csrf=identity.csrf_token)

        self.assertEqual(own_game_history(request)["games"], [])
        before = public_player_profile(user.username)["player"]["achievements"]["unlocked"]
        self.assertNotIn("history_viewed", {item["key"] for item in before})
        for unauthorized in (request_for(), request_for(cookie=f"rollthedice_session={token}")):
            with self.assertRaises(HTTPException):
                history_engagement(unauthorized)
        self.assertEqual(history_engagement(request), {"recorded": True, "event": "history_viewed"})
        with session_scope() as db:
            events = list(db.scalars(select(UserEngagementEvent).where(UserEngagementEvent.user_id == user.id)))
            zdwa = self._keys(db.scalars(select(UserAchievement).where(UserAchievement.user_id == user.id)))
            zilch = self._keys(db.scalars(select(ZilchAchievementUnlock).where(ZilchAchievementUnlock.user_id == user.id)))
        self.assertEqual([(event.event_key, event.count) for event in events], [("history_viewed", 1)])
        self.assertIn("history_viewed", zdwa)
        self.assertIn("zilch.history_viewed", zilch)

    def test_zdwa_bridge_navigation_records_rules_and_ranking_for_its_visitor(self) -> None:
        user = create_user("BridgeExplorer", "a-secure-password-123", must_change_password=False)
        _identity, token = login(request_for(), user.username, "a-secure-password-123")
        request = request_for(cookie=f"rollthedice_session={token}", host="zilch.zockdiewandan.online")
        for path in ("regeln", "spieler"):
            with self.subTest(path=path):
                self.assertEqual(main._serve_zilch_pwa_zdwa_bridge(request, path).status_code, 200)
        with session_scope() as db:
            events = {row.event_key for row in db.scalars(select(UserEngagementEvent).where(UserEngagementEvent.user_id == user.id))}
            zdwa = self._keys(db.scalars(select(UserAchievement).where(UserAchievement.user_id == user.id)))
            zilch = self._keys(db.scalars(select(ZilchAchievementUnlock).where(ZilchAchievementUnlock.user_id == user.id)))
        self.assertEqual(events, {"rules_viewed", "leaderboard_viewed"})
        self.assertTrue(events <= zdwa)
        self.assertTrue({f"zilch.{event}" for event in events} <= zilch)

    def test_dedicated_language_change_earns_settings_save_without_replay(self) -> None:
        user = create_user("LanguageExplorer", "a-secure-password-123", must_change_password=False)
        identity, token = login(request_for(), user.username, "a-secure-password-123")
        request = request_for(cookie=f"rollthedice_session={token}", csrf=identity.csrf_token)
        auth_update_language(LanguagePreferenceRequest(preferred_language="de"), request)
        with session_scope() as db:
            self.assertEqual(list(db.scalars(select(UserEngagementEvent).where(UserEngagementEvent.user_id == user.id))), [])
        auth_update_language(LanguagePreferenceRequest(preferred_language="en"), request)
        auth_update_language(LanguagePreferenceRequest(preferred_language="en"), request)
        with session_scope() as db:
            events = {row.event_key: row.count for row in db.scalars(select(UserEngagementEvent).where(UserEngagementEvent.user_id == user.id))}
        self.assertEqual(events, {"settings_saved": 1, "language_changed": 1})

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

    def test_stale_interaction_delivery_is_settled_without_touching_game_delivery(self) -> None:
        user = create_user("DeliveryRepair", "a-secure-password-123", must_change_password=False)
        delivery_time = datetime(2026, 9, 7, 15, 45, tzinfo=timezone.utc)
        with session_scope() as db:
            interaction = ZilchAchievementUnlock(
                user_id=user.id,
                achievement_key="zilch.leaderboard_viewed",
                definition_version=1,
                source_evidence_id=None,
                source_community_recipient_id=None,
                source_game_id=None,
                presentation_game_id=None,
                unlocked_at=delivery_time,
            )
            game = ZilchAchievementUnlock(
                user_id=user.id,
                achievement_key="zilch.first_game",
                definition_version=1,
                source_evidence_id=None,
                source_community_recipient_id=None,
                source_game_id="delivery-repair-game",
                presentation_game_id="delivery-repair-game",
                unlocked_at=delivery_time,
            )
            db.add_all((interaction, game))
            db.flush()
            db.add_all((
                ZilchAchievementDelivery(unlock_id=interaction.id, queued_at=delivery_time, acknowledged_at=None),
                ZilchAchievementDelivery(unlock_id=game.id, queued_at=delivery_time, acknowledged_at=None),
            ))

        command.downgrade(self._config(), "20260907_0035")
        command.upgrade(self._config(), "head")
        command.upgrade(self._config(), "head")

        with session_scope() as db:
            deliveries = {
                unlock.achievement_key: delivery
                for delivery, unlock in db.execute(
                    select(ZilchAchievementDelivery, ZilchAchievementUnlock)
                    .join(ZilchAchievementUnlock, ZilchAchievementDelivery.unlock_id == ZilchAchievementUnlock.id)
                    .where(ZilchAchievementUnlock.user_id == user.id)
                )
            }
        self.assertEqual(
            deliveries["zilch.leaderboard_viewed"].acknowledged_at.replace(tzinfo=timezone.utc),
            delivery_time,
        )
        self.assertIsNone(deliveries["zilch.first_game"].acknowledged_at)
