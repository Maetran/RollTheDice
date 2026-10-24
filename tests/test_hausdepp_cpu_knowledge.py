"""Accepted public observations and the bounded, engine-proven three-versus-pair tactic."""

from collections import OrderedDict, defaultdict
from copy import deepcopy
from itertools import combinations
from unittest.mock import Mock

import pytest

from app import hausdepp_cpu_runner as runner
from app import hausdepp_engine as engine
from app import hausdepp_gameplay as gameplay
from app.hausdepp_cpu_knowledge import PublicKnowledge
from app.hausdepp_cpu_strategy import _known_pair_block, choose_cpu_action
from tests.test_hausdepp_cpu_strategy import ScriptedRandom
from tests.test_hausdepp_engine import scenario


@pytest.fixture
def table_factory(monkeypatch):
    monkeypatch.setattr(runner, "_MEMORIES", OrderedDict())
    monkeypatch.setattr(gameplay, "multiplayer_pause_reason", lambda _game: None)

    def create(state, *, cpu_ids=("p0",), game_id="observed-pair"):
        for player in state["players"]:
            player["is_cpu"] = player["id"] in cpu_ids
        people = [{"id": player["id"], "name": player["name"], "is_cpu": player["is_cpu"],
                   "user_id": None if player["is_cpu"] else index + 1}
                  for index, player in enumerate(state["players"])]
        game = {"_id": game_id, "_game_type": "hausdepp", "_started": True, "_finished": False,
                "_participants": people, "_hausdepp": state,
                "_players": [{**person, "ws": object()} for person in people if not person["is_cpu"]]}
        monkeypatch.setitem(runner.games, game_id, game)
        return game

    return create


def command(game, actor, action, cards=None, *, version=None):
    state = game["_hausdepp"]
    before = deepcopy(state)
    cpu = next(person["is_cpu"] for person in game["_participants"] if person["id"] == actor)
    gameplay.apply_hausdepp_command(game, actor, {"action": action, "cards": cards,
        "version": state["version"] if version is None else version}, trusted_cpu=cpu)
    assert state == before
    assert game["_hausdepp"]["version"] == state["version"] + 1
    return game["_hausdepp"]


def observation_trace(table_factory, ranks=("6", "7", "K", "A"), *, packet=None, extra_unknown=(), final_hand=None):
    low, pair, blocker, reserve = ranks
    packet = packet if packet is not None else [f"bells-{pair}", f"leaves-{pair}"]
    final_hand = final_hand if final_hand is not None else [f"bells-{low}", f"hearts-{blocker}", f"hearts-{reserve}"]
    state = scenario([[f"hearts-{low}", *final_hand, "hearts-10"],
                      ["acorns-A", *extra_unknown]], discard=packet, current="p1")
    game = table_factory(state)
    command(game, "p1", "pickup")  # legal voluntary public purchase, no hidden hand inference
    command(game, "p0", "play", [f"hearts-{low}"])
    command(game, "p1", "play", ["acorns-A"])
    command(game, "p0", "play", ["hearts-10"])
    return game


def decision(game, *, rng=None):
    view = engine.project_state(game["_hausdepp"], "p0")
    memory = runner._memories_for(game)["p0"]
    return choose_cpu_action(view, memory=memory, rng=rng), view, memory


@pytest.mark.parametrize("ranks", tuple(combinations(engine.HAUSDEPP_RANKS[:-1], 4)))
def test_all_seventy_patterns_are_learned_through_real_accepted_commands(table_factory, ranks):
    game = observation_trace(table_factory, ranks)
    low, pair, blocker, _reserve = ranks
    state = game["_hausdepp"]
    assert state["deck"] == [] and state["discard"] == [] and state["current_player_id"] == "p0"
    assert len(state["players"]) == 2 and len(state["players"][0]["hand"]) == 3
    move, view, memory = decision(game)
    assert memory.public.exact_hand(view, "p1") == tuple(sorted([f"bells-{pair}", f"leaves-{pair}"]))
    assert choose_cpu_action(view)["cards"] == [f"bells-{low}"]
    assert move["cards"] == [f"hearts-{blocker}"]


def legal_commands(state, actor):
    view = engine.project_state(state, actor)
    result = []
    for action in view["available_actions"]:
        if action in {"play", "afterthrow"}:
            groups = defaultdict(list)
            for card in view["playable_cards"]:
                groups[engine.card_rank(card)].append(card)
            for group in groups.values():
                for size in range(1, len(group) + 1):
                    result.extend((action, list(cards)) for cards in combinations(group, size))
        else:
            assert action == "pickup"
            result.append((action, None))
    return result


