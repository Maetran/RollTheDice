"""Waiting seats are deliberately releasable without abandoning a played round."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import func, select
from starlette.testclient import TestClient

from app import main
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.game_state import games
from app.game_ws_session import GameSocketSession, handle_session_action
from app.hausdepp_cpu_runner import stop_cpu_runners
from app.hausdepp_snapshot import snapshot_hausdepp
from app.hausdepp_state import configure_hausdepp_game, join_hausdepp_player, new_hausdepp_game, start_hausdepp_game
from app.models import ActiveGame, CompletedGame, HausdeppRoundCredit
from tests.test_hausdepp_integration import RecordingSocket
from tests.test_user_accounts import request_for


def scoreboard(socket):
    for _ in range(12):
        frame = socket.receive_json()
        if "scoreboard" in frame:
            return frame["scoreboard"]
    raise AssertionError("No scoreboard")


class HausdeppWaitingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/waiting.sqlite3",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
        })
        self.env.start()
        self.registry = patch.dict(games, clear=True)
        self.registry.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.accounts = [create_user(name, "secure-password-123", must_change_password=False)
                         for name in ("WaitingHost", "WaitingFriend")]
        self.identities = [login(request_for(), user.username, "secure-password-123") for user in self.accounts]

    def tearDown(self):
        asyncio.run(stop_cpu_runners())
        self.registry.stop()
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def test_real_sockets_release_own_seat_transfer_host_and_retire_last_waiter_without_points(self):
        host_identity, host_token = self.identities[0]
        created = asyncio.run(main.api_games_create(main.CreateReq(
            game_type="hausdepp", mode="4", name="Waiting test", play_mode="cpu", cpu_count=1,
        ), request_for(cookie=f"rollthedice_session={host_token}", csrf=host_identity.csrf_token)))
        game_id = created["game_id"]
        with TestClient(main.app) as host, TestClient(main.app) as friend:
            host.cookies.set("rollthedice_session", host_token)
            friend.cookies.set("rollthedice_session", self.identities[1][1])
            with host.websocket_connect(f"/ws/{game_id}") as host_ws:
                self.assertTrue(host_ws.receive_json()["auth"]["authenticated"])
                host_ws.send_json({"action": "join_game"})
                host_id = host_ws.receive_json()["player_id"]
                self.assertEqual(scoreboard(host_ws)["_waiting_permissions"], {"can_leave": True, "is_host": True})
                with friend.websocket_connect(f"/ws/{game_id}") as friend_ws:
                    self.assertTrue(friend_ws.receive_json()["auth"]["authenticated"])
                    friend_ws.send_json({"action": "join_game"})
                    previous_id = friend_ws.receive_json()["player_id"]
                    self.assertEqual(scoreboard(friend_ws)["_waiting_permissions"], {"can_leave": True, "is_host": False})
                    scoreboard(host_ws)
                    friend_ws.send_json({"action": "leave_waiting_game", "player_id": host_id})
                    self.assertEqual(friend_ws.receive_json(), {"left_waiting_game": True, "table_closed": False,
                                                              "host_transferred": False, "redirect": "/hausdepp"})
                    remaining = scoreboard(host_ws)
                    self.assertEqual([item["id"] for item in remaining["_players"]], [host_id])
                    self.assertNotIn(previous_id, [item["id"] for item in remaining["_participants"]])
                with friend.websocket_connect(f"/ws/{game_id}") as friend_ws:
                    self.assertTrue(friend_ws.receive_json()["auth"]["authenticated"])
                    friend_ws.send_json({"action": "join_game"})
                    self.assertNotEqual(friend_ws.receive_json()["player_id"], previous_id)
                    scoreboard(friend_ws)
                    scoreboard(host_ws)
                    host_ws.send_json({"action": "leave_waiting_game"})
                    self.assertTrue(host_ws.receive_json()["host_transferred"])
                    self.assertTrue(scoreboard(friend_ws)["_waiting_permissions"]["is_host"])
                    friend_ws.send_json({"action": "leave_waiting_game"})
                    self.assertTrue(friend_ws.receive_json()["table_closed"])
        self.assertNotIn(game_id, games)
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(ActiveGame)), 0)
            self.assertEqual(db.scalar(select(func.count()).select_from(CompletedGame)), 0)
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppRoundCredit)), 0)

    def test_started_tables_stale_sockets_spectators_and_forged_identity_cannot_leave(self):
        game = new_hausdepp_game("waiting-guards", "Waiting guards", "2")
        configure_hausdepp_game(game, host_user_id=self.accounts[0].id, cpu_count=0)
        sockets = [RecordingSocket(), RecordingSocket()]
        for index, user in enumerate(self.accounts):
            join_hausdepp_player(game, {"id": f"human-{index}", "name": user.username,
                                      "user_id": user.id, "ws": sockets[index]})
        identity = self.identities[0][0]
        for socket, player_id, auth, spectator in (
            (RecordingSocket(), "human-0", identity, False),
            (sockets[0], "human-0", self.identities[1][0], False),
            (RecordingSocket(), None, identity, True),
        ):
            session = GameSocketSession(socket, game, auth, player_id=player_id, is_spectator=spectator)
            self.assertFalse(asyncio.run(handle_session_action(session, "leave_waiting_game", {})))
            self.assertEqual(socket.messages[-1]["error"], "hausdepp_waiting_leave_not_seated")
            self.assertEqual(len(game["_players"]), 2)
        start_hausdepp_game(game)
        before = json.dumps({key: value for key, value in game.items() if key == "_hausdepp"}, sort_keys=True)
        session = GameSocketSession(sockets[0], game, identity, player_id="human-0")
        self.assertFalse(snapshot_hausdepp(game, "human-0")["_waiting_permissions"]["can_leave"])
        self.assertFalse(asyncio.run(handle_session_action(session, "leave_waiting_game", {})))
        self.assertEqual(sockets[0].messages[-1]["error"], "hausdepp_waiting_already_started")
        self.assertEqual(json.dumps({key: value for key, value in game.items() if key == "_hausdepp"}, sort_keys=True), before)
