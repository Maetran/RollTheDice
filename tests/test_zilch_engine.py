"""Rule-contract tests for the pure, non-ZDWA Zilch engine."""

from __future__ import annotations

from dataclasses import replace
from unittest import TestCase

from app.zilch_engine import (
    ZILCH_BANK_MINIMUM,
    ZILCH_PHASE_CONFIRMATION_ROLL_REQUIRED,
    ZILCH_PHASE_READY_TO_ROLL,
    ZILCH_THIRD_ROLL_MINIMUM,
    ZilchRuleError,
    apply_zilch_streak,
    bank_allowed,
    evaluate_zilch_roll,
    new_zilch_turn,
    options_for_turn,
    roll_available_dice,
    roll_starting_player,
    roll_zilch_turn,
    scoring_options_for_roll,
    select_zilch_option,
)


def sequence_rng(values: list[int]):
    values_iter = iter(values)

    def _rng(_lower: int, _upper: int) -> int:
        return next(values_iter)

    return _rng


def option_for(options, *, combination_type: str, dice_indices: tuple[int, ...] | None = None, points: int | None = None):
    for option in options:
        if option.combination_type != combination_type:
            continue
        if dice_indices is not None and option.dice_indices != dice_indices:
            continue
        if points is not None and option.points != points:
            continue
        return option
    raise AssertionError(f"option not found: {combination_type}, {dice_indices}, {points}")


class ZilchScoringTestCase(TestCase):
    def test_single_ones_and_fives_are_independent_scoring_options(self):
        options = scoring_options_for_roll([1, 5, 2, 3, 4, 6], turn_id=7, roll_id=3)

        self.assertEqual(option_for(options, combination_type="single_one", dice_indices=(0,)).points, 100)
        self.assertEqual(option_for(options, combination_type="single_five", dice_indices=(1,)).points, 50)
        self.assertEqual(option_for(options, combination_type="combined", dice_indices=(0, 1)).points, 150)

    def test_three_ones_and_other_triples_follow_the_confirmed_values(self):
        ones = scoring_options_for_roll([1, 1, 1, 2, 3, 4], turn_id=1, roll_id=1)
        triple_ones = option_for(ones, combination_type="three_ones", dice_indices=(0, 1, 2))
        self.assertEqual(triple_ones.points, 1_000)
        self.assertTrue(triple_ones.requires_confirmation)
        self.assertFalse(
            any(option.dice_indices == (0, 1, 2) and option.points == 300 for option in ones),
            "A selected triple must not be reinterpreted as three single ones.",
        )

        for face in range(2, 7):
            with self.subTest(face=face):
                options = scoring_options_for_roll([face, face, face, 2, 3, 4], turn_id=1, roll_id=face)
                triple = option_for(options, combination_type="three_of_a_kind", dice_indices=(0, 1, 2))
                self.assertEqual(triple.points, face * 100)
                self.assertFalse(triple.requires_confirmation)
                if face == 5:
                    self.assertFalse(
                        any(option.dice_indices == (0, 1, 2) and option.points == 150 for option in options),
                        "A selected triple of fives must not be reinterpreted as singles.",
                    )

    def test_matching_twos_to_sixes_double_after_the_third_die(self):
        for face in range(2, 7):
            fillers = [value for value in range(2, 7) if value != face]
            for count in range(3, 7):
                with self.subTest(face=face, count=count):
                    options = scoring_options_for_roll(
                        [face] * count + fillers[: 6 - count],
                        turn_id=1,
                        roll_id=count,
                    )
                    combination_type = {
                        3: "three_of_a_kind",
                        4: "four_of_a_kind",
                        5: "five_of_a_kind",
                        6: "six_of_a_kind",
                    }[count]
                    option = option_for(
                        options,
                        combination_type=combination_type,
                        dice_indices=tuple(range(count)),
                        points=face * 100 * (2 ** (count - 3)),
                    )
                    self.assertEqual(option.dice_values, (face,) * count)

    def test_ones_remain_fixed_triples_with_individual_extra_ones(self):
        options = scoring_options_for_roll([1, 1, 1, 1, 1, 1], turn_id=2, roll_id=4)

        self.assertEqual(
            option_for(
                options,
                combination_type="three_ones",
                dice_indices=(0, 1, 2),
                points=1_000,
            ).points,
            1_000,
        )
        self.assertFalse(
            {"four_of_a_kind", "five_of_a_kind", "six_of_a_kind"}
            & {option.combination_type for option in options}
        )
        self.assertEqual(
            option_for(options, combination_type="combined", dice_indices=(0, 1, 2, 3), points=1_100).points,
            1_100,
        )
        self.assertEqual(
            option_for(options, combination_type="double_triple", dice_indices=(0, 1, 2, 3, 4, 5), points=2_000).points,
            2_000,
        )

    def test_six_matching_twos_are_a_hot_six_of_a_kind(self):
        options = scoring_options_for_roll([2, 2, 2, 2, 2, 2], turn_id=2, roll_id=4)

        six_of_a_kind = option_for(
            options,
            combination_type="six_of_a_kind",
            dice_indices=(0, 1, 2, 3, 4, 5),
            points=1_600,
        )
        self.assertTrue(six_of_a_kind.hot_dice)
        self.assertTrue(six_of_a_kind.free_roll)
        self.assertTrue(six_of_a_kind.requires_confirmation)

    def test_straight_three_pairs_and_two_triples_are_supported(self):
        straight = option_for(
            scoring_options_for_roll([1, 2, 3, 4, 5, 6], turn_id=1, roll_id=1),
            combination_type="straight",
            points=2_000,
        )
        self.assertTrue(straight.hot_dice)
        pairs = option_for(
            scoring_options_for_roll([2, 2, 3, 3, 6, 6], turn_id=1, roll_id=1),
            combination_type="three_pairs",
            points=1_500,
        )
        self.assertTrue(pairs.hot_dice)
        triples = option_for(
            scoring_options_for_roll([2, 2, 2, 4, 4, 4], turn_id=1, roll_id=1),
            combination_type="two_triples",
            points=600,
        )
        self.assertTrue(triples.hot_dice)

    def test_full_six_die_nothing_throw_is_a_score_not_a_zilch(self):
        evaluation = evaluate_zilch_roll([2, 2, 3, 4, 6, 6], turn_id=1, roll_id=1)

        self.assertFalse(evaluation.zilch)
        consolation = option_for(evaluation.options, combination_type="nothing_bonus", points=500)
        self.assertEqual(consolation.dice_indices, (0, 1, 2, 3, 4, 5))
        self.assertTrue(consolation.hot_dice)

    def test_non_scoring_partial_roll_is_a_zilch(self):
        evaluation = evaluate_zilch_roll(
            [1, 2, 2, 3, 4, 6],
            held_indices=(0,),
            round_points=100,
            turn_id=2,
            roll_id=3,
        )

        self.assertTrue(evaluation.zilch)
        self.assertEqual(evaluation.options, ())

    def test_overlapping_choices_are_distinct_and_option_ids_are_stable(self):
        dice = [1, 1, 1, 5, 5, 5]
        first = scoring_options_for_roll(dice, turn_id=8, roll_id=2)
        second = scoring_options_for_roll(dice, turn_id=8, roll_id=2)
        changed_roll = scoring_options_for_roll(dice, turn_id=8, roll_id=3)

        self.assertEqual([option.option_id for option in first], [option.option_id for option in second])
        self.assertNotEqual(first[0].option_id, changed_roll[0].option_id)
        self.assertEqual(len({option.option_id for option in first}), len(first))
        self.assertEqual(
            option_for(first, combination_type="three_ones", dice_indices=(0, 1, 2)).points,
            1_000,
        )
        self.assertEqual(
            option_for(first, combination_type="two_triples", points=1_500).dice_indices,
            (0, 1, 2, 3, 4, 5),
        )


