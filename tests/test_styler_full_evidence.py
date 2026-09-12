import asyncio
import json
from datetime import datetime, timezone

from app.achievements import _game_metrics
from app.active_games import serializable_game_state
from app.game_admin import apply_superadmin_changes
from app.game_results import build_leaderboard_snapshot_fields
from app.game_snapshot import snapshot
from app.game_state import KEY_TO_ROW, board_key_for_actor
from app.game_ws_gameplay import handle_gameplay_action
from app.game_ws_session import GameSocketSession
from app.models import CompletedGame, GameParticipant
from tests.support import GameStateTestCase


class RecordingSocket:
    async def send_json(self, _message):
        pass


class StylerFullEvidenceTestCase(GameStateTestCase):
    def session(self, game, player_id="p1"):
        socket = RecordingSocket()
        for player in game["_players"]:
            player["ws"] = socket
        return GameSocketSession(websocket=socket, game=game, auth_identity=None, player_id=player_id)

    def write(self, game, dice, *, field="full", column="free", strike=False):
        game["_dice"] = dice[:]
        game["_rolls_used"] = 1
        game["_turn"]["roll_index"] = 1
        session = self.session(game)
        asyncio.run(handle_gameplay_action(
            session, "write_field", {"row": KEY_TO_ROW[field], "field": column, "strike": strike},
            finalize_game=lambda _game: {},
        ))
        return session

    def metrics(self, game, *, player_id="p1"):
        completed = CompletedGame(
            mode=str(game["_mode"]), hardcore=False, finished_at=datetime.now(timezone.utc),
            snapshot_json=json.dumps(build_leaderboard_snapshot_fields(game)),
        )
        participant = GameParticipant(player_key=player_id, team=game.get("_team_of", {}).get(player_id), points=0)
        return _game_metrics(completed, participant)

    def test_identical_full_scores_require_real_five_equal_dice(self):
        for dice, expected in (([2, 2, 2, 5, 5], 0), ([2, 2, 2, 2, 2], 1)):
            with self.subTest(dice=dice):
                game = self.make_game()
                self.write(game, dice)
                self.assertEqual(game["_scoreboards"]["p1"]["13,free"], 46)
                self.assertEqual(self.metrics(game)["styler_full_count"], expected)
                self.assertNotIn("_styler_full_evidence", snapshot(game))

    def test_all_faces_count_but_strikes_and_non_full_writes_do_not(self):
        for face in range(1, 7):
            with self.subTest(face=face):
                game = self.make_game()
                self.write(game, [face] * 5)
                self.assertEqual(self.metrics(game)["styler_full_count"], 1)
        for field, strike in (("full", True), ("2", False)):
            with self.subTest(field=field, strike=strike):
                game = self.make_game()
                self.write(game, [2] * 5, field=field, strike=strike)
                self.assertEqual(self.metrics(game)["styler_full_count"], 0)

    def test_rejected_write_cannot_create_evidence(self):
        game = self.make_game()
        game["_scoreboards"]["p1"]["13,free"] = 46
        self.write(game, [2] * 5)
        self.assertEqual(self.metrics(game)["styler_full_count"], 0)

    def test_correction_moves_proof_only_when_final_field_is_full(self):
        game = self.make_game()
        session = self.write(game, [2] * 5)
        for field, expected in (("2", 0), ("full", 1), ("full", 0)):
            with self.subTest(field=field, expected=expected):
                asyncio.run(handle_gameplay_action(session, "request_correction", {}, finalize_game=lambda _game: {}))
                self.assertTrue(game["_correction"]["active"])
                asyncio.run(handle_gameplay_action(session, "write_field_correction", {
                    "row": KEY_TO_ROW[field], "field": "free", "strike": field == "full" and expected == 0,
                }, finalize_game=lambda _game: {}))
                self.assertFalse(game["_correction"]["active"])
                self.assertEqual(self.metrics(game)["styler_full_count"], expected)

    def test_correction_from_ordinary_full_does_not_manufacture_five_dice(self):
        game = self.make_game()
        session = self.write(game, [2, 2, 2, 5, 5], field="2")
        asyncio.run(handle_gameplay_action(session, "request_correction", {}, finalize_game=lambda _game: {}))
        asyncio.run(handle_gameplay_action(session, "write_field_correction", {"row": 13, "field": "free"}, finalize_game=lambda _game: {}))
        self.assertEqual(game["_scoreboards"]["p1"]["13,free"], 46)
        self.assertEqual(self.metrics(game)["styler_full_count"], 0)

    def test_admin_rewrite_even_to_same_score_invalidates_dice_proof(self):
        game = self.make_game()
        self.write(game, [2] * 5)
        apply_superadmin_changes(game, "p1", "p1", [{"row": 13, "field": "free", "value": 46}])
        self.assertEqual(self.metrics(game)["styler_full_count"], 0)

    def test_proof_survives_active_state_restart_and_is_owned_by_team_board(self):
        game = self.make_game(mode="2v2")
        self.write(game, [2] * 5)
        restored = json.loads(json.dumps(serializable_game_state(game)))
        self.assertEqual(board_key_for_actor(restored, "p1"), "A")
        self.assertEqual(self.metrics(restored, player_id="p1")["styler_full_count"], 1)
        self.assertEqual(self.metrics(restored, player_id="p3")["styler_full_count"], 1)
        self.assertEqual(self.metrics(restored, player_id="p2")["styler_full_count"], 0)

    def test_legacy_or_invalid_proof_never_counts_ambiguous_scores(self):
        game = self.make_game()
        self.write(game, [2] * 5)
        projected = build_leaderboard_snapshot_fields(game)
        invalid = [
            None, {}, {"version": True, "boards": {"p1": {"13,free": 2}}},
            {"version": 1, "boards": {"p1": {"13,free": True}}},
            {"version": 1, "boards": {"p1": {"13,free": 3}}},
            {"version": 1, "boards": {"p2": {"13,free": 2}}},
        ]
        for proof in invalid:
            with self.subTest(proof=proof):
                projected["styler_full_evidence"] = proof
                completed = CompletedGame(
                    mode="2", hardcore=False, finished_at=datetime.now(timezone.utc),
                    snapshot_json=json.dumps(projected),
                )
                participant = GameParticipant(player_key="p1", points=0)
                self.assertEqual(_game_metrics(completed, participant)["styler_full_count"], 0)
