"""Small, authoritative cosmetic objects shared by a Hausdepp table's viewers.

Coordinates and motion stay local. Only validated gestures change these bounded
round facts; the card engine, turn version, awards and gameplay clock are untouched.
"""

from __future__ import annotations

import time
from copy import deepcopy
from functools import lru_cache
from secrets import SystemRandom

from .auth import resolve_session
from .game_realtime import broadcast
from .game_state import multiplayer_pause_reason
from .game_types import game_type_from_state
from .hausdepp_gameplay import game_lock

HAUSDEPP_PROP_ACTIONS = frozenset({"hausdepp_table_prop"})
_STATE_KEY = "_hausdepp_table_props"
_RANDOM = SystemRandom()
_LARGE = ("beer", "can", "nuts", "marend", "dice", "tea", "chips", "flips", "pretzel", "sweets", "lantern", "lemonade")
_SCATTER = ("cap", "opener", "praline-gold", "praline-red", "die", "loose-nuts", "loose-chips", "loose-flips", "coin", "coaster", "pencil")
_DUPLICATES = {"lemonade": ("opener", "cap"), "dice": ("die",), "sweets": ("praline-gold", "praline-red"),
               "chips": ("loose-chips",), "flips": ("loose-flips",), "nuts": ("loose-nuts",)}
_PORTIONS = {"nuts": 16, "chips": 10, "flips": 12, "sweets": 14, "marend": 10, "pretzel": 6,
             "loose-nuts": 3, "loose-chips": 2, "loose-flips": 2, "praline-gold": 1, "praline-red": 1}
_DRINKS = frozenset({"beer", "tea", "lemonade"})
_MAX_REVISION = 2**31 - 1
_RECENT_LIMIT = 128


def _now_ms() -> int:
    return int(time.time() * 1000)


def _round_number(game: dict) -> int:
    value = (game.get("_hausdepp_tournament") or {}).get("round_number", 1)
    return value if type(value) is int and 1 <= value <= 48 else 1


def _random_for(key: str):
    seed = 2166136261
    for letter in key:
        seed = ((seed ^ ord(letter)) * 16777619) & 0xFFFFFFFF

    def random():
        nonlocal seed
        seed ^= (seed << 13) & 0xFFFFFFFF
        seed ^= seed >> 17
        seed ^= (seed << 5) & 0xFFFFFFFF
        return (seed & 0xFFFFFFFF) / 4294967296

    return random


@lru_cache(maxsize=512)
def _layout(game_id: str, round_number: int) -> dict:
    # Keep the established renderer's PRNG sequence, including its candidate
    # positions. The server owns object identity, never the display coordinates.
    random = _random_for(f"{game_id}:{round_number}")
    count, scatter_count = 4 + int(random() * 3), 4 + int(random() * 3)
    for spot in range(64):
        if spot % 3:
            random()
        random()
        random()
    for _ in range(64):
        random()
    props = sorted(_LARGE, key=lambda _item: random())
    scatter = sorted(_SCATTER, key=lambda _item: random())
    return {"props": props, "scatter": scatter, "count": count, "scatter_count": scatter_count}


def initial_layout(game_id: str, round_number: int) -> dict:
    return deepcopy(_layout(str(game_id), round_number))


def _offered_ids(layout: dict) -> set[str]:
    result = set(layout["props"][:layout["count"]])
    # These are the existing portrait, landscape, tablet and desktop limits.
    # A rare prop can occupy one scatter slot; its later consumption only
    # reveals a prefix of the already permitted ordinary objects.
    for large_count, small_count in ((1, 3), (2, 2), (3, layout["scatter_count"] - 1),
                                     (layout["count"], layout["scatter_count"])):
        hidden = {item for prop in layout["props"][:large_count] for item in _DUPLICATES.get(prop, ())}
        result.update([prop for prop in layout["scatter"] if prop not in hidden][:small_count])
    return result


def _new_object(prop: str) -> dict:
    state = {"uses": 0}
    if prop in _PORTIONS:
        state.update(remaining=_PORTIONS[prop], total=_PORTIONS[prop], keeps_container=prop in _LARGE)
    if prop in _DRINKS:
        state.update(level=4, fallen=False, fallen_at=0, foam_flat=False, spill=None, _taps=[], _busy_until=0)
    if prop == "can":
        state.update(can_state="sealed", spill=None, _taps=[])
    if prop == "lantern":
        state.update(lit=True, relight_at=None)
    if prop == "coin":
        state["face"] = "heads"
    if prop in {"dice", "die"}:
        state["value"] = None
    if prop == "coaster":
        state.update(tally=0, total_tallies=0)
    return state


