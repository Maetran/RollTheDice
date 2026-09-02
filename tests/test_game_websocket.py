import asyncio
from unittest.mock import patch

from app.game_state import _passphrase_from_payload
from app.game_websocket import MessageRateLimiter
from app.game_ws_gameplay import handle_gameplay_action
from app.game_ws_session import GameSocketSession, disconnect_session, handle_session_action
from app.game_ws_social import handle_social_action
from tests.support import GameStateTestCase


class RecordingSocket:
    def __init__(self):
        self.messages = []
        self.close_codes = []

    async def send_json(self, message):
        self.messages.append(message)

    async def close(self, code=1000):
        self.close_codes.append(code)


class RejoinDisconnectTestCase(GameStateTestCase):
    def test_non_string_passphrase_payload_is_rejected_without_crashing(self):
        self.assertEqual(_passphrase_from_payload({"pass": 123}), "")

    def test_replaced_socket_cannot_pause_or_mutate_the_new_session(self):
        game = self.make_game(mode=2, players=[("p1", "Anna"), ("p2", "Ben")])
        old_socket = object()
        new_socket = object()
        game["_players"][0]["ws"] = new_socket
        game["_players"][1]["ws"] = object()
        game["_resume_required"] = False
        game["_superadmins"] = {"p1": {"board_id": "p1"}}
        game["_correction"] = {"active": True, "player_id": "p1", "dice": [1, 1, 1, 1, 2]}
        session = GameSocketSession(
            websocket=old_socket,
            game=game,
            auth_identity=None,
            player_id="p1",
        )

        asyncio.run(disconnect_session(session))

        self.assertIs(game["_players"][0]["ws"], new_socket)
        self.assertFalse(game["_resume_required"])
        self.assertIn("p1", game["_superadmins"])
        self.assertTrue(game["_correction"]["active"])


class MessageRateLimiterTestCase(GameStateTestCase):
    def test_general_and_social_windows_are_independent(self):
        limiter = MessageRateLimiter()
        with patch("app.game_websocket.time.monotonic", return_value=100.0):
            self.assertTrue(all(limiter.check("roll_dice") is None for _ in range(50)))
            self.assertTrue(all(limiter.check("chat_message") is None for _ in range(10)))
            self.assertEqual(limiter.check("chat_message"), "close")

        limiter = MessageRateLimiter()
        with patch("app.game_websocket.time.monotonic", return_value=200.0):
            self.assertTrue(all(limiter.check("chat_message") is None for _ in range(10)))
            self.assertEqual(limiter.check("chat_message"), "wait")


