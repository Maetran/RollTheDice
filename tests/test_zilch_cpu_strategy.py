"""Focused contract tests for pure, deterministic Zilch CPU decisions."""

from __future__ import annotations

from unittest import TestCase

from app.zilch_cpu_strategy import (
    CpuQuickHoldOption,
    CpuStrategyContext,
    ZilchCpuStrategyError,
    choose_zilch_cpu_decision,
    validate_zilch_cpu_strategy,
)


def option(
    option_id: str,
    *,
    points: int,
    indices: tuple[int, ...] = (0,),
    all_available_dice: bool = False,
    hot_dice: bool = False,
    free_roll: bool = False,
) -> CpuQuickHoldOption:
    return CpuQuickHoldOption(
        option_id=option_id,
        combination_type="combined",
        points=points,
        dice_indices=indices,
        all_available_dice=all_available_dice,
        hot_dice=hot_dice,
        free_roll=free_roll,
    )


def context(
    *,
    strategy: str = "normal",
    own_total: int = 2_000,
    opponent_total: int = 2_000,
    target_score: int = 10_000,
    round_points: int = 0,
    available_dice_count: int = 4,
    confirmation_required: bool = False,
    hot_dice: bool = False,
    final_round: bool = False,
    needed_to_beat: int | None = None,
    quick_holds: tuple[CpuQuickHoldOption, ...] = (),
    can_roll: bool = True,
    can_bank: bool = False,
) -> CpuStrategyContext:
    return CpuStrategyContext(
        strategy=strategy,
        own_total=own_total,
        opponent_total=opponent_total,
        target_score=target_score,
        round_points=round_points,
        available_dice_count=available_dice_count,
        confirmation_required=confirmation_required,
        hot_dice=hot_dice,
        final_round=final_round,
        needed_to_beat=needed_to_beat,
        quick_holds=quick_holds,
        can_roll=can_roll,
        can_bank=can_bank,
    )


