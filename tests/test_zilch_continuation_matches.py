"""Focused contracts for the offline heldout runner; no production CPU patch."""

from __future__ import annotations

from dataclasses import replace
from fractions import Fraction

from app.game_state import games
from app.zilch_engine import options_for_turn
from app.zilch_gameplay import apply_zilch_select_hold
from app.zilch_state import current_zilch_turn
from scripts.zilch_continuation_gameplay_check import witness_game
from scripts.zilch_continuation_matches import (
    accepted_witness,
    actual_context,
    balanced_design,
    harm_sign_p_value,
    match,
    opening_game,
    witness_option,
)
from scripts.zilch_continuation_probe import GAPS, PROFILES, Value, strategy_context, witness_turn


def test_witness_only_replaces_an_actual_legal_one_with_positive_net_value():
    turn = witness_turn()
    context = strategy_context(turn, "normal", 0)
    favorable = Value(Fraction(350), Fraction(1, 4)), Value(Fraction(300), Fraction(1, 2))
    selected_id = accepted_witness(turn, context, favorable)
    selected = next(option for option in options_for_turn(turn) if option.option_id == selected_id)
    assert (selected.points, selected.dice_values) == (100, (1,))
    assert accepted_witness(turn, context, tuple(reversed(favorable))) is None


def test_witness_guards_final_target_confirmation_and_different_roll():
    turn = witness_turn()
    context = strategy_context(turn, "normal", 0)
    assert witness_option(turn, context) is not None
    assert witness_option(turn, replace(context, final_round=True)) is None
    assert witness_option(turn, replace(context, own_total=8_250)) is None
    assert witness_option(replace(turn, confirmation_reasons=("pending",)), context) is None
    assert witness_option(replace(turn, rolls_used=3), context) is None


def test_balanced_design_has_ten_pairs_for_every_profile_opponent_and_seat():
    from collections import Counter

    design = balanced_design()
    strata = Counter((profiles, candidate) for _seed, profiles, candidate in design)
    assert len(design) == len({seed for seed, _profiles, _candidate in design}) == 180
    assert len(strata) == 18
    assert set(strata.values()) == {10}


def test_sign_check_reports_benefit_and_harm_symmetrically_without_a_strength_claim():
    assert harm_sign_p_value(0, 0) == 1
    assert harm_sign_p_value(0, 5) == 1 / 32
    assert harm_sign_p_value(5, 0) == 1
    assert harm_sign_p_value(5, 5) > 0.5


def test_opening_fixture_does_not_register_a_live_game():
    before = set(games)
    game = opening_game(123)
    assert set(games) == before
    assert game["_started"] is True
    assert game["_zilch_start_roll"]["phase"] == "resolved"
    assert game["_turn"]["player_id"] in {"p0", "p1"}


def test_actual_gameplay_witness_applies_the_one_only_hold():
    game = witness_game()
    turn = current_zilch_turn(game)
    assert turn.round_points == 200 and len(turn.available_indices) == 4 and turn.rolls_used == 2
    favorable = Value(Fraction(350), Fraction(1, 4)), Value(Fraction(300), Fraction(1, 2))
    selected_id = accepted_witness(turn, actual_context(game, turn, "normal"), favorable)
    selected = next(option for option in options_for_turn(turn) if option.option_id == selected_id)
    assert selected.dice_values == (1,)
    transition = apply_zilch_select_hold(game, turn.player_id, turn_id=turn.turn_id, version=turn.version,
                                         roll_id=turn.roll_id, option_id=selected_id)
    after = current_zilch_turn(game)
    assert transition.event["type"] == "hold"
    assert (after.round_points, len(after.available_indices), after.confirmation_required) == (300, 3, False)
    assert all(after.dice[index] != 5 for index in after.held_indices)


def test_match_uses_real_banks_and_reconciles_terminal_totals():
    # Values deliberately reject every alternative: this is a baseline domain
    # match, not purported evidence for any tactical model or activation.
    rejected = Value(Fraction(100), Fraction(1, 2)), Value(Fraction(200), Fraction(1, 4))
    values = {(profile, gap): rejected for profile in PROFILES for gap in GAPS}
    result = match(123, ("conservative", "conservative"), "p0", False, values, lambda: None)
    assert result["counts"]["verified_bank_actions"] > 0
    assert result["counts"].get("overrides", 0) == 0
    for seat, ledger in result["ledger"].items():
        assert result["totals"][seat] == ledger["gross"] - ledger["loss"]


def test_match_pair_without_an_override_has_identical_totals_and_score():
    rejected = Value(Fraction(100), Fraction(1, 2)), Value(Fraction(200), Fraction(1, 4))
    values = {(profile, gap): rejected for profile in PROFILES for gap in GAPS}
    baseline = match(124, ("conservative", "conservative"), "p0", False, values, lambda: None)
    candidate = match(124, ("conservative", "conservative"), "p0", True, values, lambda: None)
    assert candidate["counts"].get("overrides", 0) == 0
    assert baseline["totals"] == candidate["totals"]
    assert baseline["score"] == candidate["score"]
