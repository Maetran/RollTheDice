"""Waiting deadlines survive transport activity, recovery and real retirement."""

from __future__ import annotations

import asyncio
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from sqlalchemy import func, select
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import main
from app.active_games import load_active_games, save_active_game
from app.database import session_scope
from app.game_state import GAME_TIMEOUT, check_timeout_and_abort, games, pause_remaining_seconds, touch
from app.hausdepp_state import configure_hausdepp_game, join_hausdepp_player, new_hausdepp_game, start_hausdepp_game
from app.models import AbandonedGame, ActiveGame, CompletedGame, HausdeppAchievementUnlock, HausdeppRoundCredit
from tests import test_hausdepp_waiting as fixtures

JOIN_TIME = "_hausdepp_waiting_last_join_at"


class HausdeppWaitingTimeoutTests(unittest.TestCase):
    setUp = fixtures.HausdeppWaitingTests.setUp
    tearDown = fixtures.HausdeppWaitingTests.tearDown

    def waiting_game(self, name="waiting-timeout", *, at=None):
        at = at or datetime.now(timezone.utc)
        with patch("app.hausdepp_state.datetime") as clock:
            clock.now.return_value = at
            game = new_hausdepp_game(name, "Waiting timeout", "3")
            configure_hausdepp_game(game, host_user_id=self.accounts[0].id, cpu_count=0)
        return game

    def join(self, game, index, *, at):
        account = self.accounts[index]
        with patch("app.hausdepp_state.datetime") as clock:
            clock.now.return_value = at
            join_hausdepp_player(game, {"id": f"human-{index}", "name": account.username,
                                      "user_id": account.id, "ws": None})

    def assert_no_scoring(self):
        with session_scope() as db:
            for model in (CompletedGame, HausdeppRoundCredit, HausdeppAchievementUnlock, AbandonedGame):
                with self.subTest(model=model.__name__):
                    self.assertEqual(db.scalar(select(func.count()).select_from(model)), 0)

    def test_empty_created_table_expires_at_one_hour_even_after_recent_transport_activity(self):
        at = datetime.now(timezone.utc) - timedelta(minutes=59)
        game = self.waiting_game(at=at)
        self.assertEqual(game[JOIN_TIME], at.isoformat())
        touch(game)
        self.assertLessEqual(pause_remaining_seconds(game), 60)
        self.assertFalse(check_timeout_and_abort(game, now=at + GAME_TIMEOUT - timedelta(microseconds=1)))
        self.assertTrue(check_timeout_and_abort(game, now=at + GAME_TIMEOUT))
        self.assertEqual(game["_abort_reason"], "inactivity_timeout")
        self.assertIsNone(game["_results"])
        self.assert_no_scoring()

    def test_only_a_successful_new_human_seat_renews_the_waiting_deadline(self):
        created = datetime.now(timezone.utc) - timedelta(minutes=59)
        game = self.waiting_game(at=created)
        self.join(game, 0, at=created + timedelta(minutes=1))
        accepted = created + timedelta(minutes=58)
        self.join(game, 1, at=accepted)
        self.assertEqual(game[JOIN_TIME], accepted.isoformat())
        self.assertFalse(check_timeout_and_abort(game, now=created + GAME_TIMEOUT))
        with self.assertRaises(ValueError):
            join_hausdepp_player(game, {"id": "guest", "name": "Guest", "user_id": None})
        self.assertEqual(game[JOIN_TIME], accepted.isoformat())
        self.assertFalse(check_timeout_and_abort(game, now=accepted + GAME_TIMEOUT - timedelta(microseconds=1)))
        self.assertTrue(check_timeout_and_abort(game, now=accepted + GAME_TIMEOUT))

    def test_active_game_uses_its_ordinary_activity_not_its_old_waiting_timestamp(self):
        game = new_hausdepp_game("started-clock", "Started clock", "2")
        configure_hausdepp_game(game, host_user_id=self.accounts[0].id, cpu_count=0)
        for index in (0, 1):
            self.join(game, index, at=datetime.now(timezone.utc))
        start_hausdepp_game(game)
        game[JOIN_TIME] = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        touch(game)
        now = game["_last_activity"]
        self.assertFalse(check_timeout_and_abort(game, now=now + GAME_TIMEOUT - timedelta(microseconds=1)))
        self.assertTrue(check_timeout_and_abort(game, now=now + GAME_TIMEOUT))

    def test_stored_waiting_deadline_survives_a_restart_with_newer_general_activity(self):
        at = datetime.now(timezone.utc) - timedelta(minutes=50)
        game = self.waiting_game(at=at)
        self.join(game, 0, at=at)
        touch(game)
        save_active_game(game)
        restored = load_active_games()[game["_id"]]
        self.assertEqual(restored[JOIN_TIME], at.isoformat())
        self.assertFalse(check_timeout_and_abort(restored, now=at + GAME_TIMEOUT - timedelta(microseconds=1)))
        self.assertTrue(check_timeout_and_abort(restored, now=at + GAME_TIMEOUT))

    def test_legacy_fallback_pins_the_last_known_activity_once_and_persists_it(self):
        at = datetime.now(timezone.utc) - timedelta(minutes=50)
        for original in (None, "invalid"):
            with self.subTest(original=original):
                game = self.waiting_game(f"legacy-{original}")
                if original is None:
                    game.pop(JOIN_TIME)
                else:
                    game[JOIN_TIME] = original
                game["_last_activity"] = at
                save_active_game(game)
                restored = load_active_games()[game["_id"]]
                self.assertFalse(check_timeout_and_abort(restored, now=at + timedelta(minutes=59)))
                self.assertEqual(restored[JOIN_TIME], at.isoformat())
                # A restart must read the pinned value even if a viewer/chat
                # has subsequently advanced the generic activity timestamp.
                persisted = load_active_games()[game["_id"]]
                self.assertEqual(persisted[JOIN_TIME], at.isoformat())
                touch(persisted)
                save_active_game(persisted)
                restarted = load_active_games()[game["_id"]]
                self.assertEqual(restarted[JOIN_TIME], at.isoformat())
                self.assertTrue(check_timeout_and_abort(restarted, now=at + GAME_TIMEOUT))

    def test_legacy_without_any_valid_timestamp_receives_only_one_durable_grace_period(self):
        game = self.waiting_game()
        game.pop(JOIN_TIME)
        game["_last_activity"] = "invalid"
        now = datetime.now(timezone.utc)
        self.assertFalse(check_timeout_and_abort(game, now=now))
        self.assertEqual(game[JOIN_TIME], now.isoformat())
        touch(game)
        self.assertFalse(check_timeout_and_abort(game, now=now + GAME_TIMEOUT - timedelta(microseconds=1)))
        self.assertTrue(check_timeout_and_abort(game, now=now + GAME_TIMEOUT))

    def test_real_reconnect_viewer_chat_and_pings_do_not_prevent_periodic_retirement(self):
        host_identity, host_token = self.identities[0]
        viewer_token = self.identities[1][1]
        with TestClient(main.app) as client:
            client.cookies.set("rollthedice_session", host_token)
            created = client.post("/api/games", headers={"X-CSRF-Token": host_identity.csrf_token},
                                  json={"name": "Waiting lifecycle", "mode": "3", "game_type": "hausdepp",
                                        "play_mode": "multiplayer", "cpu_count": 0})
            self.assertEqual(created.status_code, 200)
            game_id = created.json()["game_id"]
            with client.websocket_connect(f"/ws/{game_id}") as first:
                first.receive_json()
                first.send_json({"action": "join_game"})
                player_id = first.receive_json()["player_id"]
                self.assertFalse(fixtures.scoreboard(first)["_started"])
                game = games[game_id]
                last_join = (datetime.now(timezone.utc) - timedelta(minutes=59)).isoformat()
                game[JOIN_TIME] = last_join
                save_active_game(game)
            with client.websocket_connect(f"/ws/{game_id}") as host:
                host.receive_json()
                host.send_json({"action": "join_game"})
                self.assertEqual(host.receive_json()["player_id"], player_id)
                fixtures.scoreboard(host)
                self.assertEqual(game[JOIN_TIME], last_join)
                host.send_json({"action": "ping"})
                self.assertIn("Unbekannte Aktion", host.receive_json()["error"])
                self.assertEqual(game[JOIN_TIME], last_join)
                client.cookies.set("rollthedice_session", viewer_token)
                with client.websocket_connect(f"/ws/{game_id}") as viewer:
                    viewer.receive_json()
                    viewer.send_json({"action": "spectate_game"})
                    self.assertTrue(viewer.receive_json()["spectator"])
                    fixtures.scoreboard(viewer)
                    fixtures.scoreboard(host)
                    self.assertEqual(game[JOIN_TIME], last_join)
                    viewer.send_json({"action": "chat_message", "text": "Still just watching"})
                    self.assertIn("chat", viewer.receive_json())
                    self.assertIn("chat", host.receive_json())
                    self.assertEqual(game[JOIN_TIME], last_join)
                    self.assertGreater(game["_last_activity"], datetime.fromisoformat(last_join))
                    game[JOIN_TIME] = (datetime.now(timezone.utc) - GAME_TIMEOUT).isoformat()

                    async def one_real_lifecycle_tick():
                        stop = asyncio.Event()
                        task = asyncio.create_task(main._run_timeout_sweeper(stop, interval_seconds=0))
                        try:
                            async def retired():
                                while game_id in games:
                                    await asyncio.sleep(0.001)
                            await asyncio.wait_for(retired(), timeout=2)
                        finally:
                            stop.set()
                            await asyncio.wait_for(task, timeout=2)

                    client.portal.call(one_real_lifecycle_tick)
                    for socket in (host, viewer):
                        terminal = fixtures.scoreboard(socket)
                        self.assertTrue(terminal["_aborted"])
                        self.assertEqual(terminal["_abort_reason"], "inactivity_timeout")
                        self.assertIsNone(terminal["_results"])
                        with self.assertRaises(WebSocketDisconnect) as closed:
                            socket.receive_json()
                        self.assertEqual(closed.exception.code, 1000)
        self.assertNotIn(game_id, games)
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(ActiveGame)), 0)
        self.assert_no_scoring()
