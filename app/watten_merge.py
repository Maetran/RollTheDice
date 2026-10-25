"""Validated original Watten journals projected for their historical owner.

No account alias, original-binding rewrite, retrospective credit, synthetic
match award or acknowledgement is created by these adapters.
"""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from copy import deepcopy
from dataclasses import dataclass, fields
from types import SimpleNamespace

from sqlalchemy import select

from .account_merge_backings import award_backings, copy_active_backings, record_award_support
from .account_progress import owned_origin_ids
from .hausdepp_merge import is_merged
from .models import AccountMergeOperation, User, WattenAchievementGrant
from .security import as_utc
from .watten_evidence import validate_membership
from .watten_progression import (
    DRAFT_ACHIEVEMENTS,
    DRAFT_CATALOG_VERSION,
    Counters,
    MatchInput,
    evaluate_draft,
    title_for_xp,
)
from .watten_surprises import SURPRISE_ACHIEVEMENTS, qualifying_surprises


@dataclass(frozen=True)
class MatchSeat:
    origin_id: int
    match: object

    @property
    def own(self):
        return validate_membership(self.match.evidence, viewer_user_id=self.origin_id, bindings=self.match.original_bindings)

    def order(self):
        own = self.own
        score = next(item.points for item in self.match.evidence.scores if own.player_id in item.members)
        return not own.won, -score, own.seat, own.player_id, self.origin_id

    def metadata(self):
        own = self.own
        seat = next(item for item in self.match.row.participants if item.user_id == self.origin_id)
        frozen = self.match.frozen
        raw = [self.match.row.snapshot_json, frozen.bindings_json if frozen else None,
               [(item.position, item.player_key, item.user_id, item.display_name) for item in self.match.row.participants]]
        return {"game_type": "watten", "game_id": self.match.evidence.game_id, "origin_user_id": self.origin_id,
                "participant_id": seat.id, "player_key": own.player_id,
                "source_fingerprint": hashlib.sha256(json.dumps(raw, separators=(",", ":")).encode()).hexdigest()}


def _journals(db, identities):
    from .watten_account import _owned_matches, _progress
    existing = set(db.scalars(select(User.id)))
    result = {}
    for origin in identities:
        matches = list(_owned_matches(db, origin, existing))
        progress, credits = _progress(db, origin, matches)
        result[origin] = (matches, progress, credits)
    return result


def selected_matches(db, owner_id, *, origins=None, journals=None):
    identities = tuple(origins or owned_origin_ids(db, owner_id))
    journals = journals or _journals(db, identities)
    grouped = defaultdict(list)
    for origin, (matches, _progress, _credits) in journals.items():
        for match in matches:
            grouped[match.evidence.game_id].append(MatchSeat(origin, match))
    return sorted((min(rows, key=lambda item: item.order()) for rows in grouped.values()),
                  key=lambda item: (item.match.evidence.finished_at, item.match.row.id), reverse=True)


def effective_awards(db, owner_id, *, origins=None, journals=None):
    identities = tuple(origins or owned_origin_ids(db, owner_id))
    journals = journals or _journals(db, identities)
    candidates = defaultdict(list)
    for origin, (_matches, progress, _credits) in journals.items():
        for item in db.scalars(select(WattenAchievementGrant).where(WattenAchievementGrant.user_id == origin,
                WattenAchievementGrant.generation == progress["generation"])):
            candidates[item.achievement_id].append((as_utc(item.reached_at), item.xp, item.catalog_version))
    contexts = {}
    for item in award_backings(db, owner_id, "watten"):
        if item.invalidated_at is None:
            context = json.loads(item.context_json)
            if item.kind == "original":
                original = db.get(WattenAchievementGrant, (item.origin_user_id, context["generation"], item.achievement_key))
                if original is None or original.source_game_id != context["game_id"]:
                    continue
            else:
                from datetime import datetime
                selector = json.dumps({key: context[key] for key in ("origins", "through")}, sort_keys=True)
                if selector not in contexts:
                    sealed = _journals(db, context["origins"])
                    filtered = {origin: (matches, progress, [credit for credit in credits
                                if as_utc(credit.finished_at) <= as_utc(datetime.fromisoformat(context["through"][str(origin)]))])
                                for origin, (matches, progress, credits) in sealed.items()}
                    contexts[selector] = _union_facts(db, context["origins"], filtered)
                counters, rare = contexts[selector]
                definition = next((goal for goal in (*DRAFT_ACHIEVEMENTS, *SURPRISE_ACHIEVEMENTS)
                                   if goal.achievement_id == item.achievement_key), None)
                if definition is None:
                    continue
                current = counters[definition.counter] if bool(definition.counter) else int(item.achievement_key in rare)
                if current < context["target"]:
                    continue
            candidates[item.achievement_key].append((min(as_utc(item.original_unlocked_at), as_utc(item.continuity_date)),
                                                     item.credited_amount, context["catalog_version"]))
    return {key: {"unlocked_at": min(item[0] for item in rows), "xp": max(item[1] for item in rows),
                  "catalog_version": min(item[2] for item in rows)} for key, rows in candidates.items()}


