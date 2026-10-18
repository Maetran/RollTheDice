"""Bounded private collection facts from an accepted tabletop activation.

Cosmetic events never change engine state. These facts are credited only through
the normal, validated completed-round result, never by a browser or a preview.
"""

from __future__ import annotations

from copy import deepcopy

SURPRISE_EFFECTS = ("star", "hammer", "ufo", "portal", "dragon", "kraken", "clock", "blackhole")
_COLLECTION_KEY = "_hausdepp_surprise_collection"


def _human_ids(game: dict) -> set[str]:
    return {player["id"] for player in game.get("_participants", [])
            if isinstance(player.get("id"), str) and player["id"]
            and not player.get("is_cpu") and player.get("type") != "cpu"}


def record_surprise_collection(game: dict, actor_id: str, effect: str, round_number: int) -> None:
    """Called under the claim lock, after the real human activation is accepted."""
    connected = {player.get("id") for player in game.get("_players", []) if player.get("ws") is not None}
    witnesses = sorted(_human_ids(game).intersection(connected))
    if (type(round_number) is not int or round_number < 1 or effect not in SURPRISE_EFFECTS
            or actor_id not in witnesses or not 2 <= len(witnesses) <= 6):
        game.pop(_COLLECTION_KEY, None)
        return
    # Multiple sockets for one account cannot turn a solo table into a social
    # round. Guests may be real humans too; only account services award points.
    accounts = [player.get("user_id") for player in game.get("_participants", [])
                if player.get("id") in witnesses and player.get("user_id") is not None]
    if len(accounts) != len(set(accounts)):
        game.pop(_COLLECTION_KEY, None)
        return
    game[_COLLECTION_KEY] = {
        "round_number": round_number,
        "players": {player_id: {"activated": [effect] if player_id == actor_id else [], "witnessed": [effect]}
                    for player_id in witnesses},
    }


def surprise_collection_evidence(game: dict, round_number: int) -> dict[str, dict[str, list[str]]]:
    """Return only an intact current-round claim; never reinterpret old events.

    Connection state is deliberately not checked again: a later disconnect does
    not erase something the player already experienced at the shared table.
    """
    raw = game.get(_COLLECTION_KEY)
    if (type(round_number) is not int or not isinstance(raw, dict)
            or type(raw.get("round_number")) is not int or raw["round_number"] != round_number):
        return {}
    players = raw.get("players")
    if (not isinstance(players, dict) or not 2 <= len(players) <= 6
            or not set(players).issubset(_human_ids(game))):
        return {}
    actors = 0
    effects = set()
    for facts in players.values():
        if not isinstance(facts, dict) or set(facts) != {"activated", "witnessed"}:
            return {}
        activated, witnessed = facts["activated"], facts["witnessed"]
        if (not isinstance(activated, list) or len(activated) > 1
                or not isinstance(witnessed, list) or len(witnessed) != 1
                or any(not isinstance(effect, str) or effect not in SURPRISE_EFFECTS
                       for effect in [*activated, *witnessed])
                or not set(activated).issubset(witnessed)):
            return {}
        actors += bool(activated)
        effects.update(witnessed)
    if actors != 1 or len(effects) != 1:
        return {}
    return deepcopy(players)
