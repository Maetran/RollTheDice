"""Daily reminder consent, time window, anti-flood, copy and destination tests."""

from __future__ import annotations

import asyncio
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from app import push_reminders
from app.api_auth import web_push_preferences_put
from app.auth import create_user, login
from app.database import configure_database, session_scope
from app.models import User, WebPushSubscription
from app.push_reminders import (
    REMINDER_COPY,
    claim_daily_reminder,
    dispatch_daily_reminders,
    reminder_day,
    reminder_payload,
)
from app.web_push import (
    WebPushPreferencesRequest,
    game_invite_push_recipients,
    remove_web_push_subscriptions,
    save_web_push_subscription,
    update_web_push_preferences,
    web_push_subscription_status,
)
from tests import test_web_push as fixtures


class DailyPushTestCase(unittest.TestCase):
    tearDown = fixtures.WebPushTestCase.tearDown

    def setUp(self) -> None:
        fixtures.WebPushTestCase.setUp(self)
        self.settings_patch = patch.dict(os.environ, {
            "ROLLTHEDICE_DAILY_REMINDER_HOUR": "18", "ROLLTHEDICE_ZILCH_ACCESS_MODE": "public",
        })
        self.settings_patch.start()
        self.addCleanup(self.settings_patch.stop)
        self.player = create_user("DailyPlayer", "a-secure-password-123", must_change_password=False)
        self.now = datetime(2026, 9, 6, 16, tzinfo=timezone.utc)  # 18:00 Europe/Zurich

    def subscribe(self, context: str = "zdwa", suffix: str = "one") -> None:
        save_web_push_subscription(
            user_id=self.player.id,
            payload=fixtures.WebPushTestCase.subscription(f"https://fcm.googleapis.com/fcm/send/{suffix}"),
            product_context=context,
        )

    def enable_daily(self, *, invites: bool = False) -> None:
        update_web_push_preferences(self.player.id, WebPushPreferencesRequest(
            game_invites_enabled=invites, daily_reminder_enabled=True,
        ))

    def test_daily_is_separate_opt_in_and_all_push_can_be_disabled(self) -> None:
        with self.assertRaises(ValueError):
            self.enable_daily()
        self.subscribe()
        self.assertFalse(web_push_subscription_status(self.player.id)["daily_reminder_enabled"])
        self.assertIsNone(claim_daily_reminder(self.player.id, self.now.date()))
        self.enable_daily()
        status = web_push_subscription_status(self.player.id)
        self.assertTrue(status["daily_reminder_enabled"])
        self.assertFalse(status["game_invites_enabled"])
        self.assertEqual(game_invite_push_recipients({"_game_type": "zdwa", "_players": []}), [])
        self.subscribe("zilch", "two")
        self.assertFalse(web_push_subscription_status(self.player.id)["game_invites_enabled"])
        removed = remove_web_push_subscriptions(self.player.id)
        self.assertFalse(removed["daily_reminder_enabled"])
        self.assertFalse(removed["subscribed"])
        self.assertIsNone(claim_daily_reminder(self.player.id, self.now.date()))

    def test_preference_endpoint_requires_auth_and_csrf_and_accepts_reminders_only(self) -> None:
        payload = WebPushPreferencesRequest(game_invites_enabled=False, daily_reminder_enabled=True)
        with self.assertRaises(HTTPException) as denied:
            web_push_preferences_put(payload, fixtures.request_for(token="missing", csrf="missing"))
        self.assertEqual(denied.exception.status_code, 401)
        identity, token = login(fixtures.request_for(token="missing", csrf="missing"), "DailyPlayer", "a-secure-password-123")
        with self.assertRaises(HTTPException) as denied:
            web_push_preferences_put(payload, fixtures.request_for(token=token, csrf="wrong"))
        self.assertEqual(denied.exception.status_code, 403)
        self.subscribe()
        result = web_push_preferences_put(payload, fixtures.request_for(token=token, csrf=identity.csrf_token))
        self.assertTrue(result["daily_reminder_enabled"])
        self.assertFalse(result["game_invites_enabled"])

    def test_swiss_time_window_tracks_dst_and_never_catches_up_outside_the_hour(self) -> None:
        self.assertIsNone(reminder_day(self.now - timedelta(seconds=1)))
        self.assertEqual(reminder_day(self.now), date(2026, 9, 6))
        self.assertEqual(reminder_day(self.now + timedelta(minutes=59)), date(2026, 9, 6))
        self.assertIsNone(reminder_day(self.now + timedelta(hours=1)))
        self.assertEqual(reminder_day(datetime(2026, 1, 6, 17, tzinfo=timezone.utc)), date(2026, 1, 6))
        with patch.dict(os.environ, {"ROLLTHEDICE_DAILY_REMINDER_HOUR": "19"}):
            self.assertIsNone(reminder_day(self.now))
            self.assertEqual(reminder_day(self.now + timedelta(hours=1)), self.now.date())

    def test_claim_is_atomic_persistent_and_not_reset_by_toggling_the_preference(self) -> None:
        self.subscribe()
        self.enable_daily()
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: claim_daily_reminder(self.player.id, self.now.date()), range(6)))
        self.assertEqual(sum(result is not None for result in results), 1)
        configure_database(Path(self.temporary_directory.name))
        update_web_push_preferences(self.player.id, WebPushPreferencesRequest(game_invites_enabled=False, daily_reminder_enabled=False))
        self.enable_daily()
        self.assertIsNone(claim_daily_reminder(self.player.id, self.now.date()))
        self.assertIsNotNone(claim_daily_reminder(self.player.id, self.now.date() + timedelta(days=1)))

    def test_both_apps_alternate_without_two_reminders_and_all_copy_is_bilingual(self) -> None:
        self.subscribe("zdwa")
        self.subscribe("zilch", "two")
        self.enable_daily()
        games = []
        copies = {"zdwa": set(), "zilch": set()}
        for offset in range(12):
            reminder = claim_daily_reminder(self.player.id, self.now.date() + timedelta(days=offset))
            games.append(reminder.game_type)
            copies[reminder.game_type].add(reminder.variant)
            self.assertEqual(len(reminder.subscriptions), 1)
            self.assertEqual(reminder.subscriptions[0].product_context, reminder.game_type)
            self.assertTrue(reminder_payload(reminder)["url"].endswith("/"))
            self.assertNotIn("/spiel/", reminder_payload(reminder)["url"])
        self.assertNotEqual(games[0], games[1])
        self.assertEqual(copies, {"zdwa": set(range(6)), "zilch": set(range(6))})
        for variants in REMINDER_COPY.values():
            for german, english in variants:
                self.assertTrue(german and english and german != english)

    def test_failures_consume_the_daily_slot_and_expired_endpoints_are_removed(self) -> None:
        self.subscribe()
        self.enable_daily()
        with patch.object(push_reminders, "_send_web_push", return_value=(False, False)) as send:
            self.assertEqual(asyncio.run(dispatch_daily_reminders(now=self.now - timedelta(seconds=1))), 0)
            self.assertEqual(asyncio.run(dispatch_daily_reminders(now=self.now)), 1)
            self.assertEqual(asyncio.run(dispatch_daily_reminders(now=self.now)), 0)
            self.assertEqual(asyncio.run(dispatch_daily_reminders(now=self.now + timedelta(hours=1))), 0)
            send.assert_called_once()
            self.assertEqual(send.call_args.kwargs["ttl"], 3600)
        with patch.object(push_reminders, "_send_web_push", return_value=(False, True)):
            self.assertEqual(asyncio.run(dispatch_daily_reminders(now=self.now + timedelta(days=1))), 1)
        with session_scope() as db:
            self.assertEqual(db.query(WebPushSubscription).count(), 0)

    def test_opt_out_during_delivery_stops_remaining_devices(self) -> None:
        self.subscribe()
        self.subscribe(suffix="second-device")
        self.enable_daily()

        def send_and_opt_out(*_args, **_kwargs):
            remove_web_push_subscriptions(self.player.id)
            return True, False

        with patch.object(push_reminders, "_send_web_push", side_effect=send_and_opt_out) as send:
            self.assertEqual(asyncio.run(dispatch_daily_reminders(now=self.now)), 1)
            send.assert_called_once()

    def test_inactive_or_preview_excluded_accounts_are_not_reminded(self) -> None:
        self.subscribe("zilch")
        self.enable_daily()
        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_ACCESS_MODE": "preview"}):
            self.assertIsNone(claim_daily_reminder(self.player.id, self.now.date()))
        with session_scope() as db:
            db.get(User, self.player.id).is_active = False
        with patch.object(push_reminders, "_send_web_push") as send:
            self.assertEqual(asyncio.run(dispatch_daily_reminders(now=self.now)), 0)
            send.assert_not_called()

    def test_slow_batch_stops_when_the_configured_hour_ends(self) -> None:
        self.subscribe()
        self.subscribe(suffix="second-device")
        self.enable_daily()
        end = self.now + timedelta(minutes=59, seconds=59)
        with (
            patch.object(push_reminders, "utcnow", side_effect=[end, end, end, end + timedelta(seconds=2)]),
            patch.object(push_reminders, "_send_web_push", return_value=(True, False)) as send,
        ):
            self.assertEqual(asyncio.run(dispatch_daily_reminders()), 1)
            send.assert_called_once()
