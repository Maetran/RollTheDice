"""Historical HD ownership overlays; original journals and deliveries stay original.

Every helper uses the caller transaction. Statistical seats and achievement
contributions are intentionally different: a nonselected whole seat can prove
an achievement, but a shared round never becomes two rounds or two XP credits.
"""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from copy import deepcopy
from dataclasses import dataclass
from types import SimpleNamespace

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .account_merge_backings import award_backings, copy_active_backings, record_award_support
from .account_progress import owned_origin_ids, progress_owner_ids
from .hausdepp_departure_store import source_not_withdrawn
from .hausdepp_results import validated_hausdepp_membership
from .models import (
    AccountMergeOperation,
    AccountProgressOrigin,
    CompletedGame,
    GameParticipant,
    HausdeppAchievementUnlock,
    HausdeppRoundCredit,
    HausdeppWithdrawal,
)
from .security import as_utc


@dataclass(frozen=True)
class RoundSeat:
    row: CompletedGame
    origin_id: int
    seat: GameParticipant
    record: dict
    facts: dict

    def metadata(self):
        payload = [self.row.snapshot_json, sorted((seat.position, seat.player_key, seat.user_id,
                   seat.display_name) for seat in self.row.participants)]
        fingerprint = hashlib.sha256(json.dumps(payload, separators=(",", ":")).encode()).hexdigest()
        return {"game_type": "hausdepp", "game_id": self.row.game_id, "origin_user_id": self.origin_id,
                "participant_id": self.seat.id, "player_key": self.seat.player_key, "source_fingerprint": fingerprint}


def is_merged(db, owner_id):
    return db.scalar(select(AccountProgressOrigin.origin_user_id).where(
        AccountProgressOrigin.owner_user_id == owner_id).limit(1)) is not None


def selected_rounds(db, owner_id, *, origins=None):
    """Validated whole seats, newest first, with stable original-seat tiebreaks."""
    identities = tuple(origins or owned_origin_ids(db, owner_id))
    boundary = None
    while True:
        query = select(CompletedGame).options(selectinload(CompletedGame.participants)).where(
            CompletedGame.game_type == "hausdepp",
            CompletedGame.participants.any(GameParticipant.user_id.in_(identities)))
        if boundary is not None:
            query = query.where(CompletedGame.id < boundary)
        rows = list(db.scalars(query.order_by(CompletedGame.id.desc()).limit(250)))
        if not rows:
            return
        for row in rows:
            candidates = []
            for seat in row.participants:
                if seat.user_id not in identities:
                    continue
                proof = validated_hausdepp_membership(row, seat.user_id, db=db)
                if proof is not None:
                    candidates.append(RoundSeat(row, seat.user_id, seat, *proof))
            if candidates:
                yield min(candidates, key=lambda item: (
                    {"finished": 0, "remaining": 1, "hausdepp": 2}[item.record["outcome"]],
                    item.record["finished_position"] or 999, item.seat.position, item.seat.player_key, item.origin_id))
        boundary = rows[-1].id


def _credits(db, identities):
    return list(db.scalars(select(HausdeppRoundCredit).where(HausdeppRoundCredit.user_id.in_(identities),
        source_not_withdrawn(HausdeppRoundCredit.user_id, HausdeppRoundCredit.game_id))
        .order_by(HausdeppRoundCredit.finished_at, HausdeppRoundCredit.game_id, HausdeppRoundCredit.user_id)))


def _native_unlocks(db, identities):
    from .hausdepp_achievements import _unlock_source_allowed
    return list(db.scalars(select(HausdeppAchievementUnlock).where(
        HausdeppAchievementUnlock.user_id.in_(identities), _unlock_source_allowed())))


