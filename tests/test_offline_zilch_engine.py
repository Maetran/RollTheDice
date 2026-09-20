"""The local JS game must retain the deployed Python house rules.

These tests invoke the shipped source through Node, compare all dice multisets,
and replay complete local Solo/CPU games through the production domain actions.
No browser, real account, network or result-persistence pipeline is involved.
"""

import json
import subprocess
from itertools import combinations_with_replacement
from pathlib import Path

import pytest

from app.game_state import games
from app.zilch_cpu_strategy import CpuQuickHoldOption, CpuStrategyContext, choose_zilch_cpu_decision
from app.zilch_engine import bank_allowed, options_for_turn, scoring_options_for_roll
from app.zilch_gameplay import apply_zilch_bank_points, apply_zilch_roll_dice, apply_zilch_select_hold
from app.zilch_state import (
    configure_zilch_cpu_game,
    configure_zilch_solo_game,
    current_zilch_turn,
    join_zilch_player,
    new_zilch_game,
    record_zilch_start_roll,
    start_zilch_game,
)

ROOT = Path(__file__).resolve().parents[1]
SIGNATURE_KEYS = (
    "combination_type", "dice_indices", "dice_values", "points", "label_key", "label_params",
    "hot_dice", "all_available_dice", "free_roll", "requires_confirmation",
    "confirmation_reasons", "follow_up_actions",
)