def _valid_id(value) -> bool:
    return (isinstance(value, str) and 1 <= len(value) <= 80 and value.isascii()
            and all(letter.isalnum() or letter in "._:-" for letter in value))



def _valid_spill_id(value) -> bool:
    if not isinstance(value, str) or not value.isascii() or len(value) > 24:
        return False
    parts = value.split(":")
    return (len(parts) == 2 and all(part.isdecimal() for part in parts)
            and 1 <= int(parts[0]) <= 48 and 1 <= int(parts[1]) <= _MAX_REVISION)


def _valid_object(prop: str, value: object) -> bool:
    default = _new_object(prop)
    if not isinstance(value, dict) or len(value) != len(default) or set(value) != set(default):
        return False
    for key, item in value.items():
        if key in {"uses", "total_tallies"}:
            valid = type(item) is int and 0 <= item <= _MAX_REVISION
        elif key == "remaining":
            valid = type(item) is int and 0 <= item <= _PORTIONS[prop]
        elif key in {"total", "keeps_container"}:
            valid = type(item) is type(default[key]) and item == default[key]
        elif key in {"fallen", "foam_flat", "lit"}:
            valid = type(item) is bool
        elif key in {"fallen_at", "_busy_until"}:
            valid = type(item) is int and 0 <= item <= 10**15
        elif key == "relight_at":
            valid = item is None or type(item) is int and 0 <= item <= 10**15
        elif key == "_taps":
            valid = isinstance(item, list) and len(item) <= 6 and all(type(tap) is int and 0 <= tap <= 10**15 for tap in item)
        elif key in {"level", "tally"}:
            valid = type(item) is int and 0 <= item <= (4 if key == "level" else 20)
        elif key == "value":
            valid = item is None or type(item) is int and 1 <= item <= 6
        elif key == "face":
            valid = isinstance(item, str) and item in {"heads", "tails"}
        elif key == "can_state":
            valid = isinstance(item, str) and item in {"sealed", "open", "burst"}
        elif key == "spill":
            valid = item is None or (isinstance(item, dict) and set(item) == {"id", "amount", "cleaned"}
                and _valid_spill_id(item["id"]) and type(item["amount"]) is int and 1 <= item["amount"] <= 4
                and type(item["cleaned"]) is int and 0 <= item["cleaned"] < 100)
        else:
            valid = False
        if not valid:
            return False
    return True


def _state(game: dict) -> dict:
    round_number = _round_number(game)
    offered = _offered_ids(_layout(str(game["_id"]), round_number))
    raw = game.get(_STATE_KEY)
    if (isinstance(raw, dict) and set(raw) == {"schema_version", "round_number", "revision", "objects", "recent_actions"}
            and type(raw.get("schema_version")) is int and raw["schema_version"] == 1
            and type(raw.get("round_number")) is int
            and raw["round_number"] == round_number and type(raw.get("revision")) is int
            and 0 <= raw["revision"] <= _MAX_REVISION and isinstance(raw.get("objects"), dict)
            and len(raw["objects"]) == len(offered) and set(raw["objects"]) == offered and all(_valid_object(prop, value) for prop, value in raw["objects"].items())
            and isinstance(raw.get("recent_actions"), list) and len(raw["recent_actions"]) <= _RECENT_LIMIT
            and all(isinstance(entry, dict) and set(entry) == {"actor_id", "action_id", "object_id", "operation", "at"}
                    and isinstance(entry["actor_id"], str) and 1 <= len(entry["actor_id"]) <= 64
                    and _valid_id(entry["action_id"]) and isinstance(entry["object_id"], str) and entry["object_id"] in offered
                    and isinstance(entry["operation"], str) and entry["operation"] in {"tap", "shake", "wipe"}
                    and type(entry["at"]) is int and 0 <= entry["at"] <= 10**15
                    for entry in raw["recent_actions"])):
        return deepcopy(raw)
    return {"schema_version": 1, "round_number": round_number, "revision": 0,
            "objects": {prop: _new_object(prop) for prop in sorted(offered)}, "recent_actions": []}