def _union_facts(db, identities, journals):
    grouped = defaultdict(list)
    days = set()
    rare = set()
    for origin, (matches, _progress, credits) in journals.items():
        credited = {credit.game_id for credit in credits}
        for match in matches:
            if match.evidence.game_id not in credited:
                continue
            proposal = evaluate_draft((MatchInput(match.evidence, match.original_bindings),), viewer_user_id=origin)
            grouped[match.evidence.game_id].append(proposal.counters)
            days.add(match.evidence.play_day)
            rare.update(qualifying_surprises(db, match.evidence, match.original_bindings, origin))
    # Each goal has exactly one scalar counter. Compound wins/bid/retour facts
    # are evaluated above on one complete original seat before this scalar max.
    result = {field.name: sum(max(getattr(item, field.name) for item in rows) for rows in grouped.values())
              for field in fields(Counters)}
    result["days"] = len(days)
    result["variety"] = sum(result[key] > 0 for key in ("two", "three", "four"))
    return result, rare


def _selected_credits(seats, journals):
    credits = {(origin, item.game_id): item for origin, (_matches, _progress, rows) in journals.items() for item in rows}
    grouped = defaultdict(list)
    for origin, (matches, _progress, rows) in journals.items():
        for match in matches:
            if (origin, match.evidence.game_id) in credits:
                grouped[match.evidence.game_id].append(MatchSeat(origin, match))
    # If the global best statistical seat was never credited, it must not gain
    # invented retrospective XP. Another actual credited whole seat may supply
    # the single immutable participation credit for that shared game.
    return [credits[(chosen.origin_id, game)] for game, candidates in grouped.items()
            for chosen in (min(candidates, key=lambda item: item.order()),)]


def project_progress(db, owner_id, native, *, journals=None):
    from .watten_account import _title
    identities = owned_origin_ids(db, owner_id)
    journals = journals or _journals(db, identities)
    result = deepcopy(native)
    counters, rare = _union_facts(db, identities, journals)
    awards = effective_awards(db, owner_id, journals=journals)
    known_ids = {goal.achievement_id for goal in (*DRAFT_ACHIEVEMENTS, *SURPRISE_ACHIEVEMENTS)}
    for item in result["achievements"]:
        award = awards.get(item["id"])
        known = award is not None and award["catalog_version"] <= DRAFT_CATALOG_VERSION
        goal = next((goal for goal in DRAFT_ACHIEVEMENTS if goal.achievement_id == item["id"]), None)
        current = counters[goal.counter] if goal else int(item["id"] in rare)
        item.update(unlocked=known, granted_xp=award["xp"] if known else 0,
                    earned_at=award["unlocked_at"].isoformat() if known else None,
                    progress=item["target"] if known else min(item["target"], current))
    result["archived_achievements"] = [{"id": key,
        "name": {"de": "Gespeicherter Watten-Erfolg", "en": "Stored Watten achievement"},
        "granted_xp": item["xp"], "earned_at": item["unlocked_at"].isoformat(), "catalog_version": item["catalog_version"]}
        for key, item in awards.items() if key not in known_ids or item["catalog_version"] > DRAFT_CATALOG_VERSION]
    seats = selected_matches(db, owner_id, journals=journals)
    credits = _selected_credits(seats, journals)
    match_xp, achievement_xp = sum(item.xp for item in credits), sum(item["xp"] for item in awards.values())
    title = title_for_xp(match_xp + achievement_xp)
    result.update(match_xp=match_xp, achievement_xp=achievement_xp, total_xp=match_xp + achievement_xp,
                  title=_title(title.current), next_title=_title(title.next_title) if title.next_title else None,
                  xp_to_next=title.xp_to_next, counters=counters)
    # generation/sequence/ack and pending remain the exact active target journal.
    return result, credits


def _latest_operation(db, owner_id):
    return db.scalar(select(AccountMergeOperation).where(AccountMergeOperation.target_user_id == owner_id)
                     .order_by(AccountMergeOperation.created_at.desc(), AccountMergeOperation.id.desc()).limit(1))


