"""Caller-transaction DRAFT journal, deliberately not connected to the runtime.

The caller owns commit/rollback and authorization. Only managed completed Watten
rows and their actual relational participants authorize a first freeze. All
historical evaluation reads frozen private journal authority, never live game
checkpoints. No startup synchronization, reset or cross-product XP exists here.

The native caller must use one match per transaction. A general concurrent
multi-match batch needs globally ordered prelocking or whole-transaction
rollback/retry: per-match evidence locks plus account locks can deadlock across
oppositely ordered batches on PostgreSQL. No general batch-concurrency proof is
claimed by this service or by its sequential SQLite history fixture.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, replace

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import object_session

from .models import (
    CompletedGame,
    GameParticipant,
    User,
    WattenAchievementGrant,
    WattenMatchCredit,
    WattenMatchEvidence,
    WattenProgressState,
)
from .security import as_utc, utcnow
from .watten_evidence import (
    UNKNOWN,
    BidEvidence,
    MatchEvidence,
    ProjectedBinding,
    adapt_result_v1,
    evidence_from_json,
    evidence_to_json,
    evidence_to_payload,
    validate_membership,
)
from .watten_progression import MatchInput, evaluate_draft
from .watten_recipe import dumps_canonical_json


class WattenJournalError(ValueError):
    pass


def _require(condition, code="watten_journal_invalid_source"):
    if not condition:
        raise WattenJournalError(code)


def _unique(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result)
        result[key] = value
    return result


def _reject(_value):
    raise WattenJournalError("watten_journal_invalid_source")


def _json(text):
    _require(type(text) is str)
    try:
        return json.loads(text, object_pairs_hook=_unique, parse_constant=_reject)
    except (ValueError, RecursionError) as exc:
        raise WattenJournalError("watten_journal_invalid_source") from exc


def _binding_json(bindings):
    return dumps_canonical_json({"schema_version": 1, "bindings": [
        {"game_id": row.game_id, "position": row.position, "player_id": row.player_id, "display_name": row.display_name,
         "user_id": row.user_id, "points": row.points, "team": row.team} for row in bindings]})


def _bindings(text):
    raw = _json(text)
    _require(type(raw) is dict and set(raw) == {"schema_version", "bindings"}
             and type(raw["schema_version"]) is int and raw["schema_version"] == 1 and type(raw["bindings"]) is list)
    rows = []
    for item in raw["bindings"]:
        _require(type(item) is dict and set(item) == {"game_id", "position", "player_id", "display_name", "user_id", "points", "team"})
        rows.append(ProjectedBinding(item["game_id"], item["position"], item["player_id"], item["display_name"],
                                     item["user_id"], item["points"], item["team"]))
    return tuple(rows)


def _insert_once(db, model, values):
    dialect = db.get_bind().dialect.name
    _require(dialect in {"sqlite", "postgresql"}, "watten_journal_unsupported_database")
    insert = sqlite_insert if dialect == "sqlite" else pg_insert
    db.execute(insert(model).values(**values).on_conflict_do_nothing())


def _state(db, user_id, *, create):
    if create:
        # This first write also serializes SQLite callers. PostgreSQL locks the
        # state row below; all callers acquire account locks in ascending order.
        _insert_once(db, WattenProgressState, {"user_id": user_id, "generation": 1,
                                              "grant_sequence": 0, "acknowledged_sequence": 0})
    return db.scalar(select(WattenProgressState).where(WattenProgressState.user_id == user_id)
                     .with_for_update().execution_options(populate_existing=True))


def _validated_source(db, row, evidence, bindings):
    _require(type(row) is CompletedGame and object_session(row) is db and type(row.id) is int
             and type(evidence) is MatchEvidence and type(bindings) is tuple)
    source = db.execute(select(CompletedGame.game_id, CompletedGame.game_type, CompletedGame.finished_at,
                               CompletedGame.mode, CompletedGame.hardcore, CompletedGame.snapshot_json)
                        .where(CompletedGame.id == row.id)).one_or_none()
    _require(source is not None and source.game_type == "watten" and not source.hardcore)
    raw = _json(source.snapshot_json)
    legacy = adapt_result_v1(raw, finished_at=as_utc(source.finished_at))
    _require(source.game_id == evidence.game_id and source.mode == str(evidence.player_count)
             and replace(evidence, source="result_v1", profile=UNKNOWN, started_at=UNKNOWN, bids=BidEvidence()) == legacy)
    actual = tuple(ProjectedBinding(source.game_id, item.position, item.player_key, item.display_name,
                                     item.user_id, item.points, item.team) for item in db.execute(
        select(GameParticipant.position, GameParticipant.player_key, GameParticipant.display_name,
               GameParticipant.user_id, GameParticipant.points, GameParticipant.team)
        .where(GameParticipant.game_id == row.id).order_by(GameParticipant.position)))
    _require(all(type(item) is ProjectedBinding for item in bindings))
    ordered = tuple(sorted(bindings, key=lambda item: item.position))
    _require(ordered == actual)
    accounts = sorted(item.user_id for item in actual if item.user_id is not None)
    _require(len(accounts) == len(set(accounts)) and len(actual) == evidence.player_count)
    for player, binding in zip(evidence.roster, actual):
        score_index, score = next((index, score) for index, score in enumerate(evidence.scores) if player.player_id in score.members)
        _require(binding.position == player.seat and binding.player_id == player.player_id and binding.display_name == player.name
                 and binding.points == score.points and binding.team == (str(score_index) if evidence.player_count == 4 else None)
                 and not (player.is_cpu and binding.user_id is not None))
    for user_id in accounts:
        _require(db.get(User, user_id) is not None)
        validate_membership(evidence, viewer_user_id=user_id, bindings=actual)
    return raw, actual


def _freeze(db, raw, evidence, bindings):
    values = {"game_id": evidence.game_id, "result_v1_json": dumps_canonical_json(raw),
              "evidence_json": evidence_to_json(evidence), "bindings_json": _binding_json(bindings), "frozen_at": utcnow()}
    _insert_once(db, WattenMatchEvidence, values)
    frozen = db.scalar(select(WattenMatchEvidence).where(WattenMatchEvidence.game_id == evidence.game_id)
                       .with_for_update().execution_options(populate_existing=True))
    _require(frozen.result_v1_json == values["result_v1_json"] and frozen.evidence_json == values["evidence_json"],
             "watten_journal_conflicting_evidence")
    original = _bindings(frozen.bindings_json)
    _require(len(original) == len(bindings), "watten_journal_conflicting_binding")
    for old, current in zip(original, bindings):
        # FK deletion may remove an original human account. It never makes a
        # CPU, and subsequent manual assignment cannot mint a new credit.
        deleted = old.user_id is not None and current.user_id is None and db.get(User, old.user_id) is None
        _require(old == current or deleted and replace(current, user_id=old.user_id) == old,
                 "watten_journal_conflicting_binding")
    return frozen, original


def _cohort(evidence):
    public = evidence_to_payload(evidence)
    return dumps_canonical_json({"schema_version": 1, "status": "draft", "player_count": evidence.player_count,
                                 "target_points": evidence.target_points, "cpu_count": sum(item.is_cpu for item in evidence.roster),
                                 "profile": public["profile"]})


@dataclass(frozen=True, slots=True)
class JournalStatus:
    user_id: int
    generation: int
    grant_sequence: int
    acknowledged_sequence: int
    match_xp: int
    achievement_xp: int
    new_credit: bool = False
    new_achievement_ids: tuple[str, ...] = ()
    status: str = "draft"

    @property
    def total_xp(self):
        return self.match_xp + self.achievement_xp


def _status(db, state, *, new_credit=False, new_ids=()):
    credit_xp = db.scalar(select(func.coalesce(func.sum(WattenMatchCredit.xp), 0)).where(
        WattenMatchCredit.user_id == state.user_id, WattenMatchCredit.generation == state.generation))
    achievement_xp = db.scalar(select(func.coalesce(func.sum(WattenAchievementGrant.xp), 0)).where(
        WattenAchievementGrant.user_id == state.user_id, WattenAchievementGrant.generation == state.generation))
    return JournalStatus(state.user_id, state.generation, state.grant_sequence, state.acknowledged_sequence,
                         credit_xp, achievement_xp, new_credit, tuple(new_ids))


def read_draft_progress(db, *, user_id: int) -> JournalStatus | None:
    _require(type(user_id) is int and user_id > 0)
    state = db.scalar(select(WattenProgressState).where(WattenProgressState.user_id == user_id)
                       .execution_options(populate_existing=True))
    return _status(db, state) if state is not None else None


def store_draft_match(db, row: CompletedGame, evidence: MatchEvidence,
                      bindings: tuple[ProjectedBinding, ...]) -> tuple[JournalStatus, ...]:
    """Flush only, in the caller's result transaction; rollback on any exception.

    No client payload, account-name lookup, foreign staff privileges or live
    checkpoint can authorize credits. The rich evidence is a trusted producer
    input whose result-v1 public core must exactly match the actual DB result.
    Native callers use exactly one match per transaction; see the module's
    explicit concurrent-batch locking limitation before reusing this API.
    """
    raw, bindings = _validated_source(db, row, evidence, bindings)
    _frozen, original = _freeze(db, raw, evidence, bindings)
    account_ids = sorted(item.user_id for item in bindings if item.user_id is not None)
    states = [_state(db, user_id, create=True) for user_id in account_ids]
    results = []
    for state in states:
        # One full ordered join, with no per-result lookup and no 250-row cap.
        history = list(db.execute(select(WattenMatchCredit, WattenMatchEvidence).join(
            WattenMatchEvidence, WattenMatchEvidence.game_id == WattenMatchCredit.game_id).where(
                WattenMatchCredit.user_id == state.user_id, WattenMatchCredit.generation == state.generation)
            .order_by(WattenMatchCredit.finished_at, WattenMatchCredit.game_id)))
        inputs = tuple(MatchInput(evidence_from_json(frozen.evidence_json), _bindings(frozen.bindings_json))
                       for _credit, frozen in history)
        existing = next((credit for credit, _proof in history if credit.game_id == evidence.game_id), None)
        if existing is None:
            inputs += (MatchInput(evidence, original),)
        proposal = evaluate_draft(inputs, viewer_user_id=state.user_id)
        if existing is None:
            credit = next(item for item in proposal.credits if item.game_id == evidence.game_id)
            state.grant_sequence += 1
            db.add(WattenMatchCredit(user_id=state.user_id, generation=state.generation, game_id=evidence.game_id,
                                    player_id=credit.player_id, finished_at=credit.finished_at, won=credit.won,
                                    cohort_json=_cohort(evidence), xp=credit.xp, policy_version=credit.policy_version,
                                    catalog_version=credit.catalog_version, grant_sequence=state.grant_sequence))
        old_grants = {item.achievement_id for item in db.scalars(
            select(WattenAchievementGrant).where(WattenAchievementGrant.user_id == state.user_id,
                                                WattenAchievementGrant.generation == state.generation))}
        from .watten_merge import effective_awards, is_merged
        merged = is_merged(db, state.user_id)
        if merged:
            db.flush()
            old_grants.update(effective_awards(db, state.user_id))
        new_ids = []
        for grant in proposal.achievements:
            if grant.achievement_id in old_grants:
                continue  # Never update an old price, source, policy or unlock.
            state.grant_sequence += 1
            db.add(WattenAchievementGrant(user_id=state.user_id, generation=state.generation,
                                         catalog_version=grant.catalog_version, achievement_id=grant.achievement_id,
                                         source_game_id=grant.source_game_id, reached_at=grant.reached_at, xp=grant.xp,
                                         policy_version=grant.policy_version, grant_sequence=state.grant_sequence))
            new_ids.append(grant.achievement_id)
        db.flush()
        if merged:
            from .watten_merge import grant_combined
            grant_combined(db, state.user_id, reached_at=evidence.finished_at)
        results.append(_status(db, state, new_credit=existing is None, new_ids=new_ids))
    return tuple(results)


def acknowledge_draft_progress(db, *, user_id: int, generation: int, through_sequence: int) -> JournalStatus:
    """A stale generation never acknowledges a future epoch; older ACKs are no-ops."""
    _require(type(user_id) is int and user_id > 0 and type(generation) is int and generation > 0
             and type(through_sequence) is int and through_sequence >= 0, "watten_journal_invalid_ack")
    state = _state(db, user_id, create=False)
    _require(state is not None and generation == state.generation and through_sequence <= state.grant_sequence,
             "watten_journal_stale_ack")
    # SQLite ignores FOR UPDATE: enforce monotonicity in the SQL predicate too,
    # rather than writing a cursor calculated from a potentially older read.
    db.execute(update(WattenProgressState).where(
        WattenProgressState.user_id == user_id, WattenProgressState.generation == generation,
        WattenProgressState.acknowledged_sequence < through_sequence,
        WattenProgressState.grant_sequence >= through_sequence).values(acknowledged_sequence=through_sequence))
    db.flush()
    db.refresh(state)
    _require(state.generation == generation, "watten_journal_stale_ack")
    return _status(db, state)