def _public_object(value: dict, now: int) -> dict:
    result = {key: deepcopy(item) for key, item in value.items() if not key.startswith("_")}
    if result.get("relight_at") is not None and result["relight_at"] <= now:
        result.update(lit=True, relight_at=None)
    return result


def table_props_projection(game: dict) -> dict:
    """Read without changing a room; snapshots hydrate facts, never old motion."""
    round_number = _round_number(game)
    now = _now_ms()
    if game_type_from_state(game) != "hausdepp" or not game.get("_hausdepp"):
        return {"schema_version": 1, "game_id": str(game["_id"]), "round_number": round_number,
                "revision": 0, "server_now_ms": now, "layout": None, "objects": {}}
    state = _state(game)
    return {"schema_version": 1, "game_id": str(game["_id"]), "round_number": round_number,
            "revision": state["revision"], "server_now_ms": now, "layout": initial_layout(str(game["_id"]), round_number),
            "objects": {prop: _public_object(value, now) for prop, value in state["objects"].items()}}


def _error(code: str, game: dict) -> dict:
    name = f"hausdepp_table_prop_{code}"
    result = {"error": name, "error_code": name}
    if code != "invalid_actor":
        result["hausdepp_table_props"] = table_props_projection(game)
    return result


def _spill(state: dict, prop: str, amount: int) -> None:
    if amount:
        state["objects"][prop]["spill"] = {"id": f"{state['round_number']}:{state['revision']}", "amount": amount, "cleaned": 0}
        spills = [(key, value["spill"]) for key, value in state["objects"].items() if value.get("spill")]
        if len(spills) > 3:
            oldest = min(spills, key=lambda item: int(item[1]["id"].rsplit(":", 1)[1]))[0]
            state["objects"][oldest]["spill"] = None


def _apply_gesture(state: dict, prop: str, operation: str, now: int) -> str | None:
    value = state["objects"][prop]
    if prop == "lantern" and value["relight_at"] is not None and value["relight_at"] <= now:
        value.update(lit=True, relight_at=None)
    if operation == "wipe":
        if not value.get("spill"):
            return None
        value["spill"] = None
        return "wipe"
    if operation == "shake":
        if prop == "can" and value["can_state"] != "burst":
            value["can_state"] = "burst"
            _spill(state, prop, 1)
            return "can-burst"
        if prop == "lantern" and (value["lit"] or value["relight_at"] is not None):
            value.update(lit=False, relight_at=now + 2800)
            return "candle-shake-out"
        return None
    if prop in _PORTIONS:
        if value["remaining"] == 0:
            return None
        value["remaining"] -= 1
        return "bite"
    if prop in _DRINKS:
        if now < value["_busy_until"]:
            return None
        value["_taps"] = [tap for tap in value["_taps"] if now - 2600 < tap <= now][-5:] + [now]
        if value["fallen"]:
            if now - value["fallen_at"] < 1200:
                return None
            value.update(fallen=False, _taps=[], _busy_until=now + 800)
            return "stand"
        taps, level = len(value["_taps"]), value["level"]
        if taps >= 6:
            value.update(level=0, fallen=True, fallen_at=now, foam_flat=True)
            _spill(state, prop, level)
            return "fall"
        if taps >= 3:
            value.update(level=0, foam_flat=True)
            _spill(state, prop, level)
            return "spill"
        if level <= 0:
            value.update(level=4, foam_flat=False, _taps=[])
            return "refill"
        value.update(level=level - 1, foam_flat=True)
        return "sip"
    if prop == "can":
        value["_taps"] = [tap for tap in value["_taps"] if now - 2600 < tap <= now][-5:] + [now]
        if value["can_state"] == "sealed" and len(value["_taps"]) >= 3:
            value["can_state"] = "open"
            _spill(state, prop, 1)
            return "can-open"
        return "can-nudge"
    if prop == "lantern":
        value.update(lit=not value["lit"], relight_at=None)
        return "candle-light" if value["lit"] else "candle-out"
    if prop == "coin":
        value["face"] = "heads" if _RANDOM.randrange(2) == 0 else "tails"
        return "coin-toss"
    if prop in {"dice", "die"}:
        value["value"] = _RANDOM.randrange(1, 7)
        return "dice-throw"
    if prop in {"coaster", "pencil"} and "coaster" in state["objects"]:
        coaster = state["objects"]["coaster"]
        coaster["tally"] = (coaster["tally"] + 1) % 21
        coaster["total_tallies"] = min(_MAX_REVISION, coaster["total_tallies"] + 1)
        return "coaster-mark"
    return "nudge"


