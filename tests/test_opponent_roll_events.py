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
