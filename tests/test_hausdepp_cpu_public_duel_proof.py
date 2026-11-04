"""Exhaust the real-engine replies behind one narrow public-duel inference."""

import os
from collections import defaultdict
from itertools import chain, combinations

from app.hausdepp_cpu_strategy import _proven_duel_low_lead
from app.hausdepp_engine import HAUSDEPP_RANKS, apply_action, card_rank, make_deck, project_state
from tests.test_hausdepp_engine import scenario


def _commands(state, actor):
    view = project_state(state, actor)
    result = []
    for action in view["available_actions"]:
        if action == "pickup":
            result.append((action, None))
        elif action in {"play", "afterthrow"}:
            groups = defaultdict(list)
            for card in view["playable_cards"]:
                groups[card_rank(card)].append(card)
            for group in groups.values():
                for size in range(1, len(group) + 1):
                    result.extend((action, list(cards)) for cards in combinations(group, size))
            # Optional four-of-a-kind groups may be legal even below the top.
            for group in view.get("playable_groups", ()):
                command = (action, list(group))
                if command not in result:
                    result.append(command)
    return result


def _every_reply_loses(state):
    if state["phase"] == "finished":
        return state["loser_id"] == "p1"
    if state["current_player_id"] == "p0":
        # The opponent may legally get matching afterthrows in before our ace.
        for action, cards in _commands(state, "p1"):
            assert action == "afterthrow"
            after = apply_action(state, "p1", action, cards=cards, version=state["version"])
            if not _every_reply_loses(after):
                return False
        if "hearts-A" not in project_state(state, "p0")["playable_cards"]:
            return False
        return _every_reply_loses(apply_action(state, "p0", "play", cards=["hearts-A"], version=state["version"]))
    commands = _commands(state, "p1")
    assert commands
    return all(_every_reply_loses(apply_action(state, "p1", action, cards=cards, version=state["version"]))
               for action, cards in commands)


def test_public_low_lead_survives_every_reply_across_rank_shapes_and_house_rules():
    """Represent physical suits by rank shape; all rules depend only on rank.

    At least two pairwise distinct known non-ten ranks exclude our low rank;
    up to two other cards are unknown. The opponent may play subsets, ten
    chains, pickup voluntarily, or afterthrow before our final ace.
    """
    # The full proof explores over 80,000 starting hands and can take several
    # minutes. Run it explicitly with ROLLTHEDICE_EXHAUSTIVE_PUBLIC_PROOF=1;
    # the normal suite retains representative real-engine rank shapes.
    exhaustive = os.environ.get("ROLLTHEDICE_EXHAUSTIVE_PUBLIC_PROOF") == "1"
    deck = make_deck()
    checked = 0
    lows = HAUSDEPP_RANKS[:-2] if exhaustive else ("6", "U", "K")
    for low in lows:
        own = [f"hearts-{low}", "hearts-A"]
        known_ranks = [rank for rank in HAUSDEPP_RANKS[:-1] if rank != low]
        selections = (chain.from_iterable(combinations(known_ranks, size) for size in range(2, len(known_ranks) + 1))
                      if exhaustive else (known_ranks[:2], known_ranks[-2:], known_ranks[:3]))
        for selected_ranks in selections:
            known = []
            for rank in selected_ranks:
                known.append(next(card for card in deck if card_rank(card) == rank and card not in own + known))
            unseen = [card for card in deck if card not in own + known]
            # Suits carry no rank/clearance semantics; one physical example of
            # every feasible rank multiset is enough, including repeated ranks.
            representatives = {(): ()}
            for size in (1, 2):
                for hidden in combinations(unseen, size):
                    ranks = tuple(sorted((card_rank(card) for card in hidden), key=HAUSDEPP_RANKS.index))
                    representatives.setdefault(ranks, hidden)
            for wild in (False, True):
                for hidden in representatives.values():
                    assert _proven_duel_low_lead(own, [], tuple(known), len(hidden))
                    state = scenario([own, [*known, *hidden]], current="p0")
                    state["four_of_a_kind_as_ten"] = wild
                    state = apply_action(state, "p0", "play", cards=[own[0]], version=state["version"])
                    assert _every_reply_loses(state), (own, known, hidden, wild)
                    checked += 1
    assert checked >= (80_000 if exhaustive else 500)
