"""Typed Hausdepp outcomes with strictly private server-derived achievement evidence."""

from __future__ import annotations

import json
import logging
from copy import deepcopy
from datetime import datetime, timezone

from sqlalchemy import select

from .active_games import delete_active_game, save_active_game
from .database import database_schema_ready, session_scope
from .game_history import persist_completed_game_result
from .game_types import HAUSDEPP_GAME_TYPE
from .hausdepp_surprise_collection import SURPRISE_EFFECTS, surprise_collection_evidence
from .models import CompletedGame, GameParticipant, HausdeppWithdrawal
from .security import as_utc

logger = logging.getLogger(__name__)
_EVENT_ACHIEVEMENTS = {f"hausdepp_{number:02}" for number in (
    *range(17, 29), *range(30, 56), *range(58, 86), *range(88, 101), 137, 138,
)}
# Event flags that only a completed tournament may carry. 86/87 are lifetime
# tournament counters, never event flags; later ordinary IDs are not included.
TOURNAMENT_EVENT_ACHIEVEMENTS = frozenset(f"hausdepp_{number:02}" for number in (85, *range(88, 101)))
# Finishing feats can never belong to the player left holding cards.
_FINISHING_ACHIEVEMENTS = frozenset(f"hausdepp_{number:02}" for number in (*range(58, 77), 79, 81, 84, 138))


def _round_timing(started_at: object, finished_at: str) -> dict:
    """Unknown historical starts stay unknown; never infer them from turn order."""
    try:
        if not isinstance(started_at, str):
            return {}
        start = datetime.fromisoformat(started_at)
        if start.tzinfo is None:
            return {}
        start = as_utc(start)
        elapsed = (datetime.fromisoformat(finished_at) - start).total_seconds()
        if not 0 <= elapsed <= 30 * 24 * 60 * 60:
            return {}
        return {"started_at": start.isoformat(), "duration_seconds": round(elapsed, 3)}
    except (TypeError, ValueError, OverflowError):
        return {}


def validate_hausdepp_evidence(raw: object, participant_ids: set[str]) -> dict:
    """Retain only bounded event awards, never hands, peeked cards or tracking state."""
    if (not isinstance(raw, dict) or type(raw.get("schema_version")) is not int
            or raw["schema_version"] != 1 or type(raw.get("complete")) is not bool
            or not isinstance(raw.get("players"), dict) or set(raw["players"]) != participant_ids):
        raise ValueError("hausdepp_result_invalid_evidence")
    players = {}
    for key, evidence in raw["players"].items():
        if (not isinstance(evidence, dict) or not isinstance(evidence.get("flags"), list)
                or len(evidence["flags"]) > len(_EVENT_ACHIEVEMENTS)
                or any(not isinstance(flag, str) or flag not in _EVENT_ACHIEVEMENTS for flag in evidence["flags"])
                or len(set(evidence["flags"])) != len(evidence["flags"])
                or type(evidence.get("ten_clears")) is not int or not 0 <= evidence["ten_clears"] <= 4
                or (not raw["complete"] and {"hausdepp_62", "hausdepp_74", "hausdepp_75", "hausdepp_84"}
                    .intersection(evidence["flags"]))):
            raise ValueError("hausdepp_result_invalid_evidence")
        players[key] = {"flags": sorted(evidence["flags"]), "ten_clears": evidence["ten_clears"]}
        if "table_surprises" in evidence:
            players[key]["table_surprises"] = _validate_surprise_collection(evidence["table_surprises"])
    return {"schema_version": 1, "complete": raw["complete"], "players": players}


def _validate_surprise_collection(raw: object) -> dict:
    """One room effect can contribute once to either private collection."""
    if not isinstance(raw, dict) or set(raw) != {"activated", "witnessed"}:
        raise ValueError("hausdepp_result_invalid_evidence")
    for track in ("activated", "witnessed"):
        values = raw[track]
        if (not isinstance(values, list) or len(values) > 1
                or any(not isinstance(effect, str) or effect not in SURPRISE_EFFECTS for effect in values)):
            raise ValueError("hausdepp_result_invalid_evidence")
    if not set(raw["activated"]).issubset(raw["witnessed"]):
        raise ValueError("hausdepp_result_invalid_evidence")
    return {track: list(raw[track]) for track in ("activated", "witnessed")}


