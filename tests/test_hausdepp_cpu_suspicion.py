"""Speculative tactics use observed choices without inventing hidden cards."""

from collections import Counter
from copy import deepcopy
from dataclasses import replace
from random import Random

import pytest

from app import hausdepp_cpu_strategy as strategy
from app.hausdepp_cpu_endgame import winning_plays
from app.hausdepp_cpu_strategy import CpuMemory, _suspected_pickup_finish, _unhinted_endgame_finish, choose_cpu_action
from app.hausdepp_engine import apply_action, card_rank, make_deck, project_state
from tests.test_hausdepp_cpu_strategy import ScriptedRandom
from tests.test_hausdepp_engine import scenario


def _observe(state, memory, actor, action, cards=None):
    before = project_state(state, "p0")
    after = apply_action(state, actor, action, cards=cards, version=state["version"])
    memory.public.observe(before, project_state(after, "p0"))
    return after


def _pickup_position(own=None, opponent=None, packet=None):
    own = own or ["hearts-6", "hearts-A", "hearts-10"]
    opponent = opponent or ["bells-8", "acorns-9"]
    packet = packet or ["leaves-U"]
    state = scenario([own, opponent], discard=packet, current="p1")
    memory = CpuMemory()
    state = _observe(state, memory, "p1", "pickup")
    return state, memory


def test_observed_under_pickup_suggests_ace_and_ten_saves_the_low_finish():
    state, memory = _pickup_position()
    view = project_state(state, "p0")
    assert memory.public.exact_hand(view, "p1") is None
    assert _suspected_pickup_finish(view, memory)[0] == ["hearts-A"]
    assert choose_cpu_action(view, memory=memory)["cards"] == ["hearts-A"]
    state = _observe(state, memory, "p0", "play", ["hearts-A"])
    state = _observe(state, memory, "p1", "pickup")
    state = _observe(state, memory, "p0", "play", ["hearts-10"])
    state = _observe(state, memory, "p0", "play", ["hearts-6"])
    assert state["phase"] == "finished" and state["loser_id"] == "p1"


def test_pickup_can_be_voluntary_even_with_a_hidden_ten_or_ace():
    for hidden in ("bells-A", "bells-10"):
        state, memory = _pickup_position(opponent=["bells-7", hidden])
        view = project_state(state, "p0")
        assert _suspected_pickup_finish(view, memory)[0] == ["hearts-A"]
        state = _observe(state, memory, "p0", "play", ["hearts-A"])
        # The rival's answer is legal: the CPU made a judgement, not a proof.
        state = _observe(state, memory, "p1", "play", [hidden])
        assert state["last_event"]["type"] == "play"


def test_six_or_ace_is_a_real_risk_with_the_same_public_pickup():
    # In both worlds the opponent visibly takes the same Unter. Their hidden
    # remaining card decides whether the six or the ace was the winning lead.
    my_hand = ["hearts-6", "hearts-A"]
    pair_state, pair_memory = _pickup_position(own=my_hand, opponent=["bells-U"])
    ace_state, ace_memory = _pickup_position(own=my_hand, opponent=["bells-A"])
    pair_view, ace_view = project_state(pair_state, "p0"), project_state(ace_state, "p0")
    assert pair_view == ace_view
    assert choose_cpu_action(pair_view, memory=pair_memory, rng=Random(19)) == choose_cpu_action(
        ace_view, memory=ace_memory, rng=Random(19))
    assert winning_plays(my_hand, ["leaves-U", "bells-U"], []) == [("A", 1)]
    assert winning_plays(my_hand, ["leaves-U", "bells-A"], []) == [("6", 1)]
    # Real engine replies demonstrate the loss on each opposite lead.
    pair_state = _observe(pair_state, pair_memory, "p0", "play", ["hearts-6"])
    pair_state = _observe(pair_state, pair_memory, "p1", "play", ["leaves-U", "bells-U"])
    assert pair_state["phase"] == "finished" and pair_state["loser_id"] == "p0"
    ace_state = _observe(ace_state, ace_memory, "p0", "play", ["hearts-A"])
    ace_state = _observe(ace_state, ace_memory, "p1", "play", ["bells-A"])
    ace_state = _observe(ace_state, ace_memory, "p0", "pickup")
    ace_state = _observe(ace_state, ace_memory, "p1", "play", ["leaves-U"])
    assert ace_state["phase"] == "finished" and ace_state["loser_id"] == "p0"