def effective_awards(db, owner_id, *, origins=None, inputs=None):
    """One actual reward and earliest continuous date, never delivery revisions."""
    from .hausdepp_achievements import _ACHIEVEMENTS_BY_ID
    identities = tuple(origins or owned_origin_ids(db, owner_id))
    backings = [item for item in award_backings(db, owner_id, "hausdepp") if item.invalidated_at is None]
    frozen = {item.support_key: item for item in backings}
    candidates = defaultdict(list)
    for item in _native_unlocks(db, identities):
        definition = _ACHIEVEMENTS_BY_ID.get(item.achievement_id)
        if definition is None:
            continue
        support = frozen.get(f"native:{item.user_id}:{item.achievement_id}")
        candidates[item.achievement_id].append((as_utc(item.unlocked_at),
                                                support.credited_amount if support else definition["points"]))
    contexts = inputs.contexts if inputs is not None else {}
    for item in backings:
        # Native-source withdrawals keep the same exclusion as original HD.
        context = json.loads(item.context_json)
        if item.kind == "original" and item.achievement_key != "hausdepp_136" and db.get(
                HausdeppWithdrawal, (item.origin_user_id, context.get("game_id"))) is not None:
            continue
        if item.kind != "original":
            # A selector is not proof: re-read original immutable narrow credits
            # and re-evaluate this exact criterion under its sealed exclusions.
            selector = json.dumps({key: context[key] for key in ("origins", "through", "owners")}, sort_keys=True)
            if selector not in contexts:
                from datetime import datetime
                source_credits = inputs.credits if inputs is not None else _credits(db, context["origins"])
                rows = [credit for credit in source_credits if credit.user_id in context["origins"]
                        and as_utc(credit.finished_at) <= as_utc(datetime.fromisoformat(context["through"][str(credit.user_id)]))]
                contexts[selector] = _progress_values(db, context["origins"], rows,
                    frozen_owners={int(key): value for key, value in context["owners"].items()})
            current, _target = contexts[selector][item.achievement_key]
            if current < context["target"]:
                continue
        candidates[item.achievement_key].append((min(as_utc(item.original_unlocked_at), as_utc(item.continuity_date)),
                                                 item.credited_amount))
    return {key: {"unlocked_at": min(at for at, _ in values), "xp": max(xp for _, xp in values)}
            for key, values in candidates.items()}


def _progress_values(db, identities, credits, *, frozen_owners=None):
    """One coherent contribution per game/criterion, with bounded set selection."""
    from .hausdepp_achievements import ACHIEVEMENTS, _accumulate, _new_aggregate, _progress
    from .hausdepp_surprise_collection import SURPRISE_EFFECTS
    grouped = defaultdict(list)
    opponent_ids = set()
    for credit in credits:
        facts = deepcopy(json.loads(credit.facts_json))
        opponent_ids.update(facts["opponents"])
        grouped[credit.game_id].append((credit, facts))
    owner_map = (frozen_owners if frozen_owners is not None else progress_owner_ids(db, opponent_ids | set(identities)))
    self_ids = {owner_map.get(value, value) for value in identities}
    for candidates in grouped.values():
        for _credit, facts in candidates:
            facts["opponents"] = sorted({owner_map.get(value, value) for value in facts["opponents"]} - self_ids)
    groups = sorted(grouped.values(), key=lambda rows: (as_utc(rows[0][0].finished_at), rows[0][0].game_id))
    result = {}
    for goal in ACHIEVEMENTS:
        number = int(goal["id"].rsplit("_", 1)[1])
        aggregate = _new_aggregate()
        if number in (124, 125, 134, 135):
            track = "activated" if number < 126 else "witnessed"
            effects = tuple(SURPRISE_EFFECTS)
            masks = {0}
            for candidates in groups:
                options = {sum(1 << effects.index(effect) for effect in set(facts.get("table_surprises", {}).get(track, []))
                               if effect in effects) for _credit, facts in candidates}
                masks = {left | right for left in masks for right in options}
            count = max((mask.bit_count() for mask in masks), default=0)
            target = _progress(aggregate, goal["id"])[1]
            result[goal["id"]] = min(count, target), target
            continue
        for candidates in groups:
            # Evaluate the actual single-seat contribution before choosing it.
            def strength(candidate):
                credit, facts = candidate
                probe = _new_aggregate()
                _accumulate(probe, facts, credit.finished_at)
                return _progress(probe, goal["id"])[0]
            credit, facts = max(candidates, key=strength)
            _accumulate(aggregate, facts, credit.finished_at)
        aggregate["withdrawals"] = db.scalar(select(HausdeppWithdrawal.user_id).where(
            HausdeppWithdrawal.user_id.in_(identities)).limit(1)) is not None
        result[goal["id"]] = _progress(aggregate, goal["id"])
    return result


