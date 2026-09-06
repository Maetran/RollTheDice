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
from app.game_activity import play_day, record_gameplay
from app.game_state import new_game
from app.game_ws_gameplay import handle_gameplay_action
from app.game_ws_session import GameSocketSession
from app.models import CompletedGame, GameParticipant, User, WebPushSubscription
from app.push_reminders import (
    REMINDER_COPY,
    claim_daily_reminder,
    dispatch_daily_reminders,
    reminder_day,
    reminder_payload,
    reminder_scheduled_at,
)
from app.web_push import (
    WebPushPreferencesRequest,
    game_invite_push_recipients,
    remove_web_push_subscriptions,
    save_web_push_subscription,
    update_web_push_preferences,
    web_push_subscription_status,
)
from app.zilch_gameplay import handle_zilch_gameplay_action
from app.zilch_snapshot import snapshot_zilch
from app.zilch_state import (
    configure_zilch_solo_game,
    current_zilch_turn,
    join_zilch_player,
    new_zilch_game,
    start_zilch_game,
)
from tests import test_web_push as fixtures
from tests.test_zilch_gameplay import RecordingSocket, action_with_option, sequence_rng


class DailyPushTestCase(unittest.TestCase):
    tearDown = fixtures.WebPushTestCase.tearDown

    def setUp(self) -> None:
        fixtures.WebPushTestCase.setUp(self)
        self.settings_patch = patch.dict(os.environ, {
            "ROLLTHEDICE_ZILCH_ACCESS_MODE": "public",
        })
        self.settings_patch.start()
        self.addCleanup(self.settings_patch.stop)
        self.player = create_user("DailyPlayer", "a-secure-password-123", must_change_password=False)
        self.now = datetime(2026, 9, 6, 18, 59, tzinfo=timezone.utc)  # 20:59 Europe/Zurich: every daily slot is due

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
        self.assertIsNone(claim_daily_reminder(self.player.id, self.now))
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
        self.assertIsNone(claim_daily_reminder(self.player.id, self.now))

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

    def test_swiss_window_tracks_dst_and_never_catches_up_outside_17_to_21(self) -> None:
        for month, utc_hour in ((1, 16), (3, 15), (9, 15), (10, 16)):
            start = datetime(2026, month, 29, utc_hour, tzinfo=timezone.utc)
            self.assertIsNone(reminder_day(start - timedelta(seconds=1)))
            self.assertEqual(reminder_day(start), start.date())
            self.assertEqual(reminder_day(start + timedelta(hours=4, seconds=-1)), start.date())
            self.assertIsNone(reminder_day(start + timedelta(hours=4)))
        self.assertEqual(play_day(datetime(2026, 9, 5, 22, tzinfo=timezone.utc)), date(2026, 9, 6))

    def test_random_schedule_is_stable_spread_out_and_only_claimed_when_due(self) -> None:
        day = self.now.date()
        slots = [reminder_scheduled_at(self.player.id, day + timedelta(days=offset)) for offset in range(90)]
        self.assertTrue(all(17 <= slot.hour < 21 for slot in slots))
        self.assertGreater(len({(slot.hour, slot.minute) for slot in slots}), 60)
        self.assertGreater(len({reminder_scheduled_at(user_id, day) for user_id in range(100)}), 60)
        self.subscribe()
        self.enable_daily()
        slot = reminder_scheduled_at(self.player.id, day)
        configure_database(Path(self.temporary_directory.name))
        self.assertEqual(reminder_scheduled_at(self.player.id, day), slot)
        self.assertIsNone(claim_daily_reminder(self.player.id, slot - timedelta(seconds=1)))
        self.assertIsNotNone(claim_daily_reminder(self.player.id, slot))
        self.assertIsNone(claim_daily_reminder(self.player.id, slot))

    def test_claim_is_atomic_persistent_and_not_reset_by_toggling_the_preference(self) -> None:
        self.subscribe()
        self.enable_daily()
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: claim_daily_reminder(self.player.id, self.now), range(6)))
        self.assertEqual(sum(result is not None for result in results), 1)
        configure_database(Path(self.temporary_directory.name))
        update_web_push_preferences(self.player.id, WebPushPreferencesRequest(game_invites_enabled=False, daily_reminder_enabled=False))
        self.enable_daily()
        self.assertIsNone(claim_daily_reminder(self.player.id, self.now))
        self.assertIsNotNone(claim_daily_reminder(self.player.id, self.now + timedelta(days=1)))

    def test_both_apps_alternate_without_two_reminders_and_all_copy_is_bilingual(self) -> None:
        self.subscribe("zdwa")
        self.subscribe("zilch", "two")
        self.enable_daily()
        games = []
        copies = {"zdwa": set(), "zilch": set()}
        for offset in range(64):
            # Skipped/played days must not jump over copy variants.
            reminder = claim_daily_reminder(self.player.id, reminder_scheduled_at(self.player.id, self.now.date() + timedelta(days=offset * 3)))
            games.append(reminder.game_type)
            copies[reminder.game_type].add(reminder.variant)
            self.assertEqual(len(reminder.subscriptions), 1)
            self.assertEqual(reminder.subscriptions[0].product_context, reminder.game_type)
            self.assertTrue(reminder_payload(reminder)["url"].endswith("/"))
            self.assertNotIn("/spiel/", reminder_payload(reminder)["url"])
        self.assertNotEqual(games[0], games[1])
        self.assertEqual(copies, {"zdwa": set(range(32)), "zilch": set(range(32))})
        for variants in REMINDER_COPY.values():
            self.assertEqual(len(variants), 32)
            self.assertEqual(len({pair[0] for pair in variants}), 32)
            self.assertEqual(len({pair[1] for pair in variants}), 32)
            for german, english in variants:
                self.assertTrue(german and english and german != english)
                self.assertLessEqual(max(len(german), len(english)), 160)

    def test_failures_consume_the_daily_slot_and_expired_endpoints_are_removed(self) -> None:
        self.subscribe()
        self.enable_daily()
        with patch.object(push_reminders, "_send_web_push", return_value=(False, False)) as send:
            self.assertEqual(asyncio.run(dispatch_daily_reminders(now=self.now.replace(hour=14))), 0)
            self.assertEqual(asyncio.run(dispatch_daily_reminders(now=self.now)), 1)
            self.assertEqual(asyncio.run(dispatch_daily_reminders(now=self.now)), 0)
            self.assertEqual(asyncio.run(dispatch_daily_reminders(now=self.now + timedelta(hours=1))), 0)
            send.assert_called_once()
            self.assertEqual(send.call_args.kwargs["ttl"], 60)
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
            self.assertIsNone(claim_daily_reminder(self.player.id, self.now))
        with session_scope() as db:
            db.get(User, self.player.id).is_active = False
        with patch.object(push_reminders, "_send_web_push") as send:
            self.assertEqual(asyncio.run(dispatch_daily_reminders(now=self.now)), 0)
            send.assert_not_called()

    def test_slow_batch_stops_at_21_and_caps_push_service_ttl(self) -> None:
        self.subscribe()
        self.subscribe(suffix="second-device")
        self.enable_daily()
        end = self.now + timedelta(seconds=59)
        with (
            patch.object(push_reminders, "utcnow", side_effect=[end, end, end, end + timedelta(seconds=2)]),
            patch.object(push_reminders, "_send_web_push", return_value=(True, False)) as send,
        ):
            self.assertEqual(asyncio.run(dispatch_daily_reminders()), 1)
            send.assert_called_once()
            self.assertEqual(send.call_args.kwargs["ttl"], 1)

    def test_played_today_suppresses_reminders_but_never_manual_invitations(self) -> None:
        self.subscribe()
        self.enable_daily(invites=True)
        with session_scope() as db:
            db.get(User, self.player.id).last_played_on = self.now.date()
        self.assertIsNone(claim_daily_reminder(self.player.id, self.now))
        with patch.object(push_reminders, "_send_web_push") as send:
            self.assertEqual(asyncio.run(dispatch_daily_reminders(now=self.now)), 0)
            send.assert_not_called()
        self.assertEqual([sub.user_id for sub in game_invite_push_recipients({"_game_type": "zdwa", "_players": []})], [self.player.id])
        self.assertIsNotNone(claim_daily_reminder(self.player.id, self.now + timedelta(days=1)))

    def test_playing_during_delivery_stops_remaining_devices(self) -> None:
        self.subscribe()
        self.subscribe(suffix="second-device")
        self.enable_daily()

        def send_and_play(*_args, **_kwargs):
            with session_scope() as db:
                db.get(User, self.player.id).last_played_on = self.now.date()
            return True, False

        with patch.object(push_reminders, "_send_web_push", side_effect=send_and_play) as send:
            self.assertEqual(asyncio.run(dispatch_daily_reminders(now=self.now)), 1)
            send.assert_called_once()

    def test_existing_completed_results_in_either_game_count_from_swiss_midnight(self) -> None:
        self.subscribe()
        self.enable_daily()
        for game_type in ("zdwa", "zilch"):
            with self.subTest(game_type=game_type), session_scope() as db:
                result = CompletedGame(
                    game_id=f"existing-{game_type}", game_type=game_type,
                    finished_at=self.now.replace(day=5, hour=22, minute=0), mode="solo", snapshot_json="{}", created_at=self.now,
                )
                result.participants = [GameParticipant(
                    position=0, player_key="p1", display_name=self.player.username, points=0, user_id=self.player.id,
                )]
                db.add(result)
            self.assertIsNone(claim_daily_reminder(self.player.id, self.now))
            with session_scope() as db:
                db.delete(db.query(CompletedGame).filter_by(game_id=f"existing-{game_type}").one())
        self.assertIsNotNone(claim_daily_reminder(self.player.id, self.now))

    def test_only_accepted_human_gameplay_counts_in_both_games(self) -> None:
        identity, _ = login(fixtures.request_for(token="missing", csrf="missing"), "DailyPlayer", "a-secure-password-123")
        for context in ("zdwa", "zilch"):
            with self.subTest(context=context):
                socket = RecordingSocket()
                game = (new_game if context == "zdwa" else new_zilch_game)("activity-game", "Activity game", "1")
                player = {"id": "p1", "name": self.player.username, "user_id": self.player.id, "ws": socket}
                if context == "zdwa":
                    game["_players"] = [player]
                    game["_started"] = True
                    game["_turn"] = {"player_id": "p1", "roll_index": 0}
                else:
                    configure_zilch_solo_game(game, host_user_id=self.player.id)
                    join_zilch_player(game, player)
                    start_zilch_game(game)
                session = GameSocketSession(websocket=socket, game=game, auth_identity=identity, player_id="p1")
                with session_scope() as db:
                    db.get(User, self.player.id).last_played_on = None
                if context == "zdwa":
                    session.player_id = "not-seated"
                    asyncio.run(handle_gameplay_action(session, "roll_dice", {}, finalize_game=lambda _game: {}))
                else:
                    asyncio.run(handle_zilch_gameplay_action(session, "zilch_roll_dice", {"turn_id": -1, "version": -1}))
                with session_scope() as db:
                    self.assertIsNone(db.get(User, self.player.id).last_played_on)
                session.player_id = "p1"
                with (
                    patch("app.game_activity.utcnow", return_value=self.now),
                    patch("app.zilch_gameplay.fair_zilch_randint", new=sequence_rng([5, 5, 5, 2, 3, 4])),
                ):
                    if context == "zdwa":
                        asyncio.run(handle_gameplay_action(session, "roll_dice", {}, finalize_game=lambda _game: {}))
                    else:
                        turn = current_zilch_turn(game)
                        asyncio.run(handle_zilch_gameplay_action(session, "zilch_roll_dice", {"turn_id": turn.turn_id, "version": turn.version}))
                with session_scope() as db:
                    self.assertEqual(db.get(User, self.player.id).last_played_on, self.now.date())
                # Resuming across midnight and scoring without another roll
                # counts as playing on the new calendar day as well.
                tomorrow = self.now + timedelta(days=1)
                with patch("app.game_activity.utcnow", return_value=tomorrow):
                    if context == "zdwa":
                        asyncio.run(handle_gameplay_action(session, "write_field", {"row": 0, "field": "free"}, finalize_game=lambda _game: {}))
                    else:
                        view = snapshot_zilch(game)
                        option = max(view["_zilch_quick_holds"], key=lambda candidate: candidate["points"])
                        asyncio.run(handle_zilch_gameplay_action(session, "zilch_bank_points", action_with_option("zilch_bank_points", view, option)))
                        self.assertNotIn("zilch_error", socket.messages[-1], socket.messages[-1])
                with session_scope() as db:
                    self.assertEqual(db.get(User, self.player.id).last_played_on, tomorrow.date())
                    db.get(User, self.player.id).last_played_on = None
                session.is_spectator = True
                record_gameplay(session)
                session.is_spectator = False
                session.auth_identity = None
                record_gameplay(session)
                with session_scope() as db:
                    self.assertIsNone(db.get(User, self.player.id).last_played_on)