def test_high_lead_can_hand_opponent_four_of_a_kind_without_leaking_their_cards():
    my_hand = ["hearts-10", "hearts-A", "hearts-K"]
    # Both players visibly picked up the same Unter. Their three other cards
    # are hidden; in one world they happen to complete our ace into a quartet.
    triple = ["bells-A", "leaves-A", "acorns-A"]
    losing, losing_memory = _pickup_position(own=my_hand, opponent=triple)
    safe, safe_memory = _pickup_position(own=my_hand, opponent=["bells-7", "bells-8", "acorns-9"])
    losing_view, safe_view = project_state(losing, "p0"), project_state(safe, "p0")
    assert losing_view == safe_view
    assert choose_cpu_action(losing_view, memory=losing_memory) == choose_cpu_action(safe_view, memory=safe_memory)
    assert choose_cpu_action(losing_view, memory=losing_memory)["cards"] == ["hearts-A"]
    # The ace risks a quartet; in this particular hidden world the king would
    # have been a proven winning move. The latter is an offline test oracle.
    assert ("K", 1) in winning_plays(my_hand, [*triple, "leaves-U"], [])
    losing = _observe(losing, losing_memory, "p0", "play", ["hearts-A"])
    losing = _observe(losing, losing_memory, "p1", "play", triple)
    assert losing["last_event"]["burn_reason"] == "four_of_a_kind"
    losing = _observe(losing, losing_memory, "p1", "play", ["leaves-U"])
    assert losing["phase"] == "finished" and losing["loser_id"] == "p0"


def test_low_lead_can_also_give_opponent_a_four_of_a_kind():
    my_hand = ["hearts-6", "hearts-A", "hearts-10"]
    triple_six = ["bells-6", "leaves-6", "acorns-6"]
    state, memory = _pickup_position(own=my_hand, opponent=triple_six)
    view = project_state(state, "p0")
    # The same observed Unter pickup could conceal an ace trio instead; the
    # choice cannot use that private fact. A trio threatens whichever rank is led.
    other, other_memory = _pickup_position(own=my_hand, opponent=["bells-A", "leaves-A", "acorns-A"])
    assert view == project_state(other, "p0")
    assert choose_cpu_action(view, memory=memory) == choose_cpu_action(project_state(other, "p0"), memory=other_memory)
    assert ("A", 1) in winning_plays(my_hand, [*triple_six, "leaves-U"], [])
    high_memory = deepcopy(memory)
    low = _observe(state, memory, "p0", "play", ["hearts-6"])
    low = _observe(low, memory, "p1", "play", triple_six)
    assert low["last_event"]["burn_reason"] == "four_of_a_kind"
    low = _observe(low, memory, "p1", "play", ["leaves-U"])
    assert low["phase"] == "finished" and low["loser_id"] == "p0"
    high = _observe(state, high_memory, "p0", "play", ["hearts-A"])
    high = _observe(high, high_memory, "p1", "pickup")
    high = _observe(high, high_memory, "p0", "play", ["hearts-10"])
    high = _observe(high, high_memory, "p0", "play", ["hearts-6"])
    assert high["phase"] == "finished" and high["loser_id"] == "p1"


@pytest.mark.parametrize(("hand", "blocker"), [
    (["hearts-6", "hearts-A"], "A"),
    (["hearts-6", "hearts-K", "hearts-10"], "K"),
    (["hearts-7", "bells-7", "hearts-O", "hearts-10"], "O"),
    (["hearts-6", "hearts-A", "hearts-10", "bells-10"], "A"),
])
def test_alternative_finishing_hands_do_not_require_exactly_six_ace_and_ten(hand, blocker):
    state, memory = _pickup_position(own=hand, packet=["leaves-9"])
    view = project_state(state, "p0")
    assert card_rank(_suspected_pickup_finish(view, memory)[0][0]) == blocker


def test_publicly_known_ten_prevents_the_speculative_block(monkeypatch):
    state, memory = _pickup_position()
    view = project_state(state, "p0")
    monkeypatch.setattr(memory.public, "known_cards", lambda *_args: ("leaves-U", "bells-10"))
    assert _suspected_pickup_finish(view, memory) is None


