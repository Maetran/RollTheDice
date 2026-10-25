"""Private, read-only Watten account/history projections; GET never earns XP."""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass, replace
from datetime import datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import selectinload

from .database import database_schema_ready, session_scope
from .models import (
    CompletedGame,
    GameParticipant,
    User,
    WattenAchievementGrant,
    WattenMatchCredit,
    WattenMatchEvidence,
    WattenProgressState,
)
from .security import as_utc
from .watten_evidence import (
    UNKNOWN,
    BidEvidence,
    MatchEvidence,
    ProjectedBinding,
    adapt_result_v1,
    evidence_from_json,
    evidence_to_payload,
    validate_membership,
)
from .watten_progression import (
    DRAFT_ACHIEVEMENTS,
    DRAFT_CATALOG_VERSION,
    DRAFT_TITLES,
    MatchInput,
    evaluate_draft,
    title_for_xp,
)
from .watten_progression_store import _bindings, _cohort, _json
from .watten_recipe import dumps_canonical_json
from .watten_surprises import SURPRISE_ACHIEVEMENTS, qualifying_surprises, surprise_facts

SOURCE_PAGE_SIZE = 250

# Presentation metadata follows the catalogue's semantic counters. It never
# contributes to qualification, journal prices or rank thresholds.
_CATEGORY_COUNTERS = {
    "persistence": ("completed", "days"),
    "tables": ("two", "three", "four", "variety", "team_wins", "cpu_matches"),
    "variants": ("normal", "ladinisch", "blind", "critical"),
    "bidding": ("bid_matches", "counter_matches", "quiet_wins"),
    "wins": ("schneider_wins", "retourschneider_wins", "eight_plus_three_wins",
             "retourschneider_eight_plus_three_wins", "comeback_wins", "raised_wins"),
}
_CATEGORY_BY_COUNTER = {counter: category for category, counters in _CATEGORY_COUNTERS.items() for counter in counters}
_CATEGORY_ORDER = (*_CATEGORY_COUNTERS, "surprises", "other")


class WattenAccountError(ValueError):
    pass


def _require(condition, code="watten_account_invalid_result"):
    if not condition:
        raise WattenAccountError(code)


def _cursor(row):
    text = dumps_canonical_json({"v": 1, "at": as_utc(row.finished_at).isoformat(), "id": row.id})
    return base64.urlsafe_b64encode(text.encode("ascii")).decode("ascii").rstrip("=")


def _decode_cursor(value):
    if value is None:
        return None
    try:
        _require(type(value) is str and 1 <= len(value) <= 256)
        decoded = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
        _require(base64.urlsafe_b64encode(decoded).decode("ascii").rstrip("=") == value)
        raw = _json(decoded.decode("ascii"))
        _require(type(raw) is dict and set(raw) == {"v", "at", "id"} and type(raw["v"]) is int and raw["v"] == 1
                 and type(raw["id"]) is int and raw["id"] > 0 and type(raw["at"]) is str)
        at = datetime.fromisoformat(raw["at"])
        _require(at.tzinfo is not None and as_utc(at).isoformat() == raw["at"])
        return as_utc(at), raw["id"]
    except (ValueError, TypeError, OverflowError, UnicodeError, binascii.Error) as exc:
        raise WattenAccountError("watten_account_invalid_cursor") from exc


def _actual_bindings(row):
    return tuple(ProjectedBinding(row.game_id, item.position, item.player_key, item.display_name,
                                   item.user_id, item.points, item.team)
                 for item in sorted(row.participants, key=lambda item: item.position))


@dataclass(frozen=True, slots=True)
class ReadMatch:
    row: CompletedGame
    evidence: MatchEvidence
    bindings: tuple[ProjectedBinding, ...]
    original_bindings: tuple[ProjectedBinding, ...]
    frozen: WattenMatchEvidence | None


