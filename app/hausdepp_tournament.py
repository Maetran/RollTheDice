"""A durable Hausdepp session: the first eighth loss ends the tournament.

The room and seats remain stable. Each completed round has its own immutable
accounting ID, while a bounded list of at most 43 losers proves the score.
"""

from __future__ import annotations

from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any, Mapping

from .hausdepp_engine import HausdeppRuleError, new_round

TARGET_WORD = "HAUSDEPP"


def round_result_id(table_id: str, round_number: int) -> str:
    if round_number == 1:
        return table_id
    suffix = f"-r{round_number:02d}"
    if len(table_id) + len(suffix) <= 64:
        return f"{table_id}{suffix}"
    return f"{table_id[:48]}-{sha256(table_id.encode()).hexdigest()[:8]}{suffix}"


def new_tournament(table_id: str, participants: list[dict]) -> dict[str, Any]:
    return {
        "schema_version": 1, "id": table_id, "round_number": 1,
        "losses": {player["id"]: 0 for player in participants},
        "round_losers": [], "completed": False, "tages_hausdepp_id": None,
    }


def validate_tournament(raw: object, participant_ids: set[str], *, finished_round: bool = False) -> dict[str, Any]:
    """Accept old fixed-roster scores and bounded, explicit withdrawal scores."""
    schema = raw.get("schema_version") if isinstance(raw, dict) else None
    if (not isinstance(raw, dict) or type(schema) is not int or schema not in (1, 2)
            or not isinstance(raw.get("id"), str) or not 1 <= len(raw["id"]) <= 64
            or type(raw.get("round_number")) is not int
            or not 1 <= raw["round_number"] <= (8 * len(participant_ids) if schema == 2 else 7 * len(participant_ids) + 1)
            or not 2 <= len(participant_ids) <= 6 or not isinstance(raw.get("losses"), dict)
            or set(raw["losses"]) != participant_ids or type(raw.get("completed")) is not bool
            or not isinstance(raw.get("round_losers"), list)):
        raise ValueError("hausdepp_invalid_tournament")
    departed = []
    end_reason = None
    if schema == 2:
        roster = raw.get("participant_ids")
        departed = raw.get("departed_ids")
        humans = raw.get("human_ids")
        end_reason = raw.get("end_reason")
        if (not isinstance(roster, list) or any(not isinstance(key, str) for key in roster)
                or len(roster) != len(participant_ids) or set(roster) != participant_ids
                or not isinstance(departed, list) or any(not isinstance(key, str) or key not in participant_ids for key in departed)
                or len(departed) != len(set(departed))
                or not isinstance(humans, list) or not humans
                or any(not isinstance(key, str) or key not in participant_ids for key in humans)
                or len(humans) != len(set(humans))
                or end_reason is not None and (not isinstance(end_reason, str)
                    or end_reason not in {"eight_losses", "insufficient_players", "no_human_players"})):
            raise ValueError("hausdepp_invalid_tournament")
    losses, losers = raw["losses"], raw["round_losers"]
    actual_losers = [key for key in losers if key is not None]
    if (any(type(count) is not int or not 0 <= count <= len(TARGET_WORD) for count in losses.values())
            or any(key is None and schema != 2 or key is not None and (not isinstance(key, str) or key not in participant_ids)
                   for key in losers)
            or len(losers) not in {raw["round_number"] - 1, raw["round_number"]}
            or len(losers) - len(actual_losers) > len(departed)
            or dict(Counter(actual_losers)) != {key: count for key, count in losses.items() if count}
            or (finished_round and len(losers) != raw["round_number"])):
        raise ValueError("hausdepp_invalid_tournament")
    terminal = [key for key, count in losses.items() if count == len(TARGET_WORD)]
    if raw["completed"]:
        if schema == 2 and end_reason == "insufficient_players":
            if terminal or raw.get("tages_hausdepp_id") is not None or len(participant_ids - set(departed)) >= 2:
                raise ValueError("hausdepp_invalid_tournament")
        elif schema == 2 and end_reason == "no_human_players":
            if terminal or raw.get("tages_hausdepp_id") is not None or not set(humans).issubset(departed):
                raise ValueError("hausdepp_invalid_tournament")
        elif (len(terminal) != 1 or raw.get("tages_hausdepp_id") != terminal[0]
                or len(losers) != raw["round_number"] or losers[-1] != terminal[0]
                or Counter(actual_losers[:-1])[terminal[0]] != len(TARGET_WORD) - 1
                or schema == 2 and end_reason != "eight_losses"):
            raise ValueError("hausdepp_invalid_tournament")
    elif terminal or raw.get("tages_hausdepp_id") is not None or schema == 2 and end_reason is not None:
        raise ValueError("hausdepp_invalid_tournament")
    keys = ["schema_version", "id", "round_number", "losses", "round_losers", "completed", "tages_hausdepp_id"]
    if schema == 2:
        keys.extend(("participant_ids", "human_ids", "departed_ids", "end_reason"))
    return {key: deepcopy(raw[key]) for key in keys}