def test_suspicion_preserves_high_pairs_when_the_opponent_may_hold_a_higher_reply():
    hand = ["hearts-K", "bells-K", "hearts-O", "bells-O"]
    state, memory = _pickup_position(own=hand, opponent=["leaves-K", "acorns-U"])
    view = project_state(state, "p0")
    # A pickup onto the under does not justify burning both kings; a legal
    # hidden king leaves the CPU with the pile and the opponent's under pair.
    assert _suspected_pickup_finish(view, memory) is None
    move = choose_cpu_action(view, memory=memory)
    assert len(move["cards"]) == 1 and card_rank(move["cards"][0]) == "O"
    lose = _observe(state, deepcopy(memory), "p0", "play", ["bells-K", "hearts-K"])
    lose = apply_action(lose, "p1", "play", cards=["leaves-K"], version=lose["version"])
    lose = apply_action(lose, "p0", "pickup", version=lose["version"])
    lose = apply_action(lose, "p1", "play", cards=["acorns-U", "leaves-U"], version=lose["version"])
    assert lose["phase"] == "finished" and lose["loser_id"] == "p0"


def test_sure_finish_still_plays_the_whole_high_pair():
    state, memory = _pickup_position(own=["hearts-K", "bells-K"])
    view = project_state(state, "p0")
    assert choose_cpu_action(view, memory=memory)["cards"] == ["bells-K", "hearts-K"]


def test_proven_solver_move_takes_precedence_over_suspected_move(monkeypatch):
    state, memory = _pickup_position()
    view = project_state(state, "p0")
    monkeypatch.setattr(strategy, "_counted_endgame", lambda *_args: {"action": "play", "cards": ["hearts-6"]})
    assert choose_cpu_action(view, memory=memory)["cards"] == ["hearts-6"]


def test_missed_proven_solver_move_gets_no_second_chance_from_suspicion(monkeypatch):
    state, memory = _pickup_position()
    view = project_state(state, "p0")
    # Model an exactly observed burn set; the engine state is used only to
    # construct this test fixture, never by the policy itself.
    memory.public._burned = set(state["burned"])
    memory.public._burn_version = view["version"]
    assert memory.public.counted_hand(view, "p1") == tuple(sorted(state["players"][1]["hand"]))
    assert _suspected_pickup_finish(view, memory) is None
    monkeypatch.setattr(strategy, "_counted_endgame", lambda *_args: {"action": "play", "cards": ["hearts-A"]})
    # Retain the first random choice, miss the proven move, do not randomly
    # choose the next-higher card in the ordinary fallback.
    move = choose_cpu_action(view, memory=memory, skill=1.0, rng=ScriptedRandom(.99, 0.0, .99, .99))
    assert move["cards"] == ["hearts-6"]


def test_missing_hint_or_new_memory_does_not_guess_a_hidden_hand():
    state, memory = _pickup_position()
    view = project_state(state, "p0")
    assert _suspected_pickup_finish(view, CpuMemory()) is None
    assert choose_cpu_action(view, memory=CpuMemory())["cards"] == ["hearts-6"]
    assert _suspected_pickup_finish({**view, "version": view["version"] + 1}, memory) is None


def test_known_opponent_ace_is_a_counterindication_even_after_a_later_under_pickup():
    state = scenario([["hearts-6", "hearts-A", "hearts-10", "bells-U"], ["bells-7", "acorns-9"]],
                     discard=["leaves-A"], current="p1")
    memory = CpuMemory()
    state = _observe(state, memory, "p1", "pickup")
    state = _observe(state, memory, "p0", "play", ["bells-U"])
    state = _observe(state, memory, "p1", "pickup")
    view = project_state(state, "p0")
    assert "leaves-A" in memory.public.known_cards(view, "p1")
    assert _suspected_pickup_finish(view, memory) is None


def test_proven_voluntary_under_pickup_does_not_create_a_weakness_hint():
    state = scenario([["hearts-6", "hearts-A", "hearts-10", "bells-U"], ["bells-7", "acorns-9"]],
                     discard=["leaves-K"], current="p1")
    memory = CpuMemory()
    state = _observe(state, memory, "p1", "pickup")
    state = _observe(state, memory, "p0", "play", ["bells-U"])
    state = _observe(state, memory, "p1", "pickup")
    view = project_state(state, "p0")
    assert memory.public.pickup_hint(view, "p1").known_playable
    assert _suspected_pickup_finish(view, memory) is None
    assert choose_cpu_action(view, memory=memory)["cards"] == ["hearts-6"]


