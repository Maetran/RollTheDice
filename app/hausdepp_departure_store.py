"""Atomically retain a departure checkpoint and optional account forfeiture."""

from __future__ import annotations

import json
import logging
from datetime import datetime

from sqlalchemy import select

from .active_games import serializable_game_state
from .database import database_schema_ready, session_scope
from .game_types import game_type_from_state
from .models import ActiveGame, HausdeppWithdrawal
from .security import as_utc, utcnow

logger = logging.getLogger(__name__)


def source_not_withdrawn(user_column, result_column):
    """Reusable relational exclusion for every normal scoring reader."""
    return ~select(HausdeppWithdrawal.result_id).where(
        HausdeppWithdrawal.user_id == user_column, HausdeppWithdrawal.result_id == result_column,
    ).exists()


def _departure_context(game, user_id, player_id, result_id, departed_at, forfeited_round):
    if (not isinstance(game, dict) or game_type_from_state(game) != "hausdepp"
            or not game.get("_started") or game.get("_aborted")
            or type(forfeited_round) is not bool or (user_id is not None and (type(user_id) is not int or user_id < 1))
            or not isinstance(player_id, str) or not 1 <= len(player_id) <= 64
            or not isinstance(result_id, str) or not 1 <= len(result_id) <= 64):
        raise ValueError("hausdepp_invalid_departure")
    try:
        at = datetime.fromisoformat(departed_at) if isinstance(departed_at, str) else departed_at
        if not isinstance(at, datetime) or at.tzinfo is None:
            raise ValueError
        at = as_utc(at)
        marker = game["_hausdepp_departures"][player_id]
        marker_at = datetime.fromisoformat(marker["departed_at"])
        tournament = game.get("_hausdepp_tournament")
        round_number = tournament["round_number"] if tournament else 1
        from .hausdepp_tournament import round_result_id

        expected_id = round_result_id(game["_id"], round_number) if tournament else game["_id"]
        seats = [seat for seat in game["_participants"] if seat["id"] == player_id]
        if (not isinstance(marker, dict) or type(marker.get("round_number")) is not int
                or type(round_number) is not int or not 1 <= round_number <= 48
                or marker["round_number"] != round_number or marker_at.tzinfo is None or as_utc(marker_at) != at
                or marker.get("forfeited_round") is not forfeited_round or expected_id != result_id
                or len(seats) != 1 or seats[0].get("is_cpu") or seats[0].get("user_id") != user_id
                or user_id is not None and type(seats[0].get("user_id")) is not int
                or (forfeited_round and player_id not in game["_hausdepp"].get("withdrawn_ids", []))):
            raise ValueError
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise ValueError("hausdepp_invalid_departure") from exc
    return at, marker


def persist_hausdepp_departure(proposed_game: dict, *, user_id: int | None, player_id: str, result_id: str,
                              departed_at: datetime | str, forfeited_round: bool) -> dict:
    """Commit before the caller publishes its proposed state; failures propagate.

    The socket adapter owns current-socket authentication and the game lock.
    Guests and players who already finished retain their checkpoint without
    minting a forfeiture or an account award. A retry never overwrites a newer
    checkpoint. Account reads can recover an award after the commit succeeds.
    """
    at, marker = _departure_context(proposed_game, user_id, player_id, result_id, departed_at, forfeited_round)
    if not database_schema_ready():
        raise RuntimeError("hausdepp_departure_database_unavailable")
    game_id = proposed_game["_id"]
    payload = json.dumps(serializable_game_state(proposed_game), ensure_ascii=False, separators=(",", ":"))
    now = utcnow()
    already = False
    with session_scope() as db:
        # Reserve SQLite's writer before reading. On PostgreSQL the row lock
        # serializes this checkpoint with any other durable writer.
        if db.bind.dialect.name == "sqlite":
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        stored = db.scalar(select(ActiveGame).where(ActiveGame.game_id == game_id).with_for_update())
        current = json.loads(stored.state_json) if stored else {}
        previous = current.get("_hausdepp_departures", {}).get(player_id)
        if previous is not None:
            if previous != marker:
                raise ValueError("hausdepp_departure_conflict")
            already = True
        if not already:
            current_round = (current.get("_hausdepp_tournament") or {}).get("round_number", 1)
            current_version = (current.get("_hausdepp") or {}).get("version", 0)
            proposed_version = (proposed_game.get("_hausdepp") or {}).get("version", 0)
            if (current_round, current_version) > (marker["round_number"], proposed_version):
                raise ValueError("hausdepp_departure_stale_checkpoint")
            if stored is None:
                db.add(ActiveGame(game_id=game_id, state_json=payload, created_at=now, updated_at=now))
            else:
                stored.state_json, stored.updated_at = payload, now
        if forfeited_round and user_id is not None:
            receipt = db.get(HausdeppWithdrawal, (user_id, result_id))
            if receipt is None:
                db.add(HausdeppWithdrawal(user_id=user_id, result_id=result_id, table_game_id=game_id,
                                         player_id=player_id, departed_at=at, schema_version=1))
            elif receipt.table_game_id != game_id or receipt.player_id != player_id or as_utc(receipt.departed_at) != at:
                raise ValueError("hausdepp_departure_conflict")
    if forfeited_round and user_id is not None:
        try:
            from .hausdepp_achievements import synchronize_hausdepp_progress

            synchronize_hausdepp_progress(user_id)
        except Exception:
            logger.exception("Hausdepp withdrawal award reconciliation failed for %s", result_id)
    return {"departure_persisted": True, "already_persisted": already}
