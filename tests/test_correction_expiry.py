import asyncio
import json

from app.active_games import serializable_game_state
from app.game_snapshot import snapshot_zdwa
from app.game_ws_gameplay import handle_gameplay_action
from app.game_ws_session import GameSocketSession
from tests.support import GameStateTestCase


class RecordingSocket:
    def __init__(self):
        self.messages = []

    async def send_json(self, message):
        self.messages.append(message)


class CorrectionExpiryTestCase(GameStateTestCase):
    def sessions(self, game):
        result = {}
        for player in game["_players"]:
            socket = RecordingSocket()
            player["ws"] = socket
            result[player["id"]] = GameSocketSession(
                websocket=socket, game=game, auth_identity=None, player_id=player["id"],
            )
        return result

    @staticmethod
    def action(session, action, data=None):
        asyncio.run(handle_gameplay_action(session, action, data or {}, finalize_game=lambda _game: {}))

    def test_later_turns_cannot_reopen_an_older_correction_window_in_three_player_or_team_games(self):
        for mode in (3, "2v2"):
            with self.subTest(mode=mode):
                game = self.make_game(mode=mode)
                sessions = self.sessions(game)
                self.action(sessions["p1"], "roll_dice")
                self.action(sessions["p1"], "write_field", {"row": 0, "field": "free"})
                self.assertEqual(game["_turn"]["player_id"], "p2")
                self.assertTrue(snapshot_zdwa(game)["_can_request_correction"]["p1"])

                # A rejected request from a non-active player changes nothing.
                self.action(sessions["p3"], "roll_dice")
                self.assertFalse(game["_last_meta"]["p1"].get("correction_expired", False))
                self.assertTrue(snapshot_zdwa(game)["_can_request_correction"]["p1"])
                self.action(sessions["p2"], "roll_dice")
                self.assertTrue(game["_last_meta"]["p1"]["correction_expired"])
                self.action(sessions["p2"], "write_field", {"row": 0, "field": "free"})
                self.assertEqual(game["_turn"]["player_id"], "p3")
                self.assertEqual(game["_rolls_used"], 0)
                self.assertFalse(game["_last_meta"]["p2"].get("correction_expired", False))

                restored = json.loads(json.dumps(serializable_game_state(game)))
                for candidate in (game, restored):
                    with self.subTest(mode=mode, restarted=candidate is restored):
                        active = self.sessions(candidate)
                        permission = snapshot_zdwa(candidate)["_can_request_correction"]
                        self.assertFalse(permission["p1"])
                        self.assertTrue(permission["p2"])
                        self.action(active["p1"], "request_correction")
                        self.assertEqual(active["p1"].websocket.messages[-1], {
                            "error": "Korrektur nicht möglich: Es wurde bereits weiter gewürfelt",
                        })
                        self.assertFalse(candidate["_correction"]["active"])
                        self.action(active["p2"], "request_correction")
                        self.assertTrue(candidate["_correction"]["active"])
                        self.assertEqual(candidate["_correction"]["player_id"], "p2")

    def test_accepted_roll_also_expires_a_legacy_write_without_metadata(self):
        game = self.make_game(mode=3)
        sessions = self.sessions(game)
        game["_last_write"]["p1"] = (0, "free", 1)
        game["_last_dice"]["p1"] = [1, 2, 3, 4, 5]
        game["_turn"]["player_id"] = "p2"
        self.assertNotIn("p1", game["_last_meta"])
        self.action(sessions["p2"], "roll_dice")
        self.assertTrue(game["_last_meta"]["p1"]["correction_expired"])

    def test_correction_cannot_move_unannounced_second_or_third_roll_into_announce_column(self):
        for rolls in (1, 2, 3):
            for strike in (False, True):
                with self.subTest(rolls=rolls, strike=strike):
                    game = self.make_game(mode=3)
                    sessions = self.sessions(game)
                    for _ in range(rolls):
                        game["_roll_cooldown"] = {}
                        self.action(sessions["p1"], "roll_dice")
                    game["_dice"] = [6] * 5
                    self.action(sessions["p1"], "write_field", {"row": 5, "field": "free"})
                    self.action(sessions["p1"], "request_correction")
                    self.assertTrue(game["_correction"]["active"])
                    self.action(sessions["p1"], "write_field_correction", {"row": 5, "field": "ang", "strike": strike})
                    board = game["_scoreboards"]["p1"]
                    if rolls == 1:
                        self.assertNotIn("5,free", board)
                        self.assertEqual(board["5,ang"], 0 if strike else 30)
                        self.assertFalse(game["_correction"]["active"])
                    else:
                        self.assertEqual(sessions["p1"].websocket.messages[-1], {"error": "Keine Ansage aktiv"})
                        self.assertEqual(board["5,free"], 30)
                        self.assertNotIn("5,ang", board)
                        self.assertTrue(game["_correction"]["active"])

    def test_legal_last_announce_cell_written_after_three_rolls_can_still_be_corrected_in_place(self):
        game = self.make_game(mode=3)
        sessions = self.sessions(game)
        game["_scoreboards"]["p1"] = self.full_scoreboard()
        game["_scoreboards"]["p1"].pop("5,ang")
        for _ in range(3):
            game["_roll_cooldown"] = {}
            self.action(sessions["p1"], "roll_dice")
        game["_dice"] = [6] * 5
        self.action(sessions["p1"], "write_field", {"row": 5, "field": "ang"})
        self.assertEqual(game["_scoreboards"]["p1"]["5,ang"], 30)
        self.assertFalse(game["_finished"])
        self.action(sessions["p1"], "request_correction")
        self.assertTrue(game["_correction"]["active"])
        self.action(sessions["p1"], "write_field_correction", {"row": 5, "field": "ang", "strike": True})
        self.assertFalse(game["_correction"]["active"])
        self.assertEqual(game["_scoreboards"]["p1"]["5,ang"], 0)