def test_proven_voluntary_pickup_still_allows_separate_no_hint_play_at_larger_table():
    state = scenario([
        ["hearts-6", "hearts-8", "hearts-A", "hearts-U"],
        ["acorns-7", "acorns-8", "acorns-9"],
        ["bells-6", "bells-7", "bells-8", "bells-9"],
        ["hearts-7", "hearts-9", "hearts-O", "hearts-K"],
    ], discard=["leaves-K"], current="p1")
    memory = CpuMemory()
    for seat, action, cards in (("p1", "pickup", None), ("p2", "play", ["bells-6"]),
                                ("p3", "pickup", None), ("p0", "play", ["hearts-U"]),
                                ("p1", "pickup", None), ("p2", "play", ["bells-7"]),
                                ("p3", "pickup", None)):
        state = _observe(state, memory, seat, action, cards)
    view = project_state(state, "p0")
    assert memory.public.pickup_hint(view, "p1").known_playable
    assert _suspected_pickup_finish(view, memory) is None
    assert _unhinted_endgame_finish(view, memory)[0] == ["hearts-A"]


def test_packet_size_alone_does_not_change_unverified_pickup_weight(monkeypatch):
    state, memory = _pickup_position()
    view = project_state(state, "p0")
    hint = memory.public.pickup_hint(view, "p1")
    choices = []
    for size in (1, 4, 12):
        monkeypatch.setattr(memory.public, "pickup_hint", lambda *_args: replace(hint, packet_size=size))
        choices.append(_suspected_pickup_finish(view, memory))
    assert choices[0] == choices[1] == choices[2]


@pytest.mark.parametrize("wild", (False, True))
def test_two_known_distinct_nonmatching_ranks_preserve_proven_low_lead(wild):
    state, memory = _pickup_position(own=["hearts-6", "hearts-A"],
                                     opponent=["acorns-8", "leaves-9"], packet=["bells-7", "leaves-U"])
    state["four_of_a_kind_as_ten"] = wild
    view = project_state(state, "p0")
    assert set(memory.public.known_cards(view, "p1")) == {"bells-7", "leaves-U"}
    assert _suspected_pickup_finish(view, memory) is None
    assert choose_cpu_action(view, memory=memory)["cards"] == ["hearts-6"]
    # It stays a normal choice: a seeded human-sized mistake remains possible.
    assert any(choose_cpu_action(view, memory=memory, skill=.55, rng=Random(seed))["cards"] == ["hearts-A"]
               for seed in range(100))


def test_three_distinct_known_ranks_also_preserve_the_proven_low_lead():
    state, memory = _pickup_position(own=["hearts-6", "hearts-A"],
                                     opponent=["acorns-9", "acorns-O"],
                                     packet=["bells-7", "leaves-8", "leaves-U"])
    view = project_state(state, "p0")
    assert set(memory.public.known_cards(view, "p1")) == {"bells-7", "leaves-8", "leaves-U"}
    assert _suspected_pickup_finish(view, memory) is None
    assert choose_cpu_action(view, memory=memory)["cards"] == ["hearts-6"]


def test_duplicate_known_rank_can_complete_a_quartet_and_is_not_protected():
    state, memory = _pickup_position(own=["hearts-6", "hearts-A"],
                                     opponent=["hearts-7", "acorns-7"],
                                     packet=["bells-7", "leaves-7", "leaves-U"])
    view = project_state(state, "p0")
    known = memory.public.known_cards(view, "p1")
    assert not strategy._proven_duel_low_lead(view["hand"], [], known, 2)
    assert _suspected_pickup_finish(view, memory)[0] == ["hearts-A"]
    state = _observe(state, memory, "p0", "play", ["hearts-6"])
    state = _observe(state, memory, "p1", "play", ["bells-7", "leaves-7", "hearts-7", "acorns-7"])
    assert state["last_event"]["burn_reason"] == "four_of_a_kind"
    state = _observe(state, memory, "p1", "play", ["leaves-U"])
    assert state["phase"] == "finished" and state["loser_id"] == "p0"


