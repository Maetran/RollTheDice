"""Counted final-duel knowledge and the exact, bounded endgame search."""

from random import Random

import pytest

from app import hausdepp_cpu_endgame as endgame
from app.hausdepp_cpu_endgame import winning_afterthrows, winning_plays
from app.hausdepp_cpu_knowledge import PublicKnowledge
from app.hausdepp_cpu_strategy import CpuMemory, choose_cpu_action
from app.hausdepp_engine import HAUSDEPP_RANKS, apply_action, card_rank, make_deck, new_round, project_state
from tests import hausdepp_cpu_policy_4141 as frozen
from tests.test_hausdepp_cpu_knowledge import legal_commands
from tests.test_hausdepp_engine import scenario


def _ranks(cards):
    return sorted(cards, key=lambda card: HAUSDEPP_RANKS.index(card_rank(card)))


@pytest.mark.parametrize(("mine", "theirs", "discard", "wins"), [
    # A low card lets the known pair finish; the Ober forces the pickup fastest.
    (["hearts-7", "hearts-O", "hearts-A"], ["bells-8", "leaves-8"], ["acorns-6"], [("O", 1)]),
    # Three distinct ranks against one known low card: block with the Unter.
    (["leaves-6", "leaves-K", "leaves-U"], ["hearts-7"], [], [("U", 1)]),
    # A known king beats the lone block reserve: nothing is forced.
    (["hearts-7", "hearts-8", "hearts-A"], ["bells-K"], [], []),
])
def test_known_final_duels_have_exact_forced_wins(mine, theirs, discard, wins):
    assert winning_plays(mine, theirs, discard) == wins


def test_deep_eight_card_duel_falls_back_instead_of_overflowing_the_stack():
    # Defensive regression: this artificial, non-monotonic pile raised RecursionError.
    mine = ["hearts-O", "hearts-7", "acorns-U", "leaves-K", "bells-10", "hearts-K", "acorns-6", "bells-8"]
    theirs = ["hearts-8", "acorns-8", "bells-A", "bells-K", "hearts-9", "bells-9", "leaves-A", "acorns-O"]
    discard = ["hearts-U", "bells-7", "leaves-7", "bells-6"]

    def nested(depth):
        # Also safe when called deep inside the server's own call stack.
        return nested(depth - 1) if depth else winning_plays(mine, theirs, discard, budget=10**6)

    endgame._winning.cache_clear()
    result = nested(600)
    assert result is None or all(rank in HAUSDEPP_RANKS + ["pickup"] for rank, _ in result)


def test_exhausted_budget_is_undecided_not_a_claim():
    endgame._winning.cache_clear()
    assert winning_plays(["hearts-7", "hearts-O", "hearts-A"], ["bells-8", "leaves-8"], ["acorns-6"], budget=1) is None


def _key(state):
    return (tuple(tuple(sorted(player["hand"])) for player in state["players"]), tuple(state["discard"]),
            state["current_player_id"], tuple(sorted((state.get("afterthrow") or {}).items())), state["phase"])


def _verify(state, path=frozenset()):
    """Follow the solver for p0 and enumerate every engine reply of p1, including afterthrows."""
    if state["phase"] == "finished":
        assert state["loser_id"] == "p1"
        return 1
    key = _key(state)
    assert key not in path, "a re-planned forced win must never repeat a position"
    path = path | {key}
    after = lambda actor, action, cards: apply_action(state, actor, action, cards=cards, version=state["version"])  # noqa: E731
    leaves = 0
    if state["current_player_id"] == "p0":
        for action, cards in legal_commands(state, "p1") if state.get("afterthrow", {}) and state["afterthrow"]["player_id"] == "p1" else []:
            leaves += _verify(after("p1", action, cards), path)
        own = {(action, tuple(sorted(cards or ()))) for action, cards in legal_commands(state, "p0") if action != "afterthrow"}
        moves = winning_plays(state["players"][0]["hand"], state["players"][1]["hand"], state["discard"])
        assert moves, "a proven position keeps a proven continuation"
        rank, count = moves[0]
        if rank == "pickup":
            assert ("pickup", ()) in own
            return leaves + _verify(after("p0", "pickup", None), path)
        cards = sorted(card for card in state["players"][0]["hand"] if card_rank(card) == rank)[:count]
        assert ("play", tuple(cards)) in own
        return leaves + _verify(after("p0", "play", cards), path)
    for action, cards in legal_commands(state, "p1"):
        if action != "afterthrow":
            leaves += _verify(after("p1", action, cards), path)
    return leaves


