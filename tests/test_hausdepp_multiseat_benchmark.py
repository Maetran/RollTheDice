"""The synthetic multiplayer worlds expose no private cards to either CPU."""

from random import Random

import pytest

from app.hausdepp_cpu_strategy import choose_cpu_action
from scripts.benchmark_hausdepp_multiseat_scenarios import benchmark, fixture


@pytest.mark.parametrize("players", (4, 5, 6))
@pytest.mark.parametrize("hint", (False, True))
def test_hidden_opponent_variants_produce_the_same_view_and_decision(players, hint):
    worlds = [fixture(players, 3100001, name, hint=hint) for name in ("weak", "hidden_ace", "hidden_ten")]
    assert worlds[0][2] == worlds[1][2] == worlds[2][2]
    assert all(len([p for p in state["players"] if not p["finished"]]) == players for state, _, _ in worlds)
    decisions = [choose_cpu_action(view, memory=memory["p0"], skill=1.0, rng=Random(37))
                 for _, memory, view in worlds]
    assert decisions[0] == decisions[1] == decisions[2]
    assert all(memory["p0"].public.pickup_hint(view, "p1") is not None if hint
               else memory["p0"].public.pickup_hint(view, "p1") is None for _, memory, view in worlds)


@pytest.mark.parametrize("middle", ("8", "O"))
def test_six_seat_fixture_has_a_legal_low_play_and_an_ace(middle):
    _, _, view = fixture(6, 3100001, "weak", hint=True, middle=middle)
    assert "hearts-A" in view["playable_cards"]
    assert f"hearts-{middle}" in view["playable_cards"]


def test_small_scenario_benchmark_is_reproducible():
    first = benchmark(4, 3, 1.0, "weak", True, 3100000)
    assert first == benchmark(4, 3, 1.0, "weak", True, 3100000)
    assert first["stalls"] == 0
