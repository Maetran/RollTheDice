"""How experienced the people at a Hausdepp table are.

New accounts meet gentler computers and receive table tips during their first
rounds. Only completed Hausdepp rounds of the seated accounts are counted once
when a table starts; nothing is stored beyond the running table.
"""

from __future__ import annotations

import logging
from typing import Iterable

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from .database import database_schema_ready, session_scope
from .game_types import HAUSDEPP_GAME_TYPE
from .models import CompletedGame, GameParticipant

logger = logging.getLogger(__name__)

# Computers reach full strength and tips stop after this many own rounds.
GENTLE_ROUNDS = 50


def completed_rounds(user_ids: Iterable[object]) -> dict[int, int]:
    ids = sorted({user_id for user_id in user_ids if type(user_id) is int and user_id > 0})
    if not ids or not database_schema_ready():
        return {}
    try:
        with session_scope() as db:
            rows = db.execute(
                select(GameParticipant.user_id, func.count(func.distinct(CompletedGame.id)))
                .join(CompletedGame, GameParticipant.game_id == CompletedGame.id)
                .where(CompletedGame.game_type == HAUSDEPP_GAME_TYPE, GameParticipant.user_id.in_(ids))
                .group_by(GameParticipant.user_id)
            ).all()
    except SQLAlchemyError:
        logger.exception("Hausdepp experience lookup failed; computers play at full strength")
        return {}
    return {int(user_id): int(count) for user_id, count in rows}


def record_table_experience(game: dict) -> None:
    """Remember each seated person's completed rounds for this table."""
    people = {participant["id"]: participant.get("user_id") for participant in game.get("_participants", [])
              if not participant.get("is_cpu") and participant.get("user_id")}
    counts = completed_rounds(people.values())
    game["_hausdepp_experience"] = {player_id: counts.get(user_id, 0) for player_id, user_id in people.items()}


def table_skill(game: dict) -> float:
    """1.0 is full strength; the newest person at the table sets the pace."""
    experience = game.get("_hausdepp_experience") or {}
    if not experience:
        return 1.0
    newest = min(experience.values())
    return 0.55 + 0.45 * min(newest, GENTLE_ROUNDS) / GENTLE_ROUNDS


def wants_tips(game: dict, player_id: str | None) -> bool:
    experience = game.get("_hausdepp_experience") or {}
    return player_id in experience and experience[player_id] < GENTLE_ROUNDS