def _selected_credits(db, owner_id, identities, credits, *, rounds=None):
    selected = {item.row.game_id: item.origin_id for item in (
        rounds if rounds is not None else selected_rounds(db, owner_id, origins=identities))}
    grouped = defaultdict(list)
    for credit in credits:
        grouped[credit.game_id].append(credit)
    # A legitimately retained HD credit does not require a still-existing result.
    return [min(rows, key=lambda row: (row.user_id != selected.get(row.game_id), row.user_id))
            for rows in grouped.values()]


@dataclass
class ProjectionInputs:
    identities: tuple
    credits: list
    rounds: tuple
    values: dict
    contexts: dict


def read_projection_inputs(db, owner_id):
    identities = owned_origin_ids(db, owner_id)
    credits = _credits(db, identities)
    return ProjectionInputs(identities, credits, tuple(selected_rounds(db, owner_id, origins=identities)),
                            _progress_values(db, identities, credits), {})


def project_progress(db, owner_id, native, *, inputs=None):
    from .hausdepp_achievements import _new_aggregate, _projection, _rank
    inputs = inputs or read_projection_inputs(db, owner_id)
    credits = inputs.credits
    selected = _selected_credits(db, owner_id, inputs.identities, credits, rounds=inputs.rounds)
    awards = effective_awards(db, owner_id, inputs=inputs)
    unlocks = [SimpleNamespace(achievement_id=key, unlocked_at=value["unlocked_at"], awarded_points=0)
               for key, value in awards.items()]
    result = _projection(selected, unlocks, _new_aggregate(), 0)
    values = inputs.values
    for item in result["achievements"]["items"]:
        current, target = values[item["id"]]
        item["progress"] = {"current": target if item["unlocked"] else current, "target": target}
    achievement_xp = sum(item["xp"] for item in awards.values())
    total = result["scoring"]["round_points"] + achievement_xp
    result["scoring"].update(points=total, achievement_points=achievement_xp)
    # Reuse the published rank/progress calculation for frozen actual prices.
    rank = _rank(total)
    from .hausdepp_achievements import RANKS
    next_rank = next((dict(item) for item in RANKS if item["threshold"] > total), None)
    gap = next_rank["threshold"] - rank["threshold"] if next_rank else 0
    current = total - rank["threshold"] if next_rank else 0
    rank.update(next=next_rank, progress={"current": current, "target": gap,
                                        "percent": round(current / gap * 100, 2) if gap else 100})
    result["rank"] = rank
    # Normal target delivery is computed exclusively from its native journal.
    # Union points never enter receipt snapshots, points_earned or rank_up.
    result["presentation"] = deepcopy(native["presentation"])
    return result


def public_score_points(db, owner_id):
    """Titles need the immutable narrow ledger, never full result histories."""
    from .hausdepp_achievements import _round_points
    identities = owned_origin_ids(db, owner_id)
    credits = _credits(db, identities)
    grouped = defaultdict(list)
    for credit in credits:
        grouped[credit.game_id].append(credit)
    selected = []
    for rows in grouped.values():
        metadata = {tuple(json.loads(row.facts_json)[key] for key in ("participant_count", "cpu_count", "human_count"))
                    for row in rows}
        if len(metadata) != 1:
            raise ValueError("hausdepp_invalid_merged_credit")
        # Participation XP is identical for every eligible seat of one round.
        selected.append(min(rows, key=lambda row: row.user_id))
    inputs = ProjectionInputs(identities, credits, (), {}, {})
    return _round_points(selected) + sum(item["xp"] for item in effective_awards(db, owner_id, inputs=inputs).values())


def _latest_operation(db, owner_id):
    return db.scalar(select(AccountMergeOperation).where(AccountMergeOperation.target_user_id == owner_id)
                     .order_by(AccountMergeOperation.created_at.desc(), AccountMergeOperation.id.desc()).limit(1))


