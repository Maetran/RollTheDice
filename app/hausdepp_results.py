"""Typed round outcomes only: Hausdepp has no defined points or achievements yet."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import select

from .active_games import delete_active_game, save_active_game
from .database import session_scope
from .game_history import persist_completed_game_result
from .game_types import HAUSDEPP_GAME_TYPE
from .models import CompletedGame, GameParticipant


def finalize_hausdepp_result(game: dict) -> dict:
    state = game.get("_hausdepp") or {}
    if game.get("_aborted") or not game.get("_finished") or state.get("phase") != "finished":
        return {"result_persisted": False, "persistence_error": "hausdepp_result_not_finished"}
    participant_ids = {player["id"] for player in game.get("_participants", [])}
    order = state.get("finished_order", [])
    if (state.get("loser_id") not in participant_ids or len(order) != len(participant_ids) - 1
            or set(order) != participant_ids - {state["loser_id"]}):
        return {"result_persisted": False, "persistence_error": "hausdepp_result_invalid_outcome"}
    finished_at = datetime.fromisoformat(game["_finished_at"])
    payload = {"schema_version": 1, "payload_kind": "hausdepp_result", "game_type": HAUSDEPP_GAME_TYPE,
               "game_id": game["_id"], "name": game["_name"], "finished_at": finished_at.isoformat(),
               "participants": [{"id": player["id"], "name": player["name"], "is_cpu": bool(player.get("is_cpu"))}
                                for player in game["_participants"]],
               "loser_id": state["loser_id"], "finished_order": list(order)}
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
    with session_scope() as db:
        rows = db.scalars(select(CompletedGame).join(GameParticipant).where(
            CompletedGame.game_type == HAUSDEPP_GAME_TYPE, GameParticipant.user_id == user_id,
        ).order_by(CompletedGame.finished_at.desc()).limit(30)).all()
        return [json.loads(row.snapshot_json) for row in rows]
