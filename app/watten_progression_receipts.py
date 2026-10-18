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

from sqlalchemy import exists, literal, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .models import WattenAchievementGrant, WattenMatchCredit, WattenMatchPresentationAck, WattenProgressState

_READ_BATCH_SIZE = 250


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
    Missing receipts have boundary zero. Positive stored boundaries must still
    identify an actual current own event of that same source match. Bounded
    relational batches return no XP, grant IDs, other account data or private
    JSON, and never advance or repair any receipt/cursor.
    """
    _scope(user_id, generation)
    _require(type(game_ids) in {tuple, list, set, frozenset}, "watten_presentation_invalid_matches")
    for game_id in game_ids:
        _game_id(game_id)
    ids = tuple(sorted(set(game_ids)))
    with db.no_autoflush:
        latest = _current_generation(db, user_id, generation)
        if not ids:
            return MappingProxyType({})
        credit, ack, grant = WattenMatchCredit, WattenMatchPresentationAck, WattenAchievementGrant
        grant_event = exists(select(grant.grant_sequence).where(
            grant.user_id == credit.user_id, grant.generation == credit.generation,
            grant.source_game_id == credit.game_id, grant.grant_sequence == ack.through_sequence)).correlate(credit, ack)
        boundaries = {}
        for offset in range(0, len(ids), _READ_BATCH_SIZE):
            rows = db.execute(select(credit.game_id, credit.grant_sequence, ack.through_sequence, grant_event).outerjoin(
                ack, (ack.user_id == credit.user_id) & (ack.generation == credit.generation)
                & (ack.game_id == credit.game_id)).where(credit.user_id == user_id, credit.generation == generation,
                    credit.game_id.in_(ids[offset:offset + _READ_BATCH_SIZE])).order_by(credit.game_id))
            for game_id, credit_sequence, boundary, is_grant_event in rows:
                if boundary is None:
                    boundary = 0
                _require(type(boundary) is int and (boundary == 0 or 1 <= boundary <= latest
                         and (boundary == credit_sequence or is_grant_event)), "watten_presentation_invalid_source")
                boundaries[game_id] = boundary
        return MappingProxyType(boundaries)