def grant_combined(db, owner_id, *, operation=None, reached_at=None, inputs=None):
    from .hausdepp_achievements import ACHIEVEMENTS
    operation = operation or _latest_operation(db, owner_id)
    if operation is None:
        return
    inputs = inputs or read_projection_inputs(db, owner_id)
    identities, credits, values = inputs.identities, inputs.credits, inputs.values
    existing = effective_awards(db, owner_id, inputs=inputs)
    through = {str(origin): max((as_utc(item.finished_at) for item in credits if item.user_id == origin),
                                  default=as_utc(operation.created_at)).isoformat() for origin in identities}
    opponents = {other for item in credits for other in json.loads(item.facts_json)["opponents"]}
    owner_map = progress_owner_ids(db, opponents | set(identities))
    sealed_owners = {str(key): value for key, value in owner_map.items() if key != value}
    for goal in ACHIEVEMENTS:
        current, target = values[goal["id"]]
        if goal["id"] in existing or current < target:
            continue
        context = {"v": 1, "origins": list(identities), "through": through, "owners": sealed_owners,
                   "criterion": goal["id"], "target": target}
        witness = hashlib.sha256(json.dumps(context, sort_keys=True).encode()).hexdigest()[:16]
        record_award_support(db, owner_id=owner_id, game_type="hausdepp", achievement_key=goal["id"],
            support_key=f"threshold:{operation.id}:{goal['id']}:{witness}", origin_user_id=owner_id,
            operation_id=operation.id, unlocked_at=max(as_utc(operation.created_at), as_utc(reached_at)) if reached_at else operation.created_at,
            credited_amount=goal["points"],
            kind="native_observed" if reached_at is not None else "merge_threshold",
            context=context)


def prepare_hausdepp_merge_in_session(db, context):
    from .hausdepp_achievements import _ACHIEVEMENTS_BY_ID, synchronize_hausdepp_progress_in_session
    for origin in context.origin_ids:
        if origin != context.target_user_id:
            synchronize_hausdepp_progress_in_session(db, origin)
    before = synchronize_hausdepp_progress_in_session(db, context.target_user_id)
    for owner, origins in ((context.source_user_id, context.source_origin_ids),
                           (context.target_user_id, context.target_origin_ids)):
        existing = {item.support_key for item in award_backings(db, owner, "hausdepp")}
        for unlock in _native_unlocks(db, origins):
            definition = _ACHIEVEMENTS_BY_ID.get(unlock.achievement_id)
            if definition is None:
                continue
            # Original HD has no frozen price column: capture the actual current
            # published award once, never reinterpret awarded_points (revision).
            key = f"native:{unlock.user_id}:{unlock.achievement_id}"
            if key not in existing:
                record_award_support(db, owner_id=owner, game_type="hausdepp", achievement_key=unlock.achievement_id,
                    support_key=key, origin_user_id=unlock.user_id, operation_id=context.operation_id,
                    unlocked_at=unlock.unlocked_at, credited_amount=definition["points"],
                    context={"v": 1, "game_id": unlock.source_game_id})
    return {"points": before["scoring"]["points"], "rank_level": before["rank"]["level"],
            "achievement_ids": sorted(item["id"] for item in before["achievements"]["items"] if item["unlocked"]),
            "normal_presentation": before["presentation"]}


def consolidate_hausdepp_merge_in_session(db, context, prepared):
    previous = effective_awards(db, context.source_user_id, origins=context.source_origin_ids)
    copy_active_backings(db, source_owner_id=context.source_user_id, target_owner_id=context.target_user_id,
        game_type="hausdepp", operation_id=context.operation_id,
        continuity_dates={key: value["unlocked_at"] for key, value in previous.items()})
    operation = db.get(AccountMergeOperation, context.operation_id)
    inputs = read_projection_inputs(db, context.target_user_id)
    grant_combined(db, context.target_user_id, operation=operation, inputs=inputs)
    after = project_progress(db, context.target_user_id,
                             {"presentation": prepared["normal_presentation"]}, inputs=inputs)
    from .hausdepp_achievements import RANKS
    awards = effective_awards(db, context.target_user_id)
    inherited = set(previous) - set(prepared["achievement_ids"])
    public = {"before_points": prepared["points"], "after_points": after["scoring"]["points"],
              "before_rank": RANKS[prepared["rank_level"] - 1]["name"], "after_rank": after["rank"]["name"],
              "achievement_count": len(awards), "inherited_achievement_count": len(inherited),
              "new_achievement_count": len(set(awards) - set(previous) - set(prepared["achievement_ids"])),
              "games_played": len(inputs.rounds)}
    return {"public": public, "normal_presentation": after["presentation"],
            "resolutions": [item.metadata() for item in inputs.rounds]}