def test_every_claimed_win_survives_all_real_engine_replies_and_timings():
    rng, deck, claims, leaves = Random(11), make_deck(), 0, 0
    for _ in range(300):
        cards = rng.sample(deck, 10)
        mine_count, their_count = rng.randint(1, 4), rng.randint(1, 4)
        mine, theirs = cards[:mine_count], cards[mine_count:mine_count + their_count]
        discard = _ranks(cards[mine_count + their_count:][:rng.choice([0, 0, 1, 2])])
        if discard and card_rank(discard[-1]) == "10":
            continue
        state = scenario([mine, theirs], discard=discard, current="p0")
        for rank, count in winning_plays(mine, theirs, discard) or []:
            claims += 1
            if rank == "pickup":
                leaves += _verify(apply_action(state, "p0", "pickup", version=state["version"]))
                continue
            play = sorted(card for card in mine if card_rank(card) == rank)[:count]
            leaves += _verify(apply_action(state, "p0", "play", cards=play, version=state["version"]))
    assert claims > 150 and leaves > claims


def test_a_winning_afterthrow_completes_four_and_finishes():
    # Two kings follow two kings: the pile burns, the turn stays and the ace finishes.
    assert winning_afterthrows(["hearts-K", "bells-K", "hearts-A"], ["acorns-9"], ["leaves-K", "acorns-K"], "K") == [2]


def _observed_rounds(count, seeds):
    """Real engine rounds; every seat's memory observes only its own projections."""
    for seed in seeds:
        random = Random(seed)
        state = new_round([f"p{index}" for index in range(count)], dealer_index=count - 1, rng=random)
        memories = {player["id"]: CpuMemory() for player in state["players"]}
        for _ in range(3000):
            if state["phase"] == "finished":
                break
            yield state, memories
            actor = (next(iter(state["pending_refills"]), None) or (state.get("afterthrow") or {}).get("player_id")
                     or state["current_player_id"])
            view = project_state(state, actor)
            move = frozen.choose_cpu_action(view, memory=None) or frozen.choose_cpu_action(
                project_state(state, actor := state["current_player_id"]), memory=None)
            before, state = state, apply_action(state, actor, **move, rng=random)
            for player_id, memory in memories.items():
                memory.public.observe(project_state(before, player_id), project_state(state, player_id))


@pytest.mark.parametrize("count", [2, 3, 4])
def test_counted_hand_is_exactly_the_last_opposing_hand_in_real_rounds(count):
    found = 0
    for state, memories in _observed_rounds(count, range(40)):
        active = [player for player in state["players"] if not player["finished"]]
        for player in state["players"]:
            view = project_state(state, player["id"])
            for other in state["players"]:
                if other is player:
                    continue
                counted = memories[player["id"]].public.counted_hand(view, other["id"])
                duel = not state["deck"] and len(active) == 2 and player in active and other in active
                if counted is not None:
                    assert duel and counted == tuple(sorted(other["hand"]))
                    found += 1
                elif duel and state["phase"] == "playing":
                    pytest.fail("a continuously observed duel must be countable")
    assert found


def _step(state):
    actor = state["current_player_id"]
    action, cards = legal_commands(state, actor)[0]
    return apply_action(state, actor, action, cards=cards, version=state["version"])


def test_a_missed_observation_or_a_restart_loses_the_count():
    for state, memories in _observed_rounds(2, range(5, 40)):
        view = project_state(state, "p0")
        if memories["p0"].public.counted_hand(view, "p1") is not None and len(state["players"][0]["hand"]) > 2:
            break
    else:
        pytest.skip("no countable duel")
    assert PublicKnowledge().counted_hand(view, "p1") is None  # restarted memory never invents a count
    knowledge = memories["p0"].public
    missed = _step(state)
    if missed["phase"] != "playing":
        pytest.skip("round ended")
    later = _step(missed)
    knowledge.observe(project_state(missed, "p0"), project_state(later, "p0"))  # one transition was never seen
    assert knowledge.counted_hand(project_state(later, "p0"), "p1") is None


