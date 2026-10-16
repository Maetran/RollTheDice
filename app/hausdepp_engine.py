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

from .hausdepp_achievement_evidence import new_evidence, record_transition

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
    """Shuffle and wait for the designated player's active bottom peek.

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
    return {
        "ruleset_version": HAUSDEPP_RULESET_VERSION,
        "phase": "peeking",
        "version": 1,
        "table_version": 1,
        "player_versions": {},
        "players": players,
        "achievement_evidence": new_evidence(players),
        "dealer_id": players[dealer_index]["id"],
        "current_player_id": peeker["id"],
        "deck": cards,
        "discard": [],
        "burned": [],
        "afterthrow": None,
        "pending_refill": None,
        "pending_refills": {},
        "finished_order": [],
        "loser_id": None,
        "peek_information": {"player_id": peeker["id"], "cards": [], "success": None, "complete": False},
        "deal": None,
        "last_event": {"type": "peek_required", "player_id": peeker["id"]},
    }


def _deal_after_peek(state: dict[str, Any], rng: Any = None) -> None:
    players = state["players"]
    dealer_index = next(i for i, player in enumerate(players) if player["id"] == state["dealer_id"])
    sequence = []
    for _ in range(3):
        for offset in range(1, len(players) + 1):
            player = players[(dealer_index + offset) % len(players)]
            if len(player["hand"]) < 3:
                sequence.append({"player_id": player["id"], "hand_index": len(player["hand"])})
                player["hand"].append(state["deck"].pop(0))
    random_source = rng if rng is not None else SystemRandom()
    initial_tens = 0
    while True:
        starter = state["deck"].pop(0)
        if card_rank(starter) != "10":
            break
        initial_tens += 1
        state["deck"].insert(random_source.randrange(len(state["deck"]) + 1), starter)
    state["discard"] = [starter]
    state["phase"] = "playing"
    state["current_player_id"] = players[(dealer_index + 1) % len(players)]["id"]
    state["deal"] = {"version": state["version"], "sequence": sequence, "starter": starter}
    state["last_event"] = {"type": "round_started", "initial_tens_reinserted": initial_tens}


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


def _refill_debts(state: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    if "pending_refills" in state:
        return state["pending_refills"]
    legacy = state.get("pending_refill")
    return {legacy["player_id"]: legacy} if legacy else {}


def _sync_refill_alias(state: dict[str, Any]) -> None:
    state["pending_refill"] = next(iter(state["pending_refills"].values()), None)


def _normalize_state(state: Mapping[str, Any]) -> dict[str, Any]:
    result = deepcopy(dict(state))
    if "pending_refills" not in result:
        result["pending_refills"] = _refill_debts(result)
        # A persisted v1 ordinary placement waited for its actor to draw.
        # Restore its next turn without taking or reserving any stock cards.
        debt = result.get("pending_refill")
        if debt and debt["continuation"] == "advance" and result["phase"] == "playing":
            result["current_player_id"] = _next_player(result, debt["player_id"])
            if debt.get("rank") is not None:
                result["afterthrow"] = {"player_id": debt["player_id"], "rank": debt["rank"]}
    result.setdefault("table_version", result["version"])
    result.setdefault("player_versions", {})
    result.setdefault("deal", None)
    _sync_refill_alias(result)
    return result


def _settle_finishes(state: dict[str, Any]) -> None:
    # The last stock card settles every slow player's empty hand, not just
    # the person whose draw or gamble exhausted the stock.
    if not state["deck"]:
        state["pending_refills"] = {}
        _sync_refill_alias(state)
        for player in state["players"]:
            if not player["hand"] and not player["finished"]:
                player["finished"] = True
                state["finished_order"].append(player["id"])
    active = [p for p in state["players"] if not p["finished"]]
    if len(active) == 1:
        state["phase"] = "finished"
        state["loser_id"] = active[0]["id"]
        state["current_player_id"] = None
        state["afterthrow"] = None
        state["pending_refill"] = None
        state["pending_refills"] = {}
        return
    following = state.get("afterthrow")
    if following and _find_player(state, following["player_id"])["finished"]:
        state["afterthrow"] = None
    current = _find_player(state, state.get("current_player_id"))
    if current and current["finished"]:
        state["current_player_id"] = _next_player(state, current["id"])


def _complete_placement(
    state: dict[str, Any], player: dict[str, Any], *, rank: str | None, replay: bool,
) -> None:
    _settle_finishes(state)
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
    """Record this hand's debt, while immediately releasing the next turn."""
    remaining = max(0, 3 - len(player["hand"]))
    if remaining and state["deck"]:
        state["pending_refills"][player["id"]] = {
            "player_id": player["id"], "remaining": min(remaining, len(state["deck"])),
            "continuation": "replay" if replay else "advance", "rank": rank,
        }
    else:
        state["pending_refills"].pop(player["id"], None)
    _sync_refill_alias(state)
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
    rng: Any = None,
) -> dict[str, Any]:
    """Apply play, pickup, gamble, afterthrow, or mandatory stock drawing.

    The server adapter must supply the client's ``version`` and serialize
    commands.  Rejected or stale commands never close an existing afterthrow
    opportunity; the next player's first *accepted* action closes it.
    """
    state = _normalize_state(state)
    if version is not None:
        required_version = state["player_versions"].get(actor_id, 1)
        if action != "draw":
            required_version = max(required_version, state["table_version"])
        if type(version) is not int or not required_version <= version <= state["version"]:
            raise HausdeppRuleError("hausdepp_stale_version")
    if state["phase"] == "finished":
        raise HausdeppRuleError("hausdepp_round_finished")
    actor = _find_player(state, actor_id)
    if actor is None or actor["finished"]:
        raise HausdeppRuleError("hausdepp_invalid_player")
    if action == "follow":
        action = "afterthrow"
    if action not in {"play", "pickup", "gamble", "afterthrow", "draw", "peek"}:
        raise HausdeppRuleError("hausdepp_invalid_action")
    if state["phase"] == "peeking":
        if action != "peek":
            raise HausdeppRuleError("hausdepp_peek_required")
        if actor_id != state["peek_information"]["player_id"]:
            raise HausdeppRuleError("hausdepp_not_your_turn")
    elif action == "peek":
        raise HausdeppRuleError("hausdepp_peek_complete")
    pending_refill = state["pending_refills"].get(actor_id)
    if action == "draw" and not pending_refill:
        raise HausdeppRuleError("hausdepp_no_refill_pending")
    first_refill = next(iter(state["pending_refills"]), None)
    if first_refill and (action == "gamble" or action == "draw" and first_refill != actor_id):
        raise HausdeppRuleError("hausdepp_stock_refill_wait")
    afterthrow = state.get("afterthrow")
    is_afterthrow = action == "afterthrow"
    if is_afterthrow:
        if not afterthrow or afterthrow["player_id"] != actor_id:
            raise HausdeppRuleError("hausdepp_afterthrow_expired")
    elif action != "draw" and state["current_player_id"] != actor_id:
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
    if action != "draw":
        result["afterthrow"] = None
    result["version"] += 1
    result["player_versions"][actor_id] = result["version"]
    if action != "draw":
        result["table_version"] = result["version"]
    event: dict[str, Any] = {"type": action, "player_id": actor_id}

    if action == "peek":
        peek = result["peek_information"]
        card = result["deck"][-1 - len(peek["cards"])]
        peek["cards"].append(card)
        rank = card_rank(card)
        if rank == "A":
            # No card IDs in the public event: even the stopper stays private.
            result["last_event"] = event
            return record_transition(state, result, actor_id, action, event)
        peek["complete"] = True
        peek["success"] = rank == "10"
        if peek["success"]:
            player["hand"].extend(peek["cards"])
            del result["deck"][-len(peek["cards"]):]
        _deal_after_peek(result, rng=rng)
        return record_transition(state, result, actor_id, action, event)

    if action == "draw":
        event["drawn_count"] = _refill(result, player)
        result["pending_refills"].pop(actor_id, None)
        _sync_refill_alias(result)
        # Drawing never changes turn ownership or revives an afterthrow that
        # expired while this player hesitated over their stock tap.
        _settle_finishes(result)
        result["last_event"] = event
        return record_transition(state, result, actor_id, action, event)

    if action == "pickup":
        event["picked_up_count"] = len(result["discard"])
        player["hand"].extend(result["discard"])
        result["discard"] = []
        event["drawn_count"] = 0
        _finish_or_request_refill(result, player, rank=None, replay=False)
        result["last_event"] = event
        return record_transition(state, result, actor_id, action, event)

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
            return record_transition(state, result, actor_id, action, event)
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
    return record_transition(state, result, actor_id, action, event)