def record_tournament_departure(game: dict, player_id: str) -> None:
    """Retain historical losses while removing a seat from future rounds."""
    raw = game.get("_hausdepp_tournament")
    if raw is None:
        return
    ids = {player["id"] for player in game["_participants"]}
    tournament = validate_tournament(raw, ids)
    if player_id not in ids or tournament["completed"]:
        raise HausdeppRuleError("hausdepp_tournament_finished")
    if tournament["schema_version"] == 1:
        tournament.update(schema_version=2, participant_ids=[player["id"] for player in game["_participants"]],
                          human_ids=[player["id"] for player in game["_participants"] if not player.get("is_cpu")],
                          departed_ids=[], end_reason=None)
    if player_id not in tournament["departed_ids"]:
        tournament["departed_ids"].append(player_id)
    if len(ids - set(tournament["departed_ids"])) < 2:
        tournament.update(completed=True, end_reason="insufficient_players", tages_hausdepp_id=None)
    elif game.get("_finished") and set(tournament["human_ids"]).issubset(tournament["departed_ids"]):
        tournament.update(completed=True, end_reason="no_human_players", tages_hausdepp_id=None)
    game["_hausdepp_tournament"] = tournament


def tournament_is_pending(game: Mapping[str, Any]) -> bool:
    tournament = game.get("_hausdepp_tournament")
    return bool(game.get("_game_type") == "hausdepp" and isinstance(tournament, dict)
                and not tournament.get("completed") and not game.get("_aborted"))


def record_finished_round(game: dict) -> None:
    raw = game.get("_hausdepp_tournament")
    if raw is None:
        return
    state = game.get("_hausdepp") or {}
    ids = {player["id"] for player in game["_participants"]}
    tournament = validate_tournament(raw, ids)
    no_loser = state.get("round_end_reason") == "insufficient_players" and state.get("loser_id") is None
    if state.get("phase") != "finished" or not (state.get("loser_id") in ids or no_loser and tournament["schema_version"] == 2):
        raise HausdeppRuleError("hausdepp_tournament_round_not_finished")
    # A finalizer or reconnect retry must not hand out another letter.
    if len(tournament["round_losers"]) == tournament["round_number"]:
        if tournament["round_losers"][-1] != state["loser_id"]:
            raise HausdeppRuleError("hausdepp_invalid_tournament")
        return
    if tournament["completed"] and tournament.get("end_reason") != "insufficient_players":
        raise HausdeppRuleError("hausdepp_tournament_finished")
    loser = state["loser_id"]
    tournament["round_losers"].append(loser)
    if loser is not None:
        tournament["losses"][loser] += 1
    if loser is not None and tournament["losses"][loser] == len(TARGET_WORD):
        tournament["completed"] = True
        tournament["tages_hausdepp_id"] = loser
        if tournament["schema_version"] == 2:
            tournament["end_reason"] = "eight_losses"
        _record_tournament_achievements(tournament, state)
    elif tournament["schema_version"] == 2 and set(tournament["human_ids"]).issubset(tournament["departed_ids"]):
        tournament.update(completed=True, end_reason="no_human_players", tages_hausdepp_id=None)
    game["_hausdepp_tournament"] = tournament


def _record_tournament_achievements(tournament: dict, state: dict) -> None:
    evidence = state.get("achievement_evidence")
    if not isinstance(evidence, dict) or evidence.get("schema_version") != 1:
        return
    losers = [key for key in tournament["round_losers"] if key is not None]
    rounds, losses = len(losers), tournament["losses"]
    for key, facts in evidence["players"].items():
        if key in tournament.get("departed_ids", []) or key in state.get("withdrawn_ids", []):
            continue
        awarded = {85}
        # Lifetime tournament counts (86/87) are account-service facts.
        if rounds >= 20:
            awarded.add(88)
        if key == tournament["tages_hausdepp_id"]:
            awarded.add(89)
        if losses[key] == 0:
            awarded.add(90)
        if losses[key] == 1:
            awarded.add(91)
        if losses[key] == 7 and key != tournament["tages_hausdepp_id"]:
            awarded.add(92)
        if rounds >= 3 and key not in losers[-2:] and key in losers[:-2]:
            awarded.add(93)
        if losers[0] == key and losers[-1] != key:
            awarded.add(94)
        if rounds >= 4 and losers[:2] == [key, key] and key not in losers[-2:]:
            awarded.add(95)
        if rounds >= 5 and key not in losers[-3:]:
            awarded.add(96)
        if losses[key] >= 3:
            awarded.add(97)
        if any(previous == key and following != key for previous, following in zip(losers, losers[1:])):
            awarded.add(98)
        if all(losses.values()):
            awarded.add(99)
        if losers[-2:] == [key, key] and key == tournament["tages_hausdepp_id"]:
            awarded.add(100)
        facts["flags"] = sorted(set(facts["flags"]).union(f"hausdepp_{number:02}" for number in awarded))