class ZilchTurnEngineTestCase(TestCase):
    def test_roll_uses_only_available_dice_and_controlled_rng(self):
        dice = roll_available_dice([1, 0, 3, 0, 0, 6], (0, 2, 5), randint_fn=sequence_rng([4, 2, 5]))

        self.assertEqual(dice, (1, 4, 3, 2, 5, 6))
        with self.assertRaisesRegex(ZilchRuleError, "zilch_rng_invalid_result"):
            roll_available_dice([0] * 6, (), randint_fn=sequence_rng([7]))

    def test_hot_dice_resets_physical_holds_but_requires_a_scoring_confirmation_roll(self):
        turn = new_zilch_turn("p1", turn_id=1, round_number=1)
        rolled, evaluation = roll_zilch_turn(turn, randint_fn=sequence_rng([1, 2, 3, 4, 5, 6]))
        straight = option_for(evaluation.options, combination_type="straight", points=2_000)

        held = select_zilch_option(rolled, straight.option_id).turn
        self.assertEqual(held.phase, ZILCH_PHASE_CONFIRMATION_ROLL_REQUIRED)
        self.assertEqual(held.held_indices, ())
        self.assertEqual(held.dice, (0, 0, 0, 0, 0, 0))
        self.assertEqual(held.round_points, 2_000)
        self.assertFalse(bank_allowed(held)[0])

        confirmation_roll, confirmation_evaluation = roll_zilch_turn(
            held,
            randint_fn=sequence_rng([5, 2, 3, 4, 6, 2]),
        )
        single_five = option_for(confirmation_evaluation.options, combination_type="single_five", dice_indices=(0,))
        confirmed = select_zilch_option(confirmation_roll, single_five.option_id).turn
        self.assertEqual(confirmed.phase, ZILCH_PHASE_READY_TO_ROLL)
        self.assertEqual(confirmed.round_points, 2_050)

    def test_three_ones_requires_confirmation_again_when_it_reappears(self):
        turn = new_zilch_turn("p1", turn_id=1, round_number=1)
        rolled, evaluation = roll_zilch_turn(turn, randint_fn=sequence_rng([1, 1, 1, 2, 3, 4]))
        triple = option_for(evaluation.options, combination_type="three_ones", points=1_000)
        pending = select_zilch_option(rolled, triple.option_id).turn
        self.assertTrue(pending.confirmation_required)

        confirmation_roll, confirmation_options = roll_zilch_turn(
            pending,
            randint_fn=sequence_rng([1, 1, 1]),
        )
        repeated = option_for(confirmation_options.options, combination_type="three_ones", points=1_000)
        repeated_turn = select_zilch_option(confirmation_roll, repeated.option_id).turn
        self.assertTrue(repeated_turn.confirmation_required)
        self.assertEqual(repeated_turn.round_points, 2_000)

    def test_player_can_take_a_single_five_instead_of_a_triple(self):
        turn = new_zilch_turn("p1", turn_id=1, round_number=1)
        rolled, evaluation = roll_zilch_turn(turn, randint_fn=sequence_rng([5, 5, 5, 2, 3, 4]))
        single = option_for(evaluation.options, combination_type="single_five", dice_indices=(0,))

        result = select_zilch_option(rolled, single.option_id)

        self.assertEqual(result.turn.round_points, 50)
        self.assertEqual(result.turn.held_indices, (0,))
        self.assertEqual(result.turn.phase, ZILCH_PHASE_READY_TO_ROLL)
        next_roll, _evaluation = roll_zilch_turn(result.turn, randint_fn=sequence_rng([1, 2, 3, 4, 6]))
        self.assertEqual(next_roll.dice[0], 5)
        self.assertEqual(next_roll.dice[1:], (1, 2, 3, 4, 6))

    def test_third_roll_guard_rejects_a_roll_that_cannot_reach_300(self):
        turn = replace(
            new_zilch_turn("p1", turn_id=1, round_number=1),
            rolls_used=2,
            round_points=200,
        )
        rolled, evaluation = roll_zilch_turn(turn, randint_fn=sequence_rng([5, 2, 3, 4, 6, 2]))

        self.assertEqual(rolled.rolls_used, 3)
        self.assertTrue(evaluation.third_roll_threshold_zilch)
        self.assertEqual(evaluation.max_holdable_points, 50)

    def test_third_roll_guard_hides_a_too_small_hold_when_a_valid_hold_exists(self):
        turn = replace(
            new_zilch_turn("p1", turn_id=1, round_number=1),
            dice=(1, 1, 1, 5, 2, 3),
            rolls_used=3,
            roll_id=3,
            phase="awaiting_hold",
        )
        raw_options = scoring_options_for_roll(turn.dice, turn_id=turn.turn_id, roll_id=turn.roll_id)
        single_five = option_for(raw_options, combination_type="single_five", dice_indices=(3,))

        self.assertNotIn(single_five.option_id, {option.option_id for option in options_for_turn(turn)})
        with self.assertRaisesRegex(ZilchRuleError, "zilch_stale_or_invalid_option"):
            select_zilch_option(turn, single_five.option_id)
        self.assertEqual(ZILCH_THIRD_ROLL_MINIMUM, 300)

    def test_banking_requires_400_points_and_no_pending_confirmation(self):
        turn = replace(new_zilch_turn("p1", turn_id=1, round_number=1), round_points=ZILCH_BANK_MINIMUM)
        self.assertEqual(bank_allowed(turn), (True, None))
        self.assertFalse(bank_allowed(replace(turn, round_points=399))[0])
        self.assertFalse(
            bank_allowed(replace(turn, phase=ZILCH_PHASE_CONFIRMATION_ROLL_REQUIRED, confirmation_reasons=("hot_dice",)))[0]
        )

    def test_opening_roll_repeats_ties_and_scores_never_go_negative(self):
        opening = roll_starting_player(["p1", "p2"], randint_fn=sequence_rng([4, 4, 2, 6]))
        self.assertEqual(opening.player_id, "p2")
        self.assertEqual(opening.attempts, ({"p1": 4, "p2": 4}, {"p1": 2, "p2": 6}))

        total, streak, penalty = apply_zilch_streak(300, 2)
        self.assertEqual((total, streak, penalty), (0, 3, 500))
        self.assertEqual(apply_zilch_streak(0, 3), (0, 4, 0))
        self.assertEqual(apply_zilch_streak(1_200, 5), (700, 6, 500))
        self.assertEqual(apply_zilch_streak(500, 8), (0, 9, 500))
