"""Two real local accounts exercise Hausdepp's HTTP/WebSocket transport.

The normal app deliberately admits only its permanent founder. This fixture
uses a temporary database and overrides the capability in a bounded unittest
context for exactly two fixture account IDs. There is no environment bypass,
production policy change, seat injection, fake session, or manual test server.
Only the shuffled deck is deterministic; both seats join through real sockets.
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import main
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.game_access import can_access_hausdepp
from app.game_state import games
from app.hausdepp_engine import make_deck, new_round
from app.ownership import bind_founder
from tests.test_user_accounts import request_for


class HausdeppLocalMultiplayerTransportTests(unittest.TestCase):
    def setUp(self):
        games.clear()
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/local-multiplayer.sqlite3",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.founder = create_user("LocalFounder", "secure-password-123", role="admin", must_change_password=False)
        self.second = create_user("LocalPlayer", "secure-password-123", must_change_password=False)
        with session_scope() as db:
            bind_founder(db, self.founder.id)
        self.founder_identity, self.founder_token = login(request_for(), self.founder.username, "secure-password-123")
        self.second_identity, self.second_token = login(request_for(), self.second.username, "secure-password-123")

    def tearDown(self):
        games.clear()
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    @staticmethod
    def headers(token):
        return {"cookie": f"rollthedice_session={token}", "origin": "http://testserver"}

    def message(self, websocket, key):
        for _ in range(12):
            payload = websocket.receive_json()
            self.assertNotIn("error", payload, payload)
            if key in payload:
                return payload[key]
        self.fail(f"No {key} frame received")

    def board(self, websocket):
        return self.message(websocket, "scoreboard")

    def assert_private(self, snapshot, *, own_id, hand, peek):
        state = snapshot["_hausdepp"]
        self.assertEqual(state["viewer_id"], own_id)
        self.assertEqual(state["hand"], hand)
        self.assertEqual(state["private_peek"], peek)
        self.assertNotIn("deck", state)
        self.assertNotIn("burned", state)
        self.assertTrue(all("hand" not in player for player in state["players"]))
        self.assertNotIn("cards", state["peek"])
        self.assertNotIn("resume_token", json.dumps(snapshot))
        return state

    def test_two_account_join_private_play_manual_refill_disconnect_and_account_rejoin(self):
        # Local accounts have no special production capability by location.
        self.assertTrue(can_access_hausdepp(self.founder_identity))
        self.assertFalse(can_access_hausdepp(self.second_identity))
        self.assertFalse(can_access_hausdepp(None))
        prefix = ["hearts-6", "hearts-K", "bells-6", "bells-K", "hearts-10", "leaves-A",
                  "acorns-6", "hearts-7", "hearts-8"]
        bottom = "acorns-9"
        deck = prefix + [card for card in make_deck() if card not in {*prefix, bottom}] + [bottom]
        fixture_ids = {self.founder.id, self.second.id}

        def local_fixture_capability(identity):
            return bool(identity and identity.user_id in fixture_ids)

        def arranged_round(participants, dealer_index=0):
            return new_round(participants, dealer_index=dealer_index, deck=deck)

        founder_headers = self.headers(self.founder_token)
        second_headers = self.headers(self.second_token)
        with TestClient(main.app) as client:
            # Demonstrate denial before the isolated test override begins.
            self.assertEqual(client.get("/hausdepp", headers=second_headers).status_code, 403)
            with patch("app.game_access.can_access_hausdepp", side_effect=local_fixture_capability), patch(
                "app.main.can_access_hausdepp", side_effect=local_fixture_capability,
            ), patch("app.hausdepp_engine.new_round", side_effect=arranged_round) as deal:
                created = client.post("/api/games", json={
                    "name": "Local two-account transport fixture", "mode": "2", "game_type": "hausdepp",
                    "play_mode": "multiplayer", "cpu_count": 0,
                }, headers={**founder_headers, "x-csrf-token": self.founder_identity.csrf_token})
                self.assertEqual(created.status_code, 200, created.text)
                game_id = created.json()["game_id"]
                self.assertEqual(client.get(f"/hausdepp/spiel/{game_id}", headers=second_headers).status_code, 200)
                client.cookies.clear()
                with self.assertRaises(WebSocketDisconnect) as guest:
                    with client.websocket_connect(f"/ws/{game_id}"):
                        self.fail("The fixture capability must still reject guests")
                self.assertEqual(guest.exception.code, 1008)
                with client.websocket_connect(f"/ws/{game_id}", headers=founder_headers) as first:
                    initial = self.message(first, "auth")
                    self.assertEqual(initial["user"]["id"], self.founder.id)
                    first.send_json({"action": "join_game"})
                    first_join = first.receive_json()
                    first_id = first_join["player_id"]
                    waiting = self.board(first)
                    self.assertFalse(waiting["_started"])
                    self.assertIsNone(waiting["_hausdepp"])
                    with client.websocket_connect(f"/ws/{game_id}", headers=second_headers) as second:
                        initial = self.message(second, "auth")
                        self.assertEqual(initial["user"]["id"], self.second.id)
                        self.assertFalse(initial["user"]["is_owner"])
                        second.send_json({"action": "join_game"})
                        second_join = second.receive_json()
                        second_id = second_join["player_id"]
                        second_started = self.board(second)
                        first_started = self.board(first)
                        self.assertNotEqual(first_id, second_id)
                        self.assertTrue(first_started["_started"])
                        self.assertEqual(first_started["_players_joined"], 2)
                        self.assertEqual({player["user_id"] for player in first_started["_players"]}, fixture_ids)
                        self.assertTrue(all(not player["is_cpu"] for player in first_started["_participants"]))
                        self.assertEqual(first_started["_hausdepp"]["phase"], "peeking")
                        self.assertEqual(first_started["_hausdepp"]["hand"], [])
                        self.assertEqual(first_started["_hausdepp"]["available_actions"], ["peek"])
                        self.assertEqual(second_started["_hausdepp"]["available_actions"], [])
                        first.send_json({"action": "hausdepp_peek", "version": first_started["_hausdepp"]["version"]})
                        first_started = self.board(first)
                        second_started = self.board(second)
                        first_state = self.assert_private(first_started, own_id=first_id,
                                                          hand=["hearts-6", "bells-6", "hearts-10"], peek=[bottom])
                        self.assert_private(second_started, own_id=second_id,
                                            hand=["hearts-K", "bells-K", "leaves-A"], peek=[])
                        deal.assert_called_once()
                        # Another account cannot claim the founder's seat with
                        # a guessed player ID or a forged resume token.
                        with client.websocket_connect(f"/ws/{game_id}", headers=second_headers) as forged:
                            self.message(forged, "auth")
                            forged.send_json({"action": "rejoin_game", "player_id": first_id,
                                              "resume_token": "not-the-founders-resume-token"})
                            denied = forged.receive_json()
                            self.assertTrue(denied["fatal"])
                            self.assertNotIn("scoreboard", denied)
                        first.send_json({"action": "hausdepp_play", "cards": ["hearts-6", "bells-6"],
                                         "version": first_state["version"]})
                        first_pending = self.assert_private(self.board(first), own_id=first_id,
                                                            hand=["hearts-10"], peek=[bottom])
                        second_pending = self.assert_private(self.board(second), own_id=second_id,
                                                             hand=["hearts-K", "bells-K", "leaves-A"], peek=[])
                        self.assertEqual(first_pending["available_actions"], ["draw"])
                        self.assertEqual(second_pending["available_actions"], ["play", "pickup"])
                        self.assertEqual(first_pending["pending_refill"]["remaining"], 2)
                        self.assertEqual(first_pending["deck_count"], first_state["deck_count"])
                        second.send_json({"action": "hausdepp_draw", "version": second_pending["version"],
                                          "actor_id": first_id})
                        self.assertEqual(second.receive_json()["error_code"], "hausdepp_no_refill_pending")
                        # The next human places before its predecessor draws.
                        # Both hands owe a refill, but the stock queue is FIFO.
                        second.send_json({"action": "hausdepp_play", "cards": ["hearts-K", "bells-K"],
                                          "version": second_pending["version"]})
                        second_before_fill = self.assert_private(self.board(second), own_id=second_id,
                                                                hand=["leaves-A"], peek=[])
                        self.assert_private(self.board(first), own_id=first_id, hand=["hearts-10"], peek=[bottom])
                        self.assertTrue(second_before_fill["draw_required"])
                        self.assertFalse(second_before_fill["draw_urgent"])
                        self.assertEqual(second_before_fill["stock_blocked_by"], first_id)
                        self.assertNotIn("draw", second_before_fill["available_actions"])
                        second.send_json({"action": "hausdepp_draw", "version": second_before_fill["version"]})
                        self.assertEqual(second.receive_json()["error_code"], "hausdepp_stock_refill_wait")
                        first.send_json({"action": "hausdepp_draw", "version": first_pending["version"]})
                        first_filled = self.assert_private(self.board(first), own_id=first_id,
                                                           hand=["hearts-10", "hearts-7", "hearts-8"], peek=[bottom])
                        second_frame = self.board(second)
                        second_turn = self.assert_private(second_frame, own_id=second_id,
                                                          hand=["leaves-A"], peek=[])
                        self.assertEqual(first_filled["deck_count"], first_state["deck_count"] - 2)
                        self.assertIsNone(first_filled["pending_refill"])
                        self.assertEqual(first_filled["current_player_id"], first_id)
                        self.assertNotIn("hearts-7", json.dumps(second_frame))
                        self.assertNotIn("hearts-8", json.dumps(second_frame))
                        second_needs_draw = second_turn
                        self.assertEqual(second_needs_draw["available_actions"], ["draw"])
                        self.assertTrue(second_needs_draw["draw_urgent"])
                        self.assertEqual(second_needs_draw["pending_refill"]["player_id"], second_id)
                    # Real socket closure pauses the room without completing
                    # the absent account's mandatory refill on its behalf.
                    paused = self.board(first)
                    self.assertTrue(paused["_paused"])
                    self.assertEqual(paused["_hausdepp"]["version"], second_needs_draw["version"])
                    self.assertEqual(paused["_hausdepp"]["pending_refills"][0]["player_id"], second_id)
                    first.send_json({"action": "hausdepp_gamble", "version": second_needs_draw["version"]})
                    self.assertIn("error", first.receive_json())
                    # A fresh socket needs only the real account session; no
                    # injected seat or copied resume token is used to resume.
                    with client.websocket_connect(f"/ws/{game_id}", headers=second_headers) as resumed:
                        self.message(resumed, "auth")
                        resumed.send_json({"action": "join_game"})
                        recovered = resumed.receive_json()
                        self.assertTrue(recovered["resumed"])
                        self.assertEqual(recovered["player_id"], second_id)
                        self.assertEqual(recovered["resume_token"], second_join["resume_token"])
                        resumed_frame = self.board(resumed)
                        resumed_state = self.assert_private(resumed_frame, own_id=second_id, hand=["leaves-A"], peek=[])
                        first_resumed = self.board(first)
                        self.assertFalse(resumed_frame["_paused"])
                        self.assertFalse(first_resumed["_paused"])
                        self.assertEqual(resumed_state["available_actions"], ["draw"])
                        self.assertEqual(resumed_state["version"], second_needs_draw["version"])
                        resumed.send_json({"action": "hausdepp_draw", "version": resumed_state["version"]})
                        final_second = self.assert_private(self.board(resumed), own_id=second_id,
                                                           hand=["leaves-A", "hearts-9", "hearts-U"], peek=[])
                        final_first_frame = self.board(first)
                        final_first = self.assert_private(final_first_frame, own_id=first_id,
                                                          hand=["hearts-10", "hearts-7", "hearts-8"], peek=[bottom])
                        self.assertIsNone(final_second["pending_refill"])
                        self.assertEqual(final_first["current_player_id"], first_id)
                        self.assertEqual(final_first["deck_count"], first_state["deck_count"] - 4)
                        self.assertNotIn("hearts-9", json.dumps(final_first_frame))
                        self.assertNotIn("hearts-U", json.dumps(final_first_frame))
                # Neither account receives private cards through lobby/HTTP
                # metadata, even inside this test-only two-person audience.
                for headers in (founder_headers, second_headers):
                    metadata = client.get(f"/api/games/{game_id}", headers=headers).json()
                    lobby = client.get("/api/games?game_type=hausdepp", headers=headers).json()
                    self.assertNotIn("_hausdepp", metadata)
                    self.assertNotIn("hearts-10", json.dumps([metadata, lobby]))
            # The override's lifetime ended. A normal local account is denied
            # again by the actual page, lobby and WebSocket policy.
            self.assertFalse(can_access_hausdepp(self.second_identity))
            self.assertEqual(client.get("/hausdepp", headers=second_headers).status_code, 403)
            self.assertEqual(client.get("/api/games?game_type=hausdepp", headers=second_headers).json()["games"], [])
            with self.assertRaises(WebSocketDisconnect) as denied:
                with client.websocket_connect(f"/ws/{game_id}", headers=second_headers):
                    self.fail("The isolated fixture must not leave access enabled")
            self.assertEqual(denied.exception.code, 1008)


if __name__ == "__main__":
    unittest.main()