def start_next_round(game: dict, player_id: str, version: object) -> None:
    from .hausdepp_state import hausdepp_is_host

    participant = next((player for player in game.get("_participants", []) if player["id"] == player_id), None)
    if not participant or participant.get("is_cpu") or not hausdepp_is_host(game, participant):
        raise HausdeppRuleError("hausdepp_host_required")
    state = game.get("_hausdepp") or {}
    if type(version) is not int or version != state.get("version"):
        raise HausdeppRuleError("hausdepp_stale_version")
    if game.get("_aborted") or not game.get("_finished") or state.get("phase") != "finished":
        raise HausdeppRuleError("hausdepp_tournament_round_not_finished")
    try:
        tournament = validate_tournament(game.get("_hausdepp_tournament"),
                                         {player["id"] for player in game["_participants"]}, finished_round=True)
    except ValueError as exc:
        raise HausdeppRuleError("hausdepp_invalid_tournament") from exc
    if tournament["completed"]:
        raise HausdeppRuleError("hausdepp_tournament_finished")
    if not game.get("_completion_persisted"):
        raise HausdeppRuleError("hausdepp_result_persistence_pending")
    all_participants = game["_participants"]
    departed = set(tournament.get("departed_ids", []))
    participants = [player for player in all_participants if player["id"] not in departed]
    old_dealer = next(index for index, player in enumerate(all_participants) if player["id"] == state["dealer_id"])
    next_dealer = next(player["id"] for offset in range(1, len(all_participants) + 1)
                       if (player := all_participants[(old_dealer + offset) % len(all_participants)])["id"] not in departed)
    dealer_index = next(index for index, player in enumerate(participants) if player["id"] == next_dealer)
    following = new_round(participants, dealer_index=dealer_index)
    following["version"] = state["version"] + 1
    following["table_version"] = following["version"]
    tournament["round_number"] += 1
    game["_hausdepp_tournament"] = tournament
    game["_hausdepp"] = following
    game["_finished"] = False
    game["_finished_at"] = None
    game["_results"] = None
    game["_turn"] = {"player_id": following["current_player_id"]}
    game["_hausdepp_round_started_at"] = datetime.now(timezone.utc).isoformat()
    game["_resume_required"] = any(player.get("ws") is None for player in game.get("_players", []))
    if not game["_resume_required"]:
        game["_manual_pause"] = False
        game["_manual_pause_by"] = None
        game["_manual_pause_by_name"] = None
        game["_manual_pause_at"] = None
    for key in ("_completion_persisted", "_final_completion", "_finalization_pending", "_hausdepp_round_summary"):
        game.pop(key, None)


def project_hausdepp_tournament(game: Mapping[str, Any], viewer_id: str | None = None) -> dict[str, Any] | None:
    from .hausdepp_state import hausdepp_is_host

    raw = game.get("_hausdepp_tournament")
    if raw is None:
        return None
    try:
        tournament = validate_tournament(raw, {player["id"] for player in game.get("_participants", [])})
    except ValueError:
        return None
    state = game.get("_hausdepp") or {}
    viewer = next((player for player in game.get("_participants", []) if player["id"] == viewer_id), None)
    round_complete = bool(game.get("_finished") and len(tournament["round_losers"]) == tournament["round_number"])
    return {
        "id": tournament["id"], "round_number": tournament["round_number"],
        "losses": tournament["losses"],
        "letters": {key: TARGET_WORD[:count] for key, count in tournament["losses"].items()},
        "completed": tournament["completed"], "tages_hausdepp_id": tournament["tages_hausdepp_id"],
        "departed_ids": tournament.get("departed_ids", []), "end_reason": tournament.get("end_reason"),
        "round_complete": round_complete, "dealer_id": state.get("dealer_id"), "target_word": TARGET_WORD,
        "can_start_next_round": bool(round_complete and not tournament["completed"] and not game.get("_aborted")
                                     and game.get("_completion_persisted") and viewer and not viewer.get("is_cpu")
                                     and hausdepp_is_host(game, viewer)),
    }
