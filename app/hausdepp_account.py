"""Private Hausdepp account facts from validated durable round outcomes.

Read all-time facts in bounded source pages. Only keep the requested history
page in memory, and require relational account membership before decoding JSON.
No public ranking, points, achievement thresholds or cross-game totals exist.
"""

from __future__ import annotations

import base64
import binascii
import json
from datetime import datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import selectinload

from .database import database_schema_ready, session_scope
from .game_types import HAUSDEPP_GAME_TYPE
from .hausdepp_results import stored_hausdepp_result
from .models import CompletedGame, GameParticipant
from .security import as_utc

HAUSDEPP_HISTORY_DEFAULT_LIMIT = 12
HAUSDEPP_HISTORY_MAX_LIMIT = 30
HAUSDEPP_ACCOUNT_SOURCE_PAGE_SIZE = 250


def _cursor(row: CompletedGame) -> str:
    raw = json.dumps({"v": 1, "at": as_utc(row.finished_at).isoformat(), "id": row.id},
                     separators=(",", ":")).encode("ascii")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_cursor(value: str | None) -> tuple[datetime, int] | None:
    if value is None:
        return None
    try:
        if not isinstance(value, str) or not 1 <= len(value) <= 256:
            raise ValueError
        raw = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
        payload = json.loads(raw)
        if (not isinstance(payload, dict) or set(payload) != {"v", "at", "id"}
                or type(payload["v"]) is not int or payload["v"] != 1
                or type(payload["id"]) is not int or payload["id"] < 1
                or not isinstance(payload["at"], str)):
            raise ValueError
        parsed = datetime.fromisoformat(payload["at"])
        if parsed.tzinfo is None:
            raise ValueError
        return as_utc(parsed), payload["id"]
    except (TypeError, ValueError, OverflowError, binascii.Error) as exc:
        raise ValueError("hausdepp_invalid_cursor") from exc


def _private_round(row: CompletedGame, user_id: int) -> dict | None:
    payload = stored_hausdepp_result(row)
    if payload is None:
        return None
    # Snapshot player keys cannot replace durable account membership. Refuse
    # ambiguous historic ownership instead of attributing two seats to a user.
    own_seats = [seat for seat in row.participants if seat.user_id == user_id]
    if len(own_seats) != 1:
        return None
    stored_seats = {seat.player_key: seat for seat in row.participants}
    if set(stored_seats) != {player["id"] for player in payload["participants"]}:
        return None
    participants = []
    finish_positions = {key: index + 1 for index, key in enumerate(payload["finished_order"])}
    for player in payload["participants"]:
        seat = stored_seats[player["id"]]
        if player["name"] != seat.display_name or (player["is_cpu"] and seat.user_id is not None):
            return None
        participants.append({**player, "outcome": "hausdepp" if player["id"] == payload["loser_id"] else "finished",
                             "finished_position": finish_positions.get(player["id"])})
    own = next(player for player in participants if player["id"] == own_seats[0].player_key)
    return {"game_id": payload["game_id"], "name": payload["name"], "finished_at": payload["finished_at"],
            "player_id": own["id"], "outcome": own["outcome"], "finished_position": own["finished_position"],
            "participant_count": len(participants), "cpu_count": sum(player["is_cpu"] for player in participants),
            "participants": participants}


def build_hausdepp_account_for_user(
    user_id: int, *, before: str | None = None, limit: int = HAUSDEPP_HISTORY_DEFAULT_LIMIT,
) -> dict:
    """Return only the caller's all-time facts and stable private history page.

    A cursor is merely a sort boundary. It carries no authorization: every
    source query independently filters by the requesting user's membership.
    """
    boundary = _decode_cursor(before)
    if type(limit) is not int or not 1 <= limit <= HAUSDEPP_HISTORY_MAX_LIMIT:
        raise ValueError("hausdepp_invalid_limit")
    if type(user_id) is not int or user_id < 1:
        raise ValueError("hausdepp_invalid_user")
    statistics = {"rounds_played": 0, "hausdepp_rounds": 0, "finished_rounds": 0, "last_finished_at": None}
    history: list[dict] = []
    next_cursor = None
    page_end = None
    response = {"schema_version": 1, "game_type": HAUSDEPP_GAME_TYPE, "statistics": statistics,
                "history": {"rounds": history, "next_cursor": None}, "scoring": {"available": False},
                "achievements": {"available": False, "direction": "clever_to_hausdepp"}}
    if not database_schema_ready():
        return response
    with session_scope() as db:
        scan_boundary = None
        while True:
            statement = select(CompletedGame).options(selectinload(CompletedGame.participants)).where(
                CompletedGame.game_type == HAUSDEPP_GAME_TYPE,
                CompletedGame.participants.any(GameParticipant.user_id == user_id),
            )
            if scan_boundary is not None:
                at, row_id = scan_boundary
                statement = statement.where(or_(
                    CompletedGame.finished_at < at,
                    and_(CompletedGame.finished_at == at, CompletedGame.id < row_id),
                ))
            rows = db.scalars(statement.order_by(CompletedGame.finished_at.desc(), CompletedGame.id.desc())
                              .limit(HAUSDEPP_ACCOUNT_SOURCE_PAGE_SIZE)).all()
            if not rows:
                break
            for row in rows:
                record = _private_round(row, user_id)
                if record is None:
                    continue
                statistics["rounds_played"] += 1
                statistics[f"{record['outcome']}_rounds"] += 1
                if statistics["last_finished_at"] is None:
                    statistics["last_finished_at"] = record["finished_at"]
                if boundary is not None and (as_utc(row.finished_at), row.id) >= boundary:
                    continue
                if len(history) < limit:
                    history.append(record)
                    page_end = _cursor(row)
                elif next_cursor is None:
                    next_cursor = page_end
            scan_boundary = (rows[-1].finished_at, rows[-1].id)
    response["history"]["next_cursor"] = next_cursor
    return response