def test_three_unseen_cards_can_refute_the_narrow_low_lead_proof():
    # Exactly the same two different known ranks, but three hidden sevens can
    # form a clearing quartet. The opponent then finishes with the Unter.
    state, memory = _pickup_position(own=["hearts-6", "hearts-A"],
                                     opponent=["hearts-7", "leaves-7", "acorns-7"],
                                     packet=["bells-7", "leaves-U"])
    view = project_state(state, "p0")
    assert _suspected_pickup_finish(view, memory)[0] == ["hearts-A"]
    state = _observe(state, memory, "p0", "play", ["hearts-6"])
    state = _observe(state, memory, "p1", "play", ["bells-7", "hearts-7", "leaves-7", "acorns-7"])
    assert state["last_event"]["burn_reason"] == "four_of_a_kind"
    state = _observe(state, memory, "p1", "play", ["leaves-U"])
    assert state["phase"] == "finished" and state["loser_id"] == "p0"


def test_suspicion_does_not_override_a_certain_own_finish_or_a_free_clearance():
    state, memory = _pickup_position(own=["hearts-6", "hearts-10"])
    view = project_state(state, "p0")
    assert card_rank(choose_cpu_action(view, memory=memory)["cards"][0]) == "10"
    state, memory = _pickup_position(own=["hearts-6", "hearts-A", "hearts-10", "hearts-U"])
    view = project_state(state, "p0")
    assert _suspected_pickup_finish(view, memory) is None  # two unrelated ranks would remain


def test_more_experienced_cpus_follow_the_hint_more_often_but_can_misjudge():
    state, memory = _pickup_position()
    view = project_state(state, "p0")
    def counts(skill):
        return Counter(card_rank(choose_cpu_action(view, memory=memory, skill=skill, rng=Random(seed))["cards"][0])
                       for seed in range(400))
    beginner, expert = counts(.55), counts(1.0)
    assert expert["A"] > beginner["A"] > 0
    assert expert["6"] > 0


def test_other_hidden_hands_with_the_same_public_view_do_not_change_the_decision():
    first, memory = _pickup_position(opponent=["bells-7", "acorns-9"])
    second = deepcopy(first)
    second["players"][1]["hand"][:2] = ["bells-A", "bells-10"]
    before, changed = project_state(first, "p0"), project_state(second, "p0")
    assert before == changed
    assert choose_cpu_action(before, memory=memory, rng=Random(17)) == choose_cpu_action(
        changed, memory=memory, rng=Random(17))


def test_three_player_suspicion_uses_next_opponent_and_avoids_a_near_finished_other_player():
    state = scenario([["hearts-6", "hearts-A", "hearts-10"], ["bells-8", "bells-9"],
                      ["acorns-7", "acorns-8", "acorns-9", "acorns-K"]],
                     discard=["leaves-U"], current="p1")
    memory = CpuMemory()
    state = _observe(state, memory, "p1", "pickup")
    state = _observe(state, memory, "p2", "play", ["acorns-7"])
    view = project_state(state, "p0")
    assert _suspected_pickup_finish(view, memory)[0] == ["hearts-A"]
    near = scenario([["hearts-6", "hearts-A", "hearts-10"], ["bells-8", "bells-9"],
                     ["acorns-7", "acorns-8", "acorns-K"]], discard=["leaves-U"], current="p1")
    other_memory = CpuMemory()
    near = _observe(near, other_memory, "p1", "pickup")
    near = _observe(near, other_memory, "p2", "play", ["acorns-7"])
    assert _suspected_pickup_finish(project_state(near, "p0"), other_memory) is None


def _larger_table(count, *, observed_pickup, own=None):
    own = own or ["hearts-6", "hearts-8", "hearts-A"]
    opponents = [
        ["acorns-7", "acorns-8", "acorns-9"],
        ["bells-6", "bells-7", "bells-8", "bells-9"],
        ["hearts-7", "hearts-9", "hearts-U", "hearts-O"],
        ["leaves-6", "leaves-7", "leaves-8", "leaves-9"],
        ["acorns-6", "acorns-U", "acorns-O", "acorns-K"],
    ]
    memory = CpuMemory()
    if not observed_pickup:
        return scenario([own, *opponents[:count - 1]], current="p0"), memory
    state = scenario([own, *opponents[:count - 1]], discard=["leaves-U"], current="p1")
    state = _observe(state, memory, "p1", "pickup")
    # The intervening seats alternately play a low card and buy that packet;
    # the original p1 pickup remains observed, not attributed to another seat.
    for seat in range(2, count):
        if seat % 2:
            state = _observe(state, memory, f"p{seat}", "pickup")
        else:
            card = "bells-6" if seat == 2 else "leaves-6"
            state = _observe(state, memory, f"p{seat}", "play", [card])
    return state, memory