def assert_finish_with_reserve(state):
    result = engine.apply_action(state, "p0", "play", cards=["hearts-A"], version=state["version"])
    assert result["phase"] == "finished" and result["loser_id"] == "p1"
    branches = 1
    for action, cards in legal_commands(state, "p1"):
        assert action == "afterthrow"
        after = engine.apply_action(state, "p1", action, cards=cards, version=state["version"])
        branches += assert_finish_with_reserve(after)
    return branches


def test_the_integrated_trace_wins_against_every_human_response_and_optional_afterthrow(table_factory):
    game = observation_trace(table_factory)
    move, _view, _memory = decision(game)
    command(game, "p0", move["action"], move["cards"])
    assert legal_commands(game["_hausdepp"], "p1") == [("pickup", None)]
    command(game, "p1", "pickup")
    assert game["_hausdepp"]["last_event"]["picked_up_count"] == 1
    state = command(game, "p0", "play", ["bells-6"])
    branches = 0
    for action, cards in legal_commands(state, "p1"):
        reply = engine.apply_action(state, "p1", action, cards=cards, version=state["version"])
        branches += assert_finish_with_reserve(reply)
    assert branches == 7


@pytest.mark.parametrize("unknown", ["bells-A", "bells-10"])
def test_one_unknown_card_never_becomes_a_complete_hand_or_a_proven_block(table_factory, unknown):
    game = observation_trace(table_factory, extra_unknown=[unknown])
    move, view, memory = decision(game)
    assert memory.public.exact_hand(view, "p1") is None
    assert move["cards"] == ["bells-6"]


@pytest.mark.parametrize("ranks", [("6", "K", "9", "A"), ("8", "7", "K", "A")])
def test_pair_above_blocker_or_below_low_card_is_outside_the_proven_order(table_factory, ranks):
    game = observation_trace(table_factory, ranks)
    _move, view, memory = decision(game)
    assert memory.public.exact_hand(view, "p1") is not None
    assert _known_pair_block(view, memory) is None


def test_a_fully_observed_non_pair_does_not_trigger(table_factory):
    game = observation_trace(table_factory, packet=["bells-7", "leaves-8"])
    _move, view, memory = decision(game)
    assert memory.public.exact_hand(view, "p1") == ("bells-7", "leaves-8")
    assert _known_pair_block(view, memory) is None


@pytest.mark.parametrize("hand", [
    ["bells-6", "hearts-K"], ["bells-6", "hearts-8", "hearts-K", "hearts-A"],
    ["bells-6", "hearts-K", "bells-K"], ["bells-6", "hearts-K", "bells-10"],
])
def test_only_exactly_three_distinct_ordinary_cards_enter_the_proven_domain(table_factory, hand):
    game = observation_trace(table_factory, final_hand=hand)
    _, view, memory = decision(game)
    assert memory.public.exact_hand(view, "p1") == ("bells-7", "leaves-7")
    assert _known_pair_block(view, memory) is None


def test_the_new_tactic_has_its_existing_bounded_skill_misjudgement(table_factory):
    game = observation_trace(table_factory)
    move, _, _ = decision(game, rng=ScriptedRandom(0.99, 0.0, 0.99))
    assert move["cards"] == ["bells-6"]
    move, _, _ = decision(game, rng=ScriptedRandom(0.99, 0.99, 0.99))
    assert move["cards"] == ["hearts-K"]


def test_the_existing_unknown_single_card_heuristic_is_a_separate_contract():
    state = scenario([["hearts-6", "hearts-A"], ["bells-7"]], discard=["leaves-6"])
    assert choose_cpu_action(engine.project_state(state, "p0"))["cards"] == ["hearts-A"]


@pytest.mark.parametrize("action", ["afterthrow", "follow"])
def test_human_afterthrows_are_observed_without_a_running_cpu_task(table_factory, action):
    state = scenario([["hearts-6", "bells-6", "hearts-K", "hearts-A", "hearts-10"], ["acorns-A"]],
                     discard=["bells-7", "leaves-7"], current="p1")
    game = table_factory(state)
    command(game, "p1", "pickup")
    memory = runner._memories_for(game)["p0"]
    assert memory.public._known["p1"] == {"bells-7", "leaves-7"}
    command(game, "p0", "play", ["hearts-6"])
    command(game, "p1", "play", ["bells-7"])
    state = command(game, "p1", action, ["leaves-7"])
    assert state["last_event"]["type"] == "afterthrow"
    assert memory.public._known["p1"] == set()