def grant_combined(db, owner_id, *, operation=None, reached_at=None):
    operation = operation or _latest_operation(db, owner_id)
    if operation is None:
        return
    identities = owned_origin_ids(db, owner_id)
    journals = _journals(db, identities)
    counters, rare = _union_facts(db, identities, journals)
    existing = effective_awards(db, owner_id, journals=journals)
    through = {str(origin): max((as_utc(item.finished_at) for item in credits), default=as_utc(operation.created_at)).isoformat()
               for origin, (_matches, _progress, credits) in journals.items()}
    for goal in (*DRAFT_ACHIEVEMENTS, *SURPRISE_ACHIEVEMENTS):
        current = counters[goal.counter] if bool(goal.counter) else int(goal.achievement_id in rare)
        target = goal.target if bool(goal.counter) else 1
        if goal.achievement_id in existing or current < target:
            continue
        record_award_support(db, owner_id=owner_id, game_type="watten", achievement_key=goal.achievement_id,
            support_key=f"threshold:{operation.id}:{goal.achievement_id}", origin_user_id=owner_id,
            operation_id=operation.id, unlocked_at=reached_at or operation.created_at, credited_amount=goal.xp,
            kind="native_observed" if reached_at is not None else "merge_threshold",
            context={"v": 1, "origins": list(identities), "through": through, "criterion": goal.achievement_id,
                     "target": target, "catalog_version": DRAFT_CATALOG_VERSION})


def prepare_watten_merge_in_session(db, context):
    journals = _journals(db, context.origin_ids)
    before = journals[context.target_user_id][1]
    if is_merged(db, context.target_user_id):
        before, _credits = project_progress(db, context.target_user_id, before,
            journals={key: value for key, value in journals.items() if key in context.target_origin_ids})
    for owner, origins in ((context.source_user_id, context.source_origin_ids),
                           (context.target_user_id, context.target_origin_ids)):
        for origin in origins:
            progress = journals[origin][1]
            for grant in db.scalars(select(WattenAchievementGrant).where(WattenAchievementGrant.user_id == origin,
                    WattenAchievementGrant.generation == progress["generation"])):
                record_award_support(db, owner_id=owner, game_type="watten", achievement_key=grant.achievement_id,
                    support_key=f"native:{origin}:{grant.generation}:{grant.achievement_id}", origin_user_id=origin,
                    operation_id=context.operation_id, unlocked_at=grant.reached_at, credited_amount=grant.xp,
                    context={"v": 1, "game_id": grant.source_game_id, "generation": grant.generation,
                             "catalog_version": grant.catalog_version})
    return {"points": before["total_xp"], "rank_level": before["title"]["level"],
            "achievement_ids": sorted(effective_awards(db, context.target_user_id,
                origins=context.target_origin_ids, journals={key: value for key, value in journals.items()
                                                            if key in context.target_origin_ids}))}


def consolidate_watten_merge_in_session(db, context, prepared):
    previous = effective_awards(db, context.source_user_id, origins=context.source_origin_ids)
    copy_active_backings(db, source_owner_id=context.source_user_id, target_owner_id=context.target_user_id,
        game_type="watten", operation_id=context.operation_id,
        continuity_dates={key: value["unlocked_at"] for key, value in previous.items()})
    grant_combined(db, context.target_user_id, operation=db.get(AccountMergeOperation, context.operation_id))
    from .watten_account import build_watten_account_in_session
    after = build_watten_account_in_session(db, context.target_user_id)["progress"]
    from .watten_progression import DRAFT_TITLES
    awards = effective_awards(db, context.target_user_id)
    before_rank = DRAFT_TITLES[prepared["rank_level"] - 1]
    public = {"before_points": prepared["points"], "after_points": after["total_xp"],
              "before_rank": {"de": before_rank.name.de, "en": before_rank.name.en}, "after_rank": after["title"]["name"],
              "achievement_count": len(awards),
              "inherited_achievement_count": len(set(previous) - set(prepared["achievement_ids"])),
              "new_achievement_count": len(set(awards) - set(previous) - set(prepared["achievement_ids"])),
              "games_played": len(selected_matches(db, context.target_user_id))}
    return {"public": public, "normal_generation": after["generation"], "normal_sequence": after["grant_sequence"],
            "resolutions": [item.metadata() for item in selected_matches(db, context.target_user_id)]}


def public_grants(db, owner_id):
    return [SimpleNamespace(achievement_id=key, reached_at=item["unlocked_at"], xp=item["xp"],
                            catalog_version=item["catalog_version"], user_id=owner_id)
            for key, item in effective_awards(db, owner_id).items()]
