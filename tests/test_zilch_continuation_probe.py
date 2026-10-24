"""Offline-probe contracts, not a change to the production Zilch CPU."""

from __future__ import annotations

from dataclasses import replace
from fractions import Fraction

from app.zilch_cpu_strategy import choose_zilch_cpu_decision
from app.zilch_engine import bank_allowed, options_for_turn, roll_zilch_turn, select_zilch_option
from scripts.zilch_continuation_probe import (
    GAPS,
    PROFILES,
    Outcome,
    Value,
    affine_tail,
    kernel,
    strategy_context,
    weighted_rolls,
    witness_states,
    witness_turn,
)


def test_witness_uses_real_legal_holds_and_both_candidates_must_continue():
    states = witness_states()
    assert set(states) == {"keep_one", "greedy"}
    for name, expected in (("keep_one", (300, 3)), ("greedy", (350, 2))):
        turn = states[name]
        assert (turn.round_points, len(turn.available_indices)) == expected
        assert turn.rolls_used == 2
        assert turn.confirmation_required is False
        assert bank_allowed(turn) == (False, "zilch_bank_minimum_not_reached")
    # A legal 50-point next hold is not automatically bankable in both paths.
    for name, can_bank in (("keep_one", False), ("greedy", True)):
        values = iter((5, 2, 3))
        rolled, evaluation = roll_zilch_turn(states[name], randint_fn=lambda _low, _high: next(values))
        assert evaluation.third_roll_threshold_zilch is False
        option = next(option for option in options_for_turn(rolled) if option.points == 50)
        held = select_zilch_option(rolled, option.option_id).turn
        assert bank_allowed(held)[0] is can_bank


def test_baseline_greedily_keeps_both_scoring_dice_then_must_roll():
    witness = witness_turn()
    states = witness_states()
    for strategy in PROFILES:
        for gap in GAPS.values():
            decision = choose_zilch_cpu_decision(strategy_context(witness, strategy, gap))
            selected = next(option for option in options_for_turn(witness) if option.option_id == decision.option_id)
            assert (selected.points, selected.dice_values) == (150, (1, 5))
            for turn in states.values():
                decision = choose_zilch_cpu_decision(strategy_context(turn, strategy, gap))
                assert decision.action == "roll"


def test_weighted_multisets_represent_all_ordered_rolls_without_rng():
    for count, expected_rows in ((2, 21), (3, 56), (6, 462)):
        rows = weighted_rolls(count)
        assert len(rows) == expected_rows
        assert sum(weight for _turn, weight in rows) == 6 ** count


def test_kernel_bust_mass_includes_three_dice_triples():
    for count, expected in ((2, Fraction(4, 9)), (3, Fraction(5, 18))):
        outcomes = kernel(count, "normal", 0, lambda: None)
        assert sum((row.probability for row in outcomes), Fraction(0)) == 1
        assert sum((row.probability for row in outcomes if not row.points), Fraction(0)) == expected
        if count == 3:
            # A triple consumes all remaining physical dice: it needs a new
            # six-dice confirmation, rather than immediately banking the triple.
            assert any(row.points == 1_000 and row.remaining == 6 and row.confirmation for row in outcomes)


def test_permuted_dice_and_held_positions_preserve_kernel_outcomes_despite_new_option_ids():
    changed_id = False
    permutations = (tuple(range(6)), tuple(reversed(range(6))), (2, 5, 0, 4, 1, 3))
    for count, pattern in ((3, (1, 1, 1)), (4, (1, 2, 3, 5)), (6, (1, 1, 2, 2, 3, 3))):
        canonical = next(turn for turn, _weight in weighted_rolls(count)
                         if tuple(turn.dice[index] for index in turn.available_indices) == pattern)
        for profile in PROFILES:
            for gap in GAPS.values():
                expected = None
                first_id = None
                for order in permutations:
                    permuted = replace(canonical, dice=tuple(canonical.dice[index] for index in order),
                                       held_indices=tuple(index for index, old in enumerate(order)
                                                          if old in canonical.held_indices))
                    decision = choose_zilch_cpu_decision(strategy_context(permuted, profile, gap))
                    result = select_zilch_option(permuted, decision.option_id).turn
                    outcome = result.round_points - 300, len(result.available_indices), result.confirmation_required
                    if expected is None:
                        expected, first_id = outcome, decision.option_id
                    assert outcome == expected
                    changed_id |= decision.option_id != first_id
    assert changed_id


def test_affine_tail_includes_the_entire_repeated_confirmation_chain():
    # Half bank +100, one quarter score +50 and confirm again, one quarter bust.
    # Thus a = 1/2 + a/4 and b = 50 + (50*a + b)/4.
    outcomes = ((Outcome(100, 1, False, Fraction(1, 2)),
                 Outcome(50, 1, True, Fraction(1, 4)),
                 Outcome(0, 0, False, Fraction(1, 4))),)
    a, b = affine_tail(outcomes)
    assert a == (Fraction(2, 3),)
    assert b == (Fraction(700, 9),)


def test_net_value_subtracts_actual_series_loss_exactly_once():
    value = Value(Fraction(100), Fraction(1, 2))
    assert value.net(250, 1) == 100
    assert value.net(250, 2) == -25
    assert value.net(250, 5) == -25
    assert value.net(0, 2) == 100
    assert value.net(2_000, 2) == -150
