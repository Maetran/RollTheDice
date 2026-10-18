"""Tactical choices, limited knowledge and seeded real-engine CPU rounds."""

import json
from collections import Counter
from copy import deepcopy
from random import Random

import pytest

from app.hausdepp_achievements import ACHIEVEMENTS, _accumulate, _new_aggregate, _progress
from app.hausdepp_cpu_strategy import CpuMemory, choose_cpu_action, slip_chance, table_tip
from app.hausdepp_engine import apply_action, card_rank, make_deck, new_round, project_state
from tests.hausdepp_cpu_reference import choose_reference_action
from tests.test_hausdepp_engine import scenario


def decide(hand, *, discard=(), deck=(), other=("acorns-9", "acorns-O", "acorns-K"), memory=None):
    state = scenario([hand, other], discard=discard, deck=deck)
    return choose_cpu_action(project_state(state, "p0"), memory=memory)


def test_preserves_high_hand_by_gambling_on_an_empty_table():
    move = decide(["hearts-A", "bells-A", "leaves-A"],
                  deck=["hearts-6", "bells-7", "leaves-8", "bells-U", "hearts-7", "hearts-8", "bells-8"])
    assert move["action"] == "gamble"
    assert decide(["hearts-6", "bells-U", "leaves-A"], deck=["hearts-7"])["cards"] == ["hearts-6"]


def test_preserves_a_higher_pair_while_disposing_of_a_lower_single():
    move = decide(["hearts-9", "hearts-U", "bells-U", "hearts-10"], discard=["leaves-8"],
                  deck=["bells-6", "leaves-7", "bells-8", "leaves-9"])
    assert move["cards"] == ["hearts-9"]


def test_keeps_high_pair_for_the_endgame_and_blocks_a_single_card_opponent():
    assert decide(["hearts-6", "hearts-K", "bells-K"], discard=["leaves-6"])["cards"] == ["hearts-6"]
    move = decide(["hearts-6", "hearts-A"], discard=["leaves-6"], other=["acorns-U"])
    assert move["cards"] == ["hearts-A"]


def test_spends_one_ten_for_a_large_packet_and_retains_other_rescues():
    hand = ["hearts-6", "hearts-7", "hearts-8", "hearts-10", "bells-10"]
    pile = ["bells-6", "leaves-6", "bells-7", "leaves-7", "bells-8", "leaves-8", "hearts-A"]
    move = decide(hand, discard=pile, deck=["acorns-6", "acorns-7", "acorns-8", "acorns-U"], other=["leaves-K"])
    assert move["action"] == "play" and len(move["cards"]) == 1 and card_rank(move["cards"][0]) == "10"


def test_small_high_packet_can_be_safer_than_a_last_card_gamble():
    move = decide(["hearts-6", "bells-7", "leaves-8"], discard=["hearts-A", "bells-A", "leaves-A"],
                  deck=["hearts-U"])
    assert move["action"] == "pickup"


def test_completes_another_players_triple_and_follows_a_guaranteed_clearance_chain():
    move = decide(["acorns-U", "hearts-6", "hearts-A"], discard=["hearts-U", "bells-U", "leaves-U"])
    assert move["cards"] == ["acorns-U"]
    hand = [f"{suit}-{rank}" for rank in ("6", "7") for suit in ("hearts", "bells", "leaves", "acorns")]
    hand += ["hearts-K", "bells-K", "hearts-10"]
    state = scenario([hand, ["acorns-A"]], discard=["leaves-A"])
    actions = []
    while state["phase"] != "finished":
        view = project_state(state, "p0")
        move = choose_cpu_action(view)
        assert move and view["current_player_id"] == "p0"
        actions.append(card_rank(move["cards"][0]))
        state = apply_action(state, "p0", **move)
    assert actions == ["10", "6", "7", "K"] and state["loser_id"] == "p1"


def test_refills_before_deciding_and_never_treats_a_stock_hand_as_finished():
    state = scenario([["hearts-K", "hearts-10"], ["acorns-6"]], discard=["leaves-9"], deck=["bells-6"])
    state["pending_refills"] = {"p0": {"player_id": "p0", "remaining": 1, "continuation": "advance", "rank": "K"}}
    assert choose_cpu_action(project_state(state, "p0"))["action"] == "draw"


