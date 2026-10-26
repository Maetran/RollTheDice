"""Original dice-game seats for progress; never an authentication alias."""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from collections.abc import Iterable

from sqlalchemy import inspect, select
from sqlalchemy.orm import selectinload

from .account_progress import owned_origin_ids, progress_owner_ids
from .game_types import DEFAULT_GAME_TYPE
from .models import CompletedGame, GameParticipant, User, UserEngagementEvent


def origin_ids_for_progress(db, owner_id: int, *, origin_ids: Iterable[int] | None = None) -> tuple[int, ...]:
    if origin_ids is not None:
        return tuple(sorted(set(origin_ids)))
    # Historical migrations invoke the evaluator before the ownership migration.
    if not inspect(db.connection()).has_table("account_progress_origins"):
        return (owner_id,)
    return owned_origin_ids(db, owner_id)


def owners_for_progress(db, ids: Iterable[int]) -> dict[int, int]:
    ids = set(ids)
    if not ids or not inspect(db.connection()).has_table("account_progress_origins"):
        return {value: value for value in ids}
    return progress_owner_ids(db, ids)


def engagement_counts_for_origins(db, origin_ids: Iterable[int]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for row in db.scalars(select(UserEngagementEvent).where(UserEngagementEvent.user_id.in_(tuple(origin_ids)))):
        counts[str(row.event_key)] += int(row.count)
    return dict(counts)


def zdwa_seat_candidates(db, owner_id: int, *, origin_ids=None, excluded_completed_game_id=None, game_ceiling=None,
                         recorded_through=None):
    ids = origin_ids_for_progress(db, owner_id, origin_ids=origin_ids)
    query = (select(CompletedGame, GameParticipant)
             .join(GameParticipant, GameParticipant.game_id == CompletedGame.id)
             .options(selectinload(CompletedGame.participants))
             .where(GameParticipant.user_id.in_(ids), CompletedGame.game_type == DEFAULT_GAME_TYPE))
    if excluded_completed_game_id is not None:
        query = query.where(CompletedGame.id != excluded_completed_game_id)
    if game_ceiling is not None:
        query = query.where(CompletedGame.id <= game_ceiling)
    if recorded_through is not None:
        query = query.where(CompletedGame.created_at <= recorded_through,
                            (GameParticipant.assigned_at.is_(None)) | (GameParticipant.assigned_at <= recorded_through))
    return list(db.execute(query.order_by(CompletedGame.finished_at, CompletedGame.id, GameParticipant.position)))


def original_seat_tiebreak(participant):
    return (int(participant.position), str(participant.player_key), int(participant.user_id), int(participant.id))


def selected_zdwa_seats(db, owner_id: int, *, origin_ids=None, excluded_completed_game_id=None, game_ceiling=None,
                        recorded_through=None):
    grouped = defaultdict(list)
    for game, seat in zdwa_seat_candidates(
        db, owner_id, origin_ids=origin_ids, excluded_completed_game_id=excluded_completed_game_id,
        game_ceiling=game_ceiling, recorded_through=recorded_through,
    ):
        grouped[game.id].append((game, seat))
    return [min(group, key=lambda pair: (-int(pair[1].points), original_seat_tiebreak(pair[1])))
            for group in grouped.values()]


def resolution_metadata(game, participant, *, policy_version=1):
    fingerprint = hashlib.sha256(json.dumps({
        "game_type": game.game_type, "game_id": game.game_id, "snapshot": game.snapshot_json,
        "seats": sorted((seat.id, seat.user_id, seat.player_key, seat.position, seat.team, seat.points)
                        for seat in game.participants),
    }, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"game_type": str(game.game_type), "game_id": str(game.game_id),
            "origin_user_id": int(participant.user_id), "participant_id": int(participant.id),
            "player_key": str(participant.player_key), "source_fingerprint": fingerprint,
            "policy_version": policy_version}


def origin_users(db, owner_id, *, origin_ids=None):
    return {user.id: user for user in db.scalars(select(User).where(
        User.id.in_(origin_ids_for_progress(db, owner_id, origin_ids=origin_ids)),
    ))}