@pytest.mark.parametrize("clear", ["ten", "four_of_a_kind"])
def test_opposing_clearances_remove_only_the_publicly_played_cards(table_factory, clear):
    pair = ["bells-9", "leaves-9"]
    packet = pair if clear == "ten" else ["bells-7", "leaves-7", "acorns-7", *pair]
    human = ["hearts-10" if clear == "ten" else "hearts-7", "acorns-A"]
    game = table_factory(scenario([["hearts-6", "hearts-K", "hearts-A"], human],
                                  discard=packet, current="p1"))
    command(game, "p1", "pickup")
    command(game, "p0", "play", ["hearts-6"])
    state = command(game, "p1", "play", [human[0]])
    if clear == "four_of_a_kind":
        state = command(game, "p1", "follow", ["bells-7", "leaves-7", "acorns-7"])
    assert state["last_event"]["type"] == ("play" if clear == "ten" else "afterthrow")
    assert state["last_event"]["burn_reason"] == clear
    assert state["discard"] == [] and state["current_player_id"] == "p1"
    memory = runner._memories_for(game)["p0"].public
    assert memory._known["p1"] == set(pair)
    assert memory.exact_hand(engine.project_state(state, "p0"), "p1") is None
    state = command(game, "p1", "play", ["acorns-A"])
    assert memory.exact_hand(engine.project_state(state, "p0"), "p1") == tuple(sorted(pair))


def test_duplicates_do_not_readd_cards_and_a_version_gap_discards_knowledge(table_factory):
    game = observation_trace(table_factory)
    _, view, memory = decision(game)
    known = memory.public.exact_hand(view, "p1")
    before = deepcopy(game["_hausdepp"])
    after = command(game, "p0", "play", ["hearts-K"])
    runner.observe_accepted_transition(game, before, after)
    assert memory.public.exact_hand(engine.project_state(after, "p0"), "p1") == known
    # Two real authoritative commands were missed; no snapshot diff invents their meaning.
    first = engine.apply_action(after, "p1", "pickup", version=after["version"])
    second = engine.apply_action(first, "p0", "play", cards=["bells-6"], version=first["version"])
    game["_hausdepp"] = second
    runner.observe_accepted_transition(game, after, second)
    assert memory.public.exact_hand(engine.project_state(second, "p0"), "p1") is None
    assert memory.public._known == {}


def test_rejected_commands_never_observe_or_mutate_existing_knowledge(table_factory, monkeypatch):
    game = observation_trace(table_factory)
    _, _, memory = decision(game)
    state, knowledge = deepcopy(game["_hausdepp"]), deepcopy(memory.public)
    observed = []
    monkeypatch.setattr(runner, "observe_accepted_transition", lambda *_args: observed.append(True))
    for actor, cards, version in [("p0", ["bells-6"], 0), ("p1", ["bells-7"], state["version"])]:
        with pytest.raises(engine.HausdeppRuleError):
            command(game, actor, "play", cards, version=version)
    assert observed == [] and game["_hausdepp"] == state and memory.public == knowledge


def test_observation_failure_discards_party_memory_and_preserves_the_accepted_move(table_factory, monkeypatch):
    game = observation_trace(table_factory)
    state = game["_hausdepp"]
    expected = engine.apply_action(state, "p0", "play", cards=["hearts-K"], version=state["version"])

    def broken(*_args):
        raise RuntimeError("isolated optional memory failure")

    monkeypatch.setattr(runner, "observe_accepted_transition", broken)
    warning = Mock()
    monkeypatch.setattr(gameplay.logger, "warning", warning)
    command(game, "p0", "play", ["hearts-K"])
    assert game["_hausdepp"] == expected
    assert game["_id"] not in runner._MEMORIES
    warning.assert_called_once_with("Hausdepp CPU observation discarded for %s", game["_id"], exc_info=True)


def test_observation_failure_cannot_interrupt_a_terminal_move_or_its_result(table_factory, monkeypatch):
    game = observation_trace(table_factory)
    command(game, "p0", "play", ["bells-6"])
    monkeypatch.setattr(runner, "observe_accepted_transition", Mock(side_effect=RuntimeError("optional failure")))
    monkeypatch.setattr(gameplay.logger, "warning", Mock())
    command(game, "p1", "play", ["bells-7", "leaves-7"])
    assert game["_finished"] and game["_results"]["loser_id"] == "p0"
    assert game["_id"] not in runner._MEMORIES
    gameplay.logger.warning.assert_called_once()


