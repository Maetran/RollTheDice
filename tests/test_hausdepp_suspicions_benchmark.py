"""Guard the paired measurement harness and its voluntary-pickup profiles."""

from random import Random
from types import SimpleNamespace

from app.hausdepp_cpu_strategy import CpuMemory
from scripts.benchmark_hausdepp_suspicions import _continuation, _hint, benchmark, voluntary_pickup
from tests.test_hausdepp_engine import scenario


def test_voluntary_pickups_require_a_legal_choice_and_empty_stock():
    view = {"version": 7, "deck_count": 0, "available_actions": ["play", "pickup"]}
    decisions = [voluntary_pickup(view, "voluntary40", seed, "p1") for seed in range(200)]
    assert any(decisions) and not all(decisions)
    assert decisions == [voluntary_pickup(view, "voluntary40", seed, "p1") for seed in range(200)]
    assert not any(voluntary_pickup(view, "frozen", seed, "p1") for seed in range(200))
    assert not any(voluntary_pickup({**view, "deck_count": 1}, "voluntary40", seed, "p1")
                   for seed in range(200))
    assert not any(voluntary_pickup({**view, "available_actions": ["pickup"]}, "voluntary40", seed, "p1")
                   for seed in range(200))


def test_small_paired_benchmark_replays_identically():
    first = benchmark(2, 2, 1.0, 123000, "voluntary40")
    assert first == benchmark(2, 2, 1.0, 123000, "voluntary40")
    assert first["seat_deals"] == 4
    assert first["current_stalls"] == first["frozen_stalls"] == 0
    assert first["baseline_commit"].startswith("f89354f7")


def test_hint_in_three_player_deal_uses_next_active_opponent():
    view = {"players": [{"id": "p0"}, {"id": "p1", "finished": True}, {"id": "p2"}, {"id": "p3"}]}
    memory = SimpleNamespace(public=SimpleNamespace(pickup_hint=lambda _view, player: player))
    assert _hint(view, memory, "p0") == "p2"
    assert _hint(view, memory, "p3") == "p0"


def test_restart_benchmark_resets_each_seat_memory_after_stock_exhaustion():
    result = benchmark(2, 2, 1.0, 123000, "frozen", restart_on_empty_stock=True)
    assert result["memory_mode"] == "restart_on_empty_stock"
    assert result["current_resets"] == result["seat_deals"] == 4
    assert result["current_stalls"] == result["frozen_stalls"] == 0


def test_counterfactual_tracks_other_players_before_next_regular_turn():
    hands = [["hearts-6", "hearts-8", "hearts-A"], ["bells-6", "bells-7", "bells-8"],
             ["leaves-6", "leaves-7", "leaves-8"], ["acorns-6", "acorns-7", "acorns-8"]]
    state = scenario(hands, current="p0")
    memories = {f"p{i}": CpuMemory() for i in range(4)}
    source = Random(250001)  # nosec B311 -- fixed benchmark fixture
    high = {"action": "play", "cards": ["hearts-A"], "version": state["version"]}
    low = {"action": "play", "cards": ["hearts-6"], "version": state["version"]}
    high_result = _continuation(state, memories, "p0", high, 1.0, "frozen", 250001, source.getstate())
    low_result = _continuation(state, memories, "p0", low, 1.0, "frozen", 250001, source.getstate())
    assert high_result["next_hand"] == low_result["next_hand"] == 2
    assert high_result["opponent_pickup_before_next"] == 1
    assert high_result["opponent_play_before_next"] == 2
    assert low_result.get("opponent_pickup_before_next", 0) == 0
    assert low_result["opponent_play_before_next"] == 3
    assert high_result["placement"] in range(1, 5) and low_result["placement"] in range(1, 5)
    assert high_result == _continuation(state, memories, "p0", high, 1.0, "frozen", 250001, source.getstate())
    assert state["players"][0]["hand"] == hands[0]
