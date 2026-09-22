"""Authorization, durable claims and independent push for admin help."""

from __future__ import annotations

import asyncio
import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI, HTTPException

from app import admin_help
from app.admin_help import (
    claim_help_request,
    close_stale_help_requests,
    create_help_request,
    dispatch_admin_help_notifications,
    has_active_help_claim,
    help_status,
    list_help_requests,
    resolve_help_request,
)
from app.api_admin_help import router
from app.auth import create_user, login
from app.database import configure_database, session_scope
from app.game_state import games
from app.models import AdminHelpRecipient, AdminHelpRequest, User, WebPushSubscription
from app.moderation import admin_help_blocked, revoke_bans, user_play_banned
from app.security import utcnow
from app.web_push import (
    WebPushPreferencesRequest,
    save_web_push_subscription,
    update_web_push_preferences,
    web_push_subscription_status,
)
from tests import test_web_push as fixtures


class AdminHelpTestCase(unittest.TestCase):
    def setUp(self) -> None:
        fixtures.WebPushTestCase.setUp(self)
        self.player = create_user("HelpPlayer", "password-player-123", must_change_password=False)
        self.admin = create_user("HelpAdmin", "password-admin-123", role="admin", must_change_password=False)
        self.second_admin = create_user("OtherAdmin", "password-other-123", role="admin", must_change_password=False)
        self.game_ids = []
        self.game = self.game_for("help-game", self.player.id)
        self.send_patch = patch("app.admin_help._send_web_push", return_value=(True, False))
        self.send = self.send_patch.start()
        self.addCleanup(self.send_patch.stop)
        self.end_patch = patch("app.admin_help_navigation.end_help_assignment", new_callable=AsyncMock)
        self.end = self.end_patch.start()
        self.addCleanup(self.end_patch.stop)

    def tearDown(self) -> None:
        for game_id in self.game_ids:
            games.pop(game_id, None)
        fixtures.WebPushTestCase.tearDown(self)

    def game_for(self, game_id, user_id, game_type="zdwa"):
        game = {
            "_id": game_id, "_game_type": game_type, "_name": "Help table", "_started": True,
            "_finished": False, "_aborted": False,
            "_players": [{"id": f"seat-{user_id}", "name": "Player", "user_id": user_id}],
        }
        games[game_id] = game
        self.game_ids.append(game_id)
        return game

    def subscribe(self, user_id=None, suffix="device", context="zdwa"):
        save_web_push_subscription(
            user_id=user_id or self.admin.id,
            payload=fixtures.WebPushTestCase.subscription(f"https://fcm.googleapis.com/fcm/send/{suffix}"),
            product_context=context,
        )

    def create(self, game_id="help-game", user_id=None):
        return create_help_request(game_id, user_id or self.player.id)[0]

    def test_http_requires_an_authenticated_actual_player_and_csrf(self):
        app = FastAPI()
        app.include_router(router)
        identity, token = login(fixtures.request_for(token="missing", csrf="missing"), "HelpPlayer", "password-player-123")
        admin_identity, admin_token = login(fixtures.request_for(token="missing", csrf="missing"), "HelpAdmin", "password-admin-123")

        async def run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
                self.assertFalse((await client.get("/api/admin-help/status")).json()["authenticated"])
                self.assertEqual((await client.post("/api/admin-help", json={"game_id": "help-game"})).status_code, 401)
                client.cookies.set("rollthedice_session", token)
                self.assertEqual((await client.post("/api/admin-help", json={"game_id": "help-game"})).status_code, 403)
                created = await client.post("/api/admin-help", json={"game_id": "help-game"}, headers={"X-CSRF-Token": identity.csrf_token})
                self.assertEqual(created.status_code, 200)
                self.assertEqual(created.headers["cache-control"], "no-store")
                self.assertTrue(created.json()["created"])
                self.assertEqual((await client.get("/api/admin-help/requests")).status_code, 403)
                client.cookies.set("rollthedice_session", admin_token)
                spectator = await client.post("/api/admin-help", json={"game_id": "help-game"}, headers={"X-CSRF-Token": admin_identity.csrf_token})
                self.assertEqual(spectator.status_code, 403)
                self.assertEqual(spectator.json()["detail"]["code"], "admin_help_not_player")

        asyncio.run(run())

    def test_zilch_participants_work_but_cpu_and_spectator_records_do_not(self):
        game = self.game_for("zilch-help", self.player.id, "zilch")
        game["_participants"] = game.pop("_players")
        request = self.create("zilch-help")
        self.assertEqual(request["game_type"], "zilch")
        game["_spectators"] = [{"user_id": self.admin.id}]
        game["_participants"].append({"id": "cpu", "type": "cpu", "user_id": self.admin.id})
        with self.assertRaises(HTTPException) as denied:
            self.create("zilch-help", self.admin.id)
        self.assertEqual(denied.exception.status_code, 403)

    def test_one_open_request_per_account_survives_parallel_tabs_and_restart(self):
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: create_help_request("help-game", self.player.id), range(6)))
        self.assertEqual(sum(created for _request, created in results), 1)
        self.assertEqual(len({request["id"] for request, _created in results}), 1)
        self.game_for("other-table", self.player.id)
        with self.assertRaises(HTTPException) as duplicate:
            self.create("other-table")
        self.assertEqual(duplicate.exception.detail["code"], "admin_help_already_open")
        configure_database(Path(self.temporary_directory.name))
        self.assertEqual(self.create()["id"], results[0][0]["id"])

    def test_resolved_and_accidental_calls_allow_further_help_without_a_fixed_quota(self):
        for outcome in ["resolved", "accidental", "resolved", "resolved", "accidental"]:
            request = self.create()
            claim_help_request(request["id"], self.admin.id)
            resolved = resolve_help_request(request["id"], self.admin.id, outcome)
            self.assertEqual(resolved["outcome"], outcome)
            self.assertFalse(admin_help_blocked(self.player.id))

    def test_misuse_blocks_only_more_help_until_an_admin_revokes_it(self):
        request = self.create()
        claim_help_request(request["id"], self.admin.id)
        resolve_help_request(request["id"], self.admin.id, "misuse")
        self.assertTrue(admin_help_blocked(self.player.id))
        self.assertFalse(user_play_banned(self.player.id))
        self.assertTrue(help_status(self.player.id, "help-game")["blocked"])
        with self.assertRaises(HTTPException) as blocked:
            self.create()
        self.assertEqual(blocked.exception.detail["code"], "admin_help_blocked")
        with session_scope() as db:
            revoke_bans(db, self.player.id, "help", self.admin.id)
        self.assertNotEqual(self.create()["id"], request["id"])

    def test_resolution_requires_the_assigned_admin_and_cannot_be_reclassified_by_retry(self):
        request = self.create()
        claim_help_request(request["id"], self.admin.id)
        with self.assertRaises(HTTPException) as denied:
            resolve_help_request(request["id"], self.second_admin.id, "misuse")
        self.assertEqual(denied.exception.status_code, 403)
        resolve_help_request(request["id"], self.admin.id, "accidental")
        self.assertEqual(resolve_help_request(request["id"], self.admin.id, "misuse")["outcome"], "accidental")
        self.assertFalse(admin_help_blocked(self.player.id))

    def test_parallel_admin_claims_have_one_winner_and_one_active_assignment(self):
        request = self.create()

        def claim(admin_id):
            try:
                return claim_help_request(request["id"], admin_id)
            except HTTPException as error:
                return error.detail["code"]

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(claim, [self.admin.id, self.second_admin.id]))
        winners = [result for result in results if isinstance(result, dict)]
        self.assertEqual(len(winners), 1)
        self.assertIn("admin_help_already_claimed", results)
        winner = winners[0]["claimed_by_user_id"]
        self.assertEqual(claim_help_request(request["id"], winner)["claimed_by_user_id"], winner)
        other = create_user("OtherPlayer", "password-another-123", must_change_password=False)
        self.game_for("other-request", other.id)
        another = self.create("other-request", other.id)
        with self.assertRaises(HTTPException) as busy:
            claim_help_request(another["id"], winner)
        self.assertEqual(busy.exception.detail["code"], "admin_help_admin_busy")

    def test_origin_must_be_a_real_own_seat_and_claim_is_scoped_to_one_game(self):
        request = self.create()
        with self.assertRaises(HTTPException) as denied:
            claim_help_request(request["id"], self.admin.id, "help-game")
        self.assertEqual(denied.exception.status_code, 403)
        self.game_for("admin-origin", self.admin.id)
        claimed = claim_help_request(request["id"], self.admin.id, "admin-origin")
        self.assertEqual(claimed["origin_game_id"], "admin-origin")
        self.assertTrue(has_active_help_claim(self.admin.id, "help-game"))
        self.assertFalse(has_active_help_claim(self.admin.id, "admin-origin"))
        self.assertFalse(has_active_help_claim(self.second_admin.id, "help-game"))
        with session_scope() as db:
            db.get(User, self.admin.id).role = "user"
        self.assertFalse(has_active_help_claim(self.admin.id, "help-game"))
        asyncio.run(close_stale_help_requests())
        self.assertEqual(list_help_requests(self.second_admin.id)[0]["status"], "open")
        self.end.assert_awaited_once_with(request["id"])

    def test_stale_and_expired_assignments_close_without_losing_the_return_target(self):
        self.game_for("admin-origin", self.admin.id)
        request = self.create()
        claim_help_request(request["id"], self.admin.id, "admin-origin")
        with session_scope() as db:
            db.get(AdminHelpRequest, request["id"]).claimed_at = utcnow() - timedelta(hours=1, seconds=1)
        self.assertFalse(has_active_help_claim(self.admin.id, "help-game"))
        asyncio.run(close_stale_help_requests())
        status = help_status(self.admin.id)
        self.assertIsNone(status["active_claim"])
        self.assertEqual(status["return_to_game"]["request_id"], request["id"])
        self.assertEqual(status["return_to_game"]["game_id"], "admin-origin")
        self.assertTrue(status["return_to_game"]["url"].endswith("/spiel/admin-origin"))
        self.assertEqual(help_status(self.player.id, "help-game")["request"]["outcome"], "resolved")
        later = self.create()
        self.game["_finished"] = True
        asyncio.run(close_stale_help_requests())
        self.assertEqual(help_status(self.player.id, "help-game")["request"]["id"], later["id"])
        self.assertEqual(help_status(self.player.id, "help-game")["request"]["status"], "resolved")

    def test_admin_push_default_is_independent_and_old_preference_payloads_preserve_it(self):
        self.subscribe()
        status = update_web_push_preferences(self.admin.id, WebPushPreferencesRequest(
            game_invites_enabled=False, daily_reminder_enabled=False, release_notifications_enabled=False,
        ))
        self.assertTrue(status["admin_help_enabled"])
        self.assertTrue(status["enabled"])
        self.assertTrue(status["is_admin"])
        self.assertFalse(web_push_subscription_status(self.player.id)["admin_help_enabled"])
        self.create()
        asyncio.run(dispatch_admin_help_notifications())
        self.send.assert_called_once()
        with self.assertRaisesRegex(ValueError, "admin_required"):
            update_web_push_preferences(self.player.id, WebPushPreferencesRequest(
                game_invites_enabled=False, daily_reminder_enabled=False, admin_help_enabled=True,
            ))

    def test_turning_help_push_off_keeps_the_in_app_queue_available(self):
        self.subscribe()
        update_web_push_preferences(self.admin.id, WebPushPreferencesRequest(
            game_invites_enabled=False, daily_reminder_enabled=False, admin_help_enabled=False,
        ))
        request = self.create()
        self.assertEqual(help_status(self.admin.id)["requests"][0]["id"], request["id"])
        asyncio.run(dispatch_admin_help_notifications())
        self.send.assert_not_called()

    def test_unconfigured_push_does_not_block_help_or_its_in_app_queue(self):
        with patch.object(admin_help, "web_push_available", return_value=False):
            request = self.create()
            self.assertEqual(asyncio.run(dispatch_admin_help_notifications()), 0)
        self.assertEqual(list_help_requests(self.admin.id)[0]["id"], request["id"])
        self.send.assert_not_called()

    def test_dispatch_claim_survives_parallel_dispatch_and_restart(self):
        self.subscribe()
        request = self.create()
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: asyncio.run(dispatch_admin_help_notifications()), range(4)))
        self.send.assert_called_once()
        configure_database(Path(self.temporary_directory.name))
        self.assertEqual(asyncio.run(dispatch_admin_help_notifications()), 0)
        with session_scope() as db:
            self.assertIsNotNone(db.get(AdminHelpRecipient, (request["id"], self.admin.id)).push_claimed_at)

    def test_dispatch_rechecks_current_admin_role_preference_and_subscription_owner(self):
        for mutation in ["role", "inactive", "preference", "owner"]:
            with self.subTest(mutation=mutation):
                self.subscribe(suffix=mutation)
                request = self.create()
                with session_scope() as db:
                    user = db.get(User, self.admin.id)
                    if mutation == "role":
                        user.role = "user"
                    elif mutation == "inactive":
                        user.is_active = False
                    elif mutation == "preference":
                        user.admin_help_push_enabled = False
                    else:
                        for sub in db.query(WebPushSubscription).all():
                            sub.user_id = self.player.id
                asyncio.run(dispatch_admin_help_notifications())
                self.send.assert_not_called()
                with session_scope() as db:
                    user = db.get(User, self.admin.id)
                    user.role = "admin"
                    user.is_active = True
                    user.admin_help_push_enabled = True
                    db.query(WebPushSubscription).delete()
                claim_help_request(request["id"], self.second_admin.id)
                resolve_help_request(request["id"], self.second_admin.id, "resolved")

    def test_new_or_reregistered_devices_do_not_receive_an_old_request(self):
        self.subscribe()
        self.create()
        self.subscribe(suffix="new")
        self.subscribe()
        asyncio.run(dispatch_admin_help_notifications())
        self.send.assert_not_called()

    def test_push_ttl_expired_devices_and_language_are_bounded(self):
        self.subscribe()
        request = self.create()
        with session_scope() as db:
            user = db.get(User, self.admin.id)
            user.preferred_language = "en"
            created_at = db.get(AdminHelpRequest, request["id"]).created_at
        self.send.return_value = (False, True)
        asyncio.run(dispatch_admin_help_notifications(now=created_at + timedelta(seconds=100)))
        self.assertEqual(self.send.call_args.kwargs["ttl"], 200)
        payload = self.send.call_args.args[1]
        self.assertIn("Help requested", payload["title"])
        self.assertIn("needs help", payload["body"])
        self.assertIn(f"admin_help={request['id']}", payload["url"])
        with session_scope() as db:
            self.assertEqual(db.query(WebPushSubscription).count(), 0)
        self.send.reset_mock()
        claim_help_request(request["id"], self.admin.id)
        resolve_help_request(request["id"], self.admin.id, "resolved")
        self.subscribe(suffix="fresh")
        later = self.create()
        with session_scope() as db:
            created_at = db.get(AdminHelpRequest, later["id"]).created_at
        asyncio.run(dispatch_admin_help_notifications(now=created_at + timedelta(minutes=6)))
        self.send.assert_not_called()

    def test_claiming_a_call_cancels_its_pending_pushes(self):
        self.subscribe()
        request = self.create()
        claim_help_request(request["id"], self.second_admin.id)
        asyncio.run(dispatch_admin_help_notifications())
        self.send.assert_not_called()

    def test_push_chooses_one_product_and_freezes_only_admin_devices(self):
        self.subscribe(suffix="zdwa")
        self.subscribe(suffix="zilch", context="zilch")
        self.subscribe(suffix="zilch-two", context="zilch")
        self.subscribe(user_id=self.player.id, suffix="non-admin")
        request = self.create()
        asyncio.run(dispatch_admin_help_notifications())
        self.assertEqual(self.send.call_count, 2)
        self.assertTrue(all(call.args[0].product_context == "zilch" for call in self.send.call_args_list))
        with session_scope() as db:
            recipients = db.query(AdminHelpRecipient).filter_by(request_id=request["id"]).all()
            self.assertEqual({recipient.user_id for recipient in recipients}, {self.admin.id, self.second_admin.id})
            snapshots = [json.loads(recipient.subscription_snapshot_json) for recipient in recipients]
            self.assertEqual(sum(map(len, snapshots)), 2)
