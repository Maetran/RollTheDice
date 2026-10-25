"""Caller-transaction storage for independently validated achievement support.

Game adapters own eligibility. This module never treats an award mirror as
proof, scans game history, changes an original journal, or creates deliveries.
"""
from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select

from .account_progress import progress_owner_ids
from .models import MergedAwardBacking
from .security import as_utc


@dataclass(frozen=True)
class MergeContext:
    operation_id: str
    source_user_id: int
    target_user_id: int
    source_origin_ids: tuple[int, ...]
    target_origin_ids: tuple[int, ...]
    created_at: datetime
    policy_version: int = 1

    @property
    def origin_ids(self) -> tuple[int, ...]:
        return tuple(sorted(set(self.source_origin_ids) | set(self.target_origin_ids)))


@dataclass(frozen=True)
class AwardProjection:
    unlocked_at: datetime
    credited_amount: int
    support_ids: tuple[int, ...]


class MergeBackingConflict(ValueError):
    pass


def award_backings(db, owner_id: int, game_type: str, achievement_key: str | None = None) -> list[MergedAwardBacking]:
    query = select(MergedAwardBacking).where(
        MergedAwardBacking.owner_user_id == owner_id, MergedAwardBacking.game_type == game_type,
    )
    if achievement_key is not None:
        query = query.where(MergedAwardBacking.achievement_key == achievement_key)
    return list(db.scalars(query.order_by(MergedAwardBacking.id)))


def is_canonical_mirror(db, owner_id: int, game_type: str, achievement_key: str) -> bool:
    # Closed support cycles still identify the row as a mirror. A later reearn
    # must record new native support, never recapture the old mirror as proof.
    return db.scalar(select(MergedAwardBacking.id).where(
        MergedAwardBacking.owner_user_id == owner_id, MergedAwardBacking.game_type == game_type,
        MergedAwardBacking.achievement_key == achievement_key,
    ).limit(1)) is not None


def record_award_support(db, *, owner_id: int, game_type: str, achievement_key: str,
                         support_key: str, origin_user_id: int, operation_id: str,
                         unlocked_at: datetime, credited_amount: int, context: Mapping,
                         kind: str = "original", continuity_date: datetime | None = None) -> MergedAwardBacking:
    """Idempotently capture one immutable witness; never revive a closed one.

    Support keys identify the ORIGINAL witness globally, not the current owner
    or latest copy operation. A new native earning cycle needs a new key.
    """
    if type(credited_amount) is not int or credited_amount < 0:
        raise ValueError("invalid_credited_amount")
    encoded = json.dumps(dict(context), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    if len(encoded.encode("utf-8")) > 65536:
        raise ValueError("merge_backing_context_too_large")
    unlocked_at = as_utc(unlocked_at)
    continuity_date = min(unlocked_at, as_utc(continuity_date or unlocked_at))
    existing = db.scalar(select(MergedAwardBacking).where(
        MergedAwardBacking.owner_user_id == owner_id, MergedAwardBacking.game_type == game_type,
        MergedAwardBacking.achievement_key == achievement_key, MergedAwardBacking.support_key == support_key,
    ))
    if existing is not None:
        if (existing.origin_user_id != origin_user_id or existing.kind != kind
                or as_utc(existing.original_unlocked_at) != unlocked_at
                or existing.credited_amount != credited_amount or existing.context_json != encoded):
            raise MergeBackingConflict("merge_support_conflict")
        if existing.invalidated_at is None:
            existing.continuity_date = min(as_utc(existing.continuity_date), continuity_date)
        return existing
    result = MergedAwardBacking(
        owner_user_id=owner_id, game_type=game_type, achievement_key=achievement_key,
        support_key=support_key, origin_user_id=origin_user_id, kind=kind,
        original_unlocked_at=unlocked_at, continuity_date=continuity_date,
        credited_amount=credited_amount, context_json=encoded, operation_id=operation_id,
    )
    db.add(result)
    db.flush()
    return result


def copy_active_backings(db, *, source_owner_id: int, target_owner_id: int, game_type: str,
                         operation_id: str, continuity_dates: Mapping[str, datetime]) -> int:
    """Copy validated support, carrying each key's continuous presentation date."""
    if source_owner_id == target_owner_id:
        return 0
    count = 0
    for row in award_backings(db, source_owner_id, game_type):
        if row.invalidated_at is not None:
            continue
        record_award_support(
            db, owner_id=target_owner_id, game_type=game_type, achievement_key=row.achievement_key,
            support_key=row.support_key, origin_user_id=row.origin_user_id, operation_id=operation_id,
            unlocked_at=row.original_unlocked_at, credited_amount=row.credited_amount,
            context=json.loads(row.context_json), kind=row.kind,
            continuity_date=min(as_utc(row.continuity_date), as_utc(continuity_dates.get(
                row.achievement_key, row.original_unlocked_at,
            ))),
        )
        count += 1
    return count


def revalidate_backings(db, *, owner_id: int, game_type: str, achievement_key: str,
                        now: datetime, validate: Callable[[MergedAwardBacking], bool]) -> list[MergedAwardBacking]:
    """Validate each active witness independently under its sealed context.

    Invalidations are permanent and caller-transactional. Only game-specific
    adapters can validate proof; canonical award presence is never sufficient.
    """
    active = [row for row in award_backings(db, owner_id, game_type, achievement_key) if row.invalidated_at is None]
    previous_date = min((min(as_utc(row.original_unlocked_at), as_utc(row.continuity_date)) for row in active), default=None)
    valid = []
    for row in active:
        if not validate(row):
            row.invalidated_at = as_utc(now)
        else:
            # Carry continuous key history onto every remaining valid witness,
            # before an earliest original witness can disappear in a chain.
            row.continuity_date = min(as_utc(row.continuity_date), previous_date)
            valid.append(row)
    return valid


def reconcile_award_backings(db, *, owner_id: int, game_type: str, achievement_key: str,
                             now: datetime, validate: Callable[[MergedAwardBacking], bool]) -> AwardProjection | None:
    valid = revalidate_backings(db, owner_id=owner_id, game_type=game_type, achievement_key=achievement_key,
                                now=now, validate=validate)
    if not valid:
        return None
    return AwardProjection(
        unlocked_at=min(min(as_utc(row.original_unlocked_at), as_utc(row.continuity_date)) for row in valid),
        credited_amount=max(row.credited_amount for row in valid),
        support_ids=tuple(row.id for row in valid),
    )


def invalidate_source_backings(db, *, game_type: str, now: datetime,
                               matches: Callable[[MergedAwardBacking], bool]) -> set[int]:
    """Invalidate every copy of a removed witness, including old chained owners.

    The game adapter supplies a typed source predicate. Return distinct current
    progress owners for reconciliation, without changing original game rows.
    """
    affected = set()
    groups = {}
    matched = []
    for row in db.scalars(select(MergedAwardBacking).where(
        MergedAwardBacking.game_type == game_type, MergedAwardBacking.invalidated_at.is_(None),
    )):
        groups.setdefault((row.owner_user_id, row.achievement_key), []).append(row)
        if matches(row):
            matched.append(row)
            affected.add(row.owner_user_id)
    for key in {(row.owner_user_id, row.achievement_key) for row in matched}:
        rows = groups[key]
        previous_date = min(min(as_utc(row.original_unlocked_at), as_utc(row.continuity_date)) for row in rows)
        for row in rows:
            row.continuity_date = min(as_utc(row.continuity_date), previous_date)
    for row in matched:
        row.invalidated_at = as_utc(now)
    return set(progress_owner_ids(db, affected).values())