@pytest.mark.parametrize("count", (4, 5, 6))
@pytest.mark.parametrize("observed_pickup", (False, True))
def test_larger_tables_can_risk_the_high_card_with_mixed_low_rest(count, observed_pickup):
    state, memory = _larger_table(count, observed_pickup=observed_pickup)
    view = project_state(state, "p0")
    candidate = (_suspected_pickup_finish(view, memory) if observed_pickup
                 else _unhinted_endgame_finish(view, memory))
    assert candidate and candidate[0] == ["hearts-A"]
    # The actual policy takes this legal risk only sometimes; weaker players
    # do it less, and a strong CPU can still choose the lower card.
    def chosen(skill):
        return Counter(card_rank(choose_cpu_action(view, memory=memory, skill=skill, rng=Random(seed))["cards"][0])
                       for seed in range(400))
    beginner, expert = chosen(.55), chosen(1.0)
    assert expert["A"] > beginner["A"] > 0
    assert expert["6"] > 0


@pytest.mark.parametrize(("count", "mixed", "hinted", "finish", "hinted_finish"), [
    (4, 0.21617252413946628, 0.223370915625, 0.30260894064613064, 0.30537365625),
    (5, 0.18374664551854633, 0.16739492314081433, 0.25721759954921103, 0.22964395584136146),
    (6, 0.1561846486907644, 0.14524693788515627, 0.2186349596168294, 0.19856921997656246),
])
def test_mixed_unhinted_lead_is_less_likely_without_weakening_other_endgames(count, mixed, hinted, finish, hinted_finish):
    state, memory = _larger_table(count, observed_pickup=False)
    cards, weight = _unhinted_endgame_finish(project_state(state, "p0"), memory)
    assert cards == ["hearts-A"]
    assert weight == pytest.approx(mixed * 0.5 / 0.8)

    state, memory = _larger_table(count, observed_pickup=True)
    cards, weight = _suspected_pickup_finish(project_state(state, "p0"), memory)
    assert cards == ["hearts-A"]
    assert weight == pytest.approx(hinted)

    state, memory = _larger_table(count, observed_pickup=False,
                                  own=["hearts-6", "hearts-10", "hearts-A"])
    cards, weight = _unhinted_endgame_finish(project_state(state, "p0"), memory)
    assert cards == ["hearts-A"]
    assert weight == pytest.approx(finish)

    state, memory = _larger_table(count, observed_pickup=True,
                                  own=["hearts-6", "hearts-10", "hearts-A"])
    cards, weight = _suspected_pickup_finish(project_state(state, "p0"), memory)
    assert cards == ["hearts-A"]
    assert weight == pytest.approx(hinted_finish)


@pytest.mark.parametrize("count", (4, 5, 6))
@pytest.mark.parametrize("observed_pickup", (False, True))
def test_larger_table_high_lead_can_prepare_six_and_ober(count, observed_pickup):
    state, memory = _larger_table(count, observed_pickup=observed_pickup,
                                  own=["hearts-6", "leaves-O", "hearts-A"])
    view = project_state(state, "p0")
    candidate = (_suspected_pickup_finish(view, memory) if observed_pickup
                 else _unhinted_endgame_finish(view, memory))
    assert candidate and candidate[0] == ["hearts-A"]
    assert choose_cpu_action(view, memory=memory)["cards"] == ["hearts-A"]


def test_larger_table_hint_follows_next_active_seat_across_wrap_and_finished_seat():
    state = scenario([
        ["acorns-7", "acorns-8", "acorns-9"],
        ["bells-6", "bells-7", "bells-8", "bells-9"],
        ["hearts-7", "hearts-9", "hearts-U", "hearts-O"],
        ["leaves-6", "leaves-7", "leaves-8", "leaves-9"],
        ["hearts-6", "hearts-8", "hearts-A"],
        [],  # finished seat between the viewer and the next active seat
    ], discard=["leaves-U"], current="p0")
    memory = CpuMemory()
    for seat, action, cards in (("p0", "pickup", None), ("p1", "play", ["bells-6"]),
                                ("p2", "pickup", None), ("p3", "play", ["leaves-6"])):
        before = project_state(state, "p4")
        state = apply_action(state, seat, action, cards=cards, version=state["version"])
        memory.public.observe(before, project_state(state, "p4"))
    view = project_state(state, "p4")
    assert view["current_player_id"] == "p4" and memory.public.pickup_hint(view, "p0")
    assert _suspected_pickup_finish(view, memory)[0] == ["hearts-A"]