class WebSocketActionGuardTestCase(GameStateTestCase):
    @staticmethod
    def session(game, player_id=None, spectator_id=None):
        websocket = RecordingSocket()
        return GameSocketSession(
            websocket=websocket,
            game=game,
            auth_identity=None,
            player_id=player_id,
            spectator_id=spectator_id,
            is_spectator=bool(spectator_id),
        )

    def test_hold_payload_requires_a_roll_and_five_real_booleans(self):
        game = self.make_game(mode=1, players=[("p1", "Anna")])
        session = self.session(game, player_id="p1")
        game["_players"][0]["ws"] = session.websocket

        asyncio.run(handle_gameplay_action(session, "set_hold", {"holds": [True] * 5}, finalize_game=lambda _g: None))
        self.assertEqual(session.websocket.messages[-1]["error"], "Erst würfeln")
        self.assertEqual(game["_holds"], [False] * 5)

        game["_rolls_used"] = 1
        asyncio.run(
            handle_gameplay_action(
                session,
                "set_hold",
                {"holds": [True, False, "false", False, False]},
                finalize_game=lambda _g: None,
            )
        )
        self.assertEqual(session.websocket.messages[-1]["error"], "Ungültige Würfelauswahl")
        self.assertEqual(game["_holds"], [False] * 5)

        asyncio.run(
            handle_gameplay_action(
                session,
                "set_hold",
                {"holds": [True, False, True, False, False]},
                finalize_game=lambda _g: None,
            )
        )
        self.assertEqual(game["_holds"], [True, False, True, False, False])

    def test_field_cannot_be_written_before_the_first_roll(self):
        game = self.make_game(mode=1, players=[("p1", "Anna")])
        session = self.session(game, player_id="p1")

        asyncio.run(
            handle_gameplay_action(
                session,
                "write_field",
                {"row": 0, "field": "free"},
                finalize_game=lambda _g: None,
            )
        )

        self.assertEqual(session.websocket.messages[-1]["error"], "Erst würfeln")
        self.assertEqual(game["_scoreboards"]["p1"], {})

    def test_only_the_owner_can_cancel_a_correction(self):
        game = self.make_game(mode=2, players=[("p1", "Anna"), ("p2", "Ben")])
        owner = self.session(game, player_id="p1")
        other = self.session(game, player_id="p2")
        game["_players"][0]["ws"] = owner.websocket
        game["_players"][1]["ws"] = other.websocket
        game["_correction"] = {"active": True, "player_id": "p1", "dice": [1, 2, 3, 4, 5]}

        asyncio.run(handle_gameplay_action(other, "cancel_correction", {}, finalize_game=lambda _g: None))
        self.assertEqual(other.websocket.messages[-1]["error"], "Keine Korrektur aktiv")
        self.assertTrue(game["_correction"]["active"])

        asyncio.run(handle_gameplay_action(owner, "cancel_correction", {}, finalize_game=lambda _g: None))
        self.assertFalse(game["_correction"]["active"])

    def test_one_socket_cannot_join_twice(self):
        game = self.make_game(mode=2, players=[("p1", "Anna")])
        session = self.session(game, player_id="p1")

        should_close = asyncio.run(handle_session_action(session, "join_game", {"name": "Duplicate"}))

        self.assertFalse(should_close)
        self.assertEqual(session.websocket.messages[-1]["error"], "Bereits beigetreten")
        self.assertEqual([player["id"] for player in game["_players"]], ["p1"])

    def test_anonymous_legacy_session_without_token_cannot_be_claimed(self):
        game = self.make_game(mode=2, players=[("p1", "Anna"), ("p2", "Ben")])
        session = self.session(game)

        should_close = asyncio.run(
            handle_session_action(
                session,
                "rejoin_game",
                {"player_id": "p1", "resume_token": ""},
            )
        )

        self.assertTrue(should_close)
        self.assertTrue(session.websocket.messages[-1]["fatal"])
        self.assertEqual(session.websocket.close_codes, [1008])
        self.assertIsNone(session.player_id)

    def test_spectator_rejoin_removes_the_old_spectator_record(self):
        game = self.make_game(mode=2, players=[("p1", "Anna"), ("p2", "Ben")])
        session = self.session(game, spectator_id="s1")
        game["_spectators"] = [{"id": "s1", "name": "Anna", "ws": session.websocket}]
        game["_players"][0]["resume_token"] = "resume-p1"
        game["_players"][1]["ws"] = RecordingSocket()

        should_close = asyncio.run(
            handle_session_action(
                session,
                "rejoin_game",
                {"player_id": "p1", "resume_token": "resume-p1"},
            )
        )

        self.assertFalse(should_close)
        self.assertEqual(game["_spectators"], [])
        self.assertEqual(session.player_id, "p1")
        self.assertIsNone(session.spectator_id)
        self.assertFalse(session.is_spectator)

    def test_pause_uses_the_server_side_player_name(self):
        game = self.make_game(mode=2, players=[("p1", "Anna"), ("p2", "Ben")])
        session = self.session(game, player_id="p1")
        game["_players"][0]["ws"] = session.websocket
        game["_players"][1]["ws"] = RecordingSocket()

        asyncio.run(handle_social_action(session, "pause_game", {"by": "Forged name"}))

        self.assertEqual(game["_manual_pause_by"], "p1")
        self.assertEqual(game["_manual_pause_by_name"], "Anna")