def test_a_departure_hides_cards_and_ends_the_count():
    knowledge = PublicKnowledge()
    before = {"version": 7, "burned_count": 0, "phase": "playing", "viewer_id": "p0", "discard": []}
    knowledge._count_burns({**before, "version": 6}, before)
    after = {**before, "version": 8, "burned_count": 3, "last_event": {"type": "withdraw", "removed_count": 3}}
    knowledge._count_burns(before, after)
    assert knowledge._burned is None


@pytest.mark.parametrize("drawn", ["leaves-10", "leaves-A", "leaves-7"])
def test_counted_hands_follow_successful_and_failed_public_gambles(drawn):
    state = scenario([["hearts-6", "hearts-7"], ["bells-8", "bells-9"]],
                     discard=["hearts-K"], deck=[drawn])
    # Arrange already observed burns: this tests the public transition itself.
    memories = {player: PublicKnowledge(_burned=set(state["burned"]), _burn_version=state["version"])
                for player in ("p0", "p1")}
    before = state
    state = apply_action(state, "p0", "gamble", version=state["version"])
    for player, opponent in (("p0", "p1"), ("p1", "p0")):
        memory = memories[player]
        previous, current = project_state(before, player), project_state(state, player)
        memory.observe(previous, current)
        expected = next(person["hand"] for person in state["players"] if person["id"] == opponent)
        assert memory.counted_hand(current, opponent) == tuple(sorted(expected))
        burned = set(memory._burned)
        memory.observe(previous, current)  # duplicate delivery cannot count a burn twice
        assert memory._burned == burned


def test_missing_a_burn_cannot_be_recovered_from_its_public_count():
    state = scenario([["hearts-6", "hearts-7"], ["bells-8", "bells-9"]],
                     discard=["hearts-K"], deck=["leaves-10"])
    memory = PublicKnowledge(_burned=set(state["burned"]), _burn_version=state["version"])
    state = apply_action(state, "p0", "gamble", version=state["version"])  # this transition was missed
    before = state
    state = apply_action(state, "p0", "play", cards=["hearts-6"], version=state["version"])
    memory.observe(project_state(before, "p1"), project_state(state, "p1"))
    assert memory._burned is None
    assert memory.counted_hand(project_state(state, "p1"), "p0") is None


def test_cpu_uses_a_counted_duel_and_misses_it_only_by_its_usual_slip(monkeypatch):
    state = scenario([["leaves-6", "leaves-K", "leaves-U"], ["hearts-7"]])
    view = project_state(state, "p0")
    memory = CpuMemory()
    monkeypatch.setattr(memory.public, "counted_hand", lambda _view, player_id: ("hearts-7",))
    assert choose_cpu_action(view)["cards"] == ["leaves-6"]  # without counting: the losing low card
    assert choose_cpu_action(view, memory=memory)["cards"] == ["leaves-U"]
    misses = sum(choose_cpu_action(view, memory=memory, skill=skill, rng=Random(seed))["cards"] != ["leaves-U"]
                 for skill in (1.0,) for seed in range(400))
    gentle = sum(choose_cpu_action(view, memory=memory, skill=0.45, rng=Random(seed))["cards"] != ["leaves-U"]
                 for seed in range(400))
    assert 0 < misses < gentle


def test_forced_win_by_taking_the_pile_is_offered_as_a_pickup(monkeypatch):
    # Two Unters cannot answer the ace; taking it lets both Unters finish later.
    state = scenario([["hearts-U", "leaves-U"], ["hearts-7", "bells-6"]], discard=["acorns-6", "bells-A"])
    view = project_state(state, "p0")
    memory = CpuMemory()
    monkeypatch.setattr(memory.public, "counted_hand", lambda _view, player_id: ("bells-6", "hearts-7"))
    assert winning_plays(view["hand"], ["hearts-7", "bells-6"], view["discard"]) == [("pickup", 0)]
    assert choose_cpu_action(view, memory=memory)["action"] == "pickup"