def test_choices_ignore_hidden_hands_stock_order_and_private_achievement_metadata():
    state = scenario([["hearts-6", "hearts-U", "hearts-A"], ["bells-7", "bells-K", "bells-A"]],
                     discard=["leaves-6"], deck=["acorns-6", "acorns-7", "acorns-8", "acorns-9"])
    changed = deepcopy(state)
    changed["deck"].reverse()
    changed["players"][1]["hand"], changed["deck"][:3] = changed["deck"][:3], changed["players"][1]["hand"]
    changed["achievement_evidence"] = {"secret": "not CPU knowledge"}
    before = deepcopy(state)
    first, second = project_state(state, "p0"), project_state(changed, "p0")
    assert first == second
    assert choose_cpu_action(first) == choose_cpu_action(second)
    poisoned = {**first, "deck": ["acorns-A"], "opponent_hand": ["bells-10"], "private_peek": ["leaves-10"]}
    assert choose_cpu_action(first) == choose_cpu_action(poisoned)
    assert state == before


def test_bounded_own_memory_recognises_a_repeating_failed_plan():
    state = scenario([["hearts-7", "hearts-8", "hearts-A"], ["acorns-U"]], discard=["bells-8"])
    view = project_state(state, "p0")
    memory = CpuMemory()
    first = choose_cpu_action(view, memory=memory)
    assert first["cards"] == ["hearts-8"]
    memory.remember(view, first)
    later = {**view, "version": view["version"] + 6}
    assert choose_cpu_action(later, memory=memory)["cards"] == ["hearts-A"]
    assert choose_cpu_action(later, memory=CpuMemory()) == {**first, "version": later["version"]}
    for index in range(200):
        memory.remember({**view, "deck_count": index}, first)
    assert len(memory._recent) == 48


def simulate(count, seed, *, tactical_seat=None):
    random = Random(seed)
    state = new_round([f"p{index}" for index in range(count)], dealer_index=count - 1, rng=random)
    memories = {player["id"]: CpuMemory() for player in state["players"]}
    for turn in range(1500):
        if state["phase"] == "finished":
            return state, turn
        actor = (next(iter(state["pending_refills"]), None) or (state.get("afterthrow") or {}).get("player_id")
                 or state["current_player_id"])
        view = project_state(state, actor)
        policy = choose_cpu_action if tactical_seat is None or actor == tactical_seat else choose_reference_action
        move = policy(view, memory=memories[actor]) if policy is choose_cpu_action else policy(view)
        if move is None:
            actor = state["current_player_id"]
            view = project_state(state, actor)
            policy = choose_cpu_action if tactical_seat is None or actor == tactical_seat else choose_reference_action
            move = policy(view, memory=memories[actor]) if policy is choose_cpu_action else policy(view)
        assert move is not None
        state = apply_action(state, actor, **move, rng=random)
        memories[actor].remember(view, move)
        physical = state["deck"] + state["discard"] + state["burned"]
        physical += [card for player in state["players"] for card in player["hand"]]
        assert sorted(physical) == sorted(make_deck())
        if state["deck"] and state["phase"] == "playing":
            assert all(len(player["hand"]) >= 3 or player["id"] in state["pending_refills"] for player in state["players"])
    pytest.fail(f"CPU round stalled: {count} players, seed {seed}")


@pytest.mark.parametrize("count", range(2, 7))
def test_tactical_policy_finishes_seeded_rounds_without_hidden_information_or_card_loss(count):
    for seed in range(20):
        state, _ = simulate(count, 26000 + count * 100 + seed)
        assert len(state["finished_order"]) == count - 1
        assert state["loser_id"] not in state["finished_order"]
        evidence = state["achievement_evidence"]["players"]["p0"]
        aggregate = _new_aggregate()
        _accumulate(aggregate, {"participant_count": count, "cpu_count": count - 1, "human_count": 1,
                               "outcome": "hausdepp" if state["loser_id"] == "p0" else "finished", "opponents": [],
                               "flags": evidence["flags"], "ten_clears": evidence["ten_clears"]})
        assert 1 <= sum(_progress(aggregate, item["id"])[0] >= _progress(aggregate, item["id"])[1]
                        for item in ACHIEVEMENTS) <= 4


