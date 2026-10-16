"""Pure, serializable rules for our 36-card Hausdepp house rules.

Deck index zero is the top; the final discard is the visible top card.  The
transport owns locking and persistence.  Every accepted command returns a new
state, while an invalid command leaves the caller's state entirely untouched.
Only :func:`project_state` may be sent to a player or a computer participant.
"""

from __future__ import annotations

from copy import deepcopy
from secrets import SystemRandom
from typing import Any, Final, Mapping, Sequence

HAUSDEPP_RULESET_VERSION: Final = "hausdepp-house-v1"
HAUSDEPP_RANKS: Final = ("6", "7", "8", "9", "U", "O", "K", "A", "10")
HAUSDEPP_SUITS: Final = ("hearts", "bells", "leaves", "acorns")
_RANK_VALUES: Final = {rank: index for index, rank in enumerate(HAUSDEPP_RANKS)}


class HausdeppRuleError(ValueError):
    """A rejected command with a stable machine-readable reason."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def make_deck() -> list[str]:
    """Return all 36 unique cards in a stable, unshuffled order."""
    return [f"{suit}-{rank}" for suit in HAUSDEPP_SUITS for rank in HAUSDEPP_RANKS]


def card_rank(card: str) -> str:
    if not isinstance(card, str) or card not in _CARD_SET:
        raise HausdeppRuleError("hausdepp_invalid_card")
    return card.rsplit("-", 1)[1]


def card_suit(card: str) -> str:
    card_rank(card)
    return card.rsplit("-", 1)[0]


_CARD_SET: Final = frozenset(make_deck())


def _players(participants: Sequence[str | Mapping[str, Any]]) -> list[dict[str, Any]]:
    if isinstance(participants, (str, bytes)) or not isinstance(participants, Sequence):
        raise HausdeppRuleError("hausdepp_invalid_players")
    result = []
    for participant in participants:
        if isinstance(participant, str):
            participant = {"id": participant, "name": participant}
        if not isinstance(participant, Mapping):
            raise HausdeppRuleError("hausdepp_invalid_players")
        player_id = participant.get("id")
        if not isinstance(player_id, str) or not player_id.strip():
            raise HausdeppRuleError("hausdepp_invalid_players")
        name = participant.get("name", player_id)
        if not isinstance(name, str):
            raise HausdeppRuleError("hausdepp_invalid_players")
        result.append({
            "id": player_id,
            "name": name,
            "is_cpu": bool(participant.get("is_cpu", False)),
            "hand": [],
            "finished": False,
        })
    if not 2 <= len(result) <= 6 or len({p["id"] for p in result}) != len(result):
        raise HausdeppRuleError("hausdepp_invalid_players")
    return result


def new_round(
    participants: Sequence[str | Mapping[str, Any]],
    dealer_index: int = 0,
    deck: Sequence[str] | None = None,
    rng: Any = None,
) -> dict[str, Any]:
    """Shuffle, perform the mandatory bottom peek, deal, and reveal a starter.

    ``deck`` is an optional complete preordered deck for deterministic tests;
    supplied decks are not shuffled.  ``rng`` may be a ``random.Random``-like
    object implementing ``shuffle`` and ``randrange``.  Live rounds use the
    operating system random source for shuffling and ten reinsertion.
    """
    players = _players(participants)
    if type(dealer_index) is not int or not 0 <= dealer_index < len(players):
        raise HausdeppRuleError("hausdepp_invalid_dealer")
    random_source = rng if rng is not None else SystemRandom()
    if deck is not None and (isinstance(deck, (str, bytes)) or not isinstance(deck, Sequence)):
        raise HausdeppRuleError("hausdepp_invalid_deck")
    cards = make_deck() if deck is None else list(deck)
    if len(cards) != 36 or any(not isinstance(card, str) for card in cards) or set(cards) != _CARD_SET:
        raise HausdeppRuleError("hausdepp_invalid_deck")
    if deck is None:
        random_source.shuffle(cards)

    peeker = players[(dealer_index - 1) % len(players)]
    inspected: list[str] = []
    success = False
    for card in reversed(cards):
        inspected.append(card)
        rank = card_rank(card)
        if rank == "10":
            success = True
            break
        if rank != "A":
            break
    if success:
        peeker["hand"].extend(inspected)
        del cards[-len(inspected):]

    # Deal clockwise in passes, starting immediately after the dealer.  A
    # successful peeker is skipped once their hand has at least three cards.
    for _ in range(3):
        for offset in range(1, len(players) + 1):
            player = players[(dealer_index + offset) % len(players)]
            if len(player["hand"]) < 3:
                player["hand"].append(cards.pop(0))

    initial_tens = 0
    while True:
        starter = cards.pop(0)
        if card_rank(starter) != "10":
            break
        initial_tens += 1
        cards.insert(random_source.randrange(len(cards) + 1), starter)

    return {
        "ruleset_version": HAUSDEPP_RULESET_VERSION,
        "phase": "playing",
        "version": 1,
        "players": players,
        "dealer_id": players[dealer_index]["id"],
        "current_player_id": players[(dealer_index + 1) % len(players)]["id"],
        "deck": cards,
        "discard": [starter],
        "burned": [],
        "afterthrow": None,
        "pending_refill": None,
        "finished_order": [],
        "loser_id": None,
        "peek_information": {"player_id": peeker["id"], "cards": inspected, "success": success},
        "last_event": {"type": "round_started", "initial_tens_reinserted": initial_tens},
    }


def _find_player(state: Mapping[str, Any], player_id: str) -> dict[str, Any] | None:
    return next((player for player in state["players"] if player["id"] == player_id), None)


def _next_player(state: Mapping[str, Any], previous_id: str) -> str:
    players = state["players"]
    index = next(index for index, player in enumerate(players) if player["id"] == previous_id)
    for offset in range(1, len(players) + 1):
        player = players[(index + offset) % len(players)]
        if not player["finished"]:
            return player["id"]
    raise HausdeppRuleError("hausdepp_invalid_state")


def _refill(state: dict[str, Any], player: dict[str, Any]) -> int:
    drawn = 0
    while len(player["hand"]) < 3 and state["deck"]:
        player["hand"].append(state["deck"].pop(0))
        drawn += 1
    return drawn


def _settle_finish(state: dict[str, Any], player: dict[str, Any]) -> None:
    # An empty hand can only qualify after mandatory drawing has finished.
    if not state["deck"] and not player["hand"] and not player["finished"]:
        player["finished"] = True
        state["finished_order"].append(player["id"])
    active = [p for p in state["players"] if not p["finished"]]
    if len(active) == 1:
        state["phase"] = "finished"
        state["loser_id"] = active[0]["id"]
        state["current_player_id"] = None
        state["afterthrow"] = None
        state["pending_refill"] = None


def _complete_placement(
    state: dict[str, Any], player: dict[str, Any], *, rank: str | None, replay: bool,
) -> None:
    _settle_finish(state, player)
    if state["phase"] != "playing":
        return
    if replay and not player["finished"]:
        state["current_player_id"] = player["id"]
    else:
        state["current_player_id"] = _next_player(state, player["id"])
        if rank is not None and not player["finished"]:
            state["afterthrow"] = {"player_id": player["id"], "rank": rank}


def _finish_or_request_refill(
    state: dict[str, Any], player: dict[str, Any], *, rank: str | None, replay: bool,
) -> None:
    """The player must tap the stock before the turn can continue or end."""
    remaining = max(0, 3 - len(player["hand"]))
    if remaining and state["deck"]:
        state["current_player_id"] = player["id"]
        state["pending_refill"] = {
            "player_id": player["id"], "remaining": min(remaining, len(state["deck"])),
            "continuation": "replay" if replay else "advance", "rank": rank,
        }
        return
    _complete_placement(state, player, rank=rank, replay=replay)


def _burn_reason(discard: Sequence[str]) -> str | None:
    if not discard:
        return None
    rank = card_rank(discard[-1])
    if rank == "10":
        return "ten"
    if len(discard) >= 4 and all(card_rank(card) == rank for card in discard[-4:]):
        return "four_of_a_kind"
    return None


def _legal_rank(state: Mapping[str, Any], rank: str) -> bool:
    return not state["discard"] or _RANK_VALUES[rank] >= _RANK_VALUES[card_rank(state["discard"][-1])]


def apply_action(
    state: Mapping[str, Any],
    actor_id: str,
    action: str,
    cards: Sequence[str] | None = None,
    version: int | None = None,
) -> dict[str, Any]:
    """Apply play, pickup, gamble, afterthrow, or mandatory stock drawing.

    The server adapter must supply the client's ``version`` and serialize
    commands.  Rejected or stale commands never close an existing afterthrow
    opportunity; the next player's first *accepted* action closes it.
    """
    if version is not None and (type(version) is not int or version != state["version"]):
        raise HausdeppRuleError("hausdepp_stale_version")
    if state["phase"] != "playing":
        raise HausdeppRuleError("hausdepp_round_finished")
    actor = _find_player(state, actor_id)
    if actor is None or actor["finished"]:
        raise HausdeppRuleError("hausdepp_invalid_player")
    if action == "follow":
        action = "afterthrow"
    if action not in {"play", "pickup", "gamble", "afterthrow", "draw"}:
        raise HausdeppRuleError("hausdepp_invalid_action")
    pending_refill = state.get("pending_refill")
    if pending_refill:
        if pending_refill["player_id"] != actor_id:
            raise HausdeppRuleError("hausdepp_refill_required")
        if action != "draw":
            raise HausdeppRuleError("hausdepp_refill_required")
    elif action == "draw":
        raise HausdeppRuleError("hausdepp_no_refill_pending")
    afterthrow = state.get("afterthrow")
    is_afterthrow = action == "afterthrow"
    if is_afterthrow:
        if not afterthrow or afterthrow["player_id"] != actor_id:
            raise HausdeppRuleError("hausdepp_afterthrow_expired")
    elif state["current_player_id"] != actor_id:
        raise HausdeppRuleError("hausdepp_not_your_turn")

    if cards is not None and (isinstance(cards, (str, bytes)) or not isinstance(cards, Sequence)):
        raise HausdeppRuleError("hausdepp_invalid_selection")
    selection = list(cards) if cards is not None else []
    if action in {"play", "afterthrow"}:
        if not selection or any(not isinstance(card, str) for card in selection):
            raise HausdeppRuleError("hausdepp_invalid_selection")
        if len(set(selection)) != len(selection) or any(card not in actor["hand"] for card in selection):
            raise HausdeppRuleError("hausdepp_invalid_selection")
        ranks = {card_rank(card) for card in selection}
        if len(ranks) != 1:
            raise HausdeppRuleError("hausdepp_mixed_ranks")
        rank = ranks.pop()
        if is_afterthrow and rank != afterthrow["rank"]:
            raise HausdeppRuleError("hausdepp_afterthrow_wrong_rank")
        if not _legal_rank(state, rank):
            raise HausdeppRuleError("hausdepp_rank_too_low")
    elif selection:
        raise HausdeppRuleError("hausdepp_unexpected_cards")
    if action == "pickup" and not state["discard"]:
        raise HausdeppRuleError("hausdepp_empty_discard")
    if action == "gamble" and not state["deck"]:
        raise HausdeppRuleError("hausdepp_empty_deck")

    result = deepcopy(dict(state))
    player = _find_player(result, actor_id)
    result["afterthrow"] = None
    result["version"] += 1
    event: dict[str, Any] = {"type": action, "player_id": actor_id}

    if action == "draw":
        refill = result["pending_refill"]
        event["drawn_count"] = _refill(result, player)
        result["pending_refill"] = None
        _complete_placement(result, player, rank=refill["rank"], replay=refill["continuation"] == "replay")
        result["last_event"] = event
        return result

    if action == "pickup":
        event["picked_up_count"] = len(result["discard"])
        player["hand"].extend(result["discard"])
        result["discard"] = []
        event["drawn_count"] = 0
        _finish_or_request_refill(result, player, rank=None, replay=False)
        result["last_event"] = event
        return result

    if action == "gamble":
        selection = [result["deck"].pop(0)]
        rank = card_rank(selection[0])
        legal = _legal_rank(result, rank)
        result["discard"].extend(selection)
        event["cards"] = selection
        event["success"] = legal
        if not legal:
            event["picked_up_count"] = len(result["discard"])
            player["hand"].extend(result["discard"])
            result["discard"] = []
            event["drawn_count"] = 0
            _finish_or_request_refill(result, player, rank=None, replay=False)
            result["last_event"] = event
            return result
    else:
        for card in selection:
            player["hand"].remove(card)
        result["discard"].extend(selection)
        event["cards"] = selection

    burn_reason = _burn_reason(result["discard"])
    if burn_reason:
        event["burn_reason"] = burn_reason
        event["burned_count"] = len(result["discard"])
        result["burned"].extend(result["discard"])
        result["discard"] = []
    event["drawn_count"] = 0
    _finish_or_request_refill(result, player, rank=rank, replay=bool(burn_reason))
    result["last_event"] = event
    return result


def project_state(state: Mapping[str, Any], viewer_id: str | None) -> dict[str, Any]:
    """Build an explicit allowlist: no opponent hand or deck order escapes.

    Failed bottom-peek knowledge belongs only to the peeker, including after
    the round ends.  A successful peek is shown publicly.  Unknown viewers
    receive public information and no action permissions.
    """
    viewer = _find_player(state, viewer_id)
    projection = {
        key: deepcopy(state[key])
        for key in (
            "ruleset_version", "phase", "version", "dealer_id", "current_player_id",
            "discard", "afterthrow", "pending_refill", "finished_order", "loser_id", "last_event",
        )
    }
    projection["viewer_id"] = viewer_id if viewer else None
    projection["hand"] = list(viewer["hand"]) if viewer else []
    projection["players"] = [
        {
            "id": player["id"], "name": player["name"], "is_cpu": player["is_cpu"],
            "hand_count": len(player["hand"]), "finished": player["finished"],
        }
        for player in state["players"]
    ]
    projection["deck_count"] = len(state["deck"])
    projection["burned_count"] = len(state["burned"])
    peek = state["peek_information"]
    projection["peek"] = {"player_id": peek["player_id"], "success": peek["success"]}
    if peek["success"]:
        projection["peek"]["cards"] = list(peek["cards"])
    private_peek = list(peek["cards"]) if viewer and viewer_id == peek["player_id"] else []
    projection["private_peek"] = private_peek
    projection["peek_information"] = {
        **projection["peek"],
        "cards": list(peek["cards"]) if peek["success"] else private_peek,
    }
    projection["available_actions"] = []
    projection["playable_cards"] = []
    if not viewer or viewer["finished"] or state["phase"] != "playing":
        return projection
    refill = state.get("pending_refill")
    if refill:
        if refill["player_id"] == viewer_id:
            projection["available_actions"] = ["draw"]
        return projection
    if state["current_player_id"] == viewer_id:
        projection["playable_cards"] = [card for card in viewer["hand"] if _legal_rank(state, card_rank(card))]
        if projection["playable_cards"]:
            projection["available_actions"].append("play")
        if state["discard"]:
            projection["available_actions"].append("pickup")
        if state["deck"]:
            projection["available_actions"].append("gamble")
    afterthrow = state.get("afterthrow")
    if afterthrow and afterthrow["player_id"] == viewer_id:
        matches = [card for card in viewer["hand"] if card_rank(card) == afterthrow["rank"]]
        if matches:
            projection["playable_cards"] = matches
            projection["available_actions"].append("afterthrow")
    return projection
