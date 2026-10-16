"""Real seeded first games must not unlock the ordinary catalogue at once."""

from collections import Counter
from random import Random

from app.hausdepp_achievements import ACHIEVEMENTS, _accumulate, _new_aggregate, _progress
from app.hausdepp_cpu_strategy import choose_cpu_action
from app.hausdepp_engine import apply_action, new_round, project_state


def seeded_round_facts(count, seed):
    random = Random(seed)
    state = new_round([{"id": f"p{index}", "name": f"P{index}", "is_cpu": index > 0}
                       for index in range(count)], dealer_index=count - 1, rng=random)
    for _ in range(2000):
        if state["phase"] == "finished":
            break
        actor = (next(iter(state["pending_refills"]), None)
                 or (state.get("afterthrow") or {}).get("player_id") or state["current_player_id"])
        decision = choose_cpu_action(project_state(state, actor))
        if decision is None:
            actor = state["current_player_id"]
            decision = choose_cpu_action(project_state(state, actor))
        assert decision
        state = apply_action(state, actor, **decision, rng=random)
    assert state["phase"] == "finished"
    facts = state["achievement_evidence"]["players"]["p0"]
    return {"participant_count": count, "cpu_count": count - 1, "human_count": 1,
            "outcome": "hausdepp" if state["loser_id"] == "p0" else "finished", "opponents": [],
            "flags": facts["flags"], "ten_clears": facts["ten_clears"]}


def unlocked_ids(aggregate):
    return {item["id"] for item in ACHIEVEMENTS if _progress(aggregate, item["id"])[0]
            >= _progress(aggregate, item["id"])[1]}


def test_one_hundred_real_first_rounds_have_one_to_four_awards_without_an_artificial_cap():
    distribution = Counter()
    for count in range(2, 7):
        for seed in range(20):
            aggregate = _new_aggregate()
            _accumulate(aggregate, seeded_round_facts(count, 26000 + count * 100 + seed))
            unlocked = unlocked_ids(aggregate)
            assert "hausdepp_01" in unlocked
            assert 1 <= len(unlocked) <= 4, (count, seed, unlocked)
            distribution[len(unlocked)] += 1
    assert sum(distribution.values()) == 100
    assert sum(number * samples for number, samples in distribution.items()) / 100 <= 2


def test_seeded_regular_rounds_distribute_progress_without_a_later_mass_unlock():
    maximum_new = 0
    for count in range(2, 7):
        for stream in range(4):
            aggregate, previous = _new_aggregate(), set()
            for number in range(12):
                facts = seeded_round_facts(count, 58000 + count * 1000 + stream * 100 + number)
                _accumulate(aggregate, facts)
                unlocked = unlocked_ids(aggregate)
                maximum_new = max(maximum_new, len(unlocked - previous))
                previous = unlocked
            assert len(previous) > 2
    assert maximum_new <= 5
