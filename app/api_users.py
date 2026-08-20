from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from .auth import require_admin, require_csrf, require_user
from .database import database_schema_ready, session_scope
from .models import AssignmentAudit, CompletedGame, DeletedGame, GameParticipant, User
from .security import normalize_username, utcnow


router = APIRouter(prefix="/api", tags=["players"])


class AssignmentRequest(BaseModel):
    user_id: int | None


def _empty_bucket() -> dict:
    return {"games_played": 0, "points_total": 0, "max_points": None, "min_points": None, "average_points": None}


def _statistics_for_user(db, user_id: int) -> dict:
    rows = db.execute(
        select(
            CompletedGame.hardcore,
            func.count(GameParticipant.id),
            func.coalesce(func.sum(GameParticipant.points), 0),
            func.max(GameParticipant.points),
            func.min(GameParticipant.points),
            func.avg(GameParticipant.points),
        )
        .join(GameParticipant, GameParticipant.game_id == CompletedGame.id)
        .where(GameParticipant.user_id == user_id)
        .group_by(CompletedGame.hardcore)
    ).all()
    buckets = {"normal": _empty_bucket(), "hardcore": _empty_bucket()}
    for hardcore, games, points_total, maximum, minimum, average in rows:
        buckets["hardcore" if hardcore else "normal"] = {
            "games_played": int(games),
            "points_total": int(points_total),
            "max_points": int(maximum) if maximum is not None else None,
            "min_points": int(minimum) if minimum is not None else None,
            "average_points": round(float(average), 1) if average is not None else None,
        }
    normal = buckets["normal"]
    hardcore = buckets["hardcore"]
    total_games = normal["games_played"] + hardcore["games_played"]
    total_points = normal["points_total"] + hardcore["points_total"]
    maxima = [value for value in (normal["max_points"], hardcore["max_points"]) if value is not None]
    minima = [value for value in (normal["min_points"], hardcore["min_points"]) if value is not None]
    return {
        "overall": {
            "games_played": total_games,
            "points_total": total_points,
            "max_points": max(maxima) if maxima else None,
            "min_points": min(minima) if minima else None,
            "average_points": round(total_points / total_games, 1) if total_games else None,
        },
        **buckets,
    }


def _public_profile(db, user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "statistics": _statistics_for_user(db, user.id),
    }


@router.get("/players/search")
def search_players(query: str = "", limit: int = 20, offset: int = 0):
    limit = min(max(limit, 1), 100)
    offset = max(offset, 0)
    normalized = normalize_username(query)
    with session_scope() as db:
        stmt = select(User).where(User.is_active.is_(True))
        if normalized:
            stmt = stmt.where(User.username_normalized.contains(normalized))
        users = list(db.scalars(stmt.order_by(User.username_normalized).offset(offset).limit(limit)))
        return {
            "players": [{"id": user.id, "username": user.username} for user in users],
            "limit": limit,
            "offset": offset,
        }


@router.get("/players/ranking")
def player_ranking(
    sort: Literal["games", "points", "average", "maximum"] = "games",
    mode: Literal["normal", "hardcore"] = "normal",
    limit: int = 50,
    offset: int = 0,
):
    limit = min(max(limit, 1), 200)
    offset = max(offset, 0)
    games_count = func.count(GameParticipant.id)
    points_total = func.coalesce(func.sum(GameParticipant.points), 0)
    average_points = func.avg(GameParticipant.points)
    maximum_points = func.max(GameParticipant.points)
    sort_expression = {
        "games": games_count,
        "points": points_total,
        "average": average_points,
        "maximum": maximum_points,
    }[sort]
    with session_scope() as db:
        rows = db.execute(
            select(User, games_count, points_total, average_points, maximum_points)
            .join(GameParticipant, GameParticipant.user_id == User.id)
            .join(CompletedGame, CompletedGame.id == GameParticipant.game_id)
            .where(
                User.is_active.is_(True),
                CompletedGame.hardcore.is_(mode == "hardcore"),
            )
            .group_by(User.id)
            .order_by(sort_expression.desc().nullslast(), User.username_normalized)
            .offset(offset)
            .limit(limit)
        ).all()
        return {
            "players": [
                {
                    "rank": offset + index + 1,
                    "id": user.id,
                    "username": user.username,
                    "games_played": int(games),
                    "points_total": int(points),
                    "average_points": round(float(average), 1) if average is not None else None,
                    "max_points": int(maximum) if maximum is not None else None,
                }
                for index, (user, games, points, average, maximum) in enumerate(rows)
            ],
            "sort": sort,
            "mode": mode,
            "limit": limit,
            "offset": offset,
        }


@router.get("/players/{username}")
def public_player_profile(username: str):
    with session_scope() as db:
        user = db.scalar(
            select(User).where(
                User.username_normalized == normalize_username(username),
                User.is_active.is_(True),
            )
        )
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="player_not_found")
        return {"player": _public_profile(db, user)}