def run_local(operation, cases=None):
    result = subprocess.run(
        ["node", str(ROOT / "tests/fixtures/offline_zilch_engine.mjs")],
        input=json.dumps({"operation": operation, "cases": cases}),
        text=True, capture_output=True, check=False, cwd=ROOT, timeout=60,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def signature(option):
    payload = option.payload()
    return {key: payload[key] for key in SIGNATURE_KEYS}


def canonical(value):
    return json.dumps(value, sort_keys=True)


def test_local_scoring_matches_every_dice_multiset_and_remaining_dice_count():
    cases = []
    for available in range(1, 7):
        for dice in combinations_with_replacement(range(1, 7), available):
            cases.append({
                "dice": [1] * (6 - available) + list(dice),
                "held_indices": list(range(6 - available)),
                "round_points": 350,
            })
    actual = run_local("scoring", cases)
    assert len(actual) == len(cases)
    for case, result in zip(cases, actual, strict=True):
        expected = [signature(option) for option in scoring_options_for_roll(**case)]
        assert sorted(map(canonical, result)) == sorted(map(canonical, expected)), case


def test_local_confirmation_streak_final_reply_and_save_guards():
    assert run_local("checks") is True


def decision_for(game, strategy):
    turn = current_zilch_turn(game)
    own = game["_total_points"][turn.player_id]
    opponent = max((value for key, value in game["_total_points"].items() if key != turn.player_id), default=0)
    final = game.get("_zilch_final_round")
    final_reply = bool(final and turn.player_id in final["pending_player_ids"])
    choices = options_for_turn(turn)
    context = CpuStrategyContext(
        strategy=strategy, own_total=own, opponent_total=opponent, target_score=10000,
        round_points=turn.round_points, available_dice_count=len(turn.available_indices),
        confirmation_required=turn.confirmation_required, hot_dice=turn.last_event == "hot_dice",
        final_round=final_reply, needed_to_beat=max(10000, opponent) if final_reply else None,
        quick_holds=tuple(CpuQuickHoldOption(
            option_id=option.option_id, combination_type=option.combination_type, points=option.points,
            dice_indices=option.dice_indices, all_available_dice=option.all_available_dice,
            hot_dice=option.hot_dice, free_roll=option.free_roll,
        ) for option in choices),
        can_roll=turn.phase in {"ready_to_roll", "confirmation_roll_required"}, can_bank=bank_allowed(turn)[0],
    )
    return choose_zilch_cpu_decision(context), choices


def assert_same_state(game, local, id_map):
    finished = bool(game.get("_finished"))
    assert local["finished"] == finished
    turn = None
    if not finished:
        current = current_zilch_turn(game)
        turn = current.payload()
        turn.pop("committed_holds")
        turn["dice"] = list(current.dice)
        turn["player_id"] = id_map[turn["player_id"]]
    assert local["turn"] == turn
    for player in local["players"]:
        key = next(key for key, value in id_map.items() if value == player["id"])
        assert player["totalPoints"] == game["_total_points"][key]
        assert player["zilchStreak"] == game["_zilch_zilch_streaks"][key]
        actual_rounds = player["rounds"]
        expected_rounds = game["_zilch_boards"][key]["rounds"]
        assert len(actual_rounds) == len(expected_rounds)
        if actual_rounds:
            for field in ("turn_id", "round", "event", "points", "discarded_points", "penalty", "total_after", "rolls_used"):
                assert actual_rounds[-1].get(field, 0) == expected_rounds[-1].get(field, 0)
    final = game.get("_zilch_final_round")
    expected_final = None if not final else {
        "triggered_by": id_map[final["triggered_by"]],
        "pending_player_ids": [id_map[value] for value in final["pending_player_ids"]],
    }
    assert local["finalRound"] == expected_final
    if finished and game["_play_mode"] == "cpu":
        assert sorted(local["winnerIds"]) == sorted(id_map[value] for value in game["_zilch_outcome"]["winner_ids"])


@pytest.mark.parametrize("mode,strategy,seed", [
    ("solo", "normal", 17), ("solo", "normal", 129),
    ("cpu", "normal", 42), ("cpu", "normal", 194),
    ("cpu", "conservative", 333), ("cpu", "aggressive", 41),
])
def test_complete_local_games_replay_with_identical_server_results(mode, strategy, seed):
    trace = run_local("trace", [{"mode": mode, "strategy": strategy, "seed": seed}])[0]
    game_id = f"offline-parity-{mode}-{strategy}-{seed}"
    game = new_zilch_game(game_id, "Offline parity", 1 if mode == "solo" else 2)
    id_map = {"you": "you"}
    try:
        if mode == "solo":
            configure_zilch_solo_game(game, host_user_id=1)
        else:
            cpu = configure_zilch_cpu_game(game, host_user_id=1, cpu_strategy=strategy)
            id_map[cpu["id"]] = "cpu"
        join_zilch_player(game, {"id": "you", "name": "Local", "user_id": 1, "ws": object()})
        start_zilch_game(game)
        for attempt in trace["opening"]:
            record_zilch_start_roll(game, "you", attempt["you"])
            record_zilch_start_roll(game, cpu["id"], attempt["cpu"])
        for step in trace["steps"]:
            turn = current_zilch_turn(game)
            decision, choices = decision_for(game, strategy)
            assert decision.action == step["action"]
            common = {"turn_id": turn.turn_id, "version": turn.version}
            if step["action"] == "roll":
                values = iter(step["rolled"])
                apply_zilch_roll_dice(game, turn.player_id, **common, randint_fn=lambda _low, _high: next(values))
                assert next(values, None) is None
            elif step["action"] == "bank":
                apply_zilch_bank_points(game, turn.player_id, **common)
            else:
                choice = next(option for option in choices if signature(option) == step["option"])
                policy_choice = next(option for option in choices if option.option_id == decision.option_id)
                # Local IDs do not cross the transport boundary. Equal-value
                # interchangeable dice can consequently choose another index,
                # but the CPU must keep the server strategy's score/risk choice.
                for field in ("points", "dice_values", "hot_dice", "free_roll", "all_available_dice"):
                    assert getattr(choice, field) == getattr(policy_choice, field)
                apply_zilch_select_hold(game, turn.player_id, **common, roll_id=turn.roll_id, option_id=choice.option_id)
            assert_same_state(game, step["view"], id_map)
        assert game["_finished"] is True
        assert any(board["rounds"] for board in game["_zilch_boards"].values())
    finally:
        games.pop(game_id, None)