def test_larger_table_hidden_hand_swaps_never_change_the_cpu_view_or_choice():
    state, memory = _larger_table(6, observed_pickup=False)
    altered = deepcopy(state)
    first, second = altered["players"][1]["hand"], altered["players"][2]["hand"]
    first[0], second[0] = second[0], first[0]  # conserve physical cards
    original_view, changed_view = project_state(state, "p0"), project_state(altered, "p0")
    assert original_view == changed_view
    assert choose_cpu_action(original_view, memory=memory, rng=Random(17)) == choose_cpu_action(
        changed_view, memory=memory, rng=Random(17))


@pytest.mark.parametrize("middle", ("hearts-8", "leaves-O"))
def test_six_player_high_lead_can_leave_a_playable_low_card_or_a_high_pile(middle):
    hand = ["hearts-6", middle, "hearts-A"]
    opponents = [
        ["bells-10", "bells-A", "bells-6", "bells-9", "bells-K"],
        ["leaves-6", "leaves-9", "leaves-K", "hearts-8" if middle == "leaves-O" else "leaves-O"],
        ["leaves-A", "bells-7", "bells-O", "hearts-7"],
        ["acorns-7", "acorns-8", "acorns-9", "acorns-K"],
        ["acorns-A", "bells-8", "leaves-8", "acorns-O"],
    ]
    initial = scenario([hand, *opponents], current="p0")
    view = project_state(initial, "p0")
    assert _unhinted_endgame_finish(view, CpuMemory())[0] == ["hearts-A"]
    assert choose_cpu_action(view, memory=CpuMemory())["cards"] == ["hearts-A"]
    favourable = apply_action(initial, "p0", "play", cards=["hearts-A"], version=initial["version"])
    for seat, card in (("p1", "bells-10"), ("p1", "bells-6"), ("p2", "leaves-6"),
                       ("p3", "bells-7"), ("p4", "acorns-7"), ("p5", "bells-8")):
        favourable = apply_action(favourable, seat, "play", cards=[card], version=favourable["version"])
    assert middle in project_state(favourable, "p0")["playable_cards"]
    favourable = apply_action(favourable, "p0", "play", cards=[middle], version=favourable["version"])
    assert favourable["players"][0]["hand"] == ["hearts-6"]
    risky = apply_action(initial, "p0", "play", cards=["hearts-A"], version=initial["version"])
    for seat, action, card in (("p1", "play", "bells-10"), ("p1", "play", "bells-A"),
                               ("p2", "pickup", None), ("p3", "play", "leaves-A"),
                               ("p4", "pickup", None), ("p5", "play", "acorns-A")):
        risky = apply_action(risky, seat, action, cards=[card] if card else None, version=risky["version"])
    risk_view = project_state(risky, "p0")
    assert risk_view["discard"][-1] == "acorns-A"
    assert not risk_view["playable_cards"] and "pickup" in risk_view["available_actions"]


