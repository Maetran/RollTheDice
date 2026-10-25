"""Bounded, private evidence from accepted Hausdepp engine transitions.

This is persisted engine state, never a player/CPU projection or an event log.
Account services consume only each player's ``flags`` and ``ten_clears`` after
a round has completed. Missing evidence on an old round is deliberately
incomplete: observed events count, but an unknown past cannot prove a negative.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence


def new_evidence(players: Sequence[Mapping[str, Any]], *, complete: bool = True) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "complete": complete,
        "players": {player["id"]: {
            "flags": [], "ten_clears": 0, "tens": [], "failed_gambles": 0,
            "max_hand": 0, "terminal": None,
            "pickups": 0, "pickups_known": complete, "max_pile_take": 0,
            "late_pile_take": 0, "quartet_clears": 0, "stock_comeback": False,
        } for player in players},
        "pile": [], "window": None, "clear_chain": None,
    }


def _rank(card: str) -> str:
    return card.rsplit("-", 1)[1]


def _award(player: dict[str, Any], *numbers: int) -> None:
    player["flags"] = sorted(set(player["flags"]).union(f"hausdepp_{number:02d}" for number in numbers))


def _observe_hands(evidence: dict[str, Any], state: Mapping[str, Any]) -> None:
    for player in state["players"]:
        facts = evidence["players"][player["id"]]
        facts["max_hand"] = max(facts["max_hand"], min(36, len(player["hand"])))
        if facts["max_hand"] >= 18:
            _award(facts, 53)
        if player["hand"]:
            facts["terminal"] = None


def _record_finishes(evidence: dict[str, Any], before: Mapping[str, Any], after: Mapping[str, Any]) -> None:
    previous = {player["id"]: player for player in before["players"]}
    for player in after["players"]:
        if not player["finished"] or previous[player["id"]]["finished"]:
            continue
        facts = evidence["players"][player["id"]]
        terminal = facts.get("terminal")
        if terminal:
            if terminal["single"] and terminal["rank"] == "6":
                _award(facts, 58)
            if terminal["single"] and terminal["rank"] == "10":
                _award(facts, 59)
            if terminal["three"]:
                _award(facts, 60)
            if terminal["after_ten"]:
                _award(facts, 61)
            if terminal.get("four_kings"):
                _award(facts, 79)
            if terminal.get("multi_ten"):
                _award(facts, 81)
            # Terminals saved before this marker existed stay unknown/False.
            if terminal["single"] and terminal.get("quartet_finish"):
                _award(facts, 138)
        if evidence["complete"] and not facts["tens"]:
            _award(facts, 62)
        if facts["max_hand"] >= 12:
            _award(facts, 63)
        if facts["failed_gambles"] >= 2:
            _award(facts, 64)
        if facts["max_hand"] >= 18:
            _award(facts, 65)
        if facts["max_hand"] >= 24:
            _award(facts, 66)
        if facts["late_pile_take"] >= 12 or "hausdepp_55" in facts["flags"]:
            _award(facts, 67)
        if facts["max_pile_take"] >= 16:
            _award(facts, 68)
        if facts["failed_gambles"] >= 3:
            _award(facts, 69)
        if "hausdepp_54" in facts["flags"]:
            _award(facts, 70)
        if "hausdepp_51" in facts["flags"]:
            _award(facts, 71)
        if facts["stock_comeback"]:
            _award(facts, 72)
        if facts["pickups"] >= 3:
            _award(facts, 73)
        if evidence["complete"] and not facts["tens"]:
            if facts["failed_gambles"] >= 3:
                _award(facts, 74)
            if facts["max_hand"] >= 18:
                _award(facts, 75)
        if facts["max_hand"] >= 12 and sum(not item["finished"] for item in before["players"]) == 2:
            _award(facts, 76)
        if facts["pickups_known"] and not facts["pickups"]:
            _award(facts, 84)


def record_transition(
    before: Mapping[str, Any], after: dict[str, Any], actor_id: str, action: str,
    event: Mapping[str, Any],
) -> dict[str, Any]:
    """Attach evidence to an already accepted new state and return that state.

    The engine calls this only after validation and gameplay mutation. ``after``
    is its private deep copy, so neither accepted nor rejected calls mutate the
    caller's state. No hidden information is added to ``event``.
    """
    evidence = after.get("achievement_evidence")
    if not evidence or evidence.get("schema_version") != 1:
        evidence = new_evidence(before["players"], complete=False)
        after["achievement_evidence"] = evidence
    for facts in evidence["players"].values():
        # Earlier v1 evidence did not record small voluntary pickups. Unknown
        # history cannot establish the new negative "no pickup" condition.
        for key, default in (("pickups", 0), ("pickups_known", False), ("max_pile_take", 0),
                             ("late_pile_take", 0), ("quartet_clears", 0), ("stock_comeback", False)):
            facts.setdefault(key, default)
    _observe_hands(evidence, before)
    facts = evidence["players"][actor_id]
    old_player = next(player for player in before["players"] if player["id"] == actor_id)
    player = next(player for player in after["players"] if player["id"] == actor_id)
    cards = list(event.get("cards", []))
    chain = evidence["clear_chain"]
    # A slow refill never interrupts another player's earned continuation.
    if action in {"play", "afterthrow", "gamble", "pickup"} and chain and chain["player_id"] != actor_id:
        evidence["clear_chain"] = None
        chain = None

    if action == "peek":
        peek = after["peek_information"]
        if peek.get("complete"):
            aces = sum(_rank(card) == "A" for card in peek["cards"])
            if peek["success"]:
                _award(facts, 17 if not aces else 18 if aces == 1 else 19)
            elif aces:
                _award(facts, 20)
    elif action == "draw":
        window = evidence["window"]
        opportunity = before.get("afterthrow")
        if window and window["player_id"] == actor_id and opportunity and opportunity["player_id"] == actor_id:
            drawn = [card for card in player["hand"] if card not in old_player["hand"]]
            if drawn:
                window["fresh"] = list(dict.fromkeys([*window["fresh"], *drawn]))[-3:]
                window["refills"] = min(3, window["refills"] + 1)
                window["three"] = False
                window["four_kings"] = False
    elif action == "pickup" or action == "gamble" and not event.get("success"):
        if action == "gamble":
            facts["failed_gambles"] = min(3, facts["failed_gambles"] + 1)
            _award(facts, 49)
            if facts["failed_gambles"] >= 2:
                _award(facts, 50)
            if before["discard"] and _rank(before["discard"][-1]) == "A" and _rank(cards[0]) == "6":
                _award(facts, 51)
            if len(before["deck"]) == 1:
                _award(facts, 54)
        picked_up = event.get("picked_up_count", 0)
        facts["pickups"] = min(3, facts["pickups"] + 1)
        facts["max_pile_take"] = max(facts["max_pile_take"], min(36, picked_up))
        if not before["deck"]:
            facts["late_pile_take"] = max(facts["late_pile_take"], min(36, picked_up))
        if picked_up >= 12:
            _award(facts, 52)
            if not before["deck"]:
                _award(facts, 55)
        evidence["pile"] = []
        evidence["window"] = None
        evidence["clear_chain"] = None
    elif action in {"play", "afterthrow", "gamble"}:
        _record_placement(evidence, before, after, actor_id, action, event, cards, old_player, player, chain)

    _observe_hands(evidence, after)
    if before["deck"] and not after["deck"]:
        active = [item for item in after["players"] if not item["finished"]]
        if len(active) >= 2:
            for item in active:
                if all(len(item["hand"]) >= len(other["hand"]) + 6 for other in active if other["id"] != item["id"]):
                    evidence["players"][item["id"]]["stock_comeback"] = True
    _record_finishes(evidence, before, after)
    return after


def _record_placement(
    evidence: dict[str, Any], before: Mapping[str, Any], after: Mapping[str, Any],
    actor_id: str, action: str, event: Mapping[str, Any], cards: list[str],
    old_player: Mapping[str, Any], player: Mapping[str, Any], chain: dict[str, Any] | None,
) -> None:
    facts = evidence["players"][actor_id]
    rank = _rank(cards[0])
    if action == "gamble":
        if not before["discard"]:
            _award(facts, 23)
            if len(old_player["hand"]) >= 3 and all(_rank(card) == "A" for card in old_player["hand"]):
                _award(facts, 24)
            if chain and chain["last_reason"] == "ten":
                _award(facts, 30)
        else:
            top = _rank(before["discard"][-1])
            if top == rank:
                _award(facts, 21)
            if top == "A":
                _award(facts, 22)
            if top == "K" and rank in {"A", "10"}:
                _award(facts, 83)

    window = evidence["window"]
    if action != "afterthrow" or not window or window["player_id"] != actor_id or window["rank"] != rank:
        window = {
            "player_id": actor_id, "rank": rank, "count": 0, "afterthrows": 0,
            "fresh": [], "refills": 0, "last_fresh_refill": 0, "fresh_throws": 0,
            "three": action != "gamble" and len(old_player["hand"]) == 3
            and all(_rank(card) == rank for card in old_player["hand"]),
            "four_kings": action != "gamble" and len(old_player["hand"]) == 4
            and all(_rank(card) == "K" for card in old_player["hand"]),
        }
        evidence["window"] = window
    fresh_throw = action == "afterthrow" and any(card in window["fresh"] for card in cards)
    if action == "afterthrow":
        _award(facts, 41)
        window["afterthrows"] = min(2, window["afterthrows"] + 1)
        if window["afterthrows"] >= 2:
            _award(facts, 43)
        if fresh_throw:
            _award(facts, 42)
            if window["refills"] != window["last_fresh_refill"]:
                window["fresh_throws"] = min(2, window["fresh_throws"] + 1)
                window["last_fresh_refill"] = window["refills"]
            if window["fresh_throws"] >= 2:
                _award(facts, 44)
    window["fresh"] = [card for card in window["fresh"] if card not in cards]
    window["count"] = min(4, window["count"] + len(cards))
    if action != "gamble" and window["count"] >= 2:
        _award(facts, 45)
    if action != "gamble" and window["count"] >= 3:
        _award(facts, 46)

    pile = evidence["pile"]
    # Old rounds can have an unknown top run. Preserve unknown provenance rather
    # than attribute an existing card to the next actor who happens to match it.
    top_run = []
    for card in reversed(before["discard"]):
        if _rank(card) != rank:
            break
        top_run.insert(0, card)
    if [entry["card"] for entry in pile] != top_run[-4:]:
        pile = [{"card": card, "player_id": None} for card in top_run[-4:]]
    pile = [*pile, *({"card": card, "player_id": actor_id} for card in cards)][-4:]
    evidence["pile"] = pile

    if rank == "10":
        facts["tens"] = sorted(set(facts["tens"]).union(cards))
        if len(facts["tens"]) >= 4:
            _award(facts, 32)
    reason = event.get("burn_reason")
    ten_only_finish = bool(reason == "ten" and not before["deck"] and (
        chain.get("ten_only_finish") if chain else
        len(old_player["hand"]) >= 2 and all(_rank(card) == "10" for card in old_player["hand"])
    ))
    quartet_finish = False
    if reason:
        count = min(3, chain["count"] + 1) if chain else 1
        # The chain belongs to this actor: any other player's accepted card
        # action or pickup has already reset it (refill draws do not).
        if chain and chain["player_id"] == actor_id and (chain["last_reason"] == "ten") != (reason == "ten"):
            _award(facts, 137)
        if count >= 2:
            _award(facts, 47)
        if count >= 3:
            _award(facts, 48)
        if reason == "ten":
            facts["ten_clears"] = min(4, facts["ten_clears"] + 1)
            _award(facts, 25)
            if action == "gamble":
                _award(facts, 26)
            if event["burned_count"] >= 10:
                _award(facts, 27)
            if event["burned_count"] >= 16:
                _award(facts, 28)
            if chain and chain["last_reason"] == "ten":
                _award(facts, 31)
        else:
            facts["quartet_clears"] = min(2, facts["quartet_clears"] + 1)
            _award(facts, 33)
            if facts["quartet_clears"] >= 2:
                _award(facts, 80)
            if window["count"] == 4 and action != "gamble" and all(entry["player_id"] == actor_id for entry in pile):
                _award(facts, 34)
            origins = [entry["player_id"] for entry in pile]
            if all(origin is not None and origin != actor_id for origin in origins[:3]):
                _award(facts, 35)
            if None not in origins and len(set(origins)) == 4:
                _award(facts, 36)
            # Unknown legacy provenance (None) never counts as another player.
            quartet_finish = not before["deck"] and any(
                origin is not None and origin != actor_id for origin in origins[:3])
            if rank == "6":
                _award(facts, 37)
            if rank == "A":
                _award(facts, 38)
            if rank == "U":
                _award(facts, 77)
            if rank == "O":
                _award(facts, 78)
            if fresh_throw:
                _award(facts, 39)
            if action == "gamble":
                _award(facts, 40)
        evidence["clear_chain"] = {
            "player_id": actor_id, "count": count, "last_reason": reason,
            "empty_stock_ten": reason == "ten" and not before["deck"],
            "ten_only_finish": ten_only_finish,
        }
        evidence["pile"] = []
        if facts["ten_clears"] and facts["quartet_clears"]:
            _award(facts, 82)

    if action != "gamble" and not player["hand"]:
        facts["terminal"] = {
            "rank": rank, "single": len(old_player["hand"]) == len(cards) == 1,
            "three": window["three"] and window["count"] == 3,
            "after_ten": bool(chain and chain["empty_stock_ten"]),
            "four_kings": bool(window.get("four_kings") and window["count"] == 4),
            "multi_ten": ten_only_finish,
            "quartet_finish": quartet_finish,
        }