def test_the_observer_never_reads_even_own_private_hand_or_peek_fields(table_factory, monkeypatch):
    observe = PublicKnowledge.observe

    class PublicOnly(dict):
        def __getitem__(self, key):
            assert key not in {"hand", "deck", "private_peek", "private_peek_in_stock", "peek_information",
                               "opponent_hand", "achievement_evidence"}
            return super().__getitem__(key)

        def get(self, key, default=None):
            if key in self:
                return self[key]
            return default

    def guarded(memory, before, after):
        def public_view(view):
            return PublicOnly({**view, "players": [PublicOnly({**person, "hand": ["hearts-10"]})
                                                   for person in view["players"]]})

        return observe(memory, public_view(before), public_view(after))

    monkeypatch.setattr(PublicKnowledge, "observe", guarded)
    game = observation_trace(table_factory)
    assert decision(game)[0]["cards"] == ["hearts-K"]


def test_each_cpu_receives_its_own_projection_and_keeps_separate_knowledge(table_factory, monkeypatch):
    state = scenario([["hearts-6"], ["acorns-A"], ["leaves-8"]],
                     discard=["bells-7", "leaves-7"], current="p1")
    game = table_factory(state, cpu_ids=("p0", "p2"))
    observe, viewers = PublicKnowledge.observe, []

    def captured(memory, before, after):
        viewers.append(after["viewer_id"])
        assert "_hausdepp" not in after and all("hand" not in person for person in after["players"])
        assert before["viewer_id"] == after["viewer_id"]
        return observe(memory, before, after)

    monkeypatch.setattr(PublicKnowledge, "observe", captured)
    command(game, "p1", "pickup")
    assert viewers == ["p0", "p2"]
    first, second = [runner._memories_for(game)[actor].public for actor in ("p0", "p2")]
    assert first is not second and first._known == second._known == {"p1": {"bells-7", "leaves-7"}}
    first.clear()
    assert second._known == {"p1": {"bells-7", "leaves-7"}}


def test_private_and_foreign_poison_fields_never_change_knowledge_or_decision(table_factory, monkeypatch):
    original = engine.project_state

    def poisoned(state, viewer):
        view = original(state, viewer)
        return {**view, "players": [{**person, "hand": ["hearts-10"]} for person in view["players"]],
                "opponent_hand": ["hearts-10"], "deck": ["hearts-A"],
                "private_peek": ["hearts-K"], "achievement_evidence": {"opponent": "secret"}}

    monkeypatch.setattr(engine, "project_state", poisoned)
    game = observation_trace(table_factory)
    move, view, memory = decision(game)
    clean = original(game["_hausdepp"], "p0")
    assert memory.public.exact_hand(view, "p1") == memory.public.exact_hand(clean, "p1")
    assert choose_cpu_action(clean, memory=memory) == move
    assert move["cards"] == ["hearts-K"]


def test_context_replacement_new_round_roster_and_withdrawal_discard_prior_knowledge(table_factory):
    game = observation_trace(table_factory)
    _, _, memory = decision(game)
    recovered = dict(game)
    assert runner._memories_for(recovered)["p0"] is not memory
    current = runner._memories_for(game)["p0"]
    game["_hausdepp_tournament"] = {"round_number": 2}
    assert runner._memories_for(game)["p0"] is not current
    current = runner._memories_for(game)["p0"]
    game["_participants"][1]["user_id"] = 99
    assert runner._memories_for(game)["p0"] is not current
    current = runner._memories_for(game)["p0"]
    state = game["_hausdepp"]
    game["_hausdepp"] = engine.withdraw_player(state, "p1", version=state["version"])
    assert runner._memories_for(game)["p0"] is not current


def test_finish_and_fresh_stock_discard_observed_cards(table_factory):
    game = observation_trace(table_factory)
    _, _, memory = decision(game)
    command(game, "p0", "play", ["bells-6"])
    command(game, "p1", "play", ["bells-7", "leaves-7"])
    assert game["_finished"] and game["_id"] not in runner._MEMORIES
    before = scenario([["hearts-6", "hearts-K", "hearts-A"], ["bells-7"]],
                      discard=["leaves-7"], deck=["hearts-8"], current="p1")
    after = engine.apply_action(before, "p1", "pickup", version=before["version"])
    memory.public.observe(engine.project_state(before, "p0"), engine.project_state(after, "p0"))
    assert memory.public._known == {} and memory.public._position is None