def _validate_surprise_membership(evidence: dict, participants: list[dict]) -> None:
    """An accepted surprise belongs to one actor and at least two human seats."""
    humans = {player["id"] for player in participants if not player["is_cpu"]}
    actors, witnesses, effects = set(), set(), set()
    for player_id, facts in evidence["players"].items():
        collection = facts.get("table_surprises", {})
        if collection.get("activated"):
            actors.add(player_id)
        if collection.get("witnessed"):
            witnesses.add(player_id)
            effects.update(collection["witnessed"])
    if witnesses and (not witnesses.issubset(humans) or len(witnesses) < 2 or len(actors) != 1 or len(effects) != 1):
        raise ValueError("hausdepp_result_invalid_evidence")


def validate_hausdepp_result(payload: object) -> dict:
    """Project the known result schema, never private live-game fields.

    The loser is the only final outcome. The other seats have an exit order,
    which deliberately does not imply a points score or a winner award.
    """
    if (not isinstance(payload, dict) or type(payload.get("schema_version")) is not int
            or payload.get("schema_version") not in (1, 2, 3, 4) or payload.get("payload_kind") != "hausdepp_result"
            or payload.get("game_type") != HAUSDEPP_GAME_TYPE):
        raise ValueError("hausdepp_result_invalid_schema")
    game_id, name = payload.get("game_id"), payload.get("name")
    if (not isinstance(game_id, str) or not 1 <= len(game_id) <= 64
            or not isinstance(name, str) or len(name) > 160):
        raise ValueError("hausdepp_result_invalid_metadata")
    try:
        finished_at = as_utc(datetime.fromisoformat(payload["finished_at"])).isoformat()
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise ValueError("hausdepp_result_invalid_timestamp") from exc
    raw_participants = payload.get("participants")
    if not isinstance(raw_participants, list) or not 2 <= len(raw_participants) <= 6:
        raise ValueError("hausdepp_result_invalid_participants")
    participants = []
    for player in raw_participants:
        if (not isinstance(player, dict) or not isinstance(player.get("id"), str)
                or not 1 <= len(player["id"]) <= 64 or not isinstance(player.get("name"), str)
                or not 1 <= len(player["name"]) <= 64 or type(player.get("is_cpu")) is not bool):
            raise ValueError("hausdepp_result_invalid_participants")
        participants.append({"id": player["id"], "name": player["name"], "is_cpu": player["is_cpu"]})
    participant_ids = {player["id"] for player in participants}
    order, loser = payload.get("finished_order"), payload.get("loser_id")
    if (len(participant_ids) != len(participants) or not isinstance(order, list)
            or any(not isinstance(key, str) for key in order) or len(set(order)) != len(order)):
        raise ValueError("hausdepp_result_invalid_outcome")
    terminal = {}
    if payload["schema_version"] == 4:
        withdrawn = payload.get("withdrawn_ids")
        reason, remaining = payload.get("round_end_reason"), payload.get("remaining_player_id")
        if (not isinstance(withdrawn, list) or any(not isinstance(key, str) for key in withdrawn)
                or len(set(withdrawn)) != len(withdrawn) or set(order).intersection(withdrawn)
                or not isinstance(reason, str) or reason not in {"normal", "insufficient_players"}):
            raise ValueError("hausdepp_result_invalid_outcome")
        last = loser if reason == "normal" else remaining
        if (not isinstance(last, str) or last not in participant_ids or last in set(order).union(withdrawn)
                or set(order).union(withdrawn, {last}) != participant_ids
                or (reason == "normal" and remaining is not None)
                or (reason == "insufficient_players" and (loser is not None or not withdrawn))):
            raise ValueError("hausdepp_result_invalid_outcome")
        terminal = {"withdrawn_ids": list(withdrawn), "round_end_reason": reason, "remaining_player_id": remaining}
    elif (not isinstance(loser, str) or loser not in participant_ids or len(order) != len(participants) - 1
          or set(order) != participant_ids - {loser}):
        raise ValueError("hausdepp_result_invalid_outcome")
    result = {"schema_version": payload["schema_version"], "payload_kind": "hausdepp_result", "game_type": HAUSDEPP_GAME_TYPE,
            "game_id": game_id, "name": name, "finished_at": finished_at,
            "participants": participants, "loser_id": loser, "finished_order": list(order), **terminal}
    timing = _round_timing(payload.get("started_at"), finished_at)
    duration = payload.get("duration_seconds")
    if (timing and type(duration) in {int, float} and 0 <= duration <= 30 * 24 * 60 * 60
            and abs(duration - timing["duration_seconds"]) <= .001):
        result.update(timing)
    if payload["schema_version"] >= 2:
        result["achievement_evidence"] = validate_hausdepp_evidence(payload.get("achievement_evidence"), participant_ids)
        _validate_surprise_membership(result["achievement_evidence"], participants)
        remaining_id = result.get("remaining_player_id")
        if remaining_id and _FINISHING_ACHIEVEMENTS.intersection(
                result["achievement_evidence"]["players"][remaining_id]["flags"]):
            raise ValueError("hausdepp_result_invalid_evidence")
    if payload["schema_version"] == 3 or (payload["schema_version"] == 4 and "tournament" in payload):
        from .hausdepp_tournament import round_result_id, validate_tournament

        raw_tournament = payload.get("tournament")
        original_ids = participant_ids
        if isinstance(raw_tournament, dict) and raw_tournament.get("schema_version") == 2:
            originals = raw_tournament.get("participant_ids")
            if (not isinstance(originals, list) or any(not isinstance(key, str) for key in originals)
                    or len(set(originals)) != len(originals) or not participant_ids.issubset(originals)):
                raise ValueError("hausdepp_result_invalid_tournament")
            original_ids = set(originals)
        tournament = validate_tournament(raw_tournament, original_ids, finished_round=True)
        if (round_result_id(tournament["id"], tournament["round_number"]) != game_id
                or tournament["round_losers"][-1] != loser):
            raise ValueError("hausdepp_result_invalid_tournament")
        result["tournament"] = tournament
    elif any(flag in TOURNAMENT_EVENT_ACHIEVEMENTS
             for facts in result.get("achievement_evidence", {}).get("players", {}).values() for flag in facts["flags"]):
        raise ValueError("hausdepp_result_invalid_tournament")
    if "tournament" in result and (not result["tournament"]["completed"]
                                  or result["tournament"].get("end_reason") not in {None, "eight_losses"}) and any(
        flag in TOURNAMENT_EVENT_ACHIEVEMENTS
        for facts in result["achievement_evidence"]["players"].values() for flag in facts["flags"]
    ):
        raise ValueError("hausdepp_result_invalid_tournament")
    return result


