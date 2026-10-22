"""Refills use their own reaction clock without shortening public throw windows."""

import asyncio
import os
from collections import Counter
from contextlib import ExitStack, asynccontextmanager
from copy import deepcopy
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

import pytest

from app import hausdepp_cpu_runner as runner
from app.hausdepp_cpu_tempo import enable_fast_cpu_tempo
from app.hausdepp_engine import project_state
from app.hausdepp_gameplay import apply_hausdepp_command
from tests.test_hausdepp_cpu_runner import game_for
from tests.test_hausdepp_engine import scenario


class VirtualClock:
    """Advance actual runner sleeps and cancellation, without waiting in real time."""

    def __init__(self):
        self.now = 0.0
        self.waits = []
        self.yield_control = asyncio.sleep

    async def sleep(self, seconds):
        if seconds <= 0:
            await self.yield_control(0)
            return
        future = asyncio.get_running_loop().create_future()
        wait = (self.now + seconds, future)
        self.waits.append(wait)
        try:
            await future
        finally:
            self.waits.remove(wait)

    async def settle(self):
        # All work at this virtual instant is synchronous apart from task and
        # lock handoffs. Repeated event-loop turns do not advance the clock.
        for _ in range(12):
            await self.yield_control(0)

    async def advance_to(self, target):
        assert target >= self.now
        await self.settle()
        while self.waits and min(deadline for deadline, _ in self.waits) <= target:
            self.now = min(deadline for deadline, _ in self.waits)
            for deadline, future in list(self.waits):
                if deadline <= self.now and not future.done():
                    future.set_result(None)
            await self.settle()
        self.now = target
        await self.settle()