def _validated_match(row, frozen, user_id, existing_users):
    """The selecting SQL must already establish this actual account membership."""
    try:
        raw = _json(row.snapshot_json)
        legacy = adapt_result_v1(raw, finished_at=as_utc(row.finished_at))
        _require(row.game_type == "watten" and row.game_id == legacy.game_id
                 and row.mode == str(legacy.player_count) and not row.hardcore)
        actual = _actual_bindings(row)
        validate_membership(legacy, viewer_user_id=user_id, bindings=actual)
        if frozen is None:
            return ReadMatch(row, legacy, actual, actual, None)
        evidence = evidence_from_json(frozen.evidence_json)
        _require(frozen.game_id == row.game_id and _json(frozen.result_v1_json) == raw
                 and replace(evidence, source="result_v1", profile=UNKNOWN, started_at=UNKNOWN, bids=BidEvidence()) == legacy)
        original = _bindings(frozen.bindings_json)
        validate_membership(evidence, viewer_user_id=user_id, bindings=original)
        _require(len(original) == len(actual))
        for before, current in zip(original, actual):
            deleted = before.user_id is not None and current.user_id is None and before.user_id not in existing_users
            _require(before == current or deleted and replace(current, user_id=before.user_id) == before)
        return ReadMatch(row, evidence, actual, original, frozen)
    except (ValueError, TypeError, KeyError, OverflowError) as exc:
        raise WattenAccountError("watten_account_invalid_result") from exc


def _owned_matches(db, user_id, existing_users):
    boundary = None
    while True:
        query = select(CompletedGame, WattenMatchEvidence).outerjoin(
            WattenMatchEvidence, WattenMatchEvidence.game_id == CompletedGame.game_id).options(
                selectinload(CompletedGame.participants)).where(
                    CompletedGame.game_type == "watten", CompletedGame.participants.any(GameParticipant.user_id == user_id))
        if boundary:
            at, identifier = boundary
            query = query.where(or_(CompletedGame.finished_at < at,
                                    and_(CompletedGame.finished_at == at, CompletedGame.id < identifier)))
        rows = list(db.execute(query.order_by(CompletedGame.finished_at.desc(), CompletedGame.id.desc()).limit(SOURCE_PAGE_SIZE)))
        if not rows:
            return
        for row, frozen in rows:
            yield _validated_match(row, frozen, user_id, existing_users)
        boundary = rows[-1][0].finished_at, rows[-1][0].id


def _record(match, user_id):
    evidence = match.evidence
    own = validate_membership(evidence, viewer_user_id=user_id, bindings=match.original_bindings)
    public = evidence_to_payload(evidence)
    return {"game_id": evidence.game_id, "finished_at": evidence.finished_at.isoformat(),
            "player_count": evidence.player_count, "cpu_count": sum(item.is_cpu for item in evidence.roster),
            "own_player_id": own.player_id, "outcome": "won" if own.won else "lost",
            "participants": [{"id": item.player_id, "seat": item.seat, "name": item.name, "is_cpu": item.is_cpu}
                             for item in evidence.roster],
            "scores": public["scores"], "winners": public["winners"], "profile": public["profile"]}


def _title(title):
    return {"level": title.level, "name": {"de": title.name.de, "en": title.name.en}, "threshold": title.xp}