def test_tactical_first_games_and_long_term_achievement_progress_are_measured_separately():
    first_awards, maximum_new = Counter(), 0
    for count in range(2, 7):
        for stream in range(4):
            aggregate, previous = _new_aggregate(), set()
            for number in range(12):
                state, _ = simulate(count, 58000 + count * 1000 + stream * 100 + number)
                evidence = state["achievement_evidence"]["players"]["p0"]
                _accumulate(aggregate, {"participant_count": count, "cpu_count": count - 1, "human_count": 1,
                                       "outcome": "hausdepp" if state["loser_id"] == "p0" else "finished",
                                       "opponents": [], "flags": evidence["flags"], "ten_clears": evidence["ten_clears"]})
                unlocked = {item["id"] for item in ACHIEVEMENTS
                            if _progress(aggregate, item["id"])[0] >= _progress(aggregate, item["id"])[1]}
                new = unlocked - previous
                if not number:
                    first_awards[len(new)] += 1
                    assert 1 <= len(new) <= 4
                maximum_new = max(maximum_new, len(new))
                assert all(_progress(aggregate, key)[0] >= _progress(aggregate, key)[1] for key in new)
                previous = unlocked
            assert len(previous) > 2
    assert sum(first_awards.values()) == 20
    assert maximum_new <= 5


def paired_policy_benchmark(*, seeds=20, seed_base=26000):
    """Same shuffled deal and dealer, once for every possible tactical seat."""
    measurements = []
    for count in range(2, 7):
        baseline_losses = tactical_losses = games = 0
        for seed in range(seeds):
            number = seed_base + count * 100 + seed
            baseline, _ = simulate(count, number, tactical_seat="reference-only")
            for seat in range(count):
                actor = f"p{seat}"
                tactical, _ = simulate(count, number, tactical_seat=actor)
                baseline_losses += baseline["loser_id"] == actor
                tactical_losses += tactical["loser_id"] == actor
                games += 1
        measurements.append({"players": count, "paired_seat_deals": games,
                             "reference_losses": baseline_losses, "tactical_losses": tactical_losses})
    return measurements


def test_tactical_policy_against_frozen_reference_on_400_paired_seat_deals():
    measurements = paired_policy_benchmark()
    print(json.dumps(measurements, sort_keys=True))
    assert sum(item["paired_seat_deals"] for item in measurements) == 400
    assert all(item["reference_losses"] == 20 for item in measurements)
    assert all(item["tactical_losses"] <= item["reference_losses"] for item in measurements)
    assert sum(item["tactical_losses"] for item in measurements) < 100


def decide_at(hands, discard, *, stock=20):
    used = {card for hand in hands for card in hand} | set(discard)
    deck = [card for card in make_deck() if card not in used][:stock]
    return choose_cpu_action(project_state(scenario(hands, discard=discard, deck=deck), "p0"))


def test_buys_a_lone_ace_instead_of_burning_a_ten_while_stock_remains():
    others = [["acorns-9", "acorns-O", "acorns-K"], ["bells-9", "bells-O", "bells-K"]]
    hand = ["hearts-7", "bells-8", "hearts-10"]
    assert decide_at([hand, *others], ["leaves-A"])["action"] == "pickup"
    # Heads-up as well: a ten is too valuable for a single early ace.
    assert decide_at([hand, others[0]], ["leaves-A"])["action"] == "pickup"
    # Without stock every extra card counts: then the ten clears.
    move = decide_at([hand, *others], ["leaves-A"], stock=0)
    assert move["action"] == "play" and move["cards"] == ["hearts-10"]


