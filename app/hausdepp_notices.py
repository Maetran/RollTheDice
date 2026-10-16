"""Private, once-confirmed achievement/rank popup delivery, separate from XP."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import select

from .database import database_schema_ready, session_scope
from .hausdepp_achievements import (
    ACHIEVEMENTS,
    RANKS,
    _accumulate,
    _insert_once,
    _new_aggregate,
    _progress,
    synchronize_hausdepp_progress,
)
from .models import HausdeppAchievementUnlock, HausdeppNoticeReceipt, HausdeppRoundCredit
from .security import as_utc


def _achievement_notice(item: dict, unlock, credit, progress: tuple[int, int]) -> dict:
    current, target = progress
    source = None
    if credit is not None:
        facts = json.loads(credit.facts_json)
        source = {"finished_at": as_utc(credit.finished_at).isoformat(),
                  "players": facts["participant_count"], "with_computer": facts["cpu_count"] > 0}
    if current >= target:
        reason = {
            "de": f"Deine gespeicherten Runden belegen dieses Ziel: {current} von {target} erforderlichen Schritten erreicht.",
            "en": f"Your saved rounds confirm this goal: {current} of {target} required steps reached.",
        }
    else:
        # Balancing may have raised a goal after the original unlock. Honour
        # the immutable award without claiming today's higher goal was met.
        reason = {
            "de": "Dieser Erfolg wurde dir bereits nach der damals geltenden Bedingung gutgeschrieben. Er bleibt erhalten; die heutige Bedingung kann inzwischen anspruchsvoller sein.",
            "en": "This achievement was already awarded under the condition in effect at the time. You keep it; today's condition may now be more demanding.",
        }
    return {"key": f"achievement:{item['id']}", "kind": "achievement", "name": item["name"],
            "points": item["points"], "condition": item["description"], "reason": reason,
            "earned_at": as_utc(unlock.unlocked_at).isoformat(), "source": source,
            "evidence": {"current": current, "target": target, "current_condition_proven": current >= target}}


def pending_hausdepp_notices(user_id: int) -> dict:
    """Recover XP once, then read only the caller's bounded own delivery queue."""
    progress = synchronize_hausdepp_progress(user_id)
    result = {"notices": [], "revision": progress["presentation"]["revision"],
              "points": progress["scoring"]["points"]}
    if not database_schema_ready():
        return result
    with session_scope() as db:
        seen = set(db.scalars(select(HausdeppNoticeReceipt.notice_key).where(HausdeppNoticeReceipt.user_id == user_id)))
        unlocks = db.scalars(select(HausdeppAchievementUnlock).where(
            HausdeppAchievementUnlock.user_id == user_id,
        ).order_by(HausdeppAchievementUnlock.awarded_points, HausdeppAchievementUnlock.achievement_id)).all()
        credits = db.scalars(select(HausdeppRoundCredit).where(HausdeppRoundCredit.user_id == user_id)
                             .order_by(HausdeppRoundCredit.finished_at, HausdeppRoundCredit.game_id)).all()
        catalog = {item["id"]: item for item in ACHIEVEMENTS}
        wanted_sources = {unlock.source_game_id for unlock in unlocks
                          if f"achievement:{unlock.achievement_id}" not in seen and unlock.achievement_id in catalog}
        by_source = {}
        aggregate = _new_aggregate()
        # Reconstruct source-time counts from narrow validated own facts. Never
        # return opponent IDs, private card flags, raw source IDs or hands.
        for credit in credits:
            _accumulate(aggregate, json.loads(credit.facts_json))
            if credit.game_id in wanted_sources:
                by_source[credit.game_id] = (credit, {key: _progress(aggregate, key) for key in catalog})
        for unlock in unlocks:
            key = f"achievement:{unlock.achievement_id}"
            item = catalog.get(unlock.achievement_id)
            if key in seen or item is None:
                continue
            credit, counts = by_source.get(unlock.source_game_id, (None, {}))
            result["notices"].append(_achievement_notice(item, unlock, credit, counts.get(item["id"], (0, 1))))
        for rank in RANKS[1:]:
            key = f"rank:{rank['id']}"
            if key in seen or rank["threshold"] > result["points"]:
                continue
            result["notices"].append({
                "key": key, "kind": "rank", "name": rank["name"], "points": 0, "rank": rank,
                "condition": {"de": f"{rank['threshold']} EP im Hausdepp-Konto erreichen.",
                              "en": f"Reach {rank['threshold']} XP in your Hausdepp account."},
                "reason": {"de": f"Du hast jetzt {result['points']} EP und damit die Rangschwelle von {rank['threshold']} EP erreicht. Der Aufstieg vergibt keine zusätzlichen EP.",
                           "en": f"You now have {result['points']} XP, reaching this rank's {rank['threshold']} XP threshold. Ranking up grants no additional XP."},
                "quote": rank["quote"], "source": None,
            })
    return result


def acknowledge_hausdepp_notice(user_id: int, notice_key: str) -> dict:
    """Acknowledge exactly one earned item; stale clicks cannot hide later ones."""
    if not isinstance(notice_key, str) or not 1 <= len(notice_key) <= 64:
        raise ValueError("hausdepp_invalid_notice")
    queue = pending_hausdepp_notices(user_id)
    if not database_schema_ready():
        raise ValueError("hausdepp_invalid_notice")
    with session_scope() as db:
        if notice_key in {notice["key"] for notice in queue["notices"]}:
            # The first statement is the idempotent write: avoid SQLite's WAL
            # read-to-write snapshot race between simultaneous confirmations.
            _insert_once(db, HausdeppNoticeReceipt, {"user_id": user_id, "notice_key": notice_key,
                                                   "acknowledged_at": datetime.now(timezone.utc)})
        elif not db.get(HausdeppNoticeReceipt, (user_id, notice_key)):
            raise ValueError("hausdepp_invalid_notice")
    return {"acknowledged": True, "key": notice_key}
