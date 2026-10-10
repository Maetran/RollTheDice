import asyncio
from unittest.mock import patch

from app.active_games import serializable_game_state
from app.game_snapshot import snapshot
from app.game_ws_gameplay import handle_gameplay_action
from app.game_ws_session import GameSocketSession
from tests.support import GameStateTestCase


class RecordingSocket:
    def __init__(self):
        self.messages = []

    async def send_json(self, message):
        self.messages.append(message)


class OpponentRollEventTestCase(GameStateTestCase):
    def room(self):
        game = self.make_game()
        sockets = [RecordingSocket() for _ in range(3)]
        for player, socket in zip(game["_players"], sockets):
            player["ws"] = socket
        game["_spectators"] = [{"id": "s1", "name": "Observer", "ws": sockets[2]}]
        session = GameSocketSession(websocket=sockets[0], game=game, auth_identity=None, player_id="p1")
        return game, sockets, session

    @staticmethod
    def action(session, name, data=None):
        asyncio.run(handle_gameplay_action(session, name, data or {}, finalize_game=lambda _game: {}))

    def test_accepted_roll_broadcasts_one_ephemeral_event_to_players_and_spectator(self):
        game, sockets, session = self.room()
        self.action(session, "roll_dice")
        for socket in sockets:
            self.assertEqual(len(socket.messages), 1)
            self.assertEqual(socket.messages[0]["roll_event"], {"player_id": "p1", "dice_indices": [0, 1, 2, 3, 4]})
            self.assertEqual(socket.messages[0]["scoreboard"]["_rolls_used"], 1)
        self.assertNotIn("roll_event", snapshot(game))
        self.assertNotIn("roll_event", serializable_game_state(game))

    def test_repeated_equal_result_animates_only_the_unheld_dice(self):
        game, sockets, session = self.room()
        with patch("app.game_engine.random.randint", return_value=2), patch("app.game_ws_gameplay.roll_cooldown_ok", return_value=True):
            self.action(session, "roll_dice")
            self.action(session, "set_hold", {"holds": [True, False, True, False, True]})
            self.assertTrue(all("roll_event" not in socket.messages[-1] for socket in sockets))
            self.action(session, "roll_dice")
        self.assertEqual(game["_dice"], [2] * 5)
        for socket in sockets:
            self.assertEqual(socket.messages[-1]["roll_event"], {"player_id": "p1", "dice_indices": [1, 3]})
            self.assertEqual(socket.messages[-1]["scoreboard"]["_rolls_used"], 2)

    def test_announced_number_auto_hold_broadcasts_holds_and_preserves_roll_animation_indices(self):
        game, sockets, session = self.room()
        with patch("app.game_engine.random.randint", side_effect=[2, 1, 3, 4, 5, 2, 2, 4, 5]):
            with patch("app.game_ws_gameplay.roll_cooldown_ok", return_value=True):
                self.action(session, "roll_dice")
                self.action(session, "announce_row4", {"field": "2"})
                self.assertEqual(game["_holds"], [True, False, False, False, False])
                self.action(session, "set_hold", {"holds": [True, False, False, False, False]})
                self.action(session, "roll_dice")
        for socket in sockets:
            self.assertEqual(socket.messages[-1]["roll_event"], {"player_id": "p1", "dice_indices": [1, 2, 3, 4]})
            self.assertEqual(socket.messages[-1]["scoreboard"]["_holds"], [True, True, True, False, False])
        self.action(session, "set_hold", {"holds": [True, False, True, False, False]})
        self.assertEqual(game["_holds"], [True, False, True, False, False])
        self.assertEqual(snapshot(game)["_holds"], [True, False, True, False, False])

    def test_first_roll_unannounce_releases_automatic_dice_and_preserves_manual_reholds(self):
        game, sockets, session = self.room()
        with patch("app.game_engine.random.randint", side_effect=[2, 2, 2, 3, 4]):
            self.action(session, "roll_dice")
        self.action(session, "set_hold", {"holds": [True, False, False, False, False]})
        self.action(session, "announce_row4", {"field": "2"})
        self.assertEqual(game["_holds"], [True, True, True, False, False])
        self.assertEqual(game["_auto_held_announced_indices"], [1, 2])
        self.assertEqual(serializable_game_state(game)["_auto_held_announced_indices"], [1, 2])
        self.action(session, "set_hold", {"holds": [True, False, True, False, False]})
        self.action(session, "set_hold", {"holds": [True, True, True, False, False]})
        self.action(session, "unannounce_row4")
        self.assertEqual(game["_holds"], [True, True, False, False, False])
        self.assertEqual(game["_auto_held_announced_indices"], [])
        for socket in sockets:
            self.assertEqual(socket.messages[-1]["scoreboard"]["_holds"], [True, True, False, False, False])
            self.assertIsNone(socket.messages[-1]["scoreboard"]["_announced_row4"])

    def test_announce_protocol_disables_first_roll_auto_hold_only_for_explicit_false(self):
        for preference in ("missing", True, False, None, "false", 0):
            with self.subTest(preference=preference):
                game, sockets, session = self.room()
                game["_rolls_used"] = 1
                game["_turn"]["roll_index"] = 1
                game["_dice"] = [2, 2, 2, 3, 4]
                game["_holds"] = [True, False, False, False, False]
                payload = {"field": "2"}
                if preference != "missing":
                    payload["auto_hold_announced_numbers"] = preference
                self.action(session, "announce_row4", payload)
                expected = [True, False, False, False, False] if preference is False else [True, True, True, False, False]
                self.assertEqual(game["_holds"], expected)
                self.assertEqual(sockets[0].messages[-1]["scoreboard"]["_holds"], expected)

    def test_roll_protocol_disables_number_auto_hold_only_for_explicit_false(self):
        for preference in ("missing", True, False, None, "false", 0):
            with self.subTest(preference=preference):
                game, sockets, session = self.room()
                game["_rolls_used"] = 1
                game["_turn"]["roll_index"] = 1
                game["_dice"] = [2, 1, 1, 1, 1]
                game["_holds"] = [True, False, False, False, False]
                game["_announced_row4"] = "2"
                payload = {} if preference == "missing" else {"auto_hold_announced_numbers": preference}
                with patch("app.game_engine.random.randint", return_value=2):
                    self.action(session, "roll_dice", payload)
                expected = [True, False, False, False, False] if preference is False else [True] * 5
                self.assertEqual(game["_holds"], expected)
                self.assertEqual(sockets[0].messages[-1]["scoreboard"]["_holds"], expected)

    def test_rejected_rolls_and_cooldown_do_not_emit_animation_events(self):
        for reason in ("wrong_turn", "paused", "correction", "limit", "cooldown"):
            with self.subTest(reason=reason):
                game, sockets, session = self.room()
                if reason == "wrong_turn":
                    game["_turn"]["player_id"] = "p2"
                elif reason == "paused":
                    game["_players"][1]["ws"] = None
                elif reason == "correction":
                    game["_correction"] = {"active": True, "player_id": "p1"}
                elif reason == "limit":
                    game["_rolls_used"] = 3
                with patch("app.game_ws_gameplay.roll_cooldown_ok", return_value=reason != "cooldown"):
                    self.action(session, "roll_dice")
                self.assertTrue(all("roll_event" not in message for socket in sockets for message in socket.messages))
                self.assertTrue(all("scoreboard" not in message for socket in sockets for message in socket.messages))
