"""Focused integration contracts for Zilch state, actions, and persistence."""

from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from unittest import TestCase
from unittest.mock import patch

from app.active_games import serializable_game_state
from app.game_state import games, new_game
from app.game_ws_session import GameSocketSession
from app.zilch_engine import ZILCH_PHASE_READY_TO_ROLL
from app.zilch_gameplay import ZILCH_GAMEPLAY_ACTIONS, handle_zilch_gameplay_action
from app.zilch_snapshot import snapshot_zilch
from app.zilch_state import (
    advance_after_zilch_turn,
    current_zilch_turn,
    ensure_zilch_engine_state,
    finish_zilch_game,
    join_zilch_player,
    new_zilch_game,
    record_zilch_bank,
    record_zilch_loss,
    start_zilch_game,
    sync_zilch_turn,
)


def sequence_rng(values: list[int]):
    values_iter = iter(values)

    def _rng(_lower: int, _upper: int) -> int:
        return next(values_iter)

    return _rng


class RecordingSocket:
    def __init__(self):
        self.messages: list[dict] = []

    async def send_json(self, message: dict) -> None:
        self.messages.append(message)


def option_for(snapshot: dict, *, combination_type: str, dice_indices: list[int] | None = None, points: int | None = None):
    for option in snapshot.get("_zilch_quick_holds", []):
        if option.get("combination_type") != combination_type:
            continue
        if dice_indices is not None and option.get("dice_indices") != dice_indices:
            continue
        if points is not None and option.get("points") != points:
            continue
        return option
    raise AssertionError(f"missing option: {combination_type}, {dice_indices}, {points}")


