"""Engine proof: finished empty seats are inert in the bounded final duel.

This checks legal replies and the remaining Hausdepp, not equal overall ranks:
previous finishers correctly remain a prefix of the finishing order.
"""

from copy import deepcopy
from itertools import combinations

import pytest

from app import hausdepp_engine as engine
from app.hausdepp_cpu_strategy import choose_cpu_action
from tests.test_hausdepp_cpu_knowledge import legal_commands
from tests.test_hausdepp_engine import scenario


def advance(state, actor, action, cards=None):
    original = deepcopy(state)
    result = engine.apply_action(state, actor, action, cards=cards, version=state["version"])
    assert state == original and result["version"] == state["version"] + 1
    cards_in_game = result["deck"] + result["discard"] + result["burned"] + [
        card for person in result["players"] for card in person["hand"]]
    assert len(cards_in_game) == len(set(cards_in_game)) == 36
    assert set(cards_in_game) == set(engine.make_deck())
    return result


def finish_after_every_optional_reply(state, reserve, prior_finishers):
    finished = advance(state, "p0", "play", [reserve])
    assert finished["phase"] == "finished" and finished["loser_id"] == "p1"
    assert finished["finished_order"] == [*prior_finishers, "p0"]
    branches = 1
    for action, cards in legal_commands(state, "p1"):
        assert action == "afterthrow"
        after = advance(state, "p1", action, cards)
        assert after["phase"] == "playing"
        branches += finish_after_every_optional_reply(after, reserve, prior_finishers)
    return branches


@pytest.mark.parametrize("seats", [3, 4, 6])
def test_all_seventy_blocks_win_with_finished_empty_seats_between_the_active_players(seats):
    patterns = branches = 0
    for low_rank, pair_rank, block_rank, reserve_rank in combinations(engine.HAUSDEPP_RANKS[:-1], 4):
        low, block, reserve = [f"hearts-{rank}" for rank in (low_rank, block_rank, reserve_rank)]
        pair = [f"bells-{pair_rank}", f"leaves-{pair_rank}"]
        state = scenario([[low, block, reserve], pair, *([] for _ in range(seats - 2))])
        # Cross every inactive seat before reaching the sole opposing player.
        state["players"] = [state["players"][0], *state["players"][2:], state["players"][1]]
        prior_finishers = list(state["finished_order"])
        assert state["deck"] == state["discard"] == [] and state["afterthrow"] is None
        assert not state.get("withdrawn_ids") and not state.get("pending_refills")
        assert len([person for person in state["players"] if not person["finished"]]) == 2
        assert all(not person["hand"] for person in state["players"] if person["finished"])
        assert choose_cpu_action(engine.project_state(state, "p0"))["cards"] == [low]
        baseline = advance(state, "p0", "play", [low])
        lost = advance(baseline, "p1", "play", pair)
        assert lost["phase"] == "finished" and lost["loser_id"] == "p0"

        blocked = advance(state, "p0", "play", [block])
        assert legal_commands(blocked, "p1") == [("pickup", None)]
        picked = advance(blocked, "p1", "pickup")
        assert picked["last_event"]["picked_up_count"] == 1
        after_low = advance(picked, "p0", "play", [low])
        replies = 0
        for action, cards in legal_commands(after_low, "p1"):
            reply = advance(after_low, "p1", action, cards)
            assert reply["phase"] == "playing"
            replies += finish_after_every_optional_reply(reply, reserve, prior_finishers)
        assert replies == 7
        branches += replies
        patterns += 1
    assert patterns == 70 and branches == 490
