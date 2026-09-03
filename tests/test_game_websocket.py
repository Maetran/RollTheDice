import asyncio
import json
from datetime import datetime, timezone
from unittest.mock import patch

from app.game_snapshot import snapshot
from app.game_state import WRITABLE_COLS, WRITABLE_ROWS, _passphrase_from_payload
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


class JsonRecordingSocket(RecordingSocket):
    """A test socket that enforces Starlette's raw ``send_json`` contract."""

    async def send_json(self, message):
        # Starlette WebSocket.send_json calls json.dumps itself.  Keeping that
        # behaviour here makes an unserializable terminal achievement fail the
        # regression test exactly as it would in a browser connection.
        json.dumps(message, separators=(",", ":"), ensure_ascii=False)
        await super().send_json(message)


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

    def test_valid_rejoin_receives_a_terminal_snapshot_while_finalization_is_pending(self):
        game = self.make_game(mode=1, players=[("p1", "Anna")])
        game["_players"][0]["resume_token"] = "resume-anna"
        game["_players"][0]["ws"] = RecordingSocket()
        game["_started"] = False
        game["_finished"] = True
        game["_finalization_pending"] = True
        game["_final_completion"] = {
            "achievement_unlocks": {
                "p1": [
                    {
                        "key": "normal_under_700",
                        "unlocked_at": datetime(2026, 9, 2, 12, tzinfo=timezone.utc),
                    }
                ]
            },
            "achievement_rank_ups": {
                "p1": {
                    "previous": {"key": "newbie", "title": "Newbie", "minimum_points": 0},
                    "current": {"key": "rookie", "title": "Rookie", "minimum_points": 13},
                }
            },
        }
        for row in WRITABLE_ROWS:
            for column in WRITABLE_COLS:
                game["_scoreboards"]["p1"][f"{row},{column}"] = 0

        socket = JsonRecordingSocket()
        session = GameSocketSession(websocket=socket, game=game, auth_identity=None)
        should_close = asyncio.run(
            handle_session_action(
                session,
                "rejoin_game",
                {"player_id": "p1", "resume_token": "resume-anna"},
            )
        )

        self.assertFalse(should_close)
        self.assertEqual(socket.messages[0]["player_id"], "p1")
        self.assertTrue(socket.messages[1]["scoreboard"]["_finished"])
        self.assertTrue(socket.messages[1]["finalization_pending"])
        self.assertEqual(
            socket.messages[1]["achievement_unlocks"]["p1"][0]["unlocked_at"],
            "2026-09-02T12:00:00+00:00",
        )
        self.assertEqual(socket.messages[1]["achievement_rank_ups"]["p1"]["current"]["key"], "rookie")


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

    def test_last_open_field_can_be_struck_without_a_roll(self):
        game = self.make_game(mode=1, players=[("p1", "Anna")])
        board = game["_scoreboards"]["p1"]
        for row in WRITABLE_ROWS:
            for column in WRITABLE_COLS:
                board[f"{row},{column}"] = 0
        board.pop("15,down")

        session = self.session(game, player_id="p1")
        game["_players"][0]["ws"] = session.websocket
        finalized = []

        asyncio.run(
            handle_gameplay_action(
                session,
                "write_field",
                {"row": 15, "field": "down", "strike": True},
                finalize_game=lambda finished_game: finalized.append(finished_game) or {},
            )
        )

        self.assertEqual(board["15,down"], 0)
        self.assertTrue(game["_finished"])
        self.assertFalse(game["_started"])
        self.assertEqual(finalized, [game])
        self.assertTrue(session.websocket.messages[-1]["scoreboard"]["_finished"])

    def test_last_field_at_three_of_five_rolls_finishes_once_without_turn_reset(self):
        game = self.make_game(mode=1, players=[("p1", "Anna")])
        board = game["_scoreboards"]["p1"]
        for row in WRITABLE_ROWS:
            for column in WRITABLE_COLS:
                board[f"{row},{column}"] = 0
        board.pop("15,down")
        game["_turn"] = {"player_id": "p1", "roll_index": 3, "first4oak_roll": None}
        game["_rolls_used"] = 3
        game["_rolls_max"] = 5
        game["_dice"] = [1, 2, 3, 4, 5]
        turn_before = dict(game["_turn"])
        dice_before = game["_dice"][:]

        session = self.session(game, player_id="p1")
        game["_players"][0]["ws"] = session.websocket
        finalized = []
        completion = {
            "achievement_unlocks": {"p1": [{"key": "terminal-test"}]},
            "achievement_rank_ups": {
                "p1": {
                    "previous": {"key": "newbie", "minimum_points": 0},
                    "current": {"key": "rookie", "minimum_points": 13},
                }
            },
        }

        asyncio.run(
            handle_gameplay_action(
                session,
                "write_field",
                {"row": 15, "field": "down", "strike": True},
                finalize_game=lambda finished_game: finalized.append(finished_game) or completion,
            )
        )

        self.assertEqual(board["15,down"], 0)
        self.assertTrue(game["_finished"])
        self.assertFalse(game["_started"])
        self.assertEqual(game["_turn"], turn_before)
        self.assertEqual(game["_rolls_used"], 3)
        self.assertEqual(game["_rolls_max"], 5)
        self.assertEqual(game["_dice"], dice_before)
        self.assertEqual(finalized, [game])
        self.assertEqual(session.websocket.messages[-1]["achievement_unlocks"], completion["achievement_unlocks"])
        self.assertEqual(session.websocket.messages[-1]["achievement_rank_ups"], completion["achievement_rank_ups"])

        # The same mobile tap/retry must be a no-op that still gives the
        # client the final snapshot, rather than a stale turn error.
        asyncio.run(
            handle_gameplay_action(
                session,
                "write_field",
                {"row": 15, "field": "down", "strike": True},
                finalize_game=lambda finished_game: finalized.append(finished_game) or completion,
            )
        )

        retry = session.websocket.messages[-1]
        self.assertNotIn("error", retry)
        self.assertTrue(retry["scoreboard"]["_finished"])
        self.assertEqual(retry["scoreboard"]["_turn"], turn_before)
        self.assertEqual(retry["achievement_unlocks"], completion["achievement_unlocks"])
        self.assertEqual(retry["achievement_rank_ups"], completion["achievement_rank_ups"])
        self.assertEqual(finalized, [game])

    def test_pending_achievement_sync_keeps_terminal_recovery_state(self):
        """A durable result alone must not discard an unfinished award retry."""

        game = self.make_game(mode=1, players=[("p1", "Anna")])
        board = game["_scoreboards"]["p1"]
        for row in WRITABLE_ROWS:
            for column in WRITABLE_COLS:
                board[f"{row},{column}"] = 0
        board.pop("15,down")
        session = self.session(game, player_id="p1")
        game["_players"][0]["ws"] = session.websocket
        completion = {
            "result_persisted": True,
            "achievement_sync_pending": True,
            "achievement_sync_error": "temporary_award_store_failure",
        }

        asyncio.run(
            handle_gameplay_action(
                session,
                "write_field",
                {"row": 15, "field": "down", "strike": True},
                finalize_game=lambda _finished_game: completion,
            )
        )

        self.assertTrue(game["_finished"])
        self.assertFalse(game.get("_completion_persisted", False))
        self.assertEqual(game["_final_completion"], completion)
        self.assertFalse(game["_finalization_pending"])

    def test_terminal_write_reaches_a_requester_replaced_during_reconnect(self):
        """The socket that accepted the last tap must receive its result too.

        A reconnect may replace the socket stored on the player while an older
        accepted socket still completes a write.  Broadcasting only to the
        current player socket used to leave that requester with an unchanged
        final cell even though the server had persisted it.
        """
        game = self.make_game(mode=1, players=[("p1", "Anna")])
        board = game["_scoreboards"]["p1"]
        for row in WRITABLE_ROWS:
            for column in WRITABLE_COLS:
                board[f"{row},{column}"] = 0
        board.pop("15,down")
        stale_socket = RecordingSocket()
        current_socket = RecordingSocket()
        game["_players"][0]["ws"] = current_socket
        session = GameSocketSession(websocket=stale_socket, game=game, auth_identity=None, player_id="p1")
        completion = {"achievement_unlocks": {"p1": [{"key": "terminal-test"}]}}
        finalized = []

        asyncio.run(
            handle_gameplay_action(
                session,
                "write_field",
                {"row": 15, "field": "down", "strike": True},
                finalize_game=lambda finished_game: finalized.append(finished_game) or completion,
            )
        )

        self.assertEqual(finalized, [game])
        self.assertEqual(board["15,down"], 0)
        self.assertEqual(len(stale_socket.messages), 2)
        self.assertEqual(len(current_socket.messages), 2)
        for delivered in (stale_socket.messages[-1], current_socket.messages[-1]):
            self.assertTrue(delivered["scoreboard"]["_finished"])
            self.assertFalse(delivered["finalization_pending"])
            self.assertEqual(delivered["achievement_unlocks"], completion["achievement_unlocks"])

    def test_terminal_achievement_datetime_is_json_serialized_without_detaching_socket(self):
        """A newly earned achievement must not swallow the terminal update.

        ``UserAchievement.unlocked_at`` is a Python datetime.  Starlette's
        WebSocket implementation uses raw ``json.dumps`` and used to fail on
        it, after the final field had already been persisted.  Broadcast then
        treated the healthy connection as dead, leaving the browser stuck.
        """
        game = self.make_game(mode=1, players=[("p1", "Anna")])
        board = game["_scoreboards"]["p1"]
        for row in WRITABLE_ROWS:
            for column in WRITABLE_COLS:
                board[f"{row},{column}"] = 0
        board.pop("15,down")
        unlocked_at = datetime(2026, 9, 2, 12, 34, 56, tzinfo=timezone.utc)
        completion = {
            "achievement_unlocks": {
                "p1": [{"key": "normal_under_700", "unlocked_at": unlocked_at}]
            }
        }
        socket = JsonRecordingSocket()
        session = GameSocketSession(websocket=socket, game=game, auth_identity=None, player_id="p1")
        game["_players"][0]["ws"] = socket

        asyncio.run(
            handle_gameplay_action(
                session,
                "write_field",
                {"row": 15, "field": "down", "strike": True},
                finalize_game=lambda _game: completion,
            )
        )

        self.assertIs(game["_players"][0]["ws"], socket)
        self.assertEqual(board["15,down"], 0)
        self.assertTrue(socket.messages[-1]["scoreboard"]["_finished"])
        unlock = socket.messages[-1]["achievement_unlocks"]["p1"][0]
        self.assertEqual(unlock["unlocked_at"], unlocked_at.isoformat())

        # The duplicate-tap recovery path sends the same completion directly,
        # so it must apply the encoder as well.
        asyncio.run(
            handle_gameplay_action(
                session,
                "write_field",
                {"row": 15, "field": "down", "strike": True},
                finalize_game=lambda _game: completion,
            )
        )
        retry_unlock = socket.messages[-1]["achievement_unlocks"]["p1"][0]
        self.assertEqual(retry_unlock["unlocked_at"], unlocked_at.isoformat())

    def test_terminal_snapshot_survives_a_rank_lookup_failure(self):
        game = self.make_game(mode=1, players=[("p1", "Anna")])
        game["_players"][0]["user_id"] = 42
        game["_started"] = False
        game["_finished"] = True
        board = game["_scoreboards"]["p1"]
        for row in WRITABLE_ROWS:
            for column in WRITABLE_COLS:
                board[f"{row},{column}"] = 0

        with patch("app.game_snapshot.public_achievement_ranks", side_effect=RuntimeError("database temporarily locked")):
            terminal = snapshot(game)

        self.assertTrue(terminal["_finished"])
        self.assertEqual(terminal["_scoreboards"]["p1"]["15,down"], 0)
        self.assertEqual(terminal["_results"][0]["player"], "Anna")

    def test_finalizer_failure_does_not_hide_the_completed_game(self):
        game = self.make_game(mode=1, players=[("p1", "Anna")])
        board = game["_scoreboards"]["p1"]
        for row in WRITABLE_ROWS:
            for column in WRITABLE_COLS:
                board[f"{row},{column}"] = 0
        board.pop("15,down")
        game["_rolls_used"] = 5
        game["_rolls_max"] = 5

        session = self.session(game, player_id="p1")
        game["_players"][0]["ws"] = session.websocket

        def failing_finalizer(_game):
            raise RuntimeError("achievement persistence failed")

        asyncio.run(
            handle_gameplay_action(
                session,
                "write_field",
                {"row": 15, "field": "down", "strike": True},
                finalize_game=failing_finalizer,
            )
        )

        self.assertEqual(board["15,down"], 0)
        self.assertTrue(game["_finished"])
        self.assertTrue(session.websocket.messages[-1]["scoreboard"]["_finished"])

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
