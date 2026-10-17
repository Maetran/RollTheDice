"""Human-paced CPU clocks without artificial protection for additional cards."""

import asyncio
import os
from random import Random
from unittest import IsolatedAsyncioTestCase
from unittest.mock import Mock, patch

import pytest

from app import hausdepp_cpu_runner as runner
from app.hausdepp_engine import apply_action
from tests.test_hausdepp_engine import scenario


def test_default_timing_has_fast_regular_and_thoughtful_reactions():
    with patch.dict(os.environ, clear=True):
        random = Random(7103)
        delays = [runner._delay({}, {"action": "play"}, rng=random) for _ in range(600)]
        following = [runner._delay({}, {"action": "play"}, following=True, rng=random) for _ in range(600)]
        draws = [runner._delay({}, {"action": "draw"}, rng=random) for _ in range(100)]
        additional = [runner._delay({}, {"action": "afterthrow"}, rng=random) for _ in range(100)]
    assert len(set(delays)) == 600
    assert all(0.18 <= delay <= 2.7 for delay in delays)
    assert sum(delay < 0.45 for delay in delays) > 50
    assert sum(delay > 1.4625 for delay in delays) > 50
    assert sum(following) / len(following) < sum(delays) / len(delays)
    assert all(0.16875 <= delay <= 0.73125 for delay in draws)
    assert all(0.1125 <= delay <= 0.95625 for delay in additional)


@pytest.mark.parametrize(("action", "following", "roll", "bounds"), [
    ("peek", False, 0.0, (0.45, 1.3)),
    ("draw", False, 0.0, (0.15, 0.65)),
    ("afterthrow", False, 0.0, (0.1, 0.85)),
    ("play", False, 0.1, (0.16, 0.37)),
    ("play", False, 0.5, (0.45, 1.2)),
    ("play", False, 0.9, (1.3, 2.4)),
    ("play", True, 0.5, (0.12, 0.65)),
    ("play", True, 0.9, (0.8, 1.35)),
    ("gamble", False, 0.5, (0.45, 1.2)),
    ("pickup", True, 0.9, (0.8, 1.35)),
])
def test_each_normal_reaction_is_exactly_twelve_and_a_half_percent_slower(action, following, roll, bounds):
    timing_rng = Mock()
    timing_rng.random.return_value = roll
    sampled = bounds[0] + (bounds[1] - bounds[0]) * 0.37
    timing_rng.uniform.return_value = sampled
    with patch.dict(os.environ, clear=True):
        assert runner._delay({}, {"action": action}, following=following, rng=timing_rng) == sampled * 1.125
    timing_rng.uniform.assert_called_once_with(*bounds)


@pytest.mark.parametrize(("value", "expected"), [("0", 0.0), ("0.06", 0.06), ("-8", 0.0), ("50", 5.0)])
def test_explicit_timing_override_remains_bounded_and_deterministic(value, expected):
    with patch.dict(os.environ, {"ROLLTHEDICE_HAUSDEPP_CPU_DELAY_SECONDS": value}):
        for action in ("peek", "draw", "afterthrow", "play", "gamble", "pickup"):
            timing_rng = Mock()
            assert runner._delay({}, {"action": action}, following=True, rng=timing_rng) == expected
            timing_rng.uniform.assert_not_called()
            timing_rng.random.assert_not_called()


@pytest.mark.parametrize("value", ["invalid", "NaN", "inf", "-inf"])
def test_bad_timing_configuration_falls_back_to_a_finite_reaction(value):
    with patch.dict(os.environ, {"ROLLTHEDICE_HAUSDEPP_CPU_DELAY_SECONDS": value}):
        assert 0.18 <= runner._delay({}, {"action": "play"}, rng=Random(31)) <= 2.7


def game_for(state, *, cpu_ids):
    for player in state["players"]:
        player["is_cpu"] = player["id"] in cpu_ids
    return {"_id": "isolated-cpu-clock", "_game_type": "hausdepp", "_started": True, "_finished": False,
            "_aborted": False, "_hausdepp": state, "_participants": state["players"],
            "_players": [{"id": "human", "ws": object()}]}


