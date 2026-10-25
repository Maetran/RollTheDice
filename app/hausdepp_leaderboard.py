"""Authenticated Hausdepp standings from validated completed human round seats."""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .database import database_schema_ready, session_scope
from .game_types import HAUSDEPP_GAME_TYPE
from .hausdepp_achievements import public_hausdepp_ranks
from .hausdepp_results import validated_hausdepp_membership
from .models import CompletedGame, User


def build_hausdepp_leaderboard(user_id: int, *, players: int | None = None, limit: int = 50) -> dict:
    """Rank accounts by finished rounds; ties share a place, CPUs never rank.

    The HTTP boundary owns authentication. Only outcome counts, current account
    names and their current Hausdepp title leave this service: no cards, unlocks,
    XP totals, source game IDs, foreign account IDs or tournament evidence.
    """
    if type(user_id) is not int or user_id < 1:
        raise ValueError("hausdepp_invalid_user")
    if players is not None and (type(players) is not int or not 2 <= players <= 6):
        raise ValueError("hausdepp_invalid_players")
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("hausdepp_invalid_limit")
    result = {"schema_version": 1, "game_type": HAUSDEPP_GAME_TYPE, "ranking": "finished_rounds",
              "players": players, "total_players": 0, "entries": [],
              "win_definition": {
                  "de": "Jede abgeschlossene Runde, in der du alle Karten loswirst, zählt als Sieg.",
                  "en": "Every completed round in which you finish all your cards counts as a win.",
              }}
    if not database_schema_ready():
        return result
    totals = defaultdict(lambda: {"wins": 0, "rounds_played": 0})
    with session_scope() as db:
        last_id = None
        while True:
            query = select(CompletedGame).options(selectinload(CompletedGame.participants)).where(
                CompletedGame.game_type == HAUSDEPP_GAME_TYPE,
            )
            if last_id is not None:
                query = query.where(CompletedGame.id > last_id)
            rows = db.scalars(query.order_by(CompletedGame.id).limit(250)).all()
            if not rows:
                break
            for row in rows:
                if players is not None and len(row.participants) != players:
                    continue
                for account_id in {seat.user_id for seat in row.participants if seat.user_id is not None}:
                    validated = validated_hausdepp_membership(row, account_id, db=db)
                    if validated is None:
                        continue
                    record, _private_facts = validated
                    totals[account_id]["rounds_played"] += 1
                    totals[account_id]["wins"] += int(record["outcome"] == "finished")
            last_id = rows[-1].id
        from .account_progress import owned_origin_ids
        from .hausdepp_merge import selected_rounds
        from .models import AccountProgressOrigin
        merged_owners = set(db.scalars(select(AccountProgressOrigin.owner_user_id)))
        for owner in merged_owners:
            for origin in owned_origin_ids(db, owner):
                totals.pop(origin, None)
            chosen = [item for item in selected_rounds(db, owner)
                      if players is None or item.record["participant_count"] == players]
            if chosen:
                totals[owner] = {"rounds_played": len(chosen),
                                 "wins": sum(item.record["outcome"] == "finished" for item in chosen)}
        # Resolve current names once. Historical labels never merge two accounts.
        names = dict(db.execute(select(User.id, User.username).where(
            User.id.in_(totals), User.is_active.is_(True),
        )).all()) if totals else {}
    ordered = sorted((account_id for account_id in totals if account_id in names),
                     key=lambda key: (-totals[key]["wins"], names[key].casefold(), key))
    result["total_players"] = len(ordered)
    previous_wins, place = None, 0
    with session_scope() as db:
        ranks = public_hausdepp_ranks(db, ordered[:limit])
    for index, account_id in enumerate(ordered[:limit], 1):
        counts = totals[account_id]
        if counts["wins"] != previous_wins:
            place = index
            previous_wins = counts["wins"]
        result["entries"].append({"place": place, "display_name": names[account_id], **counts,
                                  "win_rate": round(counts["wins"] / counts["rounds_played"] * 100, 1),
                                  "is_self": account_id == user_id, "rank": ranks[account_id]})
    return result
