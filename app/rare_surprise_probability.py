"""Durable player chances for shared table surprises.

The caller owns the checkpoint transaction. One shared lock serializes decisions
across concurrent rooms, including first-time counters on SQLite/PostgreSQL.
"""
from __future__ import annotations

import secrets

from sqlalchemy import update

from .models import RareSurpriseCounter, RareSurpriseLock, RareSurpriseOffer

EFFECTS = ("star", "hammer", "ufo", "portal", "dragon", "kraken", "clock", "blackhole")


def _lock(db):
    changed = db.execute(update(RareSurpriseLock).where(RareSurpriseLock.id == 1)
                         .values(id=RareSurpriseLock.id))
    if changed.rowcount != 1:
        raise RuntimeError("rare_surprise_lock_missing")


def start_game(db, game_type: str, game_key: str, user_ids) -> None:
    """Count exactly once, drawing the common result at the highest chance."""
    ids = sorted({value for value in user_ids if type(value) is int and value > 0})
    from .account_progress import lock_account_rows

    lock_account_rows(db, ids)
    _lock(db)
    key = (game_type, game_key)
    if db.get(RareSurpriseOffer, key) is not None:
        return
    counts = []
    for user_id in ids:
        counter = db.get(RareSurpriseCounter, (game_type, user_id))
        if counter is None:
            counter = RareSurpriseCounter(game_type=game_type, user_id=user_id, games=0)
            db.add(counter)
        counter.games = min(100, counter.games + 1)
        counts.append(counter.games)
    chance = max(counts, default=0)
    effect = EFFECTS[secrets.randbelow(len(EFFECTS))] if secrets.randbelow(100) < chance else None
    db.add(RareSurpriseOffer(game_type=game_type, game_key=game_key, effect=effect, activated=False))
    db.flush()


def read_offer(db, game_type: str, game_key: str):
    return db.get(RareSurpriseOffer, (game_type, game_key))


def activate(db, game_type: str, game_key: str, effect: str, user_ids) -> bool | None:
    """Claim once and reset connected players; None denotes a legacy game."""
    ids = sorted({value for value in user_ids if type(value) is int and value > 0})
    from .account_progress import lock_account_rows

    lock_account_rows(db, ids)
    _lock(db)
    offer = db.get(RareSurpriseOffer, (game_type, game_key), populate_existing=True)
    if offer is None:
        return None
    if offer.activated or offer.effect is None or offer.effect != effect:
        return False
    offer.activated = True
    for user_id in ids:
        counter = db.get(RareSurpriseCounter, (game_type, user_id))
        if counter is not None:
            counter.games = 0
    db.flush()
    return True


def hausdepp_key(game_id, round_number):
    return f"{game_id}:{round_number}"


def hausdepp_start_accounts(game, previous):
    """Identify all accounts before any checkpoint authorization takes locks."""
    if not game.get("_started") or game.get("_finished") or game.get("_aborted"):
        return ()
    number = (game.get("_hausdepp_tournament") or {}).get("round_number", 1)
    old = previous or {}
    old_number = (old.get("_hausdepp_tournament") or {}).get("round_number", 1)
    if old.get("_started") and old_number == number:
        return ()
    state_ids = {player["id"] for player in (game.get("_hausdepp") or {}).get("players", [])}
    return tuple(sorted({p["user_id"] for p in game.get("_participants", [])
                         if not p.get("is_cpu") and (not state_ids or p.get("id") in state_ids)
                         and type(p.get("user_id")) is int and p["user_id"] > 0}))


def record_hausdepp_start(db, game, previous):
    """Only transitions started after this policy was installed are counted."""
    ids = hausdepp_start_accounts(game, previous)
    if not ids:
        return
    number = (game.get("_hausdepp_tournament") or {}).get("round_number", 1)
    start_game(db, "hausdepp", hausdepp_key(str(game["_id"]), number), ids)


def record_watten_start(db, game, previous_room):
    runtime = game["_watten"]
    if runtime.engine is None or previous_room is None or previous_room.status != "waiting":
        return False
    start_game(db, "watten", str(game["_id"]),
               (member.account_id for member in runtime.room.members if member.seat is not None))
    return True


def merge_counters(db, source_id: int, target_id: int) -> None:
    """Preserve the larger waiting chance when two accounts are merged."""
    from .account_progress import lock_account_rows

    lock_account_rows(db, (source_id, target_id))
    _lock(db)
    for game_type in ("hausdepp", "watten"):
        source = db.get(RareSurpriseCounter, (game_type, source_id))
        target = db.get(RareSurpriseCounter, (game_type, target_id))
        if source is None:
            continue
        if target is None:
            target = RareSurpriseCounter(game_type=game_type, user_id=target_id, games=source.games)
            db.add(target)
        else:
            target.games = max(target.games, source.games)
        db.delete(source)
    db.flush()