class ZilchCpuStrategyTestCase(TestCase):
    def test_unknown_strategy_is_rejected_without_aliases(self) -> None:
        with self.assertRaisesRegex(ZilchCpuStrategyError, "zilch_invalid_cpu_strategy"):
            validate_zilch_cpu_strategy("expert")
        with self.assertRaisesRegex(ZilchCpuStrategyError, "zilch_invalid_cpu_strategy"):
            validate_zilch_cpu_strategy(["normal"])
        with self.assertRaisesRegex(ZilchCpuStrategyError, "zilch_invalid_cpu_strategy"):
            choose_zilch_cpu_decision(context(strategy="NORMAL"))

    def test_every_strategy_is_deterministic_for_the_same_context(self) -> None:
        holds = (
            option("b", points=200, indices=(0, 1)),
            option("a", points=200, indices=(2, 3)),
        )
        for strategy in ("conservative", "normal", "aggressive"):
            with self.subTest(strategy=strategy):
                first = choose_zilch_cpu_decision(context(strategy=strategy, quick_holds=holds))
                second = choose_zilch_cpu_decision(context(strategy=strategy, quick_holds=holds))
                self.assertEqual(first, second)
                self.assertEqual(first.action, "select_hold")
                self.assertEqual(first.option_id, "a")

    def test_cpu_only_selects_a_current_well_formed_quick_hold(self) -> None:
        invalid = CpuQuickHoldOption(
            option_id="forged",
            combination_type="combined",
            points=500,
            dice_indices=(0, 0),
            all_available_dice=False,
            hot_dice=False,
            free_roll=False,
        )
        decision = choose_zilch_cpu_decision(
            context(
                quick_holds=(
                    invalid,
                    option("valid", points=100, indices=(1,)),
                )
            )
        )
        self.assertEqual(decision.action, "select_hold")
        self.assertEqual(decision.option_id, "valid")

    def test_confirmation_always_rolls_instead_of_banking(self) -> None:
        decision = choose_zilch_cpu_decision(
            context(
                round_points=1_500,
                confirmation_required=True,
                can_roll=True,
                can_bank=True,
            )
        )
        self.assertEqual(decision.action, "roll")
        self.assertEqual(decision.reason_key, "zilch.cpu.reason.confirmation_required")

    def test_conservative_banks_earlier_than_normal_and_aggressive(self) -> None:
        decisions = {
            strategy: choose_zilch_cpu_decision(
                context(strategy=strategy, round_points=600, can_roll=True, can_bank=True)
            )
            for strategy in ("conservative", "normal", "aggressive")
        }
        self.assertEqual(decisions["conservative"].action, "bank")
        self.assertEqual(decisions["normal"].action, "roll")
        self.assertEqual(decisions["aggressive"].action, "roll")

    def test_normal_banks_before_aggressive_at_the_same_safe_round(self) -> None:
        normal = choose_zilch_cpu_decision(
            context(strategy="normal", round_points=800, can_roll=True, can_bank=True)
        )
        aggressive = choose_zilch_cpu_decision(
            context(strategy="aggressive", round_points=800, can_roll=True, can_bank=True)
        )
        self.assertEqual(normal.action, "bank")
        self.assertEqual(aggressive.action, "roll")

    def test_aggressive_banks_a_solid_round_when_only_two_dice_remain(self) -> None:
        decision = choose_zilch_cpu_decision(
            context(
                strategy="aggressive",
                round_points=700,
                available_dice_count=2,
                can_roll=True,
                can_bank=True,
            )
        )
        self.assertEqual(decision.action, "bank")
        self.assertEqual(decision.reason_params["bank_goal"], 700)

    def test_few_remaining_dice_lower_the_safe_bank_goal(self) -> None:
        few_dice = choose_zilch_cpu_decision(
            context(strategy="normal", round_points=600, available_dice_count=2, can_roll=True, can_bank=True)
        )
        many_dice = choose_zilch_cpu_decision(
            context(strategy="normal", round_points=600, available_dice_count=6, can_roll=True, can_bank=True)
        )
        self.assertEqual(few_dice.action, "bank")
        self.assertEqual(many_dice.action, "roll")

    def test_hot_dice_context_raises_the_non_confirmation_risk_goal(self) -> None:
        ordinary = choose_zilch_cpu_decision(
            context(strategy="normal", round_points=700, can_roll=True, can_bank=True)
        )
        hot_dice = choose_zilch_cpu_decision(
            context(
                strategy="normal",
                round_points=700,
                hot_dice=True,
                confirmation_required=False,
                can_roll=True,
                can_bank=True,
            )
        )
        self.assertEqual(ordinary.action, "bank")
        self.assertEqual(hot_dice.action, "roll")

    def test_trailing_cpu_accepts_more_risk_but_a_leader_banks_earlier(self) -> None:
        trailing = choose_zilch_cpu_decision(
            context(
                strategy="normal",
                own_total=2_000,
                opponent_total=3_500,
                round_points=650,
                can_roll=True,
                can_bank=True,
            )
        )
        leading = choose_zilch_cpu_decision(
            context(
                strategy="normal",
                own_total=3_500,
                opponent_total=2_000,
                round_points=650,
                can_roll=True,
                can_bank=True,
            )
        )
        self.assertEqual(trailing.action, "roll")
        self.assertEqual(leading.action, "bank")

    def test_target_is_banked_immediately_when_legal(self) -> None:
        decision = choose_zilch_cpu_decision(
            context(
                own_total=9_700,
                round_points=400,
                can_roll=True,
                can_bank=True,
            )
        )
        self.assertEqual(decision.action, "bank")
        self.assertEqual(decision.reason_key, "zilch.cpu.reason.target_reached")

    def test_final_reply_never_banks_a_known_loss_when_a_roll_remains(self) -> None:
        decision = choose_zilch_cpu_decision(
            context(
                own_total=9_400,
                opponent_total=10_200,
                round_points=650,
                final_round=True,
                needed_to_beat=10_201,
                can_roll=True,
                can_bank=True,
            )
        )
        self.assertEqual(decision.action, "roll")
        self.assertEqual(decision.reason_key, "zilch.cpu.reason.final_round_chase")

    def test_final_reply_banks_as_soon_as_it_secures_required_total(self) -> None:
        decision = choose_zilch_cpu_decision(
            context(
                own_total=9_600,
                opponent_total=10_100,
                round_points=601,
                final_round=True,
                needed_to_beat=10_201,
                can_roll=True,
                can_bank=True,
            )
        )
        self.assertEqual(decision.action, "bank")
        self.assertEqual(decision.reason_key, "zilch.cpu.reason.final_round_target_reached")

    def test_aggressive_profile_prefers_a_equal_value_hot_dice_option(self) -> None:
        safe = option("safe", points=200, indices=(0,))
        hot = option(
            "hot",
            points=200,
            indices=(0, 1, 2, 3),
            all_available_dice=True,
            hot_dice=True,
            free_roll=True,
        )
        conservative = choose_zilch_cpu_decision(
            context(strategy="conservative", available_dice_count=4, quick_holds=(safe, hot))
        )
        aggressive = choose_zilch_cpu_decision(
            context(strategy="aggressive", available_dice_count=4, quick_holds=(safe, hot))
        )
        self.assertEqual(conservative.option_id, "safe")
        self.assertEqual(aggressive.option_id, "hot")