def test_bounded_cpu_memory_survives_human_turns_and_resets_for_a_new_round_or_disconnect():
    game = {"_id": "memory-table", "_participants": [{"id": "cpu", "is_cpu": True}]}
    with patch.dict(runner.games, {game["_id"]: game}, clear=True), patch.dict(runner._MEMORIES, clear=True):
        first = runner._memories_for(game)["cpu"]
        assert runner._memories_for(game)["cpu"] is first
        game["_hausdepp_tournament"] = {"round_number": 2}
        second = runner._memories_for(game)["cpu"]
        assert second is not first
        asyncio.run(runner.stop_cpu_runner(game["_id"]))
        assert game["_id"] not in runner._MEMORIES
        for index in range(140):
            table = {"_id": str(index), "_participants": []}
            runner.games[table["_id"]] = table
            runner._memories_for(table)
        assert len(runner._MEMORIES) == 128


class CpuRunnerRaceTests(IsolatedAsyncioTestCase):
    async def run_cpu(self, game, *, sleep=None, delay=None, stop_after=1):
        events = []

        async def published(current, **kwargs):
            events.append(dict(current["_hausdepp"]["last_event"]))
            if len(events) >= stop_after:
                current["_aborted"] = True

        original_sleep = asyncio.sleep

        async def instant_sleep(seconds):
            if sleep:
                await sleep(seconds)
            await original_sleep(0)

        with (patch.dict(runner.games, {game["_id"]: game}, clear=True),
              patch.object(runner, "multiplayer_pause_reason", return_value=None),
              patch("app.hausdepp_gameplay.multiplayer_pause_reason", return_value=None),
              patch("app.hausdepp_gameplay.publish_hausdepp_transition", side_effect=published),
              patch.object(runner.asyncio, "sleep", side_effect=instant_sleep),
              patch.object(runner, "_delay", side_effect=delay or (lambda *args, **kwargs: 0.0)) as clock):
            await runner._run(game)
        return events, clock

    async def test_two_cpu_seats_race_by_their_deadline_instead_of_participant_order(self):
        for faster in ("p0", "p1"):
            with self.subTest(faster=faster):
                state = scenario([["hearts-U", "hearts-6", "hearts-A"], ["hearts-K", "hearts-7", "hearts-10"],
                                  ["acorns-6"]], discard=["bells-U"], current="p1",
                                 afterthrow={"player_id": "p0", "rank": "U"})
                game = game_for(state, cpu_ids={"p0", "p1"})

                def delay(view, command, **kwargs):
                    return 0.1 if view["viewer_id"] == faster else 0.7

                events, _ = await self.run_cpu(game, delay=delay)
                assert events[0]["player_id"] == faster
                assert events[0]["type"] == ("afterthrow" if faster == "p0" else "play")

    async def test_human_additional_card_is_accepted_during_wait_and_cpu_recomputes(self):
        state = scenario([["hearts-U", "hearts-6", "hearts-A"], ["acorns-U", "hearts-K", "hearts-10"]],
                         discard=["bells-U", "leaves-U"], current="p1",
                         afterthrow={"player_id": "p0", "rank": "U"})
        game = game_for(state, cpu_ids={"p1"})
        original_version = state["version"]

        async def additional(_seconds):
            game["_hausdepp"] = apply_action(game["_hausdepp"], "p0", "afterthrow", ["hearts-U"], version=original_version)

        events, _ = await self.run_cpu(game, sleep=additional)
        assert game["_hausdepp"]["version"] == original_version + 2
        assert events[0]["player_id"] == "p1" and events[0]["burn_reason"] == "four_of_a_kind"
        assert not game["_hausdepp_cpu_thinking"]

    async def test_unrelated_refill_does_not_restart_the_current_cpus_wait(self):
        state = scenario([["hearts-6"], ["hearts-K", "hearts-A", "hearts-10"]], discard=["bells-U"],
                         deck=["hearts-7", "hearts-8", "hearts-9"], current="p1")
        state["pending_refills"] = {"p0": {"player_id": "p0", "remaining": 2, "continuation": "advance", "rank": "6"}}
        game = game_for(state, cpu_ids={"p1"})

        async def refill(_seconds):
            current = game["_hausdepp"]
            game["_hausdepp"] = apply_action(current, "p0", "draw", version=current["version"])

        events, clock = await self.run_cpu(game, sleep=refill)
        assert clock.call_count == 1
        assert events[0]["player_id"] == "p1"

    async def test_clearance_and_following_move_receive_distinct_followup_reactions(self):
        state = scenario([["hearts-K", "bells-K", "hearts-10"], ["acorns-6"]], discard=["leaves-A"])
        waits = []

        async def observe_wait(seconds):
            waits.append(seconds)

        with patch.dict(os.environ, clear=True):
            events, clock = await self.run_cpu(game_for(state, cpu_ids={"p0"}), sleep=observe_wait, stop_after=2)
        assert [event["type"] for event in events] == ["play", "play"]
        assert [call.kwargs["following"] for call in clock.call_args_list] == [False, True]
        assert events[0]["burn_reason"] == "ten"
        assert events[1]["cards"] == ["bells-K", "hearts-K"]
        assert waits[0] == 0
        assert 1.9 < waits[1] <= 1.95

    async def test_explicit_fast_clock_keeps_integration_games_fast_after_a_clearance(self):
        state = scenario([["hearts-K", "bells-K", "hearts-10"], ["acorns-6"]], discard=["leaves-A"])
        waits = []

        async def observe_wait(seconds):
            waits.append(seconds)

        with patch.dict(os.environ, {"ROLLTHEDICE_HAUSDEPP_CPU_DELAY_SECONDS": "0"}):
            events, _ = await self.run_cpu(game_for(state, cpu_ids={"p0"}), sleep=observe_wait, stop_after=2)
        assert [event["type"] for event in events] == ["play", "play"]
        assert waits == [0, 0]

    async def test_next_cpu_waits_for_public_card_arrival_without_restarting_its_reaction(self):
        state = scenario([["hearts-6"], ["hearts-K", "hearts-A", "hearts-10"]], discard=["bells-U"], current="p1")
        state["last_event"] = {"type": "play", "player_id": "p0", "cards": ["bells-U"]}
        waits = []

        async def observe_wait(seconds):
            waits.append(seconds)

        with patch.dict(os.environ, clear=True):
            events, clock = await self.run_cpu(game_for(state, cpu_ids={"p1"}), sleep=observe_wait)
        assert events[0]["player_id"] == "p1"
        assert clock.call_count == 1
        assert 1.25 < waits[0] <= 1.3

    async def test_waiting_runner_lets_a_human_card_land_before_the_next_cpu_turn(self):
        # p0 (computer) still owes a refill while the human p1 plays. The
        # runner was already waiting; the next computer must not close p1's
        # afterthrow while that card is still flying to the pile.
        state = scenario([["hearts-6"], ["hearts-K", "acorns-K", "bells-9"], ["leaves-A", "leaves-8", "leaves-9"]],
                         discard=["bells-U"], deck=["hearts-7", "hearts-8", "hearts-9", "acorns-6"], current="p1")
        state["pending_refills"] = {"p0": {"player_id": "p0", "remaining": 2, "continuation": "advance", "rank": "6"}}
        game = game_for(state, cpu_ids={"p0", "p2"})
        now = [100.0]
        played_at = []

        async def human_plays_then_time_passes(seconds):
            if not played_at:
                from app.hausdepp_gameplay import apply_hausdepp_command

                apply_hausdepp_command(game, "p1", {"action": "play", "cards": ["hearts-K"],
                                                    "version": game["_hausdepp"]["version"]})
                played_at.append(now[0])
            now[0] += seconds

        with patch.dict(os.environ, clear=True), patch.object(runner, "_now", side_effect=lambda: now[0]):
            events, _ = await self.run_cpu(game, sleep=human_plays_then_time_passes, stop_after=2)
        # The next computer may play or buy the packet; only its timing matters here.
        assert [(event["type"], event["player_id"]) for event in events][0] == ("draw", "p0")
        assert events[1]["player_id"] == "p2" and events[1]["type"] in {"play", "pickup"}
        assert now[0] - played_at[0] == pytest.approx(1.3)


def test_a_successful_cut_is_shown_before_the_first_computer_move():
    with patch.dict(os.environ, clear=True):
        shown = {"last_event": {"type": "round_started"}, "peek_information": {"success": True}}
        quiet = {"last_event": {"type": "round_started"}, "peek_information": {"success": False}}
        assert runner._presentation_delay(shown) == 3.0
        assert runner._presentation_delay(quiet) == 0.0
