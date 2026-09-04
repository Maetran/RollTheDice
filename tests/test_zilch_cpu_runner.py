"""Focused trusted-runner contracts for human-vs-CPU Zilch."""

from __future__ import annotations

import asyncio
import os
from unittest import TestCase
from unittest.mock import AsyncMock, patch

from app.game_state import games
from app.game_ws_session import GameSocketSession
from app.zilch_cpu_runner import (
    cpu_action_delay_seconds,
    cpu_action_is_due,
    maybe_schedule_cpu_turn,
    resume_cpu_games,
    stop_cpu_runners,
)
from app.zilch_gameplay import (
    apply_zilch_roll_dice,
    apply_zilch_start_roll,
    handle_zilch_gameplay_action,
)
from app.zilch_results import build_zilch_result_payload
from app.zilch_state import (
    configure_zilch_cpu_game,
    finish_zilch_game,
    join_zilch_player,
    new_zilch_game,
    record_zilch_start_roll,
    start_zilch_game,
    zilch_cpu_participant,
)


def sequence_rng(values: list[int]):
    iterator = iter(values)

    def _rng(_lower: int, _upper: int) -> int:
        return next(iterator)

    return _rng


class RecordingSocket:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def send_json(self, message: dict) -> None:
        self.messages.append(message)