def test_heads_up_weighs_an_ace_topped_packet_instead_of_always_clearing_it():
    opponent = ["acorns-9", "acorns-O", "bells-K"]
    hand = ["hearts-7", "bells-8", "hearts-10"]
    # Three cards under an ace, little stock left: buying still beats the ten.
    assert decide_at([hand, opponent], ["leaves-K", "bells-9", "leaves-A"], stock=8)["action"] == "pickup"
    # Without an ace on top the heads-up race keeps clearing the packet.
    move = decide_at([hand, opponent], ["leaves-6", "bells-7", "leaves-K"], stock=8)
    assert move["action"] == "play" and move["cards"] == ["hearts-10"]
    # A large junk packet under the ace is still cleared.
    move = decide_at([hand, opponent], ["leaves-6", "bells-6", "acorns-7", "leaves-7", "acorns-8", "leaves-A"], stock=8)
    assert move["action"] == "play" and move["cards"] == ["hearts-10"]


def test_buys_a_packet_that_completes_its_own_quartet():
    others = [["acorns-9", "acorns-O", "acorns-K"], ["bells-9", "bells-O", "bells-K"]]
    move = decide_at([["hearts-U", "acorns-U", "hearts-10"], *others], ["leaves-U", "bells-U", "leaves-A"])
    assert move["action"] == "pickup"


def test_prefers_a_valuable_packet_to_a_gamble_without_a_legal_card():
    others = [["acorns-9", "acorns-O", "bells-K"], ["bells-9", "bells-O", "leaves-K"]]
    move = decide_at([["hearts-6", "bells-7", "leaves-8"], *others], ["hearts-A", "acorns-A"])
    assert move["action"] == "pickup"


def test_table_tips_explain_the_same_bargains_for_a_newer_person():
    others = [["acorns-9", "acorns-O", "acorns-K"], ["bells-9", "bells-O", "bells-K"]]

    def tip(hand, discard, *, stock=20, players=None):
        used = {card for item in [hand, *(players or others)] for card in item} | set(discard)
        deck = [card for card in make_deck() if card not in used][:stock]
        return table_tip(project_state(scenario([hand, *(players or others)], discard=discard, deck=deck), "p0"))

    assert tip(["hearts-7", "bells-8", "hearts-10"], ["leaves-A"]) == {"key": "tipBuyAce"}
    assert tip(["hearts-7", "bells-8", "hearts-10"], ["leaves-K", "leaves-A"]) == {"key": "tipBuyPacket"}
    assert tip(["hearts-U", "acorns-U", "hearts-10"], ["leaves-U", "bells-U", "leaves-A"]) == {
        "key": "tipQuartet", "rank": "U"}
    assert tip(["hearts-6", "bells-7", "leaves-8"], ["hearts-A", "acorns-A"]) == {"key": "tipPickupNotGamble"}
    # No tip for an ordinary low play, without stock, or when it is not the person's turn.
    assert tip(["hearts-7", "bells-8", "hearts-K"], ["leaves-6"]) is None
    assert tip(["hearts-7", "bells-8", "hearts-10"], ["leaves-A"], stock=0) is None
    waiting = scenario([["hearts-7", "bells-8", "hearts-10"], *others], discard=["leaves-A"], current="p1")
    assert table_tip(project_state(waiting, "p0")) is None


def test_gentle_computers_misjudge_more_often_but_never_illegally():
    assert slip_chance(1.0) == pytest.approx(0.05)
    assert slip_chance(0.55) > slip_chance(0.8) > slip_chance(1.0)
    others = [["acorns-9", "acorns-O", "acorns-K"], ["bells-9", "bells-O", "bells-K"]]
    used = {"hearts-7", "bells-8", "hearts-10", "leaves-A", *others[0], *others[1]}
    deck = [card for card in make_deck() if card not in used][:20]
    view = project_state(scenario([["hearts-7", "bells-8", "hearts-10"], *others], discard=["leaves-A"], deck=deck), "p0")
    sharp = Counter(choose_cpu_action(view, skill=1.0, rng=Random(seed))["action"] for seed in range(400))
    gentle = Counter(choose_cpu_action(view, skill=0.55, rng=Random(seed))["action"] for seed in range(400))
    assert sharp["pickup"] > gentle["pickup"] > 200
    # Experienced tables rarely see the obvious purchase missed.
    assert sharp["pickup"] >= 390
    assert set(sharp) | set(gentle) <= {"pickup", "play"}
    # Without randomness the decision stays exactly reproducible.
    assert choose_cpu_action(view) == choose_cpu_action(view, skill=0.55)