def validated_hausdepp_membership(row: CompletedGame, user_id: int, *, db=None) -> tuple[dict, dict] | None:
    """Verify every relational seat before returning this account's private facts."""
    payload = stored_hausdepp_result(row)
    if payload is None:
        return None
    # Independent durable evidence wins over an older or damaged result JSON.
    # Every normal account, ranking and recovery reader passes this boundary.
    if db is None:
        with session_scope() as own_db:
            if own_db.get(HausdeppWithdrawal, (user_id, row.game_id)) is not None:
                return None
    elif db.get(HausdeppWithdrawal, (user_id, row.game_id)) is not None:
        return None
    own_seats = [seat for seat in row.participants if seat.user_id == user_id]
    seats = {seat.player_key: seat for seat in row.participants}
    if len(own_seats) != 1 or len(seats) != len(row.participants) or set(seats) != {
        player["id"] for player in payload["participants"]
    }:
        return None
    human_accounts = [seat.user_id for seat in row.participants if seat.user_id is not None]
    if len(human_accounts) != len(set(human_accounts)):
        return None
    participants = []
    positions = {key: index + 1 for index, key in enumerate(payload["finished_order"])}
    for player in payload["participants"]:
        seat = seats[player["id"]]
        if player["name"] != seat.display_name or (player["is_cpu"] and seat.user_id is not None):
            return None
        outcome = ("withdrawn" if player["id"] in payload.get("withdrawn_ids", []) else
                   "remaining" if player["id"] == payload.get("remaining_player_id") else
                   "hausdepp" if player["id"] == payload["loser_id"] else "finished")
        participants.append({**player, "outcome": outcome,
                             "finished_position": positions.get(player["id"])})
    own = next(player for player in participants if player["id"] == own_seats[0].player_key)
    if own["is_cpu"] or own["outcome"] == "withdrawn":
        return None
    record = {"game_id": payload["game_id"], "name": payload["name"], "finished_at": payload["finished_at"],
              "player_id": own["id"], "outcome": own["outcome"], "finished_position": own["finished_position"],
              "participant_count": len(participants), "cpu_count": sum(player["is_cpu"] for player in participants),
              "participants": participants}
    if "tournament" in payload:
        record["tournament"] = payload["tournament"]
    record.update({key: payload[key] for key in ("started_at", "duration_seconds") if key in payload})
    evidence = payload.get("achievement_evidence", {}).get("players", {}).get(own["id"], {})
    facts = {"participant_count": len(participants), "cpu_count": record["cpu_count"],
             "human_count": len(participants) - record["cpu_count"], "outcome": own["outcome"],
             "opponents": sorted(account for account in human_accounts if account != user_id),
             "flags": evidence.get("flags", []), "ten_clears": evidence.get("ten_clears", 0)}
    if "table_surprises" in evidence:
        facts["table_surprises"] = evidence["table_surprises"]
    tournament = payload.get("tournament")
    facts["completed_tournament_id"] = (tournament["id"] if tournament and tournament["completed"]
                                         and tournament.get("end_reason") in {None, "eight_losses"} else None)
    return record, facts


