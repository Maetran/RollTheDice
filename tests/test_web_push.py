"""Contracts for opt-in waiting-room Web Push invitations."""

from __future__ import annotations

import asyncio
import base64
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException, Response
from starlette.requests import Request

from app import main
from app.api_auth import web_push_opt_in_prompt_post
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.models import User, WebPushSubscription
from app.web_push import (
    GameInviteDispatch,
    StoredSubscription,
    WebPushPreferencesRequest,
    WebPushSubscriptionKeys,
    WebPushSubscriptionRequest,
    _send_web_push,
    claim_game_invite_push,
    claim_web_push_opt_in_prompt,
    game_invite_cooldown_remaining,
    game_invite_notification_payload,
    game_invite_push_recipients,
    remove_web_push_subscriptions,
    save_web_push_subscription,
    update_web_push_preferences,
)


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


TEST_VAPID_PUBLIC_KEY = _base64url(b"\x04" + (b"\x01" * 64))
TEST_SUBSCRIPTION_KEY = _base64url(b"\x04" + (b"\x02" * 64))
TEST_AUTH_SECRET = _base64url(b"\x03" * 16)


def request_for(*, token: str, csrf: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "scheme": "http",
            "path": "/api/games/push-game/notify-open-seat",
            "headers": [
                (b"host", b"testserver"),
                (b"cookie", f"rollthedice_session={token}".encode("ascii")),
                (b"x-csrf-token", csrf.encode("ascii")),
            ],
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 80),
        }
    )


class WebPushTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        database_path = Path(self.temporary_directory.name) / "web-push.sqlite3"
        self.env_patch = patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{database_path}",
                "ROLLTHEDICE_COOKIE_DOMAIN": "",
                "ROLLTHEDICE_COOKIE_SECURE": "0",
                "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
                "ROLLTHEDICE_TURNSTILE_SECRET": "",
                "ROLLTHEDICE_WEB_PUSH_VAPID_PUBLIC_KEY": TEST_VAPID_PUBLIC_KEY,
                "ROLLTHEDICE_WEB_PUSH_VAPID_PRIVATE_KEY": "test-private-key",
                "ROLLTHEDICE_WEB_PUSH_VAPID_SUBJECT": "mailto:test@example.com",
            },
            clear=False,
        )
        self.env_patch.start()
        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)

    def tearDown(self) -> None:
        self.env_patch.stop()
        configure_database(main.DATA_DIR)
        self.temporary_directory.cleanup()

    @staticmethod
    def subscription(endpoint: str = "https://fcm.googleapis.com/fcm/send/test-endpoint") -> WebPushSubscriptionRequest:
        return WebPushSubscriptionRequest(
            endpoint=endpoint,
            keys=WebPushSubscriptionKeys(p256dh=TEST_SUBSCRIPTION_KEY, auth=TEST_AUTH_SECRET),
        )

    def test_subscription_prepares_a_device_and_removing_it_is_an_account_wide_opt_out(self) -> None:
        player = create_user("PushPlayer", "a-secure-password-123", must_change_password=False)

        saved = save_web_push_subscription(
            user_id=player.id,
            payload=self.subscription(),
            product_context="zilch",
        )
        self.assertTrue(saved["available"] and saved["subscribed"])
        self.assertFalse(saved["enabled"])
        self.assertFalse(saved["game_invites_enabled"])
        self.assertFalse(saved["daily_reminder_enabled"])
        with session_scope() as db:
            subscription = db.query(WebPushSubscription).one()
            self.assertEqual(subscription.user_id, player.id)
            self.assertEqual(subscription.product_context, "zilch")
            user = db.get(type(player), player.id)
            self.assertFalse(user.game_invite_push_enabled)
            self.assertIsNotNone(user.push_opt_in_prompted_at)

        removed = remove_web_push_subscriptions(player.id)
        self.assertEqual(removed["enabled"], False)
        with session_scope() as db:
            self.assertEqual(db.query(WebPushSubscription).count(), 0)
            self.assertFalse(db.get(type(player), player.id).game_invite_push_enabled)

    def test_opt_in_prompt_is_atomic_account_wide_and_requires_authentication(self) -> None:
        player = create_user("GentlePrompt", "a-secure-password-123", must_change_password=False)
        now = datetime(2026, 9, 6, 12, tzinfo=timezone.utc)
        with patch("app.web_push.utcnow", return_value=now), ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(claim_web_push_opt_in_prompt, [player.id] * 6))
        self.assertEqual(sum(result["show"] for result in results), 1)
        self.assertTrue(all(result["interval_days"] == 14 for result in results))
        with patch("app.web_push.utcnow", return_value=now + timedelta(days=13, hours=23, minutes=59)):
            self.assertFalse(claim_web_push_opt_in_prompt(player.id)["show"])
        with patch("app.web_push.utcnow", return_value=now + timedelta(days=14)):
            self.assertTrue(claim_web_push_opt_in_prompt(player.id)["show"])

        save_web_push_subscription(user_id=player.id, payload=self.subscription(), product_context="zdwa")
        update_web_push_preferences(player.id, WebPushPreferencesRequest(
            game_invites_enabled=True, daily_reminder_enabled=False, release_notifications_enabled=False,
        ))
        with patch("app.web_push.utcnow", return_value=now + timedelta(days=28)):
            self.assertFalse(claim_web_push_opt_in_prompt(player.id)["show"])
        with session_scope() as db:
            db.query(WebPushSubscription).delete()
            db.get(User, player.id).push_opt_in_prompted_at = now + timedelta(days=13)
        with patch("app.web_push.utcnow", return_value=now + timedelta(days=28)):
            self.assertTrue(claim_web_push_opt_in_prompt(player.id)["show"])
        # Restore a device so the explicit account-wide opt-out below can
        # exercise its own fresh 14-day cooldown.
        save_web_push_subscription(user_id=player.id, payload=self.subscription(), product_context="zdwa")
        with patch("app.web_push.utcnow", return_value=now + timedelta(days=28)):
            self.assertFalse(claim_web_push_opt_in_prompt(player.id)["show"])
            remove_web_push_subscriptions(player.id)
        with patch("app.web_push.utcnow", return_value=now + timedelta(days=28, seconds=1)):
            self.assertFalse(claim_web_push_opt_in_prompt(player.id)["show"])

        guest = request_for(token="missing", csrf="missing")
        with self.assertRaises(HTTPException) as denied:
            web_push_opt_in_prompt_post(guest, Response())
        self.assertEqual(denied.exception.status_code, 401)
        identity, token = login(guest, "GentlePrompt", "a-secure-password-123")
        with self.assertRaises(HTTPException) as denied:
            web_push_opt_in_prompt_post(request_for(token=token, csrf="wrong"), Response())
        self.assertEqual(denied.exception.status_code, 403)
        with session_scope() as db:
            db.get(User, player.id).game_invite_push_enabled = False
            db.get(User, player.id).push_opt_in_prompted_at = now - timedelta(days=14)
        response = Response()
        with patch("app.web_push.utcnow", return_value=now):
            result = web_push_opt_in_prompt_post(request_for(token=token, csrf=identity.csrf_token), response)
        self.assertTrue(result["show"])
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_only_opted_in_unseated_accounts_receive_a_public_room_invitation(self) -> None:
        seated = create_user("Seated", "a-secure-password-123", must_change_password=False)
        recipient = create_user("Recipient", "another-secure-password-123", must_change_password=False)
        opted_out = create_user("OptedOut", "third-secure-password-123", must_change_password=False)
        save_web_push_subscription(user_id=recipient.id, payload=self.subscription(), product_context="zdwa")
        update_web_push_preferences(recipient.id, WebPushPreferencesRequest(
            game_invites_enabled=True, daily_reminder_enabled=False,
        ))
        save_web_push_subscription(
            user_id=opted_out.id,
            payload=self.subscription("https://fcm.googleapis.com/fcm/send/other-endpoint"),
            product_context="zdwa",
        )
        remove_web_push_subscriptions(opted_out.id)

        recipients = game_invite_push_recipients(
            {
                "_id": "push-game",
                "_game_type": "zdwa",
                "_expected": 3,
                "_players": [{"id": "seat", "name": "Seated", "user_id": seated.id}],
            }
        )
        self.assertEqual([item.user_id for item in recipients], [recipient.id])

    def test_payload_uses_joined_names_and_correct_singular_or_plural_grammar(self) -> None:
        single = {
            "_id": "single",
            "_game_type": "zilch",
            "_expected": 2,
            "_players": [{"id": "a", "name": "Anna", "user_id": 1}],
        }
        plural = {
            "_id": "plural",
            "_game_type": "zdwa",
            "_expected": 3,
            "_players": [
                {"id": "a", "name": "Anna", "user_id": 1},
                {"id": "b", "name": "Ben", "user_id": 2},
            ],
        }
        self.assertEqual(
            game_invite_notification_payload(
                game=single, destination="https://example.test/zilch/spiel/single", language="de", product_context="zilch"
            )["body"],
            "Anna wartet in Zilch auf einen zweiten Mitspieler. Sei dabei!",
        )
        self.assertEqual(
            game_invite_notification_payload(
                game=plural, destination="https://example.test/spiel/plural", language="en", product_context="zdwa"
            )["body"],
            "Anna and Ben are waiting in ZDWA for a third player. Join in!",
        )

    def test_endpoint_marks_a_room_cooldown_before_dispatching(self) -> None:
        player = create_user("PushSender", "a-secure-password-123", must_change_password=False)
        identity, token = login(
            request_for(token="placeholder", csrf="placeholder"),
            "PushSender",
            "a-secure-password-123",
        )
        request = request_for(token=token, csrf=identity.csrf_token)
        game = {
            "_id": "push-game",
            "_game_type": "zdwa",
            "_expected": 2,
            "_players": [{"id": "sender", "name": "PushSender", "user_id": player.id}],
            "_started": False,
            "_finished": False,
            "_aborted": False,
        }
        subscription = StoredSubscription(
            id=1,
            user_id=999,
            endpoint="https://fcm.googleapis.com/fcm/send/test-endpoint",
            p256dh=TEST_SUBSCRIPTION_KEY,
            auth=TEST_AUTH_SECRET,
            product_context="zdwa",
            preferred_language="de",
        )
        dispatch = AsyncMock(return_value=GameInviteDispatch(attempted=1, accepted=1, expired=0))
        with (
            patch.object(main, "games", {"push-game": game}),
            patch.object(main, "web_push_available", return_value=True),
            patch.object(main, "sweep_timeouts"),
            patch.object(main, "can_access_game", return_value=True),
            patch.object(main, "game_invite_push_recipients", return_value=[subscription]),
            patch.object(main, "save_active_game"),
            patch.object(main, "dispatch_game_invite_push", dispatch),
        ):
            result = asyncio.run(main.api_game_notify_open_seat("push-game", request))
            self.assertEqual(result, {"ok": True, "notified": True})
            self.assertGreater(game_invite_cooldown_remaining(game), 0)
            dispatch.assert_awaited_once_with(game, [subscription], sender_user_id=player.id)
            with self.assertRaises(HTTPException) as rejected:
                asyncio.run(main.api_game_notify_open_seat("push-game", request))

        self.assertEqual(rejected.exception.status_code, 429)
        self.assertEqual(rejected.exception.detail["code"], "game_invite_cooldown")

    def test_account_cooldown_is_atomic_and_survives_reconnects_and_restarts(self) -> None:
        player = create_user("PushFlood", "a-secure-password-123", must_change_password=False)
        now = datetime(2026, 9, 6, 12, tzinfo=timezone.utc)
        with patch("app.web_push.utcnow", return_value=now), ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(claim_game_invite_push, [player.id] * 6))
        self.assertEqual(sorted(results), [0, 60, 60, 60, 60, 60])

        # Dispose/reopen the database, as on a process restart. Sessions and
        # game rooms are deliberately not part of this persistent barrier.
        configure_database(Path(self.temporary_directory.name))
        with patch("app.web_push.utcnow", return_value=now + timedelta(seconds=59, milliseconds=100)):
            self.assertEqual(claim_game_invite_push(player.id), 1)
        with patch("app.web_push.utcnow", return_value=now + timedelta(seconds=60)):
            self.assertEqual(claim_game_invite_push(player.id), 0)

    def test_empty_recipient_attempt_still_limits_same_account_across_games(self) -> None:
        player = create_user("AcrossGames", "a-secure-password-123", must_change_password=False)
        identity, token = login(request_for(token="placeholder", csrf="placeholder"), "AcrossGames", "a-secure-password-123")
        request = request_for(token=token, csrf=identity.csrf_token)
        zdwa = {"_id": "one", "_game_type": "zdwa", "_expected": 2, "_players": [{"user_id": player.id}]}
        zilch = {**zdwa, "_id": "two", "_game_type": "zilch"}
        with (
            patch.object(main, "games", {"one": zdwa, "two": zilch}),
            patch.object(main, "sweep_timeouts"),
            patch.object(main, "can_access_game", return_value=True),
            patch.object(main, "game_invite_push_recipients", return_value=[]),
            patch.object(main, "dispatch_game_invite_push", new_callable=AsyncMock) as dispatch,
        ):
            self.assertEqual(asyncio.run(main.api_game_notify_open_seat("one", request)), {"ok": True, "notified": False})
            with self.assertRaises(HTTPException) as rejected:
                asyncio.run(main.api_game_notify_open_seat("two", request))
            self.assertEqual(rejected.exception.status_code, 429)
            self.assertEqual(rejected.exception.detail["code"], "game_invite_account_cooldown")
            self.assertGreater(int(rejected.exception.headers["Retry-After"]), 0)
            dispatch.assert_not_called()

    def test_unsafe_room_requests_do_not_consume_a_push_slot(self) -> None:
        player = create_user("PrivatePush", "a-secure-password-123", must_change_password=False)
        identity, token = login(request_for(token="placeholder", csrf="placeholder"), "PrivatePush", "a-secure-password-123")
        request = request_for(token=token, csrf=identity.csrf_token)
        room = {"_id": "private", "_expected": 2, "_passphrase": "secret", "_players": [{"user_id": player.id}]}
        with (
            patch.object(main, "games", {"private": room}),
            patch.object(main, "sweep_timeouts"),
            patch.object(main, "can_access_game", return_value=True),
            patch.object(main, "claim_game_invite_push") as claim,
        ):
            with self.assertRaises(HTTPException) as rejected:
                asyncio.run(main.api_game_notify_open_seat("private", request))
            self.assertEqual(rejected.exception.detail, "game_invite_private_room")
            claim.assert_not_called()

    def test_real_push_encryption_and_signing_without_contacting_a_push_service(self) -> None:
        sender = ec.generate_private_key(ec.SECP256R1())
        recipient = ec.generate_private_key(ec.SECP256R1())
        private_key = _base64url(sender.private_bytes(
            serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption(),
        ))
        public_key = _base64url(recipient.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint,
        ))
        subscription = StoredSubscription(
            id=99, user_id=99, endpoint="https://fcm.googleapis.com/fcm/send/encryption-test",
            p256dh=public_key, auth=TEST_AUTH_SECRET, product_context="zdwa", preferred_language="de",
        )
        with patch.dict(os.environ, {"ROLLTHEDICE_WEB_PUSH_VAPID_PRIVATE_KEY": private_key}):
            for status, expected in [(201, (True, False)), (410, (False, True)), (500, (False, False))]:
                with self.subTest(status=status), patch("requests.post", return_value=Mock(status_code=status)) as post:
                    self.assertEqual(_send_web_push(subscription, {"title": "Test", "body": "Hallo"}), expected)
                    post.assert_called_once()
                    kwargs = post.call_args.kwargs
                    self.assertIn("vapid", kwargs["headers"]["authorization"])
                    self.assertNotIn(b"Hallo", kwargs["data"])
                    self.assertEqual(kwargs["timeout"], 8)