class ZilchGameplayTestCase(TestCase):
    def setUp(self):
        self.game_ids: list[str] = []

    def tearDown(self):
        for game_id in self.game_ids:
            games.pop(game_id, None)

    def make_game(self, *, players: int = 1):
        game_id = f"zilch-gameplay-{len(self.game_ids)}"
        self.game_ids.append(game_id)
        game = new_zilch_game(game_id, "Rules", players)
        sockets = []
        for index in range(players):
            socket = RecordingSocket()
            player_id = f"p{index + 1}"
            join_zilch_player(
                game,
                {"id": player_id, "name": f"Player {index + 1}", "user_id": index + 1, "ws": socket},
            )
            sockets.append(socket)
        start_rng = sequence_rng([6] if players == 1 else [6, 1])
        start_zilch_game(game, randint_fn=start_rng)
        return game, sockets

    @staticmethod
    def session(game, socket, player_id: str) -> GameSocketSession:
        return GameSocketSession(websocket=socket, game=game, auth_identity=None, player_id=player_id)

    def test_roll_and_hold_are_server_calculated_and_broadcast_the_structured_option(self):
        game, sockets = self.make_game()
        session = self.session(game, sockets[0], "p1")
        with patch("app.zilch_gameplay.fair_zilch_randint", new=sequence_rng([5, 5, 5, 2, 3, 4])):
            asyncio.run(handle_zilch_gameplay_action(session, "zilch_roll_dice", {"turn_id": 1, "version": 0}))

        rolled = sockets[0].messages[-1]["scoreboard"]
        triple = option_for(rolled, combination_type="three_of_a_kind", dice_indices=[0, 1, 2], points=500)
        self.assertEqual(triple["label_key"], "zilch.option.three_of_a_kind")
        self.assertEqual(triple["roll_id"], 1)
        self.assertEqual(triple["follow_up_actions"], ["zilch_roll_dice", "zilch_bank_points"])

        asyncio.run(
            handle_zilch_gameplay_action(
                session,
                "zilch_select_hold",
                {
                    "turn_id": 1,
                    "version": 1,
                    "roll_id": triple["roll_id"],
                    "option_id": triple["id"],
                    "dice_indices": triple["dice_indices"],
                    "points": triple["points"],
                    "combination_type": triple["combination_type"],
                },
            )
        )

        held = sockets[0].messages[-1]["scoreboard"]
        self.assertEqual(held["_round_points"]["p1"], 500)
        self.assertEqual(held["_zilch_turn_state"]["held_dice_indices"], [0, 1, 2])
        self.assertTrue(held["_zilch_turn_state"]["can_bank"])
        self.assertEqual(held["_zilch_turn_state"]["committed_holds"][0]["id"], triple["id"])

    def test_manipulated_or_duplicate_hold_is_rejected_without_state_change(self):
        game, sockets = self.make_game()
        session = self.session(game, sockets[0], "p1")
        with patch("app.zilch_gameplay.fair_zilch_randint", new=sequence_rng([1, 1, 1, 2, 3, 4])):
            asyncio.run(handle_zilch_gameplay_action(session, "zilch_roll_dice", {"turn_id": 1, "version": 0}))
        rolled = sockets[0].messages[-1]["scoreboard"]
        triple = option_for(rolled, combination_type="three_ones", dice_indices=[0, 1, 2], points=1_000)
        before = json.dumps(serializable_game_state(game), sort_keys=True)

        asyncio.run(
            handle_zilch_gameplay_action(
                session,
                "zilch_select_hold",
                {
                    "turn_id": 1,
                    "version": 1,
                    "roll_id": 1,
                    "option_id": triple["id"],
                    "dice_indices": [0, 1, 5],
                    "points": 999,
                },
            )
        )
        self.assertEqual(sockets[0].messages[-1]["zilch_error"]["code"], "zilch_option_reference_mismatch")
        self.assertEqual(json.dumps(serializable_game_state(game), sort_keys=True), before)

        payload = {
            "turn_id": 1,
            "version": 1,
            "roll_id": 1,
            "option_id": triple["id"],
            "dice_indices": triple["dice_indices"],
            "points": triple["points"],
        }
        asyncio.run(handle_zilch_gameplay_action(session, "zilch_select_hold", payload))
        changed = json.dumps(serializable_game_state(game), sort_keys=True)
        asyncio.run(handle_zilch_gameplay_action(session, "zilch_select_hold", payload))
        self.assertEqual(sockets[0].messages[-1]["zilch_error"]["code"], "zilch_stale_state")
        self.assertEqual(json.dumps(serializable_game_state(game), sort_keys=True), changed)

    def test_wrong_participant_wrong_game_type_and_manual_score_are_rejected(self):
        game, sockets = self.make_game(players=2)
        foreign = self.session(game, sockets[1], "p2")
        asyncio.run(handle_zilch_gameplay_action(foreign, "zilch_roll_dice", {"turn_id": 1, "version": 0}))
        self.assertEqual(sockets[1].messages[-1]["zilch_error"]["code"], "zilch_not_your_turn")

        player = self.session(game, sockets[0], "p1")
        asyncio.run(handle_zilch_gameplay_action(player, "zilch_submit_score", {}))
        self.assertEqual(sockets[0].messages[-1]["zilch_error"]["code"], "zilch_manual_score_not_supported")
        self.assertNotIn("zilch_unhold_dice", ZILCH_GAMEPLAY_ACTIONS)

        zdwa = new_game("wrong-game-type", "ZDWA", 1)
        self.game_ids.append("wrong-game-type")
        wrong_socket = RecordingSocket()
        wrong_session = self.session(zdwa, wrong_socket, "p1")
        asyncio.run(handle_zilch_gameplay_action(wrong_session, "zilch_roll_dice", {"turn_id": 1, "version": 0}))
        self.assertEqual(wrong_socket.messages[-1]["zilch_error"]["code"], "zilch_wrong_game_type")

    def test_zilch_discards_round_points_advances_turn_and_uses_no_zdwa_roll_path(self):
        game, sockets = self.make_game(players=2)
        session = self.session(game, sockets[0], "p1")
        turn = replace(
            current_zilch_turn(game),
            dice=(1, 0, 0, 0, 0, 0),
            held_indices=(0,),
            round_points=100,
            phase=ZILCH_PHASE_READY_TO_ROLL,
        )
        sync_zilch_turn(game, turn)

        with (
            patch("app.zilch_gameplay.fair_zilch_randint", new=sequence_rng([2, 2, 3, 4, 6])),
            patch("app.game_engine.apply_roll", side_effect=AssertionError("ZDWA engine must stay untouched")),
        ):
            asyncio.run(handle_zilch_gameplay_action(session, "zilch_roll_dice", {"turn_id": 1, "version": 0}))

        self.assertEqual(game["_round_points"]["p1"], 0)
        self.assertEqual(game["_zilch_boards"]["p1"]["rounds"][-1]["event"], "zilch")
        self.assertEqual(game["_zilch_boards"]["p1"]["zilch_streak"], 1)
        self.assertEqual(game["_turn"]["player_id"], "p2")
        self.assertEqual(sockets[0].messages[-1]["zilch_event"]["reason"], "no_scoring_option")

    def test_successful_bank_resets_zilch_streak_and_three_zilchs_do_not_go_negative(self):
        game, _sockets = self.make_game()
        game["_total_points"]["p1"] = 200
        game["_zilch_boards"]["p1"]["total_points"] = 200
        for index in range(3):
            turn = replace(current_zilch_turn(game), turn_id=index + 1, round_points=100, rolls_used=1)
            record_zilch_loss(game, turn, reason="no_scoring_option")
        self.assertEqual(game["_total_points"]["p1"], 0)
        self.assertEqual(game["_zilch_boards"]["p1"]["zilch_streak"], 3)
        self.assertEqual(game["_zilch_boards"]["p1"]["rounds"][-1]["penalty"], 500)

        bank_turn = replace(current_zilch_turn(game), round_points=400, phase=ZILCH_PHASE_READY_TO_ROLL)
        record_zilch_bank(game, bank_turn)
        self.assertEqual(game["_zilch_boards"]["p1"]["zilch_streak"], 0)
        self.assertEqual(game["_total_points"]["p1"], 400)

    def test_target_score_starts_one_full_opponent_reply_then_finishes_without_zdwa_results(self):
        game, _sockets = self.make_game(players=2)
        game["_total_points"]["p1"] = 9_500
        game["_zilch_boards"]["p1"]["total_points"] = 9_500
        first_turn = replace(current_zilch_turn(game), round_points=500, phase=ZILCH_PHASE_READY_TO_ROLL)

        record_zilch_bank(game, first_turn)
        self.assertFalse(advance_after_zilch_turn(game, "p1"))
        self.assertEqual(game["_zilch_final_round"]["pending_player_ids"], ["p2"])
        reply = current_zilch_turn(game)
        self.assertEqual(reply.player_id, "p2")
        self.assertEqual(reply.rolls_used, 0)

        record_zilch_bank(game, replace(reply, round_points=400, phase=ZILCH_PHASE_READY_TO_ROLL))
        self.assertTrue(advance_after_zilch_turn(game, "p2"))
        outcome = finish_zilch_game(game)
        self.assertTrue(game["_finished"])
        self.assertIsNone(game["_results"])
        self.assertEqual(outcome["winner_id"], "p1")
        self.assertFalse(outcome["tied"])

    def test_finished_equal_totals_are_explicitly_a_tie_without_a_winner(self):
        game, _sockets = self.make_game(players=2)
        game["_total_points"] = {"p1": 10_000, "p2": 10_000}
        game["_zilch_boards"]["p1"]["total_points"] = 10_000
        game["_zilch_boards"]["p2"]["total_points"] = 10_000

        outcome = finish_zilch_game(game)

        self.assertTrue(outcome["tied"])
        self.assertIsNone(outcome["winner_id"])
        self.assertEqual(outcome["winner_ids"], ["p1", "p2"])

    def test_active_state_roundtrip_preserves_engine_turn_boards_and_quick_hold_payload(self):
        game, sockets = self.make_game()
        session = self.session(game, sockets[0], "p1")
        with patch("app.zilch_gameplay.fair_zilch_randint", new=sequence_rng([2, 2, 2, 3, 4, 6])):
            asyncio.run(handle_zilch_gameplay_action(session, "zilch_roll_dice", {"turn_id": 1, "version": 0}))
        before = sockets[0].messages[-1]["scoreboard"]
        triple = option_for(before, combination_type="three_of_a_kind", dice_indices=[0, 1, 2], points=200)
        serialized = serializable_game_state(game)
        restored = json.loads(json.dumps(serialized))
        ensure_zilch_engine_state(restored)
        after = snapshot_zilch(restored)

        self.assertEqual(after["_game_type"], "zilch")
        self.assertEqual(after["_zilch_turn_state"]["turn_id"], 1)
        self.assertEqual(after["_zilch_turn_state"]["version"], 1)
        restored_triple = option_for(after, combination_type="three_of_a_kind", dice_indices=[0, 1, 2], points=200)
        self.assertEqual(restored_triple["id"], triple["id"])

    def test_old_or_malformed_engine_metadata_is_hydrated_to_a_safe_turn(self):
        game, _sockets = self.make_game()
        game["_turn"] = {"player_id": "p1", "round": 1}
        game["_round_points"] = "legacy-invalid"
        game["_total_points"] = "legacy-invalid"
        game["_zilch_zilch_streaks"] = "legacy-invalid"
        game["_zilch_boards"] = "legacy-invalid"

        projected = snapshot_zilch(game)

        self.assertEqual(projected["_turn"]["turn_id"], 1)
        self.assertEqual(projected["_zilch_boards"]["p1"]["total_points"], 0)
        self.assertEqual(projected["_zilch_boards"]["p1"]["round_points"], 0)