def project_state(state: Mapping[str, Any], viewer_id: str | None) -> dict[str, Any]:
    """Build an explicit allowlist: no opponent hand or deck order escapes.

    Failed bottom-peek knowledge belongs only to the peeker, including after
    the round ends.  A successful peek is shown publicly.  Unknown viewers
    receive public information and no action permissions.
    """
    state = _normalize_state(state)
    viewer = _find_player(state, viewer_id)
    projection = {
        key: deepcopy(state[key])
        for key in (
            "ruleset_version", "phase", "version", "dealer_id", "current_player_id",
            "discard", "afterthrow", "finished_order", "loser_id", "last_event", "deal",
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
    projection["pending_refills"] = deepcopy(list(state["pending_refills"].values()))
    projection["pending_refill"] = deepcopy(state["pending_refills"].get(viewer_id)) if viewer else None
    first_refill = next(iter(state["pending_refills"]), None)
    projection["draw_required"] = bool(viewer and viewer_id in state["pending_refills"])
    projection["draw_urgent"] = bool(viewer and first_refill == viewer_id)
    projection["stock_blocked_by"] = first_refill if first_refill != viewer_id else None
    peek = state["peek_information"]
    projection["peek"] = {"player_id": peek["player_id"], "success": peek["success"],
                          "complete": peek.get("complete", True)}
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
    if not viewer or viewer["finished"]:
        return projection
    if state["phase"] == "peeking":
        if peek["player_id"] == viewer_id:
            projection["available_actions"] = ["peek"]
        return projection
    if state["phase"] != "playing":
        return projection
    refill = state["pending_refills"].get(viewer_id)
    if refill and first_refill == viewer_id:
        projection["available_actions"].append("draw")
    if state["current_player_id"] == viewer_id:
        projection["playable_cards"] = [card for card in viewer["hand"] if _legal_rank(state, card_rank(card))]
        if projection["playable_cards"]:
            projection["available_actions"].append("play")
        if state["discard"]:
            projection["available_actions"].append("pickup")
        if state["deck"] and not first_refill:
            projection["available_actions"].append("gamble")
    afterthrow = state.get("afterthrow")
    if afterthrow and afterthrow["player_id"] == viewer_id:
        matches = [card for card in viewer["hand"] if card_rank(card) == afterthrow["rank"]]
        if matches:
            projection["playable_cards"] = matches
            projection["available_actions"].append("afterthrow")
    return projection