class ZilchCpuRunnerTestCase(TestCase):
    def setUp(self) -> None:
        self.game_ids: list[str] = []

    def tearDown(self) -> None:
        asyncio.run(stop_cpu_runners())
        for game_id in self.game_ids:
            games.pop(game_id, None)

    def _cpu_game(self, *, strategy: str = "conservative") -> tuple[dict, RecordingSocket, str, str]:
        game_id = f"zilch-cpu-runner-{len(self.game_ids)}"
        self.game_ids.append(game_id)
        game = new_zilch_game(game_id, "CPU table", 2)
        cpu = configure_zilch_cpu_game(game, host_user_id=42, cpu_strategy=strategy)
        socket = RecordingSocket()
        human_id = "human-1"
        join_zilch_player(
            game,
            {"id": human_id, "name": "Mani", "user_id": 42, "ws": socket, "resume_token": "human-resume"},
        )
        start_zilch_game(game)
        return game, socket, human_id, str(cpu["id"])

    def test_cpu_start_roll_waits_for_human_then_resolves_through_same_rng_seam(self) -> None:
        game, socket, human_id, cpu_id = self._cpu_game()

        async def scenario() -> None:
            apply_zilch_start_roll(game, human_id, start_roll_version=0, randint_fn=sequence_rng([6]))
            task = maybe_schedule_cpu_turn(game, delay_seconds=0, randint_fn=sequence_rng([2]))
            self.assertIsNotNone(task)
            await task

        asyncio.run(scenario())
        opening = game["_zilch_start_roll"]
        self.assertEqual(opening["phase"], "resolved")
        self.assertEqual(opening["winner_id"], human_id)
        self.assertEqual(opening["attempts"], [{"attempt": 1, "rolls": {human_id: 6, cpu_id: 2}}])
        self.assertEqual(game["_turn"]["player_id"], human_id)
        self.assertTrue(any(message.get("zilch_event", {}).get("actor_participant_id") == cpu_id for message in socket.messages))

    def test_cpu_opening_tie_waits_for_next_human_roll_and_never_duplicates(self) -> None:
        game, _socket, human_id, cpu_id = self._cpu_game()

        async def scenario() -> None:
            apply_zilch_start_roll(game, human_id, start_roll_version=0, randint_fn=sequence_rng([4]))
            first = maybe_schedule_cpu_turn(game, delay_seconds=0, randint_fn=sequence_rng([4]))
            second = maybe_schedule_cpu_turn(game, delay_seconds=0, randint_fn=sequence_rng([6]))
            self.assertIs(first, second)
            await first
            self.assertTrue(game["_zilch_start_roll"]["tied"])
            self.assertEqual(game["_zilch_start_roll"]["pending_player_ids"], [human_id, cpu_id])
            apply_zilch_start_roll(game, human_id, start_roll_version=2, randint_fn=sequence_rng([6]))
            retry = maybe_schedule_cpu_turn(game, delay_seconds=0, randint_fn=sequence_rng([2]))
            self.assertIsNotNone(retry)
            await retry

        asyncio.run(scenario())
        self.assertEqual(game["_zilch_start_roll"]["phase"], "resolved")
        self.assertEqual(game["_zilch_start_roll"]["attempts"], [
            {"attempt": 1, "rolls": {human_id: 4, cpu_id: 4}},
            {"attempt": 2, "rolls": {human_id: 6, cpu_id: 2}},
        ])

    def test_cpu_uses_shared_roll_hold_and_bank_path_without_zdwa_scoring(self) -> None:
        game, socket, human_id, cpu_id = self._cpu_game(strategy="conservative")

        async def scenario() -> None:
            # CPU wins the opening die, then takes one visible roll, commits
            # the server-provided triple, and banks through the shared command.
            apply_zilch_start_roll(game, human_id, start_roll_version=0, randint_fn=sequence_rng([2]))
            task = maybe_schedule_cpu_turn(
                game,
                delay_seconds=0,
                randint_fn=sequence_rng([6, 5, 5, 5, 2, 3, 4]),
            )
            self.assertIsNotNone(task)
            await task

        with patch("app.game_engine.apply_roll", side_effect=AssertionError("ZDWA scoring must not run for CPU")):
            asyncio.run(scenario())
        cpu_board = game["_zilch_boards"][cpu_id]
        self.assertEqual(cpu_board["total_points"], 500)
        self.assertEqual(cpu_board["rounds"][-1]["event"], "bank")
        self.assertEqual(game["_turn"]["player_id"], human_id)
        events = [message.get("zilch_event", {}) for message in socket.messages]
        self.assertTrue(any(event.get("type") == "roll" and event.get("actor_participant_id") == cpu_id for event in events))
        self.assertTrue(any(event.get("type") == "hold" and event.get("actor_participant_id") == cpu_id for event in events))
        self.assertTrue(any(event.get("type") == "bank" and event.get("actor_participant_id") == cpu_id for event in events))

    def test_cpu_default_pacing_is_nine_tenths_of_a_second(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(cpu_action_delay_seconds(), 0.9)

    def test_cpu_waits_for_zilch_presentation_then_uses_default_inter_action_pacing(self) -> None:
        game, _socket, human_id, cpu_id = self._cpu_game(strategy="conservative")
        delays: list[float] = []

        async def record_delay(delay: float) -> None:
            delays.append(delay)

        async def scenario() -> None:
            record_zilch_start_roll(game, human_id, 2)
            record_zilch_start_roll(game, cpu_id, 6)
            # The previous player's terminal roll is already published.  The
            # CPU must leave enough time for the 500 ms dice reveal and the
            # following ZILCH presentation before starting its own turn.
            game["_zilch_last_event"] = {"type": "zilch", "player_id": human_id}
            with patch.dict(os.environ, {}, clear=True), patch(
                "app.zilch_cpu_runner.asyncio.sleep",
                new=record_delay,
            ):
                task = maybe_schedule_cpu_turn(
                    game,
                    randint_fn=sequence_rng([5, 5, 5, 2, 3, 4]),
                )
                self.assertIsNotNone(task)
                await task

        asyncio.run(scenario())
        self.assertGreaterEqual(len(delays), 2)
        self.assertGreaterEqual(delays[0], 1.9)
        self.assertEqual(delays[1:], [0.9] * (len(delays) - 1))

    def test_explicit_zero_delay_bypasses_even_the_zilch_handoff_pause(self) -> None:
        game, _socket, human_id, cpu_id = self._cpu_game(strategy="conservative")

        async def scenario() -> None:
            record_zilch_start_roll(game, human_id, 2)
            record_zilch_start_roll(game, cpu_id, 6)
            game["_zilch_last_event"] = {"type": "zilch", "player_id": human_id}
            sleep = AsyncMock()
            with patch("app.zilch_cpu_runner.asyncio.sleep", sleep):
                task = maybe_schedule_cpu_turn(
                    game,
                    delay_seconds=0,
                    randint_fn=sequence_rng([5, 5, 5, 2, 3, 4]),
                )
                self.assertIsNotNone(task)
                await task
            sleep.assert_not_awaited()

        asyncio.run(scenario())

    def test_pause_or_human_disconnect_stops_cpu_before_any_action(self) -> None:
        game, _socket, human_id, cpu_id = self._cpu_game()
        record_zilch_start_roll(game, human_id, 2)
        record_zilch_start_roll(game, cpu_id, 6)
        self.assertTrue(cpu_action_is_due(game))
        game["_players"][0]["ws"] = None
        game["_resume_required"] = True
        self.assertFalse(cpu_action_is_due(game))
        self.assertIsNone(maybe_schedule_cpu_turn(game, delay_seconds=0))

    def test_unknown_recovered_strategy_stays_a_cpu_state_and_stops_without_inventing_a_move(self) -> None:
        game, socket, human_id, cpu_id = self._cpu_game()
        game["_participants"][1]["cpu_strategy"] = "future-unknown"
        # A bad pre-Part-6 connection marker must not make the game wait for
        # a second fake WebSocket; the CPU schema still has one human seat.
        game["_expected_connections"] = 2
        record_zilch_start_roll(game, human_id, 2)
        record_zilch_start_roll(game, cpu_id, 6)

        async def scenario() -> None:
            task = maybe_schedule_cpu_turn(game, delay_seconds=0)
            self.assertIsNotNone(task)
            await task

        asyncio.run(scenario())
        self.assertEqual(game["_participants"][1]["type"], "cpu")
        self.assertEqual(game["_expected_connections"], 1)
        self.assertEqual(game["_zilch_cpu_error"], "zilch_cpu_game_cannot_continue")
        self.assertEqual(game["_zilch_boards"][cpu_id]["rounds"], [])
        self.assertEqual(socket.messages[-1]["zilch_event"]["type"], "cpu_unavailable")

    def test_public_socket_cannot_claim_the_cpu_participant_id(self) -> None:
        game, _socket, human_id, cpu_id = self._cpu_game()
        record_zilch_start_roll(game, human_id, 6)
        record_zilch_start_roll(game, cpu_id, 2)
        forged_socket = RecordingSocket()
        forged = GameSocketSession(websocket=forged_socket, game=game, auth_identity=None, player_id=cpu_id)

        asyncio.run(
            handle_zilch_gameplay_action(
                forged,
                "zilch_roll_dice",
                {"turn_id": game["_turn"]["turn_id"], "version": game["_turn"]["version"]},
            )
        )
        self.assertEqual(forged_socket.messages[-1]["zilch_error"]["code"], "zilch_cpu_action_not_allowed")

    def test_human_and_cpu_roll_commands_consume_the_same_injectable_rng_shape(self) -> None:
        human_game, _socket, human_id, cpu_id = self._cpu_game()
        record_zilch_start_roll(human_game, human_id, 6)
        record_zilch_start_roll(human_game, cpu_id, 2)
        human_trace: list[tuple[int, int]] = []

        def human_rng(lower: int, upper: int) -> int:
            human_trace.append((lower, upper))
            return [1, 5, 2, 3, 4, 6][len(human_trace) - 1]

        apply_zilch_roll_dice(
            human_game,
            human_id,
            turn_id=1,
            version=0,
            randint_fn=human_rng,
        )

        cpu_game, _socket, cpu_human_id, cpu_id = self._cpu_game()
        record_zilch_start_roll(cpu_game, cpu_human_id, 2)
        record_zilch_start_roll(cpu_game, cpu_id, 6)
        cpu_trace: list[tuple[int, int]] = []

        def cpu_rng(lower: int, upper: int) -> int:
            cpu_trace.append((lower, upper))
            return [1, 5, 2, 3, 4, 6][len(cpu_trace) - 1]

        # The low-level trusted CPU command is exactly the same command used
        # above; the runner merely decides when to call it.
        apply_zilch_roll_dice(
            cpu_game,
            cpu_id,
            turn_id=1,
            version=0,
            randint_fn=cpu_rng,
        )
        self.assertEqual(human_trace, [(1, 6)] * 6)
        self.assertEqual(cpu_trace, [(1, 6)] * 6)

    def test_recovery_scheduler_resumes_one_unpaused_cpu_turn(self) -> None:
        game, _socket, human_id, cpu_id = self._cpu_game(strategy="conservative")
        record_zilch_start_roll(game, human_id, 2)
        record_zilch_start_roll(game, cpu_id, 6)

        async def scenario() -> None:
            with patch("app.zilch_cpu_runner.cpu_action_delay_seconds", return_value=0), patch(
                "app.zilch_cpu_runner.fair_zilch_randint",
                new=sequence_rng([5, 5, 5, 2, 3, 4]),
            ):
                await resume_cpu_games({str(game["_id"]): game})
                task = maybe_schedule_cpu_turn(game, delay_seconds=0)
                self.assertIsNotNone(task)
                await task

        asyncio.run(scenario())
        self.assertEqual(game["_turn"]["player_id"], human_id)
        self.assertEqual(game["_zilch_boards"][cpu_id]["total_points"], 500)

    def test_cpu_result_payload_keeps_strategy_and_has_no_user_or_connection_identity(self) -> None:
        game, _socket, human_id, cpu_id = self._cpu_game(strategy="aggressive")
        record_zilch_start_roll(game, human_id, 6)
        record_zilch_start_roll(game, cpu_id, 2)
        game["_total_points"] = {human_id: 10_000, cpu_id: 9_500}
        game["_round_points"] = {human_id: 0, cpu_id: 0}
        game["_zilch_boards"][human_id].update(
            {
                "total_points": 10_000,
                "rounds": [
                    {"turn_id": 1, "round": 1, "event": "bank", "points": 10_000, "total_after": 10_000, "rolls_used": 1, "committed_holds": []}
                ],
            }
        )
        game["_zilch_boards"][cpu_id].update(
            {
                "total_points": 9_500,
                "rounds": [
                    {"turn_id": 2, "round": 1, "event": "bank", "points": 9_500, "total_after": 9_500, "rolls_used": 1, "committed_holds": []}
                ],
            }
        )
        game["_zilch_final_round"] = {"triggered_by": human_id, "target_score": 10_000, "pending_player_ids": []}
        finish_zilch_game(game)

        payload = build_zilch_result_payload(game)
        cpu = next(participant for participant in payload["participants"] if participant["participant_type"] == "cpu")
        self.assertEqual(cpu["cpu_strategy"], "aggressive")
        self.assertIsNone(cpu["user_id"])
        self.assertNotIn("connection_player_id", cpu)
        self.assertEqual(payload["play_mode"], "cpu")
        self.assertEqual(zilch_cpu_participant(game)["cpu_strategy"], "aggressive")