@pytest.mark.parametrize("count", (4, 5, 6))
@pytest.mark.parametrize("wild", (False, True))
def test_final_intervening_opponent_can_finish_with_ten_pair_or_wild_quartet(count, wild):
    own = ["hearts-6", "hearts-8", "hearts-A"]
    target = ["acorns-6", "acorns-7", "acorns-8", "acorns-U"]
    last = (["hearts-K", "bells-K", "leaves-K", "acorns-K"] if wild
            else ["bells-10", "leaves-9", "acorns-9"])
    leads = (["bells-A", "leaves-A", "acorns-A"] if wild else ["bells-6", "leaves-6"])
    used = set(own + target + last + leads)
    fillers = iter(card for card in make_deck() if card not in used)
    intervening = []
    for index in range(count - 3):
        if wild:
            intervening.append([leads[index], *(next(fillers) for _ in range(3))])
        elif index % 2 == 0:
            intervening.append([leads[index // 2], *(next(fillers) for _ in range(3))])
        else:
            intervening.append([next(fillers) for _ in range(4)])
    state = scenario([own, target, *intervening, last], current="p0")
    state["four_of_a_kind_as_ten"] = wild
    view = project_state(state, "p0")
    assert _unhinted_endgame_finish(view, CpuMemory())[0] == ["hearts-A"]
    state = apply_action(state, "p0", "play", cards=["hearts-A"], version=state["version"])
    state = apply_action(state, "p1", "pickup", version=state["version"])
    for index, seat in enumerate(range(2, count - 1)):
        if wild:
            state = apply_action(state, f"p{seat}", "play", cards=[leads[index]], version=state["version"])
        elif index % 2 == 0:
            state = apply_action(state, f"p{seat}", "play", cards=[leads[index // 2]], version=state["version"])
        else:
            state = apply_action(state, f"p{seat}", "pickup", version=state["version"])
    last_seat = f"p{count - 1}"
    if wild:
        assert card_rank(state["discard"][-1]) == "A"
        state = apply_action(state, last_seat, "play", cards=last, version=state["version"])
    else:
        state = apply_action(state, last_seat, "play", cards=["bells-10"], version=state["version"])
        state = apply_action(state, last_seat, "play", cards=["leaves-9", "acorns-9"], version=state["version"])
    assert state["players"][-1]["finished"] and state["current_player_id"] == "p0"


def test_high_lead_may_delay_a_one_card_opponent_but_pickup_may_help_them():
    initial = scenario([
        ["hearts-6", "hearts-8", "hearts-A"],
        ["bells-A", "bells-9", "bells-10"],
        ["bells-6"],
        ["leaves-7", "leaves-8", "leaves-9", "leaves-K"],
    ], current="p0")
    view = project_state(initial, "p0")
    assert _unhinted_endgame_finish(view, CpuMemory())[0] == ["hearts-A"]
    # On the high lead the next player can answer, leaving the one-card seat
    # unable to finish. This is one possible sequence, not a guaranteed block.
    high = apply_action(initial, "p0", "play", cards=["hearts-A"], version=initial["version"])
    high = apply_action(high, "p1", "play", cards=["bells-A"], version=high["version"])
    assert not project_state(high, "p2")["playable_cards"]
    high = apply_action(high, "p2", "pickup", version=high["version"])
    assert not high["players"][2]["finished"]
    # A different next-player choice takes the packet; then that same seat can
    # finish on the empty pile immediately, even following a high opening.
    other = apply_action(initial, "p0", "play", cards=["hearts-A"], version=initial["version"])
    other = apply_action(other, "p1", "pickup", version=other["version"])
    other = apply_action(other, "p2", "play", cards=["bells-6"], version=other["version"])
    assert other["players"][2]["finished"]


@pytest.mark.parametrize("wild", (False, True))
def test_six_seats_can_all_finish_before_the_cpu_gets_another_turn(wild):
    # Both counterexamples are legal: a voluntarily picked-up six gives p1
    # a three-card finish after ten, or a single-card finish after four kings.
    first_hand = (["hearts-K", "bells-K", "leaves-K", "acorns-K"] if wild
                  else ["leaves-6", "acorns-6", "bells-10"])
    state = scenario([
        ["hearts-6", "hearts-A", "hearts-10"], first_hand,
        ["hearts-7", "bells-7", "leaves-7"], ["hearts-8", "bells-8", "leaves-8"],
        ["hearts-9", "bells-9", "leaves-9"], ["hearts-U", "bells-U", "leaves-U"],
    ], discard=["bells-6"], current="p1")
    state["four_of_a_kind_as_ten"] = wild
    memory = CpuMemory()
    state = _observe(state, memory, "p1", "pickup")
    for seat, card in (("p2", "hearts-7"), ("p3", "hearts-8"), ("p4", "hearts-9"), ("p5", "hearts-U")):
        state = _observe(state, memory, seat, "play", [card])
    view = project_state(state, "p0")
    assert choose_cpu_action(view, memory=memory)["cards"] == ["hearts-A"]
    state = _observe(state, memory, "p0", "play", ["hearts-A"])
    if wild:
        state = _observe(state, memory, "p1", "play", first_hand)
        assert state["last_event"]["burn_reason"] == "four_of_a_kind"
        state = _observe(state, memory, "p1", "play", ["bells-6"])
    else:
        state = _observe(state, memory, "p1", "play", ["bells-10"])
        state = _observe(state, memory, "p1", "play", ["leaves-6", "acorns-6", "bells-6"])
    for seat, cards in (("p2", ["bells-7", "leaves-7"]), ("p3", ["bells-8", "leaves-8"]),
                        ("p4", ["bells-9", "leaves-9"]), ("p5", ["bells-U", "leaves-U"])):
        state = _observe(state, memory, seat, "play", cards)
    assert state["phase"] == "finished" and state["loser_id"] == "p0"
