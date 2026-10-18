"""Flexible waiting rooms keep admission, host commands and durable seats aligned."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError
from starlette.testclient import TestClient

from app import main
from app.active_games import load_active_games, save_active_game
from app.auth import create_user, login
from app.database import configure_database, upgrade_database
from app.game_snapshot import snapshot
from app.game_state import games
from app.game_ws_session import GameSocketSession
from app.hausdepp_cpu_runner import stop_cpu_runners
from app.hausdepp_gameplay import handle_hausdepp_gameplay_action
from app.hausdepp_rematch import create_rematch, pending_invitations, respond_to_invitation
from app.hausdepp_state import (
    configure_hausdepp_game,
    join_hausdepp_player,
    new_hausdepp_game,
    start_hausdepp_game,
)
from app.web_push import open_seat_invitation_error
from tests.test_hausdepp_integration import RecordingSocket
from tests.test_user_accounts import request_for


class HausdeppFlexibleWaitingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/flexible-waiting.sqlite3",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
            "ROLLTHEDICE_HAUSDEPP_CPU_DELAY_SECONDS": "60",
        })
        self.env.start()
        self.registry = patch.dict(games, clear=True)
        self.registry.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.accounts = [create_user(name, "secure-password-123", must_change_password=False)
                         for name in ("FlexibleHost", "FlexibleFriend", "FlexibleOther")]
        self.identities = [login(request_for(), user.username, "secure-password-123") for user in self.accounts]

    def tearDown(self):
        asyncio.run(stop_cpu_runners())
        self.registry.stop()
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def request(self, index=0):
        identity, token = self.identities[index]
        return request_for(cookie=f"rollthedice_session={token}", csrf=identity.csrf_token)

    def game(self, *, waiting_mode="open", count=6, cpus=0, manual=True, tournament=False):
        game = new_hausdepp_game("flexible-room", "Flexible waiting", str(count))
        configure_hausdepp_game(game, host_user_id=self.accounts[0].id, cpu_count=cpus,
                                waiting_mode=waiting_mode, manual_start=manual, tournament=tournament)
        return game

    def join(self, game, index=0, *, socket=None):
        player = {"id": f"person-{index}", "name": self.accounts[index].username,
                  "user_id": self.accounts[index].id, "ws": socket or RecordingSocket()}
        join_hausdepp_player(game, player)
        start_hausdepp_game(game)
        return player

    def command(self, game, player, action, **data):
        index = next(index for index, account in enumerate(self.accounts) if account.id == player["user_id"])
        session = GameSocketSession(player["ws"], game, self.identities[index][0], player_id=player["id"])
        asyncio.run(handle_hausdepp_gameplay_action(session, action, data))
        return player["ws"].messages[-1]

    def test_creation_options_are_strict_game_scoped_and_keep_legacy_defaults(self):
        legacy = main.CreateReq(name="Legacy", mode="3", game_type="hausdepp")
        self.assertEqual((legacy.waiting_mode, legacy.manual_start, legacy.cpu_count), ("fixed", False, 1))
        opened = main.CreateReq(name="Open", mode="2", game_type="hausdepp", waiting_mode="open",
                                play_mode="multiplayer", cpu_count=0)
        self.assertEqual((opened.mode, opened.manual_start), ("6", True))
        empty_opened = main.CreateReq(name="Open", mode="6", game_type="hausdepp", waiting_mode="open")
        self.assertEqual((empty_opened.play_mode, empty_opened.cpu_count), ("multiplayer", 0))
        for extra in ({"waiting_mode": "unknown"}, {"manual_start": "false"}):
            with self.subTest(extra=extra), self.assertRaises(ValidationError):
                main.CreateReq(name="Bad", mode="2", game_type="hausdepp", **extra)
        for extra in ({"waiting_mode": "open"}, {"manual_start": True}):
            with self.subTest(extra=extra), self.assertRaises(ValidationError):
                main.CreateReq(name="Other game", mode="2", game_type="zdwa", **extra)

    def test_open_room_never_autostarts_and_start_freezes_actual_tournament_roster(self):
        game = self.game(tournament=True)
        host = self.join(game)
        self.join(game, 1)
        self.assertFalse(game["_started"])
        self.assertEqual(game["_mode"], "6")
        self.assertNotIn("_hausdepp_tournament", game)
        self.assertTrue(snapshot(game, host["id"])["_hausdepp_tournament_enabled"])
        self.command(game, host, "hausdepp_add_cpu")
        self.command(game, host, "hausdepp_start_game")
        self.assertTrue(game["_started"])
        self.assertEqual((game["_mode"], game["_expected"], game["_expected_connections"]), ("3", 3, 2))
        self.assertEqual(set(game["_hausdepp_tournament"]["losses"]),
                         {player["id"] for player in game["_participants"]})
        self.assertEqual(len(game["_hausdepp"]["players"]), 3)
        self.assertEqual(self.command(game, host, "hausdepp_add_cpu")["error_code"],
                         "hausdepp_waiting_already_started")
        with self.assertRaisesRegex(ValueError, "already_started"):
            self.join(game, 2)

    def test_open_requires_two_and_connected_humans_while_fixed_manual_requires_capacity(self):
        game = self.game()
        host = self.join(game)
        self.assertEqual(self.command(game, host, "hausdepp_start_game")["error_code"],
                         "hausdepp_waiting_minimum_players")
        friend = self.join(game, 1)
        friend["ws"] = None
        self.assertEqual(self.command(game, host, "hausdepp_start_game")["error_code"],
                         "hausdepp_waiting_players_offline")
        friend["ws"] = RecordingSocket()
        self.command(game, host, "hausdepp_start_game")
        self.assertTrue(game["_started"])
        game = self.game(waiting_mode="fixed", count=3)
        host = self.join(game)
        self.join(game, 1)
        self.assertEqual(self.command(game, host, "hausdepp_start_game")["error_code"],
                         "hausdepp_waiting_not_full")
        self.command(game, host, "hausdepp_add_cpu")
        self.assertFalse(game["_started"])
        self.command(game, host, "hausdepp_start_game")
        self.assertEqual(len(game["_hausdepp"]["players"]), 3)

    def test_free_seats_precede_cpu_replacement_and_removed_cpu_ids_are_not_reused(self):
        game = self.game(cpus=2)
        host = self.join(game)
        original_cpus = [person["id"] for person in game["_participants"] if person.get("is_cpu")]
        self.join(game, 1)
        self.assertEqual(game["_hausdepp_cpu_count"], 2)
        for _ in range(2):
            self.command(game, host, "hausdepp_add_cpu")
        self.assertEqual(len(game["_participants"]), 6)
        self.assertEqual(self.command(game, host, "hausdepp_add_cpu")["error_code"], "hausdepp_game_full")
        removed_id = game["_participants"][-1]["id"]
        self.assertIsNone(open_seat_invitation_error(game, user_id=host["user_id"]))
        self.join(game, 2)
        self.assertEqual((len(game["_participants"]), len(game["_players"]), game["_hausdepp_cpu_count"]), (6, 3, 3))
        self.assertEqual(game["_expected_connections"], 3)
        self.assertNotIn(removed_id, {person["id"] for person in game["_participants"]})
        self.assertEqual(self.command(game, host, "hausdepp_remove_cpu", participant_id=removed_id)["error_code"],
                         "hausdepp_waiting_cpu_not_found")
        self.command(game, host, "hausdepp_remove_cpu", participant_id=original_cpus[0])
        self.command(game, host, "hausdepp_add_cpu")
        self.assertNotEqual(game["_participants"][-1]["id"], removed_id)
        self.assertEqual(len({person["id"] for person in game["_participants"]}), 6)
        self.assertEqual(len({person["name"].casefold() for person in game["_participants"]}), 6)

    def test_host_guards_reject_other_account_stale_socket_forged_actor_and_spectator(self):
        game = self.game()
        host = self.join(game)
        friend = self.join(game, 1)
        self.assertEqual(self.command(game, friend, "hausdepp_add_cpu")["error_code"], "hausdepp_host_required")
        for socket, identity, player_id, spectator in (
            (RecordingSocket(), self.identities[0][0], host["id"], False),
            (host["ws"], self.identities[1][0], host["id"], False),
            (RecordingSocket(), self.identities[0][0], None, True),
        ):
            session = GameSocketSession(socket, game, identity, player_id=player_id, is_spectator=spectator)
            asyncio.run(handle_hausdepp_gameplay_action(session, "hausdepp_add_cpu", {}))
            self.assertEqual(socket.messages[-1]["error_code"], "hausdepp_invalid_actor")
        self.assertEqual(len(game["_participants"]), 2)
        self.assertEqual(self.command(game, host, "hausdepp_remove_cpu", participant_id=friend["id"])["error_code"],
                         "hausdepp_waiting_cpu_not_found")

    def test_persistence_lobby_metadata_and_start_permissions_agree_after_cpu_replacement(self):
        game = self.game(cpus=4)
        host = self.join(game)
        self.join(game, 1)
        save_active_game(game)
        lobby = asyncio.run(main.api_games(self.request(), game_type="hausdepp"))["games"][0]
        detail = main.game_info(game["_id"], self.request(), passphrase=None, check=0)
        for metadata in (lobby, detail):
            self.assertTrue(metadata["can_join"])
            self.assertEqual((metadata["waiting_mode"], metadata["manual_start"], metadata["free_seats"],
                              metadata["replaceable_cpus"]), ("open", True, 0, 4))
        restored = load_active_games()[game["_id"]]
        self.assertFalse(restored["_started"])
        self.assertEqual(restored["_hausdepp_waiting_mode"], "open")
        self.assertEqual(restored["_hausdepp_cpu_count"], 4)
        self.assertEqual(restored["_expected_connections"], 2)
        permissions = snapshot(restored, host["id"])["_waiting_permissions"]
        self.assertTrue(permissions["is_host"])
        self.assertFalse(permissions["can_start"])
        self.assertEqual(permissions["start_reason"], "hausdepp_waiting_players_offline")
        self.assertNotIn("resume_token", json.dumps(snapshot(restored)))

    def test_fixed_legacy_creation_still_autostarts(self):
        game = self.game(waiting_mode="fixed", count=2, cpus=1, manual=False)
        self.join(game)
        self.assertTrue(game["_started"])
        self.assertEqual(len(game["_hausdepp"]["players"]), 2)

    def test_fixed_full_room_accepts_human_in_cpu_seat_without_changing_capacity(self):
        game = self.game(waiting_mode="fixed", count=2, cpus=1)
        host = self.join(game)
        old_cpu = game["_participants"][-1]["id"]
        self.join(game, 1)
        self.assertEqual((game["_expected"], game["_expected_connections"], game["_hausdepp_cpu_count"]), (2, 2, 0))
        self.assertEqual(game["_play_mode"], "multiplayer")
        self.assertNotIn(old_cpu, {person["id"] for person in game["_participants"]})
        with self.assertRaisesRegex(ValueError, "game_full"):
            self.join(game, 2)
        self.assertEqual(open_seat_invitation_error(game, user_id=host["user_id"]), "game_invite_no_open_seat")
        self.command(game, host, "hausdepp_start_game")
        self.assertTrue(game["_started"])

    def test_rematch_invitation_reservations_block_cpu_and_early_start_commands(self):
        source = self.game(waiting_mode="fixed", count=3, cpus=1, manual=False)
        self.join(source)
        self.join(source, 1)
        source["_finished"] = True
        source["_hausdepp"]["phase"] = "finished"
        rematch = create_rematch(source["_id"], self.accounts[0].id)
        game = games[rematch["game_id"]]
        host = self.join(game)
        before = len(game["_participants"])
        for action in ("hausdepp_add_cpu", "hausdepp_start_game"):
            self.assertEqual(self.command(game, host, action)["error_code"], "hausdepp_rematch_reserved_seats")
            self.assertEqual(len(game["_participants"]), before)
            self.assertFalse(game["_started"])

    def test_rematch_full_waiting_cpu_table_accepts_a_human_after_invitee_declines(self):
        source = self.game(waiting_mode="fixed", count=3, cpus=1, manual=False)
        self.join(source)
        self.join(source, 1)
        source["_finished"] = True
        source["_hausdepp"]["phase"] = "finished"
        rematch = create_rematch(source["_id"], self.accounts[0].id)
        game = games[rematch["game_id"]]
        host = self.join(game)
        invitation = pending_invitations(self.accounts[1].id)["invitations"][0]
        respond_to_invitation(invitation["id"], self.accounts[1].id, accept=False)
        self.command(game, host, "hausdepp_add_cpu")
        self.assertEqual(len(game["_participants"]), 3)
        self.assertFalse(game["_started"])
        self.assertEqual(game["_expected_connections"], 1)
        self.join(game, 2)
        self.assertTrue(game["_started"])
        self.assertEqual((len(game["_players"]), game["_hausdepp_cpu_count"]), (2, 1))

    def test_rematch_invitee_can_accept_again_and_replace_cpu_without_losing_reservation(self):
        source = self.game(waiting_mode="fixed", count=3, cpus=1, manual=False)
        self.join(source)
        self.join(source, 1)
        source["_finished"] = True
        source["_hausdepp"]["phase"] = "finished"
        rematch = create_rematch(source["_id"], self.accounts[0].id)
        game = games[rematch["game_id"]]
        host = self.join(game)
        invitation = pending_invitations(self.accounts[1].id)["invitations"][0]
        respond_to_invitation(invitation["id"], self.accounts[1].id, accept=False)
        self.command(game, host, "hausdepp_add_cpu")
        accepted = respond_to_invitation(invitation["id"], self.accounts[1].id, accept=True)
        self.assertEqual(accepted["game_id"], game["_id"])
        with self.assertRaisesRegex(ValueError, "rematch_reserved_seats"):
            self.join(game, 2)
        self.assertFalse(game["_started"])
        self.join(game, 1)
        self.assertTrue(game["_started"])
        self.assertEqual((len(game["_players"]), game["_hausdepp_cpu_count"]), (2, 1))

    def test_real_http_and_socket_password_open_room_add_remove_and_manual_start(self):
        token = self.identities[0][1]
        with TestClient(main.app) as client:
            client.cookies.set("rollthedice_session", token)
            created = client.post("/api/games", json={
                "name": "Protected open room", "game_type": "hausdepp", "mode": "6", "waiting_mode": "open",
                "play_mode": "multiplayer", "cpu_count": 0, "pass": "private-test-code",
            }, headers={"x-csrf-token": self.identities[0][0].csrf_token})
            self.assertEqual(created.status_code, 200, created.text)
            game_id = created.json()["game_id"]
            with client.websocket_connect(f"/ws/{game_id}") as denied:
                denied.receive_json()
                denied.send_json({"action": "join_game", "pass": "wrong"})
                self.assertEqual(denied.receive_json()["error"], "Falsche Passphrase")
            with client.websocket_connect(f"/ws/{game_id}") as ws:
                ws.receive_json()
                ws.send_json({"action": "join_game", "pass": "private-test-code"})
                self.assertIn("player_id", ws.receive_json())

                def board():
                    for _ in range(12):
                        frame = ws.receive_json()
                        if "scoreboard" in frame:
                            return frame["scoreboard"]
                    self.fail("No scoreboard")

                self.assertFalse(board()["_started"])
                ws.send_json({"action": "hausdepp_add_cpu"})
                added = board()
                self.assertEqual(len(added["_participants"]), 2)
                cpu_id = next(person["id"] for person in added["_participants"] if person["is_cpu"])
                ws.send_json({"action": "hausdepp_remove_cpu", "participant_id": cpu_id})
                self.assertEqual(len(board()["_participants"]), 1)
                ws.send_json({"action": "hausdepp_add_cpu"})
                self.assertFalse(board()["_started"])
                ws.send_json({"action": "hausdepp_start_game"})
                started = board()
                self.assertTrue(started["_started"])
                self.assertEqual((started["_mode"], started["_expected"]), ("2", 2))
                self.assertTrue(started["locked"])
                self.assertNotIn("private-test-code", json.dumps(started))