@router.get("/users/me/statistics")
def own_statistics(request: Request):
    identity = require_user(request)
    with session_scope() as db:
        user = db.get(User, identity.user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found")
        return {"player": _public_profile(db, user), "private": {"role": user.role}}


@router.get("/admin/game-participants")
def admin_game_participants(
    request: Request,
    unassigned: bool = True,
    query: str = "",
    limit: int = 100,
    offset: int = 0,
):
    require_admin(request)
    limit = min(max(limit, 1), 200)
    offset = max(offset, 0)
    with session_scope() as db:
        stmt = (
            select(GameParticipant)
            .options(selectinload(GameParticipant.game), selectinload(GameParticipant.user))
            .join(CompletedGame, CompletedGame.id == GameParticipant.game_id)
        )
        if unassigned:
            stmt = stmt.where(GameParticipant.user_id.is_(None))
        if query.strip():
            needle = f"%{query.strip().casefold()}%"
            stmt = stmt.where(func.lower(GameParticipant.display_name).like(needle))
        participants = list(
            db.scalars(stmt.order_by(CompletedGame.finished_at.desc(), GameParticipant.position).offset(offset).limit(limit))
        )
        return {
            "participants": [
                {
                    "id": participant.id,
                    "game_id": participant.game.game_id,
                    "game_name": participant.game.game_name,
                    "finished_at": participant.game.finished_at,
                    "mode": participant.game.mode,
                    "hardcore": participant.game.hardcore,
                    "display_name": participant.display_name,
                    "team": participant.team,
                    "points": participant.points,
                    "user": (
                        {"id": participant.user.id, "username": participant.user.username}
                        if participant.user else None
                    ),
                }
                for participant in participants
            ],
            "limit": limit,
            "offset": offset,
        }


@router.get("/admin/completed-games")
def admin_completed_games(request: Request, query: str = "", limit: int = 100, offset: int = 0):
    require_admin(request)
    limit = min(max(limit, 1), 200)
    offset = max(offset, 0)
    with session_scope() as db:
        stmt = select(CompletedGame).options(
            selectinload(CompletedGame.participants).selectinload(GameParticipant.user)
        )
        if query.strip():
            needle = f"%{query.strip().casefold()}%"
            matching_games = select(GameParticipant.game_id).where(
                func.lower(GameParticipant.display_name).like(needle)
            )
            stmt = stmt.where(
                func.lower(CompletedGame.game_name).like(needle)
                | func.lower(CompletedGame.game_id).like(needle)
                | CompletedGame.id.in_(matching_games)
            )
        games = list(db.scalars(
            stmt.order_by(CompletedGame.finished_at.desc()).offset(offset).limit(limit)
        ))
        return {
            "games": [{
                "game_id": game.game_id,
                "game_name": game.game_name,
                "finished_at": game.finished_at,
                "mode": game.mode,
                "hardcore": game.hardcore,
                "imported_from_legacy": game.imported_from_legacy,
                "participants": [{
                    "display_name": participant.display_name,
                    "points": participant.points,
                    "username": participant.user.username if participant.user else None,
                } for participant in game.participants],
            } for game in games],
            "limit": limit,
            "offset": offset,
        }


@router.get("/admin/deleted-games")
def admin_deleted_games(request: Request, limit: int = 50):
    require_admin(request)
    limit = min(max(limit, 1), 200)
    with session_scope() as db:
        rows = db.execute(
            select(DeletedGame, User.username)
            .join(User, User.id == DeletedGame.deleted_by_user_id)
            .order_by(DeletedGame.deleted_at.desc())
            .limit(limit)
        ).all()
        return {"games": [{
            "game_id": game.game_id,
            "game_name": game.game_name,
            "finished_at": game.finished_at,
            "mode": game.mode,
            "hardcore": game.hardcore,
            "deleted_at": game.deleted_at,
            "deleted_by": username,
            "reason": game.reason,
        } for game, username in rows]}


@router.put("/admin/game-participants/{participant_id}/assignment")
def assign_game_participant(participant_id: int, payload: AssignmentRequest, request: Request):
    identity = require_admin(request)
    require_csrf(request, identity)
    with session_scope() as db:
        participant = db.get(GameParticipant, participant_id)
        if not participant:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="participant_not_found")
        if payload.user_id is not None:
            target = db.get(User, payload.user_id)
            if not target or not target.is_active:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found")
        previous_user_id = participant.user_id
        if previous_user_id == payload.user_id:
            return {"ok": True, "changed": False}
        participant.user_id = payload.user_id
        participant.assigned_by_user_id = identity.user_id
        participant.assigned_at = utcnow()
        db.add(AssignmentAudit(
            participant_id=participant.id,
            previous_user_id=previous_user_id,
            new_user_id=payload.user_id,
            admin_user_id=identity.user_id,
            changed_at=utcnow(),
        ))
        return {"ok": True, "changed": True}


def profile_links_for_games(game_ids: set[str]) -> dict[str, list[dict]]:
    if not game_ids or not database_schema_ready():
        return {}
    with session_scope() as db:
        rows = db.execute(
            select(CompletedGame.game_id, GameParticipant.display_name, GameParticipant.points, User.id, User.username)
            .join(GameParticipant, GameParticipant.game_id == CompletedGame.id)
            .join(User, User.id == GameParticipant.user_id)
            .where(CompletedGame.game_id.in_(game_ids), User.is_active.is_(True))
            .order_by(GameParticipant.position)
        ).all()
        result: dict[str, list[dict]] = {}
        for game_id, display_name, points, user_id, username in rows:
            result.setdefault(game_id, []).append({
                "user_id": user_id,
                "username": username,
                "display_name": display_name,
                "points": int(points),
            })
        return result
