"""Durable, account-bound rematches never take another person's seat for them."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import main
from app.active_games import load_active_games, save_active_game
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.game_state import _passphrase_matches, games
from app.game_ws_session import GameSocketSession, handle_session_action
from app.hausdepp_cpu_runner import stop_cpu_runners
from app.hausdepp_rematch import (
    RematchError,
    create_rematch,
    deliver_rematch_invitations,
    pending_invitations,
    rematch_private_consent,
    respond_to_invitation,
    retain_rematch_source,
)
from app.hausdepp_state import configure_hausdepp_game, join_hausdepp_player, new_hausdepp_game, start_hausdepp_game
from app.models import (
    ActiveGame,
    CompletedGame,
    HausdeppRematch,
    HausdeppRematchInvitation,
    HausdeppRematchSource,
    HausdeppRoundCredit,
    User,
    UserBan,
)
from app.security import utcnow
from tests.test_hausdepp_integration import RecordingSocket
from tests.test_user_accounts import request_for


class HausdeppRematchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/rematch.sqlite3",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
        })
        self.env.start()
        self.registry = patch.dict(games, clear=True)
        self.registry.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.accounts = [create_user(name, "secure-password-123", must_change_password=False)
                         for name in ("RematchHost", "RematchFriend", "RematchStranger")]
        self.identities = [login(request_for(), user.username, "secure-password-123") for user in self.accounts]

    def tearDown(self):
        asyncio.run(stop_cpu_runners())
        self.registry.stop()
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def source(self, *, tournament=False, completed=True, aborted=False, private=True, count=3):
        game = new_hausdepp_game("rematch-source", "Manis Stammtisch", str(count))
        configure_hausdepp_game(game, host_user_id=self.accounts[0].id, cpu_count=1, tournament=tournament)
        for index, account in enumerate(self.accounts[:count - 1]):
            join_hausdepp_player(game, self.player(index))
        start_hausdepp_game(game)
        game["_passphrase"] = "very-private-passphrase" if private else None
        game["_finished"] = completed
        game["_aborted"] = aborted
        if completed:
            game["_hausdepp"]["phase"] = "finished"
        if tournament and completed:
            game["_hausdepp_tournament"]["completed"] = True
        return game

    def player(self, index, *, key=None, socket=None):
        account = self.accounts[index]
        return {"id": key or f"human-{index}", "name": account.username, "user_id": account.id,
                "ws": socket, "resume_token": f"resume-{index}"}

    def create(self, **kwargs):
        self.source(**kwargs)
        response = create_rematch("rematch-source", self.accounts[0].id)
        return response, games[response["game_id"]]

    def invite(self, index=1):
        return pending_invitations(self.accounts[index].id)["invitations"][0]

    def accept(self, index=1):
        invitation = self.invite(index)
        return respond_to_invitation(invitation["id"], self.accounts[index].id, accept=True)

    def request(self, index=0, *, csrf=True):
        identity, token = self.identities[index]
        return request_for(cookie=f"rollthedice_session={token}", csrf=identity.csrf_token if csrf else "")

    def test_same_settings_private_password_and_cpu_count_without_implicit_human_seats_or_rewards(self):
        response, game = self.create(tournament=True)
        self.assertTrue(response["created"])
        self.assertFalse(response["requires_acceptance"])
        self.assertIsInstance(response["invitation_id"], str)
        self.assertEqual((game["_name"], game["_mode"], game["_hausdepp_cpu_count"],
                          game["_hausdepp_tournament_enabled"], game["_passphrase"]),
                         ("Manis Stammtisch", "3", 1, True, "very-private-passphrase"))
        self.assertEqual(game["_players"], [])
        self.assertEqual(len(game["_participants"]), 1)
        self.assertTrue(game["_participants"][0]["is_cpu"])
        self.assertFalse(game["_started"])
        self.assertIsNone(game["_hausdepp"])
        self.assertIn("_hausdepp_waiting_last_join_at", game)
        invitation = self.invite()
        self.assertEqual(invitation["sender"], {"id": self.accounts[0].id, "username": "RematchHost"})
        self.assertEqual((invitation["players"], invitation["cpu_count"], invitation["tournament"], invitation["locked"]),
                         (3, 1, True, True))
        self.assertNotIn("passphrase", json.dumps(response))
        self.assertNotIn("very-private-passphrase", json.dumps(invitation))
        self.assertNotIn("original_user_ids", json.dumps(invitation))
        self.accept()
        self.assertEqual(game["_players"], [])
        self.assertEqual(self.invite()["status"], "accepted")
        with session_scope() as db:
            for table in (CompletedGame, HausdeppRoundCredit):
                self.assertEqual(db.scalar(select(func.count()).select_from(table)), 0)
            self.assertNotIn("very-private-passphrase", db.scalar(select(HausdeppRematch)).settings_json)

    def test_finished_or_aborted_only_including_full_tournament_not_interround(self):
        source = self.source(tournament=True, completed=False)
        for state in ({"_finished": False}, {"_finished": True}):
            source.update(state)
            with self.assertRaisesRegex(RematchError, "hausdepp_rematch_not_finished"):
                create_rematch(source["_id"], self.accounts[0].id)
        source["_aborted"] = True
        response = create_rematch(source["_id"], self.accounts[0].id)
        self.assertTrue(games[response["game_id"]]["_hausdepp_tournament_enabled"])
        self.assertEqual(games[response["game_id"]]["_players"], [])

    def test_duplicate_and_concurrent_creation_is_one_durable_target_and_retry_recovers_it(self):
        self.source()
        callback = Mock()
        with ThreadPoolExecutor(max_workers=4) as executor:
            responses = list(executor.map(lambda _: create_rematch("rematch-source", self.accounts[0].id,
                                                                  before_create=callback), range(4)))
        self.assertEqual(len({item["game_id"] for item in responses}), 1)
        self.assertEqual(sum(item["created"] for item in responses), 1)
        callback.assert_called_once()
        game_id = responses[0]["game_id"]
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppRematch)), 1)
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppRematchInvitation)), 2)
            self.assertEqual(db.scalar(select(func.count()).select_from(ActiveGame).where(ActiveGame.game_id == game_id)), 1)
        games.pop(game_id)
        # Neither duplicate creation nor a recovered invitation relies on a source socket.
        games.pop("rematch-source")
        recovered = create_rematch("rematch-source", self.accounts[0].id)
        self.assertEqual((recovered["game_id"], recovered["created"]), (game_id, False))
        self.assertEqual(games[game_id]["_players"], [])
        self.assertEqual(self.invite()["game_id"], game_id)

    def test_original_participant_recreate_click_returns_exact_own_invitation_for_explicit_acceptance(self):
        response, game = self.create()
        invitation = self.invite()
        repeated = create_rematch("rematch-source", self.accounts[1].id)
        self.assertEqual(repeated, {"game_id": response["game_id"], "url": response["url"], "created": False,
                                    "requires_acceptance": True, "invitation_id": invitation["id"]})
        self.assertEqual(game["_players"], [])
        accepted = respond_to_invitation(repeated["invitation_id"], self.accounts[1].id, accept=True)
        self.assertEqual(accepted["url"], response["url"])
        self.assertFalse(create_rematch("rematch-source", self.accounts[1].id)["requires_acceptance"])

    def test_committed_accept_with_lost_response_remains_resumable_until_actual_join(self):
        _, game = self.create()
        invitation = self.invite()
        self.accept()
        self.assertEqual(game["_players"], [])
        self.assertEqual(self.invite()["id"], invitation["id"])
        self.assertEqual(self.invite()["status"], "accepted")
        self.assertEqual(pending_invitations(self.accounts[0].id), {"invitations": []})
        respond_to_invitation(invitation["id"], self.accounts[1].id, accept=True)
        join_hausdepp_player(game, self.player(1))
        self.assertEqual(pending_invitations(self.accounts[1].id), {"invitations": []})

    def test_source_and_invitation_are_account_bound_even_after_renaming(self):
        self.source()
        with self.assertRaises(RematchError) as absent:
            create_rematch("rematch-source", self.accounts[2].id)
        self.assertEqual((str(absent.exception), absent.exception.status), ("game_not_found", 404))
        response = create_rematch("rematch-source", self.accounts[0].id)
        invitation = self.invite()
        for accept in (True, False):
            with self.assertRaises(RematchError) as foreign:
                respond_to_invitation(invitation["id"], self.accounts[2].id, accept=accept)
            self.assertEqual((str(foreign.exception), foreign.exception.status), ("hausdepp_invitation_not_found", 404))
        self.assertEqual(pending_invitations(self.accounts[2].id), {"invitations": []})
        with session_scope() as db:
            db.get(User, self.accounts[1].id).username = "NewNameSameAccount"
        self.assertEqual(self.accept()["game_id"], response["game_id"])
        with self.assertRaises(RematchError) as existing_foreign:
            create_rematch("rematch-source", self.accounts[2].id)
        self.assertEqual(existing_foreign.exception.status, 404)

    def test_pending_reservations_require_acceptance_and_prevent_outsider_seat_theft(self):
        _, game = self.create()
        for index, error in ((1, "hausdepp_invitation_accept_required"), (2, "hausdepp_rematch_reserved_seats")):
            with self.assertRaisesRegex(ValueError, error):
                join_hausdepp_player(game, self.player(index))
        self.assertEqual(game["_players"], [])
        self.accept()
        # The invited person can arrive before the creating host, but is still not seated by accepting.
        self.assertEqual(game["_players"], [])
        join_hausdepp_player(game, self.player(1))
        with self.assertRaisesRegex(ValueError, "hausdepp_rematch_reserved_seats"):
            join_hausdepp_player(game, self.player(2))
        join_hausdepp_player(game, self.player(0))
        with self.assertRaisesRegex(ValueError, "hausdepp_account_already_joined"):
            join_hausdepp_player(game, self.player(1, key="duplicate"))
        self.assertEqual(len(game["_players"]), 2)

    def test_decline_and_expiry_release_only_unclaimed_places(self):
        _, game = self.create(private=False)
        invitation = self.invite()
        self.assertEqual(respond_to_invitation(invitation["id"], self.accounts[1].id, accept=False), {"ok": True})
        join_hausdepp_player(game, self.player(2))
        with self.assertRaisesRegex(RematchError, "hausdepp_rematch_full"):
            respond_to_invitation(invitation["id"], self.accounts[1].id, accept=True)
        join_hausdepp_player(game, self.player(0))
        self.assertEqual(len(game["_players"]), 2)

    def test_declined_invitation_then_deliberate_normal_join_does_not_require_acceptance_again(self):
        response, game = self.create(private=False)
        invitation = self.invite()
        respond_to_invitation(invitation["id"], self.accounts[1].id, accept=False)
        join_hausdepp_player(game, self.player(1))
        repeated = create_rematch("rematch-source", self.accounts[1].id)
        self.assertEqual(repeated["game_id"], response["game_id"])
        self.assertFalse(repeated["created"])
        self.assertFalse(repeated["requires_acceptance"])
        self.assertEqual(repeated["invitation_id"], invitation["id"])
        join_hausdepp_player(game, self.player(0))
        start_hausdepp_game(game)
        self.assertTrue(game["_started"])
        self.assertFalse(create_rematch("rematch-source", self.accounts[1].id)["requires_acceptance"])

    def test_invitation_expiry_does_not_revoke_an_accepted_unjoined_reservation(self):
        _, game = self.create(private=False)
        invitation = self.invite()
        self.accept()
        with session_scope() as db:
            row = db.scalar(select(HausdeppRematch))
            row.expires_at = utcnow() - timedelta(seconds=1)
        self.assertEqual(respond_to_invitation(invitation["id"], self.accounts[1].id, accept=True)["game_id"], game["_id"])
        self.assertEqual(self.invite()["status"], "accepted")
        self.assertGreater(self.invite()["expires_at"], utcnow().isoformat())
        with self.assertRaisesRegex(ValueError, "hausdepp_rematch_reserved_seats"):
            join_hausdepp_player(game, self.player(2))
        join_hausdepp_player(game, self.player(1))
        # Once a user really joined, intentionally leaving must not reserve a ghost seat.
        game["_players"].clear()
        game["_participants"] = [item for item in game["_participants"] if item.get("is_cpu")]
        join_hausdepp_player(game, self.player(2))
        self.assertEqual(game["_players"][0]["user_id"], self.accounts[2].id)

    def test_pending_invitation_expires_and_fresh_waiting_table_accepts_other_accounts(self):
        _, game = self.create(private=False)
        invitation = self.invite()
        with session_scope() as db:
            db.scalar(select(HausdeppRematch)).expires_at = utcnow() - timedelta(seconds=1)
        self.assertEqual(pending_invitations(self.accounts[1].id), {"invitations": []})
        with self.assertRaisesRegex(RematchError, "hausdepp_invitation_expired"):
            respond_to_invitation(invitation["id"], self.accounts[1].id, accept=True)
        join_hausdepp_player(game, self.player(2))
        join_hausdepp_player(game, self.player(0))

    def test_timed_out_target_is_not_invitable_or_recreatable_and_accept_never_awards_points(self):
        response, game = self.create()
        invitation = self.invite()
        game["_hausdepp_waiting_last_join_at"] = (utcnow() - timedelta(hours=1, seconds=1)).isoformat()
        for action in (lambda: respond_to_invitation(invitation["id"], self.accounts[1].id, accept=True),
                       lambda: create_rematch("rematch-source", self.accounts[0].id)):
            with self.assertRaisesRegex(RematchError, "hausdepp_rematch_closed"):
                action()
        self.assertEqual(pending_invitations(self.accounts[1].id), {"invitations": []})
        self.assertTrue(game["_aborted"])
        self.assertEqual(game["_players"], [])
        with session_scope() as db:
            self.assertIsNone(db.scalar(select(ActiveGame).where(ActiveGame.game_id == response["game_id"])))
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppRoundCredit)), 0)

    def test_disabled_or_banned_recipients_cannot_accept_and_dont_hold_reservations(self):
        _, game = self.create(private=False)
        invitation = self.invite()
        with session_scope() as db:
            db.add(UserBan(user_id=self.accounts[1].id, scope="play", reason="test", created_at=utcnow(),
                           created_by_user_id=self.accounts[0].id))
        with self.assertRaises(RematchError) as banned:
            respond_to_invitation(invitation["id"], self.accounts[1].id, accept=True)
        self.assertEqual(banned.exception.status, 403)
        self.assertEqual(pending_invitations(self.accounts[1].id), {"invitations": []})
        join_hausdepp_player(game, self.player(2))
        with session_scope() as db:
            db.get(User, self.accounts[0].id).is_active = False
        with self.assertRaisesRegex(ValueError, "hausdepp_rematch_closed"):
            join_hausdepp_player(game, self.player(0))

    def test_host_cannot_release_the_only_host_reservation_without_leaving_an_actual_seat(self):
        response, _ = self.create()
        with self.assertRaisesRegex(RematchError, "hausdepp_rematch_closed"):
            respond_to_invitation(response["invitation_id"], self.accounts[0].id, accept=False)

    def test_real_waiting_leave_releases_reservation_and_transfers_host_for_remaining_player(self):
        _, game = self.create(private=False, count=4)
        self.accept()
        third_invitation = self.invite(2)
        respond_to_invitation(third_invitation["id"], self.accounts[2].id, accept=False)
        self.accounts.append(create_user("ActualOutsider", "secure-password-123", must_change_password=False))
        host_socket, friend_socket = RecordingSocket(), RecordingSocket()
        join_hausdepp_player(game, self.player(0, socket=host_socket))
        join_hausdepp_player(game, self.player(1, socket=friend_socket))
        session = GameSocketSession(host_socket, game, self.identities[0][0], player_id="human-0")
        self.assertTrue(asyncio.run(handle_session_action(session, "leave_waiting_game", {})))
        self.assertEqual(game["_hausdepp_host_user_id"], self.accounts[1].id)
        join_hausdepp_player(game, self.player(3))
        self.assertEqual([player["user_id"] for player in game["_players"]], [self.accounts[1].id, self.accounts[3].id])

    def test_accept_and_seat_mutation_cannot_race_into_an_overbooked_table(self):
        from app import hausdepp_state

        _, game = self.create(private=False)
        invitation = self.invite()
        respond_to_invitation(invitation["id"], self.accounts[1].id, accept=False)
        joined = threading.Event()
        release = threading.Event()
        underlying = hausdepp_state._join_hausdepp_player

        def delayed_join(*args):
            joined.set()
            if not release.wait(5):
                raise AssertionError("The test never released its admitted seat")
            underlying(*args)

        with patch("app.hausdepp_state._join_hausdepp_player", side_effect=delayed_join):
            with ThreadPoolExecutor(max_workers=2) as executor:
                joining = executor.submit(join_hausdepp_player, game, self.player(2))
                self.assertTrue(joined.wait(5))
                accepting = executor.submit(respond_to_invitation, invitation["id"], self.accounts[1].id, accept=True)
                release.set()
                joining.result(timeout=5)
                with self.assertRaisesRegex(RematchError, "hausdepp_rematch_full"):
                    accepting.result(timeout=5)
        self.assertEqual(len(game["_players"]), 1)
        join_hausdepp_player(game, self.player(0))
        self.assertEqual(len(game["_players"]), game["_expected_connections"])

    def test_accepted_private_invitation_admits_player_without_disclosing_password_not_spectator(self):
        _, game = self.create()
        self.accept()
        socket = RecordingSocket()
        session = GameSocketSession(socket, game, self.identities[1][0])
        with patch("app.hausdepp_cpu_runner.maybe_schedule_cpu_turn"):
            self.assertFalse(asyncio.run(handle_session_action(session, "join_game", {})))
        self.assertEqual(game["_players"][0]["user_id"], self.accounts[1].id)
        self.assertEqual(socket.messages[0]["player_id"], session.player_id)
        self.assertNotIn("very-private-passphrase", json.dumps(socket.messages))
        save_active_game(game)
        spectator_socket = RecordingSocket()
        spectator = GameSocketSession(spectator_socket, game, self.identities[1][0])
        self.assertTrue(asyncio.run(handle_session_action(spectator, "spectate_game", {})))
        self.assertEqual(spectator_socket.messages[-1]["error"], "Falsche Passphrase")
        self.assertFalse(rematch_private_consent(game, self.accounts[2].id))
        # The creating host can join without retyping the unchanged password too.
        host = GameSocketSession(RecordingSocket(), game, self.identities[0][0])
        with patch("app.hausdepp_cpu_runner.maybe_schedule_cpu_turn"):
            self.assertFalse(asyncio.run(handle_session_action(host, "join_game", {})))
        self.assertTrue(game["_started"])

    def test_normal_table_still_requires_host_first_and_private_password(self):
        game = new_hausdepp_game("normal", "Normal", "3")
        configure_hausdepp_game(game, host_user_id=self.accounts[0].id, cpu_count=1)
        with self.assertRaisesRegex(ValueError, "hausdepp_host_required"):
            join_hausdepp_player(game, self.player(1))
        game["_passphrase"] = "normal-secret"
        session = GameSocketSession(RecordingSocket(), game, self.identities[0][0])
        self.assertTrue(asyncio.run(handle_session_action(session, "join_game", {})))
        self.assertEqual(game["_players"], [])

    def test_api_requires_fresh_identity_csrf_membership_and_own_invitation(self):
        self.source()
        for request, status in ((request_for(), 401), (self.request(csrf=False), 403), (self.request(2), 404)):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(main.api_hausdepp_rematch("rematch-source", request))
            self.assertEqual(error.exception.status_code, status)
        with patch("app.main.enforce_game_creation_rate_limit"):
            response = asyncio.run(main.api_hausdepp_rematch("rematch-source", self.request()))
        invitation = main.api_hausdepp_invitations(self.request(1))["invitations"][0]
        with TestClient(main.app) as client:
            client.cookies.set("rollthedice_session", self.identities[2][1])
            foreign = client.post(f"/api/hausdepp/invitations/{invitation['id']}/accept",
                                  headers={"X-CSRF-Token": self.identities[2][0].csrf_token})
            self.assertEqual(foreign.status_code, 404)
            self.assertEqual(client.get("/api/hausdepp/invitations").json(), {"invitations": []})
            client.cookies.set("rollthedice_session", self.identities[1][1])
            denied = client.post(f"/api/hausdepp/invitations/{invitation['id']}/accept")
            self.assertEqual(denied.status_code, 403)
            accepted = client.post(f"/api/hausdepp/invitations/{invitation['id']}/accept",
                                   headers={"X-CSRF-Token": self.identities[1][0].csrf_token})
            self.assertEqual(accepted.status_code, 200)
            self.assertEqual(accepted.json(), {"game_id": response["game_id"], "url": response["url"]})
            self.assertIn("no-store", accepted.headers["cache-control"])

    def test_socket_hint_is_only_own_fresh_original_seat_and_transport_failure_is_best_effort(self):
        source = self.source()
        create_rematch(source["_id"], self.accounts[0].id)
        host, friend, spectator = RecordingSocket(), RecordingSocket(), RecordingSocket()
        source["_players"][0]["ws"] = host
        source["_players"][1]["ws"] = friend
        source["_spectators"] = [{"ws": spectator, "user_id": self.accounts[1].id}]
        identities = {id(host): self.identities[0][0], id(friend): self.identities[1][0]}
        with patch("app.auth.resolve_session", side_effect=lambda socket: identities.get(id(socket))):
            asyncio.run(deliver_rematch_invitations(source["_id"]))
        self.assertEqual(host.messages, [])
        self.assertEqual(spectator.messages, [])
        self.assertEqual(friend.messages, [{"hausdepp_invitation": self.invite()}])
        friend.messages.clear()
        with patch("app.auth.resolve_session", return_value=self.identities[2][0]):
            asyncio.run(deliver_rematch_invitations(source["_id"]))
        self.assertEqual(friend.messages, [])
        friend.send_json = AsyncMock(side_effect=WebSocketDisconnect(1000))
        with patch("app.auth.resolve_session", side_effect=lambda socket: identities.get(id(socket))):
            asyncio.run(deliver_rematch_invitations(source["_id"]))
        self.assertEqual(len(self.invite()["id"]), 32)

    def test_actual_manual_retirement_keeps_only_recipe_and_hashed_private_protection(self):
        source = self.source(completed=False)
        sockets = [RecordingSocket(), RecordingSocket()]
        for index, player in enumerate(source["_players"]):
            player["ws"] = sockets[index]
        from app.game_ws_social import handle_social_action

        session = GameSocketSession(sockets[0], source, self.identities[0][0], player_id="human-0")
        asyncio.run(handle_social_action(session, "end_game", {}))
        asyncio.run(main._retire_manual_abort(source))
        self.assertNotIn(source["_id"], games)
        with session_scope() as db:
            self.assertIsNone(db.scalar(select(ActiveGame).where(ActiveGame.game_id == source["_id"])))
            recipe = db.get(HausdeppRematchSource, source["_id"])
            self.assertIsNotNone(recipe)
            data = json.loads(recipe.settings_json)
            self.assertEqual(set(data), {"_name", "_mode", "_hausdepp_cpu_count", "_hausdepp_tournament_enabled", "_passphrase"})
            self.assertNotIn("very-private-passphrase", recipe.settings_json)
            self.assertNotIn("cards", recipe.settings_json)
            self.assertTrue(data["_passphrase"]["hausdepp_hash"].startswith("$argon2id$"))
        response = asyncio.run(main.api_hausdepp_rematch(source["_id"], self.request()))
        target = games[response["game_id"]]
        self.assertTrue(_passphrase_matches(target, {"pass": "very-private-passphrase"}))
        self.assertFalse(_passphrase_matches(target, {"pass": "wrong"}))
        self.assertFalse(_passphrase_matches(target, {"pass": target["_passphrase"]["hausdepp_hash"]}))
        self.assertEqual(main.game_info(target["_id"], self.request(), "very-private-passphrase", 1), {"ok": True, "exists": True})
        with self.assertRaises(HTTPException):
            main.game_info(target["_id"], self.request(), "wrong", 1)
        # A hash-shaped field can never authorize another game's passphrase.
        self.assertFalse(_passphrase_matches({**target, "_game_type": "zilch"}, {"pass": "very-private-passphrase"}))
        self.accept()
        join_hausdepp_player(target, self.player(1))
        join_hausdepp_player(target, self.player(0))
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppRoundCredit)), 0)

    def test_actual_timeout_retirement_and_restart_can_recreate_original_parameters(self):
        source = self.source(completed=False, tournament=True)
        source["_last_activity"] = utcnow() - timedelta(hours=2)
        self.assertEqual(asyncio.run(main._sweep_timeout_aborts()), 1)
        self.assertNotIn(source["_id"], games)
        games.clear()
        self.assertEqual(load_active_games(), {})
        response = create_rematch(source["_id"], self.accounts[1].id)
        target = games[response["game_id"]]
        self.assertEqual((target["_mode"], target["_hausdepp_cpu_count"], target["_hausdepp_tournament_enabled"]), ("3", 1, True))
        self.assertTrue(_passphrase_matches(target, {"passphrase": "very-private-passphrase"}))
        with self.assertRaises(RematchError) as foreign:
            create_rematch(source["_id"], self.accounts[2].id)
        self.assertEqual(foreign.exception.status, 404)

    def test_completed_result_cleanup_and_restart_retain_recipe_without_altering_outcomes(self):
        from app.hausdepp_results import finalize_hausdepp_result

        source = self.source()
        source["_finished_at"] = utcnow().isoformat()
        source["_hausdepp"].update(loser_id="human-1", finished_order=["human-0", "cpu-1"])
        self.assertTrue(finalize_hausdepp_result(source)["result_persisted"])
        with session_scope() as db:
            before = [(row.game_id, row.snapshot_json) for row in db.scalars(select(CompletedGame))]
        games.clear()
        self.assertEqual(load_active_games(), {})
        response = create_rematch(source["_id"], self.accounts[0].id)
        self.assertTrue(_passphrase_matches(games[response["game_id"]], {"pass": "very-private-passphrase"}))
        with session_scope() as db:
            self.assertEqual([(row.game_id, row.snapshot_json) for row in db.scalars(select(CompletedGame))], before)
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppRoundCredit)), 2)

    def test_tournament_interround_never_retains_a_recreation_recipe(self):
        source = self.source(tournament=True, completed=False)
        source["_finished"] = True
        source["_hausdepp"]["phase"] = "finished"
        save_active_game(source)
        with session_scope() as db:
            self.assertIsNone(db.get(HausdeppRematchSource, source["_id"]))

    def test_capture_database_failure_keeps_terminal_recovery_without_interrupting_broadcast_or_retirement(self):
        source = self.source(completed=False)
        socket = RecordingSocket()
        source["_players"][0]["ws"] = socket
        from app.game_ws_social import handle_social_action

        session = GameSocketSession(socket, source, self.identities[0][0], player_id="human-0")
        with patch("app.hausdepp_rematch._insert_once", side_effect=SQLAlchemyError("capture unavailable")):
            self.assertFalse(retain_rematch_source({**source, "_finished": True}))
            asyncio.run(handle_social_action(session, "end_game", {}))
            asyncio.run(main._retire_manual_abort(source))
            self.assertNotIn(source["_id"], games)
            with session_scope() as db:
                terminal = json.loads(db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == source["_id"])))
                self.assertTrue(terminal["_aborted"])
                self.assertTrue(terminal["_hausdepp_rematch_source_pending"])
                self.assertIsNone(db.get(HausdeppRematchSource, source["_id"]))
            # Another failing startup must preserve it without restoring a live room.
            self.assertEqual(load_active_games(), {})
        self.assertTrue(any(message.get("scoreboard", {}).get("_aborted") for message in socket.messages))
        # Recovery is immediate on POST; no restart, no forced foreign seat.
        response = asyncio.run(main.api_hausdepp_rematch(source["_id"], self.request()))
        self.assertTrue(_passphrase_matches(games[response["game_id"]], {"pass": "very-private-passphrase"}))
        self.assertEqual(games[response["game_id"]]["_players"], [])
        with session_scope() as db:
            self.assertIsNone(db.scalar(select(ActiveGame).where(ActiveGame.game_id == source["_id"])))
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppRoundCredit)), 0)

    def test_completed_outcome_stays_successful_when_capture_fails_and_startup_retries_recipe_only(self):
        from app.hausdepp_results import finalize_hausdepp_result

        source = self.source()
        source["_finished_at"] = utcnow().isoformat()
        source["_hausdepp"].update(loser_id="human-1", finished_order=["human-0", "cpu-1"])
        with patch("app.hausdepp_rematch._insert_once", side_effect=SQLAlchemyError("capture unavailable")):
            self.assertTrue(finalize_hausdepp_result(source)["result_persisted"])
            self.assertTrue(source["_completion_persisted"])
            with session_scope() as db:
                self.assertIsNotNone(db.scalar(select(ActiveGame).where(ActiveGame.game_id == source["_id"])))
                self.assertEqual(db.scalar(select(func.count()).select_from(CompletedGame)), 1)
        games.clear()
        self.assertEqual(load_active_games(), {})
        with session_scope() as db:
            self.assertIsNotNone(db.get(HausdeppRematchSource, source["_id"]))
            self.assertIsNone(db.scalar(select(ActiveGame).where(ActiveGame.game_id == source["_id"])))
            self.assertEqual(db.scalar(select(func.count()).select_from(CompletedGame)), 1)
        response = create_rematch(source["_id"], self.accounts[0].id)
        self.assertEqual(games[response["game_id"]]["_players"], [])
