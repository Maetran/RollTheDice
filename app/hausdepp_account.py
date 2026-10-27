"""Private Hausdepp account facts and XP from validated durable round outcomes.

Read all-time facts in bounded source pages. Only keep the requested history
page in memory, and require relational account membership before decoding JSON.
Hausdepp XP and achievements remain separate from other games and public feeds.
"""

from __future__ import annotations

import base64
import binascii
import json
from collections import defaultdict
from datetime import datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import selectinload

from .account_progress import progress_owner_ids
from .database import database_schema_ready, session_scope
from .game_types import HAUSDEPP_GAME_TYPE
from .hausdepp_achievements import synchronize_hausdepp_progress, synchronize_hausdepp_progress_in_session
from .hausdepp_results import validated_hausdepp_membership
from .models import CompletedGame, GameParticipant, HausdeppWithdrawal, User
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


def _private_round(row: CompletedGame, user_id: int, *, db=None) -> dict | None:
    validated = validated_hausdepp_membership(row, user_id, db=db)
    return validated[0] if validated else None


def _account_boundary(user_id, before, limit):
    boundary = _decode_cursor(before)
    if type(limit) is not int or not 1 <= limit <= HAUSDEPP_HISTORY_MAX_LIMIT:
        raise ValueError("hausdepp_invalid_limit")
    if type(user_id) is not int or user_id < 1:
        raise ValueError("hausdepp_invalid_user")
    return boundary


def _empty_account(progress):
    return {"schema_version": 2, "game_type": HAUSDEPP_GAME_TYPE,
            "statistics": {"rounds_played": 0, "hausdepp_rounds": 0, "finished_rounds": 0, "last_finished_at": None},
            "history": {"rounds": [], "next_cursor": None}, "favorite_opponents": [], **progress}


def _withdrawals_for_rows(db, rows):
    ids = [row.game_id for row in rows]
    result = set()
    for start in range(0, len(ids), HAUSDEPP_ACCOUNT_SOURCE_PAGE_SIZE):
        result.update(db.execute(select(HausdeppWithdrawal.user_id, HausdeppWithdrawal.result_id).where(
            HausdeppWithdrawal.result_id.in_(ids[start:start + HAUSDEPP_ACCOUNT_SOURCE_PAGE_SIZE]),
        )).all())
    return result


def _accumulate_opponents(db, row, record, owner_id, counts, owner_cache, withdrawals):
    """Only compare a surviving seat with the single loser; peers did not draw."""
    if record["outcome"] not in {"finished", "hausdepp"}:
        return
    seats = {seat.player_key: seat for seat in row.participants}
    accounts = {seat.user_id for seat in row.participants if seat.user_id is not None}
    missing = accounts - owner_cache.keys()
    if missing:
        owner_cache.update(progress_owner_ids(db, missing))
    outcomes = defaultdict(set)
    for player in record["participants"]:
        seat = seats[player["id"]]
        if seat.user_id is None or player["is_cpu"] or player["outcome"] not in {"finished", "hausdepp"}:
            continue
        # Durable withdrawal records also override historical result JSON.
        if (seat.user_id, row.game_id) in withdrawals:
            continue
        outcomes[owner_cache[seat.user_id]].add(player["outcome"])
    # If a merged account held both the losing and a finishing seat, there is
    # no unambiguous head-to-head result for that account in this round.
    if outcomes.get(owner_id) != {record["outcome"]}:
        return
    for opponent, results in outcomes.items():
        if opponent == owner_id or len(results) != 1 or record["outcome"] in results:
            continue
        counts[opponent]["wins" if record["outcome"] == "finished" else "losses"] += 1


def _favorite_opponents(db, counts):
    eligible = {user_id: values for user_id, values in counts.items() if sum(values.values()) > 10}
    if not eligible:
        return []
    users = db.scalars(select(User).where(User.id.in_(eligible), User.is_active.is_(True))).all()
    rows = [{"name": user.username, "wins": eligible[user.id]["wins"], "losses": eligible[user.id]["losses"],
             "draws": 0, "games": sum(eligible[user.id].values())} for user in users]
    return sorted(rows, key=lambda row: (-row["games"], row["name"].casefold(), row["name"]))


def build_hausdepp_account_for_user(
    user_id: int, *, before: str | None = None, limit: int = HAUSDEPP_HISTORY_DEFAULT_LIMIT,
) -> dict:
    """Return only the caller's all-time facts and stable private history page."""
    _account_boundary(user_id, before, limit)
    if not database_schema_ready():
        return _empty_account(synchronize_hausdepp_progress(user_id))
    with session_scope() as db:
        return build_hausdepp_account_for_user_in_session(db, user_id, before=before, limit=limit)


def build_hausdepp_account_for_user_in_session(
    db, user_id: int, *, before: str | None = None, limit: int = HAUSDEPP_HISTORY_DEFAULT_LIMIT,
) -> dict:
    """Read/recover one original account without owning its transaction.

    A cursor is only a sort boundary. Each query still requires this original
    user's membership. The caller provides a ready schema and owns rollback.
    """
    boundary = _account_boundary(user_id, before, limit)
    # Explicit request-local handoff; never cached across transactions/writes.
    projection_context = {}
    response = _empty_account(synchronize_hausdepp_progress_in_session(db, user_id, projection_context=projection_context))
    statistics = response["statistics"]
    history = response["history"]["rounds"]
    next_cursor = None
    page_end = None
    opponent_counts = defaultdict(lambda: {"wins": 0, "losses": 0})
    owner_cache = {}
    from .hausdepp_merge import is_merged
    if is_merged(db, user_id):
        selected = sorted(projection_context["inputs"].rounds,
                          key=lambda item: (as_utc(item.row.finished_at), item.row.id), reverse=True)
        withdrawals = _withdrawals_for_rows(db, [item.row for item in selected])
        for item in selected:
            record = item.record
            _accumulate_opponents(db, item.row, record, user_id, opponent_counts, owner_cache, withdrawals)
            statistics["rounds_played"] += 1
            if record["outcome"] in {"finished", "hausdepp"}:
                statistics[f"{record['outcome']}_rounds"] += 1
            if statistics["last_finished_at"] is None:
                statistics["last_finished_at"] = record["finished_at"]
        eligible = [item for item in selected if boundary is None or (as_utc(item.row.finished_at), item.row.id) < boundary]
        page = eligible[:limit]
        history.extend(item.record for item in page)
        response["history"]["next_cursor"] = _cursor(page[-1].row) if len(eligible) > limit else None
        response["favorite_opponents"] = _favorite_opponents(db, opponent_counts)
        return response
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
        withdrawals = _withdrawals_for_rows(db, rows)
        for row in rows:
            record = _private_round(row, user_id, db=db)
            if record is None:
                continue
            _accumulate_opponents(db, row, record, user_id, opponent_counts, owner_cache, withdrawals)
            statistics["rounds_played"] += 1
            if record["outcome"] in {"finished", "hausdepp"}:
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
    response["favorite_opponents"] = _favorite_opponents(db, opponent_counts)
    return response
