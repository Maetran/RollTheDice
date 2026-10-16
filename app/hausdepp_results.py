"""Typed round outcomes only: Hausdepp has no defined points or achievements yet."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import select

from .active_games import delete_active_game, save_active_game
from .database import database_schema_ready, session_scope
from .game_history import persist_completed_game_result
from .game_types import HAUSDEPP_GAME_TYPE
from .models import CompletedGame, GameParticipant
from .security import as_utc


def validate_hausdepp_result(payload: object) -> dict:
    """Project the known result schema, never private live-game fields.

    The loser is the only final outcome. The other seats have an exit order,
    which deliberately does not imply a points score or a winner award.
    """
    if (not isinstance(payload, dict) or type(payload.get("schema_version")) is not int
            or payload.get("schema_version") != 1 or payload.get("payload_kind") != "hausdepp_result"
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
            or any(not isinstance(key, str) for key in order) or not isinstance(loser, str)
            or loser not in participant_ids or len(order) != len(participants) - 1
            or set(order) != participant_ids - {loser}):
        raise ValueError("hausdepp_result_invalid_outcome")
    return {"schema_version": 1, "payload_kind": "hausdepp_result", "game_type": HAUSDEPP_GAME_TYPE,
            "game_id": game_id, "name": name, "finished_at": finished_at,
            "participants": participants, "loser_id": loser, "finished_order": list(order)}


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
        payload = validate_hausdepp_result({
            "schema_version": 1, "payload_kind": "hausdepp_result", "game_type": HAUSDEPP_GAME_TYPE,
            "game_id": game["_id"], "name": game["_name"], "finished_at": game["_finished_at"],
            "participants": [{"id": player["id"], "name": player["name"], "is_cpu": bool(player.get("is_cpu"))}
                             for player in game["_participants"]],
            "loser_id": state.get("loser_id"), "finished_order": state.get("finished_order"),
        })
    except (KeyError, TypeError, ValueError):
        return {"result_persisted": False, "persistence_error": "hausdepp_result_invalid_outcome"}
    finished_at = datetime.fromisoformat(payload["finished_at"])
    result = persist_completed_game_result(
        game_id=game["_id"], game_name=game["_name"], game_type=HAUSDEPP_GAME_TYPE, mode=game["_mode"],
        hardcore=False, finished_at=finished_at.astimezone(timezone.utc), snapshot=payload,
        participants=[{"player_key": player["id"], "display_name": player["name"], "user_id": player.get("user_id")}
                      for player in game["_participants"]],
    )
    completion = {"result_persisted": result.succeeded, "persistence_error": result.reason}
    game["_final_completion"] = completion
    if result.succeeded:
        game["_completion_persisted"] = True
        delete_active_game(game["_id"])
    else:
        save_active_game(game)
    return completion


def list_hausdepp_results_for_user(user_id: int) -> list[dict]:
    if not database_schema_ready():
        return []
    with session_scope() as db:
        rows = db.scalars(select(CompletedGame).where(
            CompletedGame.game_type == HAUSDEPP_GAME_TYPE,
            CompletedGame.participants.any(GameParticipant.user_id == user_id),
        ).order_by(CompletedGame.finished_at.desc(), CompletedGame.id.desc()).limit(30)).all()
        return [payload for row in rows if (payload := stored_hausdepp_result(row)) is not None]
