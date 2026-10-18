"""Small server-private title cache; no awards, public XP or source identifiers.

Each persisted action rechecks active account and generation/sequence metadata.
Unchanged immutable journals reuse their validated title; out-of-band corruption
without a metadata change is detected on invalidation/restart, not on every card.
The cache never enters a checkpoint and is never a grant or identity authority.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import exists, or_, select
from sqlalchemy.exc import SQLAlchemyError

from .database import database_schema_ready, session_scope
from .models import User, WattenAchievementGrant, WattenMatchCredit, WattenProgressState
from .watten_account import _owned_matches, _progress

CACHE_KEY = "_watten_public_titles"


@dataclass(frozen=True, slots=True)
class PublicTitle:
    level: int
    de: str
    en: str
    threshold: int

    def payload(self):
        return {"level": self.level, "name": {"de": self.de, "en": self.en}, "threshold": self.threshold}


@dataclass(frozen=True, slots=True)
class CachedTitle:
    participant_id: str
    account_id: int
    generation: int | None
    sequence: int | None
    title: PublicTitle


@dataclass(frozen=True, slots=True)
class PublicTitles:
    entries: tuple[CachedTitle, ...] = ()


def public_title(game: dict, participant_id: str | None, account_id: int | None):
    """Pure fresh allowlist projection, including the stable seat/account binding."""
    cache = game.get(CACHE_KEY)
    if type(cache) is PublicTitles and type(account_id) is int:
        for item in cache.entries:
            if item.participant_id == participant_id and item.account_id == account_id:
                return item.title.payload()
    return None


def _read_titles(db, game):
    members = tuple(item for item in game["_watten"].room.members if item.seat is not None)
    if not members:
        return PublicTitles()
    accounts = {item.account_id for item in members}
    if not 1 <= len(members) <= 4 or len(accounts) != len(members):
        return PublicTitles()
    has_journal = or_(exists(select(WattenMatchCredit.user_id).where(WattenMatchCredit.user_id == User.id)),
                      exists(select(WattenAchievementGrant.user_id).where(WattenAchievementGrant.user_id == User.id)))
    rows = {row.id: row for row in db.execute(select(User.id, User.is_active, WattenProgressState.generation,
        WattenProgressState.grant_sequence, WattenProgressState.acknowledged_sequence, has_journal.label("has_journal")).outerjoin(
            WattenProgressState, WattenProgressState.user_id == User.id).where(User.id.in_(accounts)))}
    previous = game.get(CACHE_KEY)
    old = {item.participant_id: item for item in previous.entries} if type(previous) is PublicTitles else {}
    entries, existing = [], None
    for member in members:
        row = rows.get(member.account_id)
        if row is None or not row.is_active:
            continue
        generation, sequence, ack = row.generation, row.grant_sequence, row.acknowledged_sequence
        if generation is None:
            if row.has_journal or sequence is not None or ack is not None:
                continue  # A legitimate newcomer has a provably empty journal.
        elif not (type(generation) is int and generation >= 1 and type(sequence) is int
                  and type(ack) is int and 0 <= ack <= sequence):
            continue
        cached = old.get(member.participant_id)
        if (cached is not None and cached.account_id == member.account_id
                and (cached.generation, cached.sequence) == (generation, sequence)):
            entries.append(cached)
            continue
        try:
            if existing is None:
                existing = set(db.scalars(select(User.id)))
            matches = list(_owned_matches(db, member.account_id, existing))
            progress, _credits = _progress(db, member.account_id, matches)
            title = progress["title"]
            entries.append(CachedTitle(member.participant_id, member.account_id, generation, sequence,
                PublicTitle(title["level"], title["name"]["de"], title["name"]["en"], title["threshold"])))
        except (ValueError, TypeError, KeyError, OverflowError):
            # No stale/default title after corruption; absence is retried later.
            continue
    return PublicTitles(tuple(entries))


def refresh_public_titles(db, game: dict) -> PublicTitles:
    """Caller flushes actual writes first and installs only after its commit.

    A read failure rolls back this savepoint, leaving the gameplay transaction
    intact. A broken journal affects only its account; database read failure
    invalidates the whole small cache instead of presenting unverified titles.
    """
    try:
        with db.begin_nested():
            return _read_titles(db, game)
    except (SQLAlchemyError, ValueError, TypeError, KeyError, OverflowError, RuntimeError):
        return PublicTitles()


def restored_public_titles(game: dict) -> PublicTitles:
    """Optional fresh DB read after decoding; no DB requirement for pure fixtures."""
    if not database_schema_ready():
        return PublicTitles()
    try:
        with session_scope() as db:
            return refresh_public_titles(db, game)
    except (SQLAlchemyError, RuntimeError):
        return PublicTitles()