def _claim_table_prop(session, data: dict) -> dict:
    """Validate and claim synchronously while the caller owns the room lock."""
    game = session.game
    player = next((person for person in game.get("_players", []) if person.get("id") == session.player_id), None)
    participant = next((person for person in game.get("_participants", [])
                        if person.get("id") == session.player_id), None)
    identity = resolve_session(session.websocket) if player and player.get("user_id") is not None else None
    if (game_type_from_state(game) != "hausdepp" or session.is_spectator or not player or not participant
            or participant.get("is_cpu") or participant.get("type") == "cpu"
            or player.get("ws") is not session.websocket or player.get("is_cpu") or player.get("type") == "cpu"
            or participant.get("user_id") != player.get("user_id")
            or player.get("user_id") is not None and (type(player["user_id"]) is not int or player["user_id"] < 1)
            or participant.get("user_id") is not None
                and (type(participant["user_id"]) is not int or participant["user_id"] < 1)
            or player.get("user_id") is not None and (not identity or identity.user_id != player["user_id"])):
        return _error("invalid_actor", game)
    if not isinstance(data, dict):
        return _error("invalid_request", game)
    allowed_keys = {"action", "round_number", "object_id", "operation", "action_id"}
    prop, operation, action_id = data.get("object_id"), data.get("operation"), data.get("action_id")
    if (set(data) - allowed_keys or not _valid_id(action_id) or not isinstance(prop, str) or len(prop) > 32
            or not isinstance(operation, str) or operation not in {"tap", "shake", "wipe"}
            or type(data.get("round_number")) is not int):
        return _error("invalid_request", game)
    if (not game.get("_started") or game.get("_finished") or game.get("_aborted")
            or (game.get("_hausdepp") or {}).get("phase") not in {"peeking", "playing"}
            or multiplayer_pause_reason(game) or data["round_number"] != _round_number(game)):
        return _error("unavailable", game)
    state = _state(game)
    if (prop not in state["objects"] or operation == "shake" and (prop not in {"can", "lantern"}
            or game["_hausdepp"]["phase"] != "playing") or operation == "wipe" and prop not in _DRINKS | {"can"}):
        return _error("unavailable", game)
    duplicate = next((entry for entry in state["recent_actions"]
                      if entry["actor_id"] == player["id"] and entry["action_id"] == action_id), None)
    if duplicate:
        if duplicate["object_id"] != prop or duplicate["operation"] != operation:
            return _error("invalid_request", game)
        else:
            return {"hausdepp_table_props": table_props_projection(game),
                    "hausdepp_table_prop_ack": {"action_id": action_id, "duplicate": True}}
    now = _now_ms()
    if (sum(entry["actor_id"] == player["id"] and entry["at"] > now - 5000 for entry in state["recent_actions"]) >= 10
            or state["revision"] >= _MAX_REVISION):
        return _error("rate_limited", game)
    before = _public_object(state["objects"][prop], now)
    state["revision"] += 1
    effect = _apply_gesture(state, prop, operation, now)
    state["objects"][prop]["uses"] = min(_MAX_REVISION, state["objects"][prop]["uses"] + (effect is not None))
    state["recent_actions"] = [*state["recent_actions"], {"actor_id": player["id"], "action_id": action_id,
        "object_id": prop, "operation": operation, "at": now}][-_RECENT_LIMIT:]
    game[_STATE_KEY] = state
    event = {"id": f"{game['_id']}:{state['round_number']}:{state['revision']}", "game_id": str(game["_id"]),
             "round_number": state["round_number"], "revision": state["revision"], "actor_id": player["id"],
             "object_id": prop, "operation": operation, "action_id": action_id, "effect": effect,
             "before": before, "after": _public_object(state["objects"][prop], now)}
    return {"hausdepp_table_props": table_props_projection(game), "hausdepp_table_prop": event}


async def handle_table_prop(session, data: dict) -> None:
    """Release the card lock before any potentially slow cosmetic delivery."""
    async with game_lock(session.game):
        message = _claim_table_prop(session, data)
    # As with rare surprises, the synchronous save at the start of broadcast
    # precedes the first yield; no viewer can retain the gameplay lock.
    if "hausdepp_table_prop" in message:
        await broadcast(session.game, message)
    else:
        await session.websocket.send_json(message)
