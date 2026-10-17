"""What each person at a Hausdepp table earned in the round just finished.

Shown only on that table's result: the round XP and the achievements this very
round unlocked for each seated account. No account totals, ranks or other
rounds leave this module; computers earn nothing and appear without XP.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from .database import database_schema_ready, session_scope
from .hausdepp_achievements import _ACHIEVEMENTS_BY_ID, CPU_ROUND_POINTS, ROUND_POINTS
from .models import HausdeppAchievementUnlock, HausdeppRoundCredit

logger = logging.getLogger(__name__)


def build_round_summary(result_id: str, participants: list[dict]) -> dict | None:
    people = {participant["id"]: participant["user_id"] for participant in participants
              if not participant.get("is_cpu") and type(participant.get("user_id")) is int}
    if not people or not database_schema_ready():
        return {"round_id": result_id, "players": {}}
    try:
        with session_scope() as db:
            credits = {credit.user_id: json.loads(credit.facts_json) for credit in db.scalars(
                select(HausdeppRoundCredit).where(HausdeppRoundCredit.game_id == result_id,
                                                  HausdeppRoundCredit.user_id.in_(set(people.values()))))}
            unlocks = defaultdict(list)
            for unlock in db.scalars(select(HausdeppAchievementUnlock).where(
                    HausdeppAchievementUnlock.source_game_id == result_id,
                    HausdeppAchievementUnlock.user_id.in_(set(people.values())))
                    .order_by(HausdeppAchievementUnlock.awarded_points.desc(), HausdeppAchievementUnlock.achievement_id)):
                unlocks[unlock.user_id].append((unlock.achievement_id, unlock.awarded_points))
    except SQLAlchemyError:
        logger.exception("Hausdepp round summary unavailable for %s", result_id)
        return None
    players = {}
    for player_id, user_id in people.items():
        facts = credits.get(user_id)
        if facts is None:
            players[player_id] = {"xp": None, "round_xp": None, "achievements": []}
            continue
        round_xp = CPU_ROUND_POINTS if facts.get("cpu_count") else ROUND_POINTS
        achievements = [{"id": achievement_id, "points": points, "name": dict(_ACHIEVEMENTS_BY_ID[achievement_id]["name"])}
                        for achievement_id, points in unlocks[user_id] if achievement_id in _ACHIEVEMENTS_BY_ID]
        players[player_id] = {"xp": round_xp + sum(item["points"] for item in achievements),
                              "round_xp": round_xp, "achievements": achievements}
    return {"round_id": result_id, "players": players}