class RefillTimingTests(IsolatedAsyncioTestCase):
    @asynccontextmanager
    async def running(self, game, *, delay, stop_after=None, settle_at_start=True):
        clock = VirtualClock()
        events = []
        samples = []

        async def published(current, **_kwargs):
            events.append((clock.now, deepcopy(current["_hausdepp"]["last_event"])))
            if stop_after and len(events) >= stop_after:
                current["_aborted"] = True

        def sampled(view, command, **kwargs):
            samples.append((view["viewer_id"], command["action"], clock.now))
            return delay(view, command, **kwargs)

        def pause_reason(current):
            return "reconnecting" if current.get("_test_paused") else None

        with ExitStack() as patches:
            patches.enter_context(patch.dict(os.environ, clear=True))
            patches.enter_context(patch.dict(runner.games, {game["_id"]: game}, clear=True))
            patches.enter_context(patch.dict(runner._TASKS, clear=True))
            patches.enter_context(patch.dict(runner._MEMORIES, clear=True))
            patches.enter_context(patch.object(runner, "_now", side_effect=lambda: clock.now))
            patches.enter_context(patch.object(runner, "_delay", side_effect=sampled))
            patches.enter_context(patch.object(runner.asyncio, "sleep", side_effect=clock.sleep))
            patches.enter_context(patch.object(runner, "multiplayer_pause_reason", side_effect=pause_reason))
            patches.enter_context(patch("app.hausdepp_gameplay.multiplayer_pause_reason", side_effect=pause_reason))
            patches.enter_context(patch("app.hausdepp_gameplay.publish_hausdepp_transition", side_effect=published))
            runner.maybe_schedule_cpu_turn(game)
            if settle_at_start:
                await clock.settle()
            try:
                yield clock, events, samples
            finally:
                await runner.stop_cpu_runners()

    async def test_refill_overtakes_a_faster_throw_blocked_by_public_card_presentation(self):
        for clears, draw_delay in ((False, 0.2), (False, 0.7), (True, 0.2), (True, 0.7)):
            with self.subTest(clears=clears, draw_delay=draw_delay):
                state = scenario(
                    [["hearts-10" if clears else "hearts-6", "hearts-9", "hearts-K"],
                     ["bells-7", "bells-8", "bells-K"]],
                    discard=(["leaves-6", "leaves-7", "leaves-8", "leaves-9", "leaves-U", "leaves-A"]
                             if clears else ["leaves-6"]),
                    deck=["acorns-6", "acorns-7", "acorns-8", "acorns-9"],
                )
                game = game_for(state, cpu_ids={"p0", "p1"})

                def delay(view, command, **_kwargs):
                    if command["action"] == "draw":
                        return draw_delay
                    return 0.2 if view["viewer_id"] == "p0" else 0.1

                landing_at = 0.2 + (1.95 if clears else 1.3)
                async with self.running(game, delay=delay, stop_after=3) as (clock, events, _samples):
                    await clock.advance_to(0.2 + draw_delay)
                    assert [(event["type"], event["player_id"]) for _, event in events] == [
                        ("play", "p0"), ("draw", "p0"),
                    ]
                    assert events[1][0] == pytest.approx(0.2 + draw_delay)
                    assert len(game["_hausdepp"]["players"][0]["hand"]) == 3
                    await clock.advance_to(landing_at - 0.001)
                    assert len(events) == 2
                    await clock.advance_to(landing_at)
                    assert len(events) == 3
                    assert events[2][0] == pytest.approx(landing_at)
                    assert events[2][1]["type"] != "draw"

    async def test_draw_keeps_human_afterthrow_open_and_keeps_the_human_landing_floor(self):
        state = scenario(
            [["hearts-6"], ["hearts-K", "acorns-K", "bells-9"], ["leaves-A", "leaves-8", "leaves-9"]],
            discard=["bells-U"], deck=["hearts-7", "hearts-8", "hearts-9", "acorns-6", "acorns-7"],
            current="p1",
        )
        state["pending_refills"] = {"p0": {"player_id": "p0", "remaining": 2,
                                           "continuation": "advance", "rank": "6"}}
        game = game_for(state, cpu_ids={"p0", "p2"})

        def delay(_view, command, **_kwargs):
            return 0.7 if command["action"] == "draw" else 0.2

        async with self.running(game, delay=delay, stop_after=2) as (clock, events, samples):
            await clock.advance_to(0.1)
            apply_hausdepp_command(game, "p1", {"action": "play", "cards": ["hearts-K"],
                                                "version": game["_hausdepp"]["version"]})
            runner.maybe_schedule_cpu_turn(game)
            await clock.advance_to(0.7)
            assert [(at, event["type"]) for at, event in events] == [(0.7, "draw")]
            assert "afterthrow" in project_state(game["_hausdepp"], "p1")["available_actions"]
            await clock.advance_to(0.8)
            apply_hausdepp_command(game, "p1", {"action": "afterthrow", "cards": ["acorns-K"],
                                                "version": game["_hausdepp"]["version"]})
            runner.maybe_schedule_cpu_turn(game)
            await clock.advance_to(2.099)
            assert len(events) == 1
            await clock.advance_to(2.1)
            assert events[1][0] == pytest.approx(2.1)
            assert events[1][1]["player_id"] == "p2"
            assert Counter(actor for actor, _action, _at in samples)["p2"] == 1

    async def test_human_refill_wakes_new_cpu_draw_without_resampling_concurrent_throws(self):
        state = scenario(
            [["hearts-8"], ["bells-6", "bells-A", "bells-K"],
             ["leaves-7", "leaves-8", "leaves-K"], ["acorns-8", "acorns-9"]],
            discard=["hearts-6"],
            deck=["hearts-O", "bells-O", "leaves-O", "acorns-O", "hearts-A", "acorns-A"],
            current="p2", afterthrow={"player_id": "p1", "rank": "6"},
        )
        state["pending_refills"] = {
            actor: {"player_id": actor, "remaining": count, "continuation": "advance", "rank": None}
            for actor, count in (("p0", 2), ("p3", 1))
        }
        state["last_event"] = {"type": "play", "player_id": "p1", "cards": ["hearts-6"]}
        game = game_for(state, cpu_ids={"p1", "p2", "p3"})

        def delay(view, command, **_kwargs):
            if command["action"] == "draw":
                return 0.2
            return 0.9 if view["viewer_id"] == "p1" else 0.8

        async with self.running(game, delay=delay, stop_after=2) as (clock, events, samples):
            await clock.advance_to(0.25)
            assert not events
            apply_hausdepp_command(game, "p0", {"action": "draw", "version": game["_hausdepp"]["version"]})
            runner.maybe_schedule_cpu_turn(game)
            await clock.advance_to(0.45)
            assert [(event["type"], event["player_id"]) for _, event in events] == [("draw", "p3")]
            assert events[0][0] == pytest.approx(0.45)
            assert game["_hausdepp"]["afterthrow"] == {"player_id": "p1", "rank": "6"}
            await clock.advance_to(1.299)
            assert len(events) == 1
            await clock.advance_to(1.3)
            assert [(event["type"], event["player_id"]) for _, event in events] == [
                ("draw", "p3"), ("play", "p2"),
            ]
            assert Counter((actor, action) for actor, action, _ in samples) == {
                ("p1", "afterthrow"): 1, ("p2", "play"): 1, ("p3", "draw"): 1,
            }

    async def test_fast_tempo_retains_refill_priority_and_paced_public_landing(self):
        state = scenario(
            [[], ["hearts-6", "hearts-9", "hearts-K"], ["bells-7", "bells-8", "bells-K"]],
            discard=["leaves-6"], deck=["acorns-6", "acorns-7", "acorns-8", "acorns-9"], current="p1",
        )
        state["players"][0]["finished"] = True
        state["finished_order"] = ["p0"]
        game = game_for(state, cpu_ids={"p1", "p2"})
        game["_participants"][0]["user_id"] = 7
        game["_players"] = [{"id": "p0", "user_id": 7, "ws": object()}]
        enable_fast_cpu_tempo(game, "p0", 1)

        def delay(view, _command, **_kwargs):
            return 0.2 if view["viewer_id"] == "p1" else 0.1

        async with self.running(game, delay=delay, stop_after=3) as (clock, events, _samples):
            await clock.advance_to(0.799)
            assert [(at, event["type"]) for at, event in events] == [(0.4, "play")]
            await clock.advance_to(0.8)
            assert [(at, event["type"]) for at, event in events] == [
                (0.4, "play"), (0.8, "draw"), (0.8, "play"),
            ]

    async def test_pausing_an_eligible_refill_does_not_apply_it_after_the_wait(self):
        state = scenario([["hearts-6"], ["bells-7", "bells-8", "bells-K"]],
                         deck=["acorns-6", "acorns-7", "acorns-8"], current="p1")
        state["pending_refills"] = {"p0": {"player_id": "p0", "remaining": 2,
                                           "continuation": "advance", "rank": "6"}}
        game = game_for(state, cpu_ids={"p0"})
        async with self.running(game, delay=lambda *_args, **_kwargs: 0.2) as (clock, events, _samples):
            game["_test_paused"] = True
            runner.maybe_schedule_cpu_turn(game)
            await clock.advance_to(2.0)
            assert not events
            assert len(game["_hausdepp"]["players"][0]["hand"]) == 1
            game["_test_paused"] = False
            runner.maybe_schedule_cpu_turn(game)
            await clock.advance_to(2.2)
            assert [(event["type"], event["player_id"]) for _, event in events] == [("draw", "p0")]

    async def test_stopping_a_waiting_refill_does_not_restart_it_as_an_internal_wake(self):
        for pending_wake in (False, True):
            with self.subTest(pending_wake=pending_wake):
                state = scenario([["hearts-6"], ["bells-7", "bells-8", "bells-K"]],
                                 deck=["acorns-6", "acorns-7", "acorns-8"], current="p1")
                state["pending_refills"] = {"p0": {"player_id": "p0", "remaining": 2,
                                                   "continuation": "advance", "rank": "6"}}
                game = game_for(state, cpu_ids={"p0"})
                async with self.running(game, delay=lambda *_args, **_kwargs: 0.7) as (clock, events, _samples):
                    await clock.advance_to(0.1)
                    if pending_wake:
                        apply_hausdepp_command(game, "p1", {"action": "play", "cards": ["bells-7"],
                                                            "version": game["_hausdepp"]["version"]})
                        runner.maybe_schedule_cpu_turn(game)
                        # Stop immediately, before the task can consume the
                        # external transition's internal wake cancellation.
                    await runner.stop_cpu_runner(game["_id"])
                    await clock.advance_to(3.0)
                    assert not events
                    assert len(game["_hausdepp"]["players"][0]["hand"]) == 1

    async def test_repeated_schedule_for_the_same_state_does_not_starve_a_ready_action(self):
        state = scenario([["hearts-6", "hearts-9", "hearts-K"], ["bells-7", "bells-8", "bells-K"]],
                         discard=["leaves-6"])
        game = game_for(state, cpu_ids={"p0"})
        async with self.running(game, delay=lambda *_args, **_kwargs: 0.0, stop_after=1,
                                settle_at_start=False) as (clock, events, samples):
            for _ in range(8):
                runner.maybe_schedule_cpu_turn(game)
                await clock.yield_control(0)
                if events:
                    break
            assert [(at, event["type"], event["player_id"]) for at, event in events] == [(0.0, "play", "p0")]
            assert samples == [("p0", "play", 0.0)]