def _counted_memory(monkeypatch, opponent):
    memory = CpuMemory()
    monkeypatch.setattr(memory.public, "counted_hand", lambda _view, _player_id: tuple(sorted(opponent)))
    return memory


def test_a_direct_finish_keeps_priority_over_the_counted_search(monkeypatch):
    state = scenario([["hearts-K", "bells-K"], ["hearts-7", "bells-7"]])
    view = project_state(state, "p0")
    assert winning_plays(view["hand"], ["hearts-7", "bells-7"], []) == [("K", 2)]  # fastest only
    move = choose_cpu_action(view, memory=_counted_memory(monkeypatch, ["hearts-7", "bells-7"]))
    assert move["action"] == "play" and move["cards"] == ["bells-K", "hearts-K"]  # both kings end the round now


def _gentle_cases():
    play = scenario([["leaves-6", "leaves-K", "leaves-U"], ["hearts-7"]])
    # Two kings follow our two kings: four burn the pile and the ace finishes.
    follow = scenario([["hearts-K", "bells-K", "hearts-A"], ["acorns-9"]], discard=["leaves-K", "acorns-K"],
                      current="p1", afterthrow={"player_id": "p0", "rank": "K"})
    return [(play, ["hearts-7"]), (follow, ["acorns-9"])]


@pytest.mark.parametrize("case", range(2))
@pytest.mark.parametrize("skill", [0.45, 0.55])
def test_newcomer_tables_play_exactly_as_before_in_counted_duels(monkeypatch, case, skill):
    state, opponent = _gentle_cases()[case]
    view = project_state(state, "p0")
    memory = _counted_memory(monkeypatch, opponent)
    for seed in range(300):
        assert (choose_cpu_action(view, memory=memory, skill=skill, rng=Random(seed))
                == frozen.choose_cpu_action(view, memory=frozen.CpuMemory(), skill=skill, rng=Random(seed)))


@pytest.mark.parametrize("case", range(2))
def test_full_strength_counts_with_one_ordinary_slip_and_no_second_chance(monkeypatch, case):
    state, opponent = _gentle_cases()[case]
    view = project_state(state, "p0")
    memory = _counted_memory(monkeypatch, opponent)
    expected = ({"action": "play", "cards": ["leaves-U"]} if case == 0
                else {"action": "afterthrow", "cards": ["bells-K", "hearts-K"]})
    misses = 0
    for seed in range(2000):
        move = choose_cpu_action(view, memory=memory, skill=1.0, rng=Random(seed)) or {}
        misses += {key: move.get(key) for key in expected} != expected
    # One ordinary 5 % slip; the old heuristic may still find the move afterwards.
    assert misses < 0.06 * 2000
    assert all(choose_cpu_action(view, memory=memory) == {"version": view["version"], **expected} for _ in range(3))


def test_search_is_deterministic_and_bounded_by_nodes_not_by_the_clock(monkeypatch):
    rng, deck = Random(5), make_deck()
    positions = []
    for size in (4, 8, 12):
        for _ in range(10):
            cards = rng.sample(deck, 2 * size + 3)
            pile = _ranks(cards[2 * size:])
            positions.append((cards[:size], cards[size:2 * size], pile[:-1] if card_rank(pile[-1]) == "10" else pile))

    def run():
        endgame._winning.cache_clear()
        return [winning_plays(*position) for position in positions]

    first = run()
    # A stalled clock or heavy load cannot change any answer.
    monkeypatch.setattr("time.perf_counter", lambda: 1e12)
    assert run() == first and any(result is None for result in first) and any(result for result in first)


def test_newcomer_tables_never_search(monkeypatch):
    from app import hausdepp_cpu_strategy as strategy

    state, opponent = _gentle_cases()[0]
    view = project_state(state, "p0")
    monkeypatch.setattr(strategy, "_counted_endgame", lambda *_: pytest.fail("searched at a newcomer table"))
    choose_cpu_action(view, memory=_counted_memory(monkeypatch, opponent), skill=0.55, rng=Random(1))
