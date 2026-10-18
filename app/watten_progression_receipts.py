"""Caller-transaction DRAFT receipts for exactly one owned match presentation.

This boundary is separate from the journal's global acknowledged_sequence.
Only events of the named source match up to the returned sequence are covered;
later grants from that same source remain pending. The caller authorizes the
account and owns one-match commit/rollback. This module never writes XP,
grants, a reset or the global cursor, and never reads private evidence JSON.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping

from sqlalchemy import literal, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .models import WattenAchievementGrant, WattenMatchCredit, WattenMatchPresentationAck, WattenProgressState


class WattenPresentationError(ValueError):
    pass


def _require(condition, code="watten_presentation_invalid_ack"):
    if not condition:
        raise WattenPresentationError(code)


def _scope(user_id, generation):
    _require(type(user_id) is int and user_id > 0 and type(generation) is int and generation > 0)


def _game_id(value):
    _require(type(value) is str and bool(value) and value == value.strip() and len(value) <= 64)


def _current_generation(db, user_id, generation, *, lock=False):
    query = select(WattenProgressState.generation, WattenProgressState.grant_sequence).where(
        WattenProgressState.user_id == user_id)
    row = db.execute(query.with_for_update() if lock else query).one_or_none()
    _require(row is not None and row.generation == generation, "watten_presentation_stale_generation")
    return row.grant_sequence


@dataclass(frozen=True, slots=True)
class MatchPresentationBoundary:
    user_id: int
    generation: int
    game_id: str
    through_sequence: int
    status: str = "draft"


def acknowledge_match_presentation(db, *, user_id: int, generation: int, game_id: str,
                                   through_sequence: int) -> MatchPresentationBoundary:
    """Flush only, validating a current own-credit/source-event boundary.

    Zero is a no-op. Positive boundaries must identify an actual own credit or
    achievement event of this match, never an event from another match. Older
    boundaries cannot lower a receipt. The caller must roll back on any error.
    """
    _scope(user_id, generation)
    _game_id(game_id)
    _require(type(through_sequence) is int and through_sequence >= 0)
    # Source/generation checks include the caller's pending transaction work;
    # an unflushed epoch change or credit deletion must not authorize an ACK.
    db.flush()
    with db.no_autoflush:
        latest = _current_generation(db, user_id, generation, lock=True)
        credit = db.scalar(select(WattenMatchCredit.grant_sequence).where(
            WattenMatchCredit.user_id == user_id, WattenMatchCredit.generation == generation,
            WattenMatchCredit.game_id == game_id))
        _require(credit is not None, "watten_presentation_match_not_owned")
        source_sequences = (credit, *db.scalars(select(WattenAchievementGrant.grant_sequence).where(
            WattenAchievementGrant.user_id == user_id, WattenAchievementGrant.generation == generation,
            WattenAchievementGrant.source_game_id == game_id)))
        sequences = set(source_sequences)
        _require(len(sequences) == len(source_sequences)
                 and all(type(item) is int and 1 <= item <= latest for item in sequences),
                 "watten_presentation_invalid_source")
        _require(through_sequence == 0 or through_sequence in sequences, "watten_presentation_invalid_boundary")
        dialect = db.get_bind().dialect.name
        _require(dialect in {"sqlite", "postgresql"}, "watten_presentation_unsupported_database")
        if through_sequence:
            insert = sqlite_insert if dialect == "sqlite" else pg_insert
            # SELECT guards generation again at the write, including on SQLite
            # where FOR UPDATE is ignored. No row is created for a stale epoch.
            source = select(literal(user_id), literal(generation), literal(game_id), literal(through_sequence)).select_from(
                WattenMatchCredit).join(WattenProgressState, WattenProgressState.user_id == WattenMatchCredit.user_id).where(
                    WattenMatchCredit.user_id == user_id, WattenMatchCredit.generation == generation,
                    WattenMatchCredit.game_id == game_id, WattenProgressState.generation == generation)
            statement = insert(WattenMatchPresentationAck).from_select(
                ("user_id", "generation", "game_id", "through_sequence"), source)
            db.execute(statement.on_conflict_do_update(
                index_elements=("user_id", "generation", "game_id"),
                set_={"through_sequence": statement.excluded.through_sequence},
                where=WattenMatchPresentationAck.through_sequence < statement.excluded.through_sequence))
            _current_generation(db, user_id, generation)
        boundary = db.scalar(select(WattenMatchPresentationAck.through_sequence).where(
            WattenMatchPresentationAck.user_id == user_id, WattenMatchPresentationAck.generation == generation,
            WattenMatchPresentationAck.game_id == game_id)) or 0
        _require(not through_sequence or boundary >= through_sequence, "watten_presentation_stale_generation")
    db.flush()
    _current_generation(db, user_id, generation)
    return MatchPresentationBoundary(user_id, generation, game_id, boundary)


def read_match_presentation_boundaries(db, *, user_id: int, generation: int,
                                      game_ids) -> Mapping[str, int]:
    """Read-only immutable own-match boundaries; foreign/unknown IDs are absent.

    No autoflush occurs: the caller must flush its own source transaction first.
    Missing receipts have boundary zero. This returns no XP, grant IDs, other
    account data or private JSON, and does not advance any receipt/cursor.
    """
    _scope(user_id, generation)
    _require(type(game_ids) in {tuple, list, set, frozenset}, "watten_presentation_invalid_matches")
    for game_id in game_ids:
        _game_id(game_id)
    ids = tuple(sorted(set(game_ids)))
    with db.no_autoflush:
        _current_generation(db, user_id, generation)
        if not ids:
            return MappingProxyType({})
        rows = db.execute(select(WattenMatchCredit.game_id, WattenMatchPresentationAck.through_sequence).outerjoin(
            WattenMatchPresentationAck,
            (WattenMatchPresentationAck.user_id == WattenMatchCredit.user_id)
            & (WattenMatchPresentationAck.generation == WattenMatchCredit.generation)
            & (WattenMatchPresentationAck.game_id == WattenMatchCredit.game_id)).where(
                WattenMatchCredit.user_id == user_id, WattenMatchCredit.generation == generation,
                WattenMatchCredit.game_id.in_(ids)).order_by(WattenMatchCredit.game_id))
        return MappingProxyType({row.game_id: row.through_sequence or 0 for row in rows})
