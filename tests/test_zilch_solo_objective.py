"""Focused tests for the pure, versioned Zilch solo challenge model."""

from __future__ import annotations

import json
from unittest import TestCase

from app.zilch_solo_objective import (
    ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
    ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
    ZILCH_SOLO_SPRINT_TARGET_SCORE,
    ZilchSoloObjectiveError,
    abandon_solo_objective,
    canonicalize_zilch_solo_objective_definition,
    new_zilch_solo_objective_state,
    record_solo_objective_active_duration,
    record_solo_objective_bank,
    record_solo_objective_hot_dice,
    record_solo_objective_roll,
    record_solo_objective_turn_started,
    record_solo_objective_zilch,
    validate_zilch_solo_objective_definition,
    zilch_solo_objective_state_from_payload,
)


class ZilchSoloObjectiveTestCase(TestCase):
    def test_the_only_objective_is_fixed_versioned_and_parameter_free(self) -> None:
        definition = validate_zilch_solo_objective_definition(
            ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
            ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
            {},
        )
        self.assertEqual(definition.target_score, 10_000)
        self.assertEqual(definition.primary_metric, "turns")
        self.assertEqual(
            definition.tie_break_metrics,
            ("rolls", "zilchs", "active_duration_seconds"),
        )
        self.assertEqual(
            canonicalize_zilch_solo_objective_definition(
                {"id": ZILCH_SOLO_SPRINT_OBJECTIVE_ID, "version": 1, "parameters": {}}
            ),
            {"id": ZILCH_SOLO_SPRINT_OBJECTIVE_ID, "version": 1, "parameters": {}},
        )

    def test_unknown_versions_and_any_client_parameters_are_rejected(self) -> None:
        for objective_id, version, parameters, code in (
            ("unknown", 1, {}, "zilch_solo_objective_unknown"),
            (ZILCH_SOLO_SPRINT_OBJECTIVE_ID, 2, {}, "zilch_solo_objective_unknown_version"),
            (ZILCH_SOLO_SPRINT_OBJECTIVE_ID, 1, {"target_score": 20_000}, "parameters_not_allowed"),
        ):
            with self.subTest(objective_id=objective_id, version=version, parameters=parameters):
                with self.assertRaisesRegex(ZilchSoloObjectiveError, code):
                    validate_zilch_solo_objective_definition(objective_id, version, parameters)

        with self.assertRaisesRegex(ZilchSoloObjectiveError, "invalid_definition"):
            canonicalize_zilch_solo_objective_definition(
                {"id": ZILCH_SOLO_SPRINT_OBJECTIVE_ID, "version": 1, "parameters": {}, "target_score": 1}
            )

    def test_authoritative_events_deterministically_build_progress(self) -> None:
        state = new_zilch_solo_objective_state()
        state = record_solo_objective_turn_started(state, turn_id=1)
        state = record_solo_objective_roll(state, turn_id=1, roll_id=1)
        state = record_solo_objective_hot_dice(state, turn_id=1, roll_id=1)
        state = record_solo_objective_roll(state, turn_id=1, roll_id=2)
        state = record_solo_objective_bank(state, turn_id=1, banked_points=1_200, total_points_after=1_200)
        state = record_solo_objective_turn_started(state, turn_id=2)
        state = record_solo_objective_roll(state, turn_id=2, roll_id=1)
        state = record_solo_objective_zilch(state, turn_id=2, total_points_after=1_200, penalty_points=0)
        state = record_solo_objective_active_duration(state, 37)

        self.assertEqual(state.total_points, 1_200)
        self.assertEqual(state.turns, 2)
        self.assertEqual(state.rolls, 3)
        self.assertEqual(state.zilchs, 1)
        self.assertEqual(state.hot_dice_events, 1)
        self.assertEqual(state.highest_banked_round, 1_200)
        self.assertEqual(state.active_duration_seconds, 37)
        self.assertEqual(state.remaining_points, 8_800)
        self.assertIsNone(state.outcome)

    def test_zilch_penalty_is_copied_from_the_authoritative_board(self) -> None:
        state = new_zilch_solo_objective_state()
        state = record_solo_objective_bank(state, turn_id=1, banked_points=600, total_points_after=600)
        state = record_solo_objective_zilch(state, turn_id=2, total_points_after=100, penalty_points=500)
        self.assertEqual(state.total_points, 100)
        self.assertEqual(state.zilchs, 1)
        self.assertEqual(state.highest_banked_round, 600)

        with self.assertRaisesRegex(ZilchSoloObjectiveError, "zilch_total_mismatch"):
            record_solo_objective_zilch(state, turn_id=3, total_points_after=99, penalty_points=0)

    def test_success_uses_at_least_target_and_locks_further_events(self) -> None:
        state = new_zilch_solo_objective_state()
        state = record_solo_objective_turn_started(state, turn_id=1)
        state = record_solo_objective_roll(state, turn_id=1, roll_id=1)
        state = record_solo_objective_bank(
            state,
            turn_id=1,
            banked_points=ZILCH_SOLO_SPRINT_TARGET_SCORE + 50,
            total_points_after=ZILCH_SOLO_SPRINT_TARGET_SCORE + 50,
        )
        state = record_solo_objective_active_duration(state, 91)
        self.assertEqual(state.outcome, "completed")
        self.assertEqual(state.ranking_key(), (1, 1, 0, 91))
        with self.assertRaisesRegex(ZilchSoloObjectiveError, "objective_finished"):
            record_solo_objective_roll(state, turn_id=2, roll_id=1)

    def test_bank_total_is_an_integrity_check_not_client_scoring(self) -> None:
        state = new_zilch_solo_objective_state()
        with self.assertRaisesRegex(ZilchSoloObjectiveError, "bank_total_mismatch"):
            record_solo_objective_bank(state, turn_id=1, banked_points=500, total_points_after=499)
        with self.assertRaisesRegex(ZilchSoloObjectiveError, "invalid_bank"):
            record_solo_objective_bank(state, turn_id=1, banked_points=0, total_points_after=0)

    def test_abandonment_keeps_progress_and_uses_monotonic_active_duration(self) -> None:
        state = new_zilch_solo_objective_state()
        state = record_solo_objective_turn_started(state, turn_id=1)
        state = record_solo_objective_roll(state, turn_id=1, roll_id=1)
        state = record_solo_objective_active_duration(state, 12)
        state = abandon_solo_objective(state, active_duration_seconds=19)

        self.assertEqual(state.outcome, "abandoned")
        self.assertEqual(state.turns, 1)
        self.assertEqual(state.rolls, 1)
        self.assertEqual(state.active_duration_seconds, 19)
        with self.assertRaisesRegex(ZilchSoloObjectiveError, "not_completed"):
            state.ranking_key()
        with self.assertRaisesRegex(ZilchSoloObjectiveError, "duration_not_monotonic"):
            record_solo_objective_active_duration(state, 18)

    def test_payload_roundtrip_is_json_safe_and_rejects_inconsistent_completion(self) -> None:
        state = new_zilch_solo_objective_state()
        state = record_solo_objective_turn_started(state, turn_id=1)
        state = record_solo_objective_roll(state, turn_id=1, roll_id=1)
        state = record_solo_objective_bank(state, turn_id=1, banked_points=500, total_points_after=500)
        state = record_solo_objective_active_duration(state, 30)
        payload = json.loads(json.dumps(state.payload()))
        self.assertEqual(zilch_solo_objective_state_from_payload(payload), state)

        payload["outcome"] = "completed"
        with self.assertRaisesRegex(ZilchSoloObjectiveError, "invalid_outcome"):
            zilch_solo_objective_state_from_payload(payload)

