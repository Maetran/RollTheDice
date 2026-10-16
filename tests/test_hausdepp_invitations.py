"""Private Hausdepp invitations reuse suite consent without widening its audience."""

from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app import main, web_push
from app.auth import create_user, login
from app.database import session_scope
from app.hausdepp_state import configure_hausdepp_game, join_hausdepp_player, new_hausdepp_game
from app.models import User
from app.ownership import bind_founder
from app.web_push import (
    WebPushPreferencesRequest,
    dispatch_game_invite_push,
    game_invite_destinations,
    game_invite_notification_payload,
    game_invite_push_recipients,
    open_seat_invitation_error,
    save_web_push_subscription,
    update_web_push_preferences,
)
from tests import test_web_push as fixtures
from tests.test_web_push import request_for


class HausdeppInvitationTests(unittest.TestCase):
    def setUp(self):
        fixtures.WebPushTestCase.setUp(self)
        self.registry = patch.dict(main.games, clear=True)
        self.registry.start()
        self.addCleanup(self.registry.stop)
        self.founder = create_user("InviteFounder", "test-password-123", role="admin", must_change_password=False)
        self.friend = create_user("InviteLocalFriend", "test-password-123", must_change_password=False)
        self.stranger = create_user("InviteOtherAdmin", "test-password-123", role="admin", must_change_password=False)
        with session_scope() as db:
            bind_founder(db, self.founder.id)
        self.identity, self.token = login(request_for(token="", csrf=""), self.founder.username, "test-password-123")
        self.request = request_for(token=self.token, csrf=self.identity.csrf_token)
        for user in (self.founder, self.friend, self.stranger):
            save_web_push_subscription(user_id=user.id, payload=fixtures.WebPushTestCase.subscription(
                f"https://fcm.googleapis.com/fcm/send/invite-{user.id}"), product_context="zilch")
            update_web_push_preferences(user.id, WebPushPreferencesRequest(
                game_invites_enabled=True, daily_reminder_enabled=False,
            ))
        self.game = new_hausdepp_game("haus-push", "Private table", "6")
        configure_hausdepp_game(self.game, host_user_id=self.founder.id, cpu_count=4)
        join_hausdepp_player(self.game, {"id": "host", "name": self.founder.username,
                                       "user_id": self.founder.id, "ws": None})
        self.send_patch = patch.object(web_push, "_send_web_push", return_value=(True, False))
        self.send = self.send_patch.start()
        self.addCleanup(self.send_patch.stop)

    tearDown = fixtures.WebPushTestCase.tearDown

    def local_cohort(self):
        # As in the real local multiplayer test, this bounded override grants
        # exactly the two fixture accounts. It creates no runtime allowlist.
        return patch.object(web_push, "_hausdepp_push_account_ids", return_value={self.founder.id, self.friend.id})

    def test_public_active_accounts_are_eligible_and_disabled_sender_is_rejected_before_subscription_lookup(self):
        self.assertEqual({row.user_id for row in game_invite_push_recipients(self.game, sender_user_id=self.founder.id)}, {self.friend.id, self.stranger.id})
        self.game["_players"].append({"id": "other", "name": "Other", "user_id": self.stranger.id})
        self.game["_expected_connections"] = 3
        with session_scope() as db:
            db.get(User, self.stranger.id).is_active = False
        with patch.object(web_push, "invitation_sender_allowed", side_effect=AssertionError("subscription query must not run")):
            self.assertEqual(game_invite_push_recipients(self.game, sender_user_id=self.stranger.id), [])
        self.assertEqual(game_invite_push_recipients(self.game), [])
        self.send.assert_not_called()

    def test_local_fixture_targets_only_opted_in_authorized_other_accounts_and_rechecks_before_dispatch(self):
        with self.local_cohort():
            recipients = game_invite_push_recipients(self.game, sender_user_id=self.founder.id)
            self.assertEqual([row.user_id for row in recipients], [self.friend.id])
            result = asyncio.run(dispatch_game_invite_push(self.game, recipients, sender_user_id=self.founder.id))
            self.assertEqual((result.attempted, result.accepted), (1, 1))
        # Fresh durable deactivation after the recipient snapshot blocks dispatch.
        with session_scope() as db:
            db.get(User, self.friend.id).is_active = False
        result = asyncio.run(dispatch_game_invite_push(self.game, recipients, sender_user_id=self.founder.id))
        self.assertEqual(result.attempted, 0)
        self.send.assert_called_once()
        self.send.reset_mock()
        with session_scope() as db:
            db.get(User, self.friend.id).is_active = True
        with patch.object(web_push, "_hausdepp_push_account_ids", return_value={self.friend.id}):
            result = asyncio.run(dispatch_game_invite_push(self.game, recipients, sender_user_id=self.founder.id))
            self.assertEqual(result.attempted, 0)
        self.send.assert_not_called()
        with self.local_cohort():
            update_web_push_preferences(self.friend.id, WebPushPreferencesRequest(
                game_invites_enabled=False, daily_reminder_enabled=False,
            ))
            self.assertEqual(asyncio.run(dispatch_game_invite_push(
                self.game, recipients, sender_user_id=self.founder.id)).attempted, 0)
        self.send.assert_not_called()

    def test_sender_allowlist_and_terminal_state_are_rechecked(self):
        update_web_push_preferences(self.friend.id, WebPushPreferencesRequest(
            game_invites_enabled=True, daily_reminder_enabled=False,
            game_invite_audience="allowlist", allowed_sender_usernames=[],
        ))
        with self.local_cohort():
            self.assertEqual(game_invite_push_recipients(self.game, sender_user_id=self.founder.id), [])
            update_web_push_preferences(self.friend.id, WebPushPreferencesRequest(
                game_invites_enabled=True, daily_reminder_enabled=False,
                allowed_sender_usernames=[self.founder.username],
            ))
            recipients = game_invite_push_recipients(self.game, sender_user_id=self.founder.id)
            self.assertEqual([row.user_id for row in recipients], [self.friend.id])
            self.game["_started"] = True
            self.assertEqual(asyncio.run(dispatch_game_invite_push(
                self.game, recipients, sender_user_id=self.founder.id)).attempted, 0)
        self.send.assert_not_called()

    def test_cpu_seats_do_not_create_invitable_human_capacity(self):
        self.assertIsNone(open_seat_invitation_error(self.game, user_id=self.founder.id))
        filled = {**self.game, "_players": [*self.game["_players"], {"user_id": self.friend.id}]}
        self.assertEqual(open_seat_invitation_error(filled, user_id=self.founder.id), "game_invite_no_open_seat")
        for flag in ("_started", "_finished", "_aborted", "_completion_persisted"):
            with self.subTest(flag=flag):
                self.assertEqual(open_seat_invitation_error({**self.game, flag: True}, user_id=self.founder.id),
                                 "game_invite_not_waiting")
        self.assertEqual(open_seat_invitation_error({**self.game, "_passphrase": "private"}, user_id=self.founder.id),
                         "game_invite_private_room")

    def test_payload_has_hausdepp_identity_in_both_languages_even_on_shared_suite_subscriptions(self):
        with self.local_cohort():
            recipients = game_invite_push_recipients(self.game, sender_user_id=self.founder.id)
        destination = game_invite_destinations(self.game, recipients)[0][1]
        self.assertEqual(destination, "/hausdepp/spiel/haus-push")
        for context in ("zdwa", "zilch"):
            for language in ("de", "en"):
                with self.subTest(context=context, language=language):
                    payload = game_invite_notification_payload(game=self.game, destination=destination,
                                                               language=language, product_context=context)
                    self.assertEqual(payload["icon"], "/static/icons/hausdepp-icon-192.png")
                    self.assertEqual(payload["badge"], payload["icon"])
                    self.assertEqual(payload["url"], destination)
                    self.assertEqual(payload["tag"], "game-invite-hausdepp-haus-push")
                    self.assertEqual(payload["title"], "Hausdepp sucht Mitspieler" if language == "de"
                                     else "Hausdepp is looking for players")
                    self.assertIn(self.founder.username, payload["body"])
                    self.assertNotIn("ZDWA", payload["body"])
                    self.assertNotIn("Zilch", payload["body"])

    def test_empty_attempt_consumes_account_barrier_and_exposes_no_recipient_data(self):
        for user in (self.friend, self.stranger):
            update_web_push_preferences(user.id, WebPushPreferencesRequest(game_invites_enabled=False, daily_reminder_enabled=False))
        result = asyncio.run(main.api_game_notify_open_seat(self.game["_id"], self.request))
        self.assertEqual(result, {"ok": True, "notified": False, "retry_after_seconds": 60})
        self.send.assert_not_called()
        lobby = asyncio.run(main.api_games(self.request, game_type="hausdepp"))["games"][0]
        self.assertTrue(lobby["can_notify_open_seat"])
        self.assertGreater(lobby["invite_retry_after_seconds"], 0)
        with self.assertRaises(HTTPException) as denied:
            asyncio.run(main.api_game_notify_open_seat(self.game["_id"], self.request))
        self.assertEqual(denied.exception.status_code, 429)
        self.assertEqual(denied.exception.detail["code"], "game_invite_account_cooldown")

    def test_local_dispatch_claims_room_barrier_and_rejects_unauthorized_sender_without_dispatch(self):
        with self.local_cohort():
            result = asyncio.run(main.api_game_notify_open_seat(self.game["_id"], self.request))
        self.assertEqual(result, {"ok": True, "notified": True, "retry_after_seconds": 600})
        self.send.assert_called_once()
        with self.assertRaises(HTTPException) as denied:
            asyncio.run(main.api_game_notify_open_seat(self.game["_id"], self.request))
        self.assertEqual(denied.exception.detail["code"], "game_invite_cooldown")
        outsider, token = login(request_for(token="", csrf=""), self.stranger.username, "test-password-123")
        with patch.object(main, "claim_game_invite_push", side_effect=AssertionError("no claim before product access")):
            with self.assertRaises(HTTPException) as denied:
                asyncio.run(main.api_game_notify_open_seat(self.game["_id"], request_for(token=token, csrf=outsider.csrf_token)))
        self.assertEqual(denied.exception.status_code, 403)
        self.send.assert_called_once()

    def test_csrf_and_reassigned_device_do_not_bypass_private_scope(self):
        with self.assertRaises(HTTPException) as denied:
            asyncio.run(main.api_game_notify_open_seat(self.game["_id"], request_for(token=self.token, csrf="wrong")))
        self.assertEqual(denied.exception.status_code, 403)
        with self.local_cohort():
            recipients = game_invite_push_recipients(self.game, sender_user_id=self.founder.id)
            save_web_push_subscription(user_id=self.stranger.id, payload=fixtures.WebPushTestCase.subscription(
                f"https://fcm.googleapis.com/fcm/send/invite-{self.friend.id}"), product_context="zdwa")
            self.assertEqual(asyncio.run(dispatch_game_invite_push(
                self.game, recipients, sender_user_id=self.founder.id)).attempted, 0)
        self.send.assert_not_called()
