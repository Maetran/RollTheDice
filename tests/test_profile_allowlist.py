"""Account-ID based list editing cannot grant push consent or overwrite peers."""

import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from fastapi import HTTPException, Response
from pydantic import ValidationError

from app.api_allowlist import (
    AllowlistAudience,
    AllowlistViewer,
    add_allowlist_player,
    own_allowlist,
    remove_allowlist_player,
    save_allowlist_audience,
)
from app.auth import create_user, login
from app.database import session_scope
from app.models import PushInviteAllowedSender, User
from app.web_push import (
    WebPushPreferencesRequest,
    remove_web_push_subscriptions,
    update_web_push_preferences,
    web_push_subscription_status,
)
from tests import test_push_allowlist as allowlist_fixtures
from tests import test_web_push as fixtures


class ProfileAllowlistTestCase(unittest.TestCase):
    tearDown = fixtures.WebPushTestCase.tearDown

    def setUp(self):
        allowlist_fixtures.PushAllowlistTestCase.setUp(self)
        identity, token = login(fixtures.request_for(token="missing", csrf="missing"), "Recipient", "a-secure-password-123")
        self.request = fixtures.request_for(token=token, csrf=identity.csrf_token)
        self.viewer = AllowlistViewer(viewer_id=self.player.id)

    def add(self, sender_id):
        return add_allowlist_player(sender_id, self.viewer, self.request, Response())

    def remove(self, sender_id):
        return remove_allowlist_player(sender_id, self.viewer, self.request, Response())

    def test_id_membership_is_private_idempotent_and_available_without_push(self):
        remove_web_push_subscriptions(self.player.id)
        before = web_push_subscription_status(self.player.id)
        self.add(self.friend.id)
        result = self.add(self.friend.id)
        self.assertEqual(result["players"], [{"id": self.friend.id, "username": "AllowedFriend", "active": True}])
        self.assertEqual(result["audience"], "all")
        after = web_push_subscription_status(self.player.id)
        for key in ("enabled", "subscribed", "game_invites_enabled", "daily_reminder_enabled", "release_notifications_enabled"):
            self.assertEqual(after[key], before[key])
        self.assertEqual(web_push_subscription_status(self.friend.id)["allowed_sender_usernames"], [])
        with session_scope() as db:
            self.assertEqual(db.query(PushInviteAllowedSender).count(), 1)
            timestamp = db.query(PushInviteAllowedSender).one().created_at
        self.add(self.friend.id)
        with session_scope() as db:
            self.assertEqual(db.query(PushInviteAllowedSender).one().created_at, timestamp)
        self.assertEqual(self.remove(self.friend.id)["players"], [])
        self.assertEqual(self.remove(self.friend.id)["players"], [])

    def test_mode_changes_only_invitation_filter_and_preserves_members_and_consent(self):
        self.add(self.friend.id)
        before = web_push_subscription_status(self.player.id)
        result = save_allowlist_audience(AllowlistAudience(viewer_id=self.player.id, audience="allowlist"), self.request, Response())
        self.assertEqual(result["audience"], "allowlist")
        self.assertEqual(result["players"][0]["id"], self.friend.id)
        after = web_push_subscription_status(self.player.id)
        for key in ("game_invites_enabled", "daily_reminder_enabled", "release_notifications_enabled"):
            self.assertEqual(before[key], after[key])
        # A concurrently open notification form does not send a bulk list.
        update_web_push_preferences(self.player.id, WebPushPreferencesRequest(game_invites_enabled=False, daily_reminder_enabled=False))
        result = own_allowlist(self.request, Response())
        self.assertEqual(result["audience"], "allowlist")
        self.assertEqual(result["players"][0]["id"], self.friend.id)

    def test_authentication_csrf_and_expected_owner_are_required(self):
        guest = fixtures.request_for(token="missing", csrf="missing")
        with self.assertRaises(HTTPException) as denied:
            own_allowlist(guest, Response())
        self.assertEqual(denied.exception.status_code, 401)
        bad_csrf = fixtures.request_for(token=self.request.cookies["rollthedice_session"], csrf="wrong")
        for handler in (add_allowlist_player, remove_allowlist_player):
            with self.assertRaises(HTTPException) as denied:
                handler(self.friend.id, self.viewer, bad_csrf, Response())
            self.assertEqual(denied.exception.status_code, 403)
            with self.assertRaises(HTTPException) as denied:
                handler(self.friend.id, AllowlistViewer(viewer_id=self.stranger.id), self.request, Response())
            self.assertEqual(denied.exception.status_code, 409)
        with self.assertRaises(ValidationError):
            AllowlistViewer(viewer_id=self.player.id, recipient_user_id=self.stranger.id)
        with session_scope() as db:
            self.assertEqual(db.query(PushInviteAllowedSender).count(), 0)

    def test_invalid_targets_cannot_be_added_and_inactive_members_can_be_removed(self):
        self.add(self.friend.id)
        with session_scope() as db:
            db.get(User, self.friend.id).is_active = False
        for target in (self.friend.id, self.player.id, 999999, -1):
            with self.assertRaises(HTTPException) as denied:
                self.add(target)
            self.assertEqual(denied.exception.status_code, 400)
        result = own_allowlist(self.request, Response())
        self.assertFalse(result["players"][0]["active"])
        self.assertEqual(self.remove(self.friend.id)["players"], [])

    def test_parallel_additions_cannot_exceed_limit_or_lose_another_member(self):
        third = create_user("ThirdFriend", "another-password-123", must_change_password=False)
        def attempt(target):
            try:
                self.add(target)
                return True
            except HTTPException as error:
                self.assertEqual(error.detail, "push_allowlist_limit")
                return False
        with patch("app.api_allowlist.ALLOWLIST_LIMIT", 2), ThreadPoolExecutor(max_workers=3) as pool:
            self.assertEqual(sum(pool.map(attempt, [self.friend.id, self.stranger.id, third.id])), 2)
            members = own_allowlist(self.request, Response())["players"]
            self.assertEqual(len(self.add(members[0]["id"])["players"]), 2)
            self.remove(members[0]["id"])
            self.assertEqual(len(self.add(members[0]["id"])["players"]), 2)

    def test_existing_name_based_lists_are_read_as_account_ids_and_survive_display_name_changes(self):
        update_web_push_preferences(self.player.id, WebPushPreferencesRequest(
            game_invites_enabled=True, daily_reminder_enabled=False, allowed_sender_usernames=["AllowedFriend"],
        ))
        with session_scope() as db:
            db.get(User, self.friend.id).username = "Current display name"
        response = Response()
        result = own_allowlist(self.request, response)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(result["players"][0]["id"], self.friend.id)
        self.assertEqual(result["players"][0]["username"], "Current display name")
        self.assertNotIn("endpoint", str(result))
