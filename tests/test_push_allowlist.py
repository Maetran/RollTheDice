"""Private, directed invitation preferences and actual-trigger authorization."""

from __future__ import annotations

import asyncio
import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from app import web_push
from app.api_auth import web_push_preferences_put
from app.auth import create_user, login
from app.database import session_scope
from app.models import PushInviteAllowedSender, User
from app.web_push import (
    WebPushPreferencesRequest,
    dispatch_game_invite_push,
    game_invite_push_recipients,
    save_web_push_subscription,
    update_web_push_preferences,
    web_push_subscription_status,
)
from tests import test_web_push as fixtures


class PushAllowlistTestCase(unittest.TestCase):
    tearDown = fixtures.WebPushTestCase.tearDown

    def setUp(self) -> None:
        fixtures.WebPushTestCase.setUp(self)
        self.settings_patch = patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_ACCESS_MODE": "public"})
        self.settings_patch.start()
        self.addCleanup(self.settings_patch.stop)
        self.player = create_user("Recipient", "a-secure-password-123", must_change_password=False)
        self.friend = create_user("AllowedFriend", "another-password-123", must_change_password=False)
        self.stranger = create_user("Stranger", "another-password-123", must_change_password=False)
        save_web_push_subscription(user_id=self.player.id, payload=fixtures.WebPushTestCase.subscription(), product_context="zdwa")
        self.game = {"_id": "allowlist-room", "_game_type": "zdwa", "_expected": 3, "_players": [
            {"user_id": self.friend.id, "name": "AllowedFriend"}, {"user_id": self.stranger.id, "name": "Stranger"},
        ]}

    def prefs(self, **changes):
        return update_web_push_preferences(self.player.id, WebPushPreferencesRequest(**{
            "game_invites_enabled": True, "daily_reminder_enabled": False,
            "game_invite_audience": "allowlist", "allowed_sender_usernames": ["AllowedFriend"], **changes,
        }))

    def test_default_all_preserved_then_only_actual_sender_is_authorized_in_both_games(self) -> None:
        self.assertEqual(web_push_subscription_status(self.player.id)["game_invite_audience"], "all")
        self.assertEqual(len(game_invite_push_recipients(self.game, sender_user_id=self.stranger.id)), 1)
        self.prefs()
        for game_type in ("zdwa", "zilch"):
            game = {**self.game, "_game_type": game_type}
            self.assertEqual([sub.user_id for sub in game_invite_push_recipients(game, sender_user_id=self.friend.id)], [self.player.id])
            # Being seated alongside the allowlisted player is not authority.
            self.assertEqual(game_invite_push_recipients(game, sender_user_id=self.stranger.id), [])
            self.assertEqual(game_invite_push_recipients(game), [])
        self.prefs(allowed_sender_usernames=[])
        self.assertEqual(game_invite_push_recipients(self.game, sender_user_id=self.friend.id), [])
        self.prefs(game_invite_audience="all", allowed_sender_usernames=[])
        self.assertEqual(len(game_invite_push_recipients(self.game, sender_user_id=self.stranger.id)), 1)

    def test_names_are_normalized_deduplicated_private_and_preserved_by_old_clients(self) -> None:
        result = self.prefs(allowed_sender_usernames=["  allowedfriend ", "AllowedFriend"], release_notifications_enabled=True)
        self.assertEqual(result["allowed_sender_usernames"], ["AllowedFriend"])
        self.assertEqual(web_push_subscription_status(self.friend.id)["allowed_sender_usernames"], [])
        result = update_web_push_preferences(self.player.id, WebPushPreferencesRequest(game_invites_enabled=False, daily_reminder_enabled=False))
        self.assertEqual(result["game_invite_audience"], "allowlist")
        self.assertEqual(result["allowed_sender_usernames"], ["AllowedFriend"])
        self.assertTrue(result["release_notifications_enabled"])
        self.assertEqual(game_invite_push_recipients(self.game, sender_user_id=self.friend.id), [])
        with session_scope() as db:
            row = db.query(PushInviteAllowedSender).one()
            self.assertEqual((row.recipient_user_id, row.sender_user_id), (self.player.id, self.friend.id))

    def test_invalid_lists_roll_back_all_preference_changes(self) -> None:
        self.prefs()
        with session_scope() as db:
            db.get(User, self.stranger.id).is_active = False
        for names in (["Recipient"], ["UnknownPlayer"], ["Stranger"], [""], ["x" * 33], ["AllowedFriend", "UnknownPlayer"]):
            with self.subTest(names=names), self.assertRaisesRegex(ValueError, "push_allowlist_invalid"):
                self.prefs(allowed_sender_usernames=names, game_invites_enabled=False, release_notifications_enabled=True)
            result = web_push_subscription_status(self.player.id)
            self.assertEqual(result["allowed_sender_usernames"], ["AllowedFriend"])
            self.assertTrue(result["game_invites_enabled"])
            self.assertFalse(result["release_notifications_enabled"])
        with self.assertRaises(ValidationError):
            WebPushPreferencesRequest(game_invites_enabled=True, daily_reminder_enabled=False, allowed_sender_usernames=["AllowedFriend"] * 101)
        with self.assertRaises(ValidationError):
            WebPushPreferencesRequest(game_invites_enabled=True, daily_reminder_enabled=False, game_invite_audience="friends-of-friends")

    def test_filter_and_opt_out_are_rechecked_after_recipient_snapshot(self) -> None:
        recipients = game_invite_push_recipients(self.game, sender_user_id=self.stranger.id)
        self.prefs()
        with patch.object(web_push, "_send_web_push", return_value=(True, False)) as send:
            result = asyncio.run(dispatch_game_invite_push(self.game, recipients, sender_user_id=self.stranger.id))
            self.assertEqual(result.attempted, 0)
            send.assert_not_called()
            result = asyncio.run(dispatch_game_invite_push(self.game, recipients, sender_user_id=self.friend.id))
            self.assertEqual(result.accepted, 1)
            self.prefs(game_invites_enabled=False)
            result = asyncio.run(dispatch_game_invite_push(self.game, recipients, sender_user_id=self.friend.id))
            self.assertEqual(result.attempted, 0)
            send.assert_called_once()

    def test_reassigned_device_does_not_receive_an_invitation_for_previous_owner(self) -> None:
        recipients = game_invite_push_recipients(self.game, sender_user_id=self.friend.id)
        new_owner = create_user("NewOwner", "another-password-123", must_change_password=False)
        save_web_push_subscription(user_id=new_owner.id, payload=fixtures.WebPushTestCase.subscription(), product_context="zdwa")
        with patch.object(web_push, "_send_web_push") as send:
            self.assertEqual(asyncio.run(dispatch_game_invite_push(self.game, recipients, sender_user_id=self.friend.id)).attempted, 0)
            send.assert_not_called()

    def test_settings_endpoint_requires_own_login_and_csrf(self) -> None:
        payload = WebPushPreferencesRequest(game_invites_enabled=True, daily_reminder_enabled=False, release_notifications_enabled=True,
                                            game_invite_audience="allowlist", allowed_sender_usernames=["AllowedFriend"])
        with self.assertRaises(HTTPException) as denied:
            web_push_preferences_put(payload, fixtures.request_for(token="missing", csrf="missing"))
        self.assertEqual(denied.exception.status_code, 401)
        identity, token = login(fixtures.request_for(token="missing", csrf="missing"), "Recipient", "a-secure-password-123")
        with self.assertRaises(HTTPException) as denied:
            web_push_preferences_put(payload, fixtures.request_for(token=token, csrf="wrong"))
        self.assertEqual(denied.exception.status_code, 403)
        result = web_push_preferences_put(payload, fixtures.request_for(token=token, csrf=identity.csrf_token))
        self.assertEqual(result["allowed_sender_usernames"], ["AllowedFriend"])
        self.assertTrue(result["release_notifications_enabled"])
        self.assertEqual(web_push_subscription_status(self.friend.id)["game_invite_audience"], "all")