def _progress(db, user_id, matches):
    by_game = {item.evidence.game_id: item for item in matches}
    rare_facts = surprise_facts(db, user_id)
    state = db.get(WattenProgressState, user_id)
    credits = list(db.scalars(select(WattenMatchCredit).where(WattenMatchCredit.user_id == user_id)))
    grants = list(db.scalars(select(WattenAchievementGrant).where(WattenAchievementGrant.user_id == user_id)))
    _require(state is not None or not credits and not grants, "watten_account_invalid_journal")
    generation, sequence, ack = (state.generation, state.grant_sequence, state.acknowledged_sequence) if state else (1, 0, 0)
    _require(type(generation) is int and generation >= 1 and type(sequence) is int and type(ack) is int and 0 <= ack <= sequence,
             "watten_account_invalid_journal")
    credits = [item for item in credits if item.generation == generation]
    grants = [item for item in grants if item.generation == generation]
    inputs, seen = [], set()
    try:
        for credit in credits:
            _require(credit.game_id in by_game)
            match = by_game[credit.game_id]
            own = validate_membership(match.evidence, viewer_user_id=user_id, bindings=match.original_bindings)
            _require(match.frozen is not None and credit.player_id == own.player_id and credit.won == own.won
                     and as_utc(credit.finished_at) == match.evidence.finished_at and credit.cohort_json == _cohort(match.evidence))
            inputs.append(MatchInput(match.evidence, match.original_bindings))
        sources = {item.game_id for item in credits}
        for item in (*credits, *grants):
            _require(type(item.xp) is int and item.xp >= 0 and type(item.policy_version) is int and item.policy_version >= 1
                     and type(item.catalog_version) is int and item.catalog_version >= 1
                     and type(item.grant_sequence) is int and 1 <= item.grant_sequence <= sequence
                     and item.grant_sequence not in seen)
            seen.add(item.grant_sequence)
        goals = {goal.achievement_id: goal for goal in DRAFT_ACHIEVEMENTS}
        rare_goals = {goal.achievement_id: goal for goal in SURPRISE_ACHIEVEMENTS}
        prefixes, contributions = {}, {}
        for grant in grants:
            _require(grant.source_game_id in sources)
            if grant.catalog_version <= DRAFT_CATALOG_VERSION and grant.achievement_id in rare_goals:
                source_match = by_game[grant.source_game_id]
                _require(as_utc(grant.reached_at) == source_match.evidence.finished_at
                         and grant.achievement_id in qualifying_surprises(db, source_match.evidence,
                                                                         source_match.original_bindings, user_id, facts=rare_facts))
            if grant.catalog_version <= DRAFT_CATALOG_VERSION and grant.achievement_id in goals:
                source_match = by_game[grant.source_game_id]
                source = source_match.evidence
                _require(as_utc(grant.reached_at) == source.finished_at)
                key = source.finished_at, source.game_id
                if key not in prefixes:
                    prefix = tuple(item for item in inputs if (item.evidence.finished_at, item.evidence.game_id) <= key)
                    prefixes[key] = evaluate_draft(prefix, viewer_user_id=user_id).counters
                if key not in contributions:
                    source_input = MatchInput(source, source_match.original_bindings)
                    contributions[key] = evaluate_draft((source_input,), viewer_user_id=user_id).counters
                goal = goals[grant.achievement_id]
                # Older matches may have arrived after this immutable grant.
                # Its own qualified prefix matters, not today's earliest source.
                _require(getattr(prefixes[key], goal.counter) >= goal.target
                         and getattr(contributions[key], goal.counter) > 0)
        _require(len(seen) == sequence)
        proposal = evaluate_draft(tuple(inputs), viewer_user_id=user_id)
    except (ValueError, TypeError, KeyError) as exc:
        raise WattenAccountError("watten_account_invalid_journal") from exc
    match_xp, achievement_xp = sum(item.xp for item in credits), sum(item.xp for item in grants)
    title = title_for_xp(match_xp + achievement_xp)
    grants_by_id = {item.achievement_id: item for item in grants if item.catalog_version <= DRAFT_CATALOG_VERSION}
    catalog = []
    for goal in DRAFT_ACHIEVEMENTS:
        grant = grants_by_id.get(goal.achievement_id)
        catalog.append({"id": goal.achievement_id, "category": _CATEGORY_BY_COUNTER.get(goal.counter, "other"),
                        "name": {"de": goal.name.de, "en": goal.name.en},
                        "description": {"de": goal.condition.de, "en": goal.condition.en}, "target": goal.target,
                        "progress": min(goal.target, getattr(proposal.counters, goal.counter)), "draft_xp": goal.xp,
                        "granted_xp": grant.xp if grant else 0, "earned_at": as_utc(grant.reached_at).isoformat() if grant else None,
                        "unlocked": grant is not None})
    rare_progress = set()
    for match_input in inputs:
        rare_progress.update(qualifying_surprises(db, match_input.evidence, match_input.bindings, user_id, facts=rare_facts))
    for goal in SURPRISE_ACHIEVEMENTS:
        grant = grants_by_id.get(goal.achievement_id)
        catalog.append({"id": goal.achievement_id, "category": "surprises", "name": {"de": goal.name.de, "en": goal.name.en},
                        "description": {"de": goal.condition.de, "en": goal.condition.en}, "target": 1,
                        "progress": int(goal.achievement_id in rare_progress), "draft_xp": goal.xp,
                        "granted_xp": grant.xp if grant else 0, "earned_at": as_utc(grant.reached_at).isoformat() if grant else None,
                        "unlocked": grant is not None})
    counters = {key: getattr(proposal.counters, key) for key in (
        "completed", "wins", "two", "three", "four", "variety", "team_wins", "cpu_matches", "days",
        "normal", "ladinisch", "blind", "critical", "bid_matches", "counter_matches", "quiet_wins",
        "schneider_wins", "retourschneider_wins", "eight_plus_three_wins", "retourschneider_eight_plus_three_wins")}
    current_ids = {item.achievement_id for item in (*DRAFT_ACHIEVEMENTS, *SURPRISE_ACHIEVEMENTS)}
    archived = [{"id": item.achievement_id, "name": {"de": "Gespeicherter Watten-Erfolg", "en": "Stored Watten achievement"},
                 "granted_xp": item.xp, "earned_at": as_utc(item.reached_at).isoformat(), "catalog_version": item.catalog_version}
             for item in grants if item.catalog_version > DRAFT_CATALOG_VERSION or item.achievement_id not in current_ids]
    return {"generation": generation, "grant_sequence": sequence, "acknowledged_sequence": ack,
            "catalog_version": DRAFT_CATALOG_VERSION, "match_xp": match_xp, "achievement_xp": achievement_xp,
            "total_xp": match_xp + achievement_xp, "title": _title(title.current),
            "next_title": _title(title.next_title) if title.next_title else None, "xp_to_next": title.xp_to_next,
            "titles": [_title(item) for item in DRAFT_TITLES],
            "achievement_categories": [category for category in _CATEGORY_ORDER if any(item["category"] == category for item in catalog)],
            "counters": counters, "achievements": catalog, "archived_achievements": archived,
            "pending": {
                "credits": [{"game_id": item.game_id, "sequence": item.grant_sequence, "xp": item.xp,
                             "outcome": "won" if item.won else "lost", "finished_at": as_utc(item.finished_at).isoformat()}
                            for item in sorted(credits, key=lambda item: item.grant_sequence) if item.grant_sequence > ack],
                "achievements": [{"id": item.achievement_id, "source_game_id": item.source_game_id,
                                  "sequence": item.grant_sequence, "xp": item.xp, "earned_at": as_utc(item.reached_at).isoformat()}
                                 for item in sorted(grants, key=lambda item: item.grant_sequence) if item.grant_sequence > ack]}}, credits