def stored_hausdepp_result(row: CompletedGame) -> dict | None:
    """Reject damaged or mismatched storage without losing the whole history."""
    try:
        payload = validate_hausdepp_result(json.loads(row.snapshot_json))
        if (row.game_type != HAUSDEPP_GAME_TYPE or payload["game_id"] != row.game_id
                or payload["name"] != row.game_name
                or datetime.fromisoformat(payload["finished_at"]) != as_utc(row.finished_at)):
            return None
        return payload
    except (TypeError, ValueError, OverflowError):
        return None


def finalize_hausdepp_result(game: dict) -> dict:
    state = game.get("_hausdepp") or {}
    if game.get("_aborted") or not game.get("_finished") or state.get("phase") != "finished":
        return {"result_persisted": False, "persistence_error": "hausdepp_result_not_finished"}
    try:
        from .hausdepp_tournament import record_finished_round, round_result_id, validate_tournament

        record_finished_round(game)
        tournament = game.get("_hausdepp_tournament")
        if tournament is not None:
            tournament = validate_tournament(tournament, {player["id"] for player in game["_participants"]},
                                             finished_round=True)
        result_id = round_result_id(game["_id"], tournament["round_number"]) if tournament else game["_id"]
        round_ids = {player["id"] for player in state.get("players", game["_participants"])}
        round_participants = [player for player in game["_participants"] if player["id"] in round_ids]
        schema = (4 if game.get("_hausdepp_departures") or state.get("withdrawn_ids")
                  or (tournament and tournament.get("schema_version") == 2)
                  else 3 if tournament else 2 if state.get("achievement_evidence") is not None else 1)
        raw = {
            "schema_version": schema,
            "payload_kind": "hausdepp_result", "game_type": HAUSDEPP_GAME_TYPE,
            "game_id": result_id, "name": game["_name"], "finished_at": game["_finished_at"],
            "participants": [{"id": player["id"], "name": player["name"], "is_cpu": bool(player.get("is_cpu"))}
                             for player in round_participants],
            "loser_id": state.get("loser_id"), "finished_order": state.get("finished_order"),
        }
        if schema == 4:
            raw.update(withdrawn_ids=list(state.get("withdrawn_ids", [])),
                       round_end_reason=state.get("round_end_reason") or "normal",
                       remaining_player_id=state.get("remaining_player_id"))
        if raw["schema_version"] >= 2:
            evidence = deepcopy(state["achievement_evidence"])
            round_number = tournament["round_number"] if tournament else 1
            for player_id, collection in surprise_collection_evidence(game, round_number).items():
                if player_id in evidence["players"]:
                    evidence["players"][player_id]["table_surprises"] = collection
            raw["achievement_evidence"] = evidence
        if tournament:
            raw["tournament"] = tournament
        start = (game.get("_hausdepp_round_started_at") if tournament and tournament["round_number"] > 1
                 else game.get("_started_at"))
        raw.update(_round_timing(start, raw["finished_at"]))
        payload = validate_hausdepp_result(raw)
    except (KeyError, TypeError, ValueError):
        return {"result_persisted": False, "persistence_error": "hausdepp_result_invalid_outcome"}
    finished_at = datetime.fromisoformat(payload["finished_at"])
    result = persist_completed_game_result(
        game_id=result_id, game_name=game["_name"], game_type=HAUSDEPP_GAME_TYPE, mode=game["_mode"],
        hardcore=False, finished_at=finished_at.astimezone(timezone.utc), snapshot=payload,
        participants=[{"player_key": player["id"], "display_name": player["name"], "user_id": player.get("user_id")}
                      for player in round_participants],
    )
    completion = {"result_persisted": result.succeeded, "persistence_error": result.reason}
    game["_final_completion"] = completion
    if result.succeeded:
        game["_completion_persisted"] = True
        # Reconcile from durable outcomes, never from a possibly changed retry.
        # Account reads perform the same recovery if this best-effort pass fails.
        from .hausdepp_achievements import synchronize_hausdepp_progress
        for user_id in {player.get("user_id") for player in round_participants
                        if type(player.get("user_id")) is int and not player.get("is_cpu")}:
            try:
                synchronize_hausdepp_progress(user_id)
            except Exception:
                logger.exception("Hausdepp award reconciliation failed for completed round %s", game["_id"])
        # Everyone at the table sees what each person earned in this round.
        from .hausdepp_round_summary import build_round_summary

        game["_hausdepp_round_summary"] = build_round_summary(result_id, round_participants)
        from .hausdepp_tournament import tournament_is_pending

        if tournament_is_pending(game):
            save_active_game(game)
        else:
            from .hausdepp_rematch import retain_rematch_source

            if retain_rematch_source({**game, "_game_type": HAUSDEPP_GAME_TYPE}):
                game.pop("_hausdepp_rematch_source_pending", None)
                delete_active_game(game["_id"])
            else:
                game["_hausdepp_rematch_source_pending"] = True
                save_active_game(game)
    else:
        save_active_game(game)
    return completion


def list_hausdepp_results_for_user(user_id: int) -> list[dict]:
    if not database_schema_ready():
        return []
    with session_scope() as db:
        from .hausdepp_merge import is_merged, selected_rounds
        if is_merged(db, user_id):
            selected = sorted(selected_rounds(db, user_id),
                              key=lambda item: (as_utc(item.row.finished_at), item.row.id), reverse=True)[:30]
            rows = [item.row for item in selected]
        else:
            rows = db.scalars(select(CompletedGame).where(
                CompletedGame.game_type == HAUSDEPP_GAME_TYPE,
                CompletedGame.participants.any(GameParticipant.user_id == user_id),
            ).order_by(CompletedGame.finished_at.desc(), CompletedGame.id.desc()).limit(30)).all()
        results = []
        for row in rows:
            if not is_merged(db, user_id) and validated_hausdepp_membership(row, user_id, db=db) is None:
                continue
            payload = stored_hausdepp_result(row)
            payload.pop("achievement_evidence", None)
            payload.pop("tournament", None)
            payload["schema_version"] = 4 if payload["schema_version"] == 4 else 1
            results.append(payload)
        return results