def build_watten_account(user_id: int, *, before=None, limit=12) -> dict:
    boundary = _decode_cursor(before)
    _require(type(user_id) is int and user_id > 0, "watten_account_invalid_user")
    _require(type(limit) is int and 1 <= limit <= 30, "watten_account_invalid_limit")
    _require(database_schema_ready(), "watten_account_unavailable")
    with session_scope() as db:
        existing = set(db.scalars(select(User.id)))
        user = db.get(User, user_id)
        _require(user is not None and user.is_active, "watten_account_invalid_user")
        matches = list(_owned_matches(db, user_id, existing))
        progress, credits = _progress(db, user_id, matches)
        eligible = [item for item in matches if boundary is None or (as_utc(item.row.finished_at), item.row.id) < boundary]
        selected = eligible[:limit]
        history = [_record(item, user_id) for item in selected]
        wins = sum(_record(item, user_id)["outcome"] == "won" for item in matches)
        credited_ids = {item.game_id for item in credits}
        return {"schema_version": 1, "game_type": "watten", "status": "draft", "coverage": {"complete": True},
                "statistics": {"all_matches": len(matches), "all_wins": wins, "credited_matches": len(credits),
                               "credited_wins": sum(item.won for item in credits),
                               "uncredited_matches": sum(item.evidence.game_id not in credited_ids for item in matches),
                               "last_finished_at": matches[0].evidence.finished_at.isoformat() if matches else None},
                "history": {"matches": history, "next_cursor": _cursor(selected[-1].row) if len(eligible) > limit else None},
                "progress": progress}
