"""Dice award adapters: original proof first, canonical target rows second."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime

from sqlalchemy import func, inspect, select

from .account_merge_backings import (
    award_backings,
    copy_active_backings,
    is_canonical_mirror,
    reconcile_award_backings,
    record_award_support,
)
from .dice_progress import (
    engagement_counts_for_origins,
    origin_ids_for_progress,
    resolution_metadata,
    selected_zdwa_seats,
)
from .models import (
    CompletedGame,
    User,
    UserAchievement,
    ZilchAchievementEvidence,
    ZilchAchievementUnlock,
    ZilchCommunityMilestone,
    ZilchCommunityRecipient,
)
from .security import as_utc, utcnow


def merge_projection_enabled(db, owner_id, game_type):
    if not inspect(db.connection()).has_table("merged_award_backings"):
        return False
    return len(origin_ids_for_progress(db, owner_id)) > 1 or bool(award_backings(db, owner_id, game_type))


def _proof_context(db, origin_ids, exclusions, version=1):
    markers = {str(user.id): {key: as_utc(value).isoformat() if value is not None else None
                             for key in user.__mapper__.columns.keys() if key.startswith("achievement_")
                             and key.endswith("_started_at") for value in [getattr(user, key)]}
               for user in db.scalars(select(User).where(User.id.in_(tuple(origin_ids))))}
    return {"version": version, "origin_ids": list(origin_ids), "excluded_opponent_ids": list(exclusions), "markers": markers,
            "recorded_through": as_utc(utcnow()).isoformat(),
            "game_ceiling": int(db.scalar(select(func.max(CompletedGame.id))) or 0),
            "evidence_ceiling": int(db.scalar(select(func.max(ZilchAchievementEvidence.id))) or 0)}


def _qualified(db, game_type, key, context, *, cache=None):
    if type(context.get("version")) is not int or context["version"] != 1:
        raise ValueError("unknown_dice_merge_proof_version")
    ids = tuple(context["origin_ids"])
    if not ids or any(type(value) is not int or value < 1 for value in ids) or len(set(ids)) != len(ids):
        raise ValueError("invalid_dice_merge_origin_context")
    if any(type(value) is not int or value < 1 for value in context["excluded_opponent_ids"]):
        raise ValueError("invalid_dice_merge_opponent_context")
    if any(type(context.get(field)) is not int or context[field] < 0 for field in ("game_ceiling", "evidence_ceiling")):
        raise ValueError("invalid_dice_merge_source_ceiling")
    user = db.get(User, ids[0]) if ids else None
    if user is None or any(db.get(User, value) is None for value in ids):
        return False
    exclusions = tuple(context["excluded_opponent_ids"])
    recorded_through = datetime.fromisoformat(context["recorded_through"])
    if recorded_through.tzinfo is None:
        raise ValueError("invalid_dice_merge_recorded_boundary")
    cache = {} if cache is None else cache
    cache_key = json.dumps({field: context.get(field) for field in (
        "origin_ids", "excluded_opponent_ids", "game_ceiling", "evidence_ceiling", "markers", "excluded_game_id", "recorded_through",
    )}, sort_keys=True)
    bundle = cache.setdefault((game_type, cache_key), {})
    if game_type == "zdwa":
        from .achievements import ACHIEVEMENT_BY_KEY, _is_unlocked, _progress_for_user
        definition = ACHIEVEMENT_BY_KEY.get(key)
        if "progress" not in bundle:
            bundle["progress"] = _progress_for_user(
                db, user, origin_ids=ids, excluded_opponent_ids=exclusions, game_ceiling=context["game_ceiling"],
                marker_overrides=context.get("markers"), excluded_completed_game_id=context.get("excluded_game_id"),
                recorded_through=recorded_through,
            )
        return definition is not None and _is_unlocked(definition, bundle["progress"])
    from .cross_game_activity import cross_game_activity_for_user
    from .zilch_achievements import (
        ZILCH_ACHIEVEMENT_BY_KEY,
        _criterion_is_satisfied,
        _cross_game_criterion_is_satisfied,
        _evidence_for_user,
    )
    definition = ZILCH_ACHIEVEMENT_BY_KEY.get(key)
    if definition is None:
        return False
    if type(context.get("definition_version")) is not int or context["definition_version"] != definition.definition_version:
        raise ValueError("unknown_zilch_merge_definition_version")
    if definition.criterion == "engagement_event":
        if "engagement" not in bundle:
            bundle["engagement"] = engagement_counts_for_origins(db, ids)
        return bundle["engagement"].get(key.removeprefix("zilch."), 0) >= definition.target
    if definition.criterion == "community_games":
        if "community" not in bundle:
            bundle["community"] = set(db.scalars(select(ZilchCommunityMilestone.achievement_key).join(
                ZilchCommunityRecipient, ZilchCommunityRecipient.milestone_id == ZilchCommunityMilestone.id,
            ).where(ZilchCommunityRecipient.user_id.in_(ids))))
        return key in bundle["community"]
    if definition.criterion in {"cross_game_days", "cross_game_streak"}:
        if "cross_game" not in bundle:
            bundle["cross_game"] = cross_game_activity_for_user(
                db, user, origin_ids=ids, game_ceiling=context["game_ceiling"], marker_overrides=context.get("markers"),
                excluded_completed_game_id=context.get("excluded_game_id"), recorded_through=recorded_through,
            )
        return _cross_game_criterion_is_satisfied(definition, bundle["cross_game"])
    if "facts" not in bundle:
        bundle["facts"] = [facts for _row, facts in _evidence_for_user(
            db, user.id, origin_ids=ids, excluded_opponent_ids=exclusions, evidence_ceiling=context["evidence_ceiling"],
            recorded_through=recorded_through,
        )]
    return _criterion_is_satisfied(definition, [fact for fact in bundle["facts"]
                                               if fact.get("_source_game_id") != context.get("excluded_source_game_id")])


def _validate(db, backing, *, cache=None):
    return _qualified(db, backing.game_type, backing.achievement_key, json.loads(backing.context_json), cache=cache)


def _definitions(game_type):
    if game_type == "zdwa":
        from .achievements import ACHIEVEMENTS
        return ACHIEVEMENTS
    from .zilch_achievements import ZILCH_ACHIEVEMENTS
    return ZILCH_ACHIEVEMENTS


def _rows(db, owner_id, game_type):
    model = UserAchievement if game_type == "zdwa" else ZilchAchievementUnlock
    return {row.achievement_key: row for row in db.scalars(select(model).where(model.user_id == owner_id))}


def _versioned(context, definition, game_type):
    return {**context, **({"definition_version": definition.definition_version} if game_type == "zilch" else {})}


def _capture(db, *, owner_id, game_type, definition, operation_id, context, unlocked_at,
             kind, witness, continuity_date=None):
    digest = hashlib.sha256(witness.encode()).hexdigest()
    return record_award_support(
        db, owner_id=owner_id, game_type=game_type, achievement_key=definition.key,
        support_key=f"{game_type}:{digest}", origin_user_id=int(context.get("witness_origin_user_id", context["origin_ids"][0])), operation_id=operation_id,
        unlocked_at=unlocked_at, credited_amount=int(definition.points), context=context, kind=kind,
        continuity_date=continuity_date,
    )


def _prepare(db, context, game_type):
    definitions = _definitions(game_type)
    cache = {}
    before = _rows(db, context.target_user_id, game_type)
    prepared = {"before_rank": _rank_for_keys(game_type, before), "target_keys": sorted(before), "target_dates": {
        key: as_utc(row.unlocked_at).isoformat() for key, row in before.items()}, "copied": 0}
    for owner_id, origin_ids in ((context.source_user_id, context.source_origin_ids),
                                 (context.target_user_id, context.target_origin_ids)):
        native = _rows(db, owner_id, game_type)
        # Validate existing copied supports under their sealed context before copying.
        for definition in definitions:
            reconcile_award_backings(db, owner_id=owner_id, game_type=game_type, achievement_key=definition.key,
                                     now=context.created_at, validate=lambda row: _validate(db, row, cache=cache))
        proof = _proof_context(db, (owner_id,), ())
        for definition in definitions:
            if is_canonical_mirror(db, owner_id, game_type, definition.key):
                continue
            criterion = _versioned(proof, definition, game_type)
            if not _qualified(db, game_type, definition.key, criterion, cache=cache):
                continue
            row = native.get(definition.key)
            unlocked_at = row.unlocked_at if row is not None else context.created_at
            if game_type == "zdwa" and definition.kind == "account_created" and row is None:
                unlocked_at = db.get(User, owner_id).created_at
            recovered_recipient = None
            if game_type == "zilch" and definition.criterion == "community_games" and row is None:
                recovered_recipient = db.scalar(select(ZilchCommunityRecipient).join(
                    ZilchCommunityMilestone, ZilchCommunityMilestone.id == ZilchCommunityRecipient.milestone_id,
                ).where(ZilchCommunityRecipient.user_id == owner_id,
                        ZilchCommunityMilestone.achievement_key == definition.key).order_by(
                    ZilchCommunityRecipient.awarded_at, ZilchCommunityRecipient.id).limit(1))
                unlocked_at = recovered_recipient.awarded_at
            # Original-source fields are provenance only; eligibility never trusts the award row.
            criterion = {**criterion, "source_completed_game_id": getattr(row, "source_completed_game_id", None),
                         "source_game_id": getattr(row, "source_game_id", None),
                         "presentation_game_id": getattr(row, "presentation_game_id", None),
                         "source_community_recipient_id": getattr(row, "source_community_recipient_id", None)
                         or (recovered_recipient.id if recovered_recipient is not None else None)}
            _capture(db, owner_id=owner_id, game_type=game_type, definition=definition,
                     operation_id=context.operation_id, context=criterion, unlocked_at=unlocked_at, kind="original",
                     witness=f"original:{owner_id}:{definition.key}:{getattr(row, 'id', 'recovered')}:{as_utc(unlocked_at).isoformat()}")
        # The context includes all previous origins only for existing copied backings; never recapture mirrors.
        if set(origin_ids) != set(origin_ids_for_progress(db, owner_id)):
            raise ValueError("merge_origin_context_changed")
    prepared["target_supported_keys"] = sorted({row.achievement_key for row in award_backings(
        db, context.target_user_id, game_type,
    ) if row.invalidated_at is None})
    db.flush()
    return prepared


def _reconcile(db, owner_id, game_type, *, now=None, context=None, prepared=None, only_keys=None,
               source_completed_game_id=None, presentation_game_id=None, continuity_dates=None):
    now = as_utc(now or utcnow())
    existing = _rows(db, owner_id, game_type)
    cache = {}
    before = set(existing)
    closed_before = set()
    ids = origin_ids_for_progress(db, owner_id)
    proof = _proof_context(db, ids, ids)
    known = award_backings(db, owner_id, game_type)
    supports_by_key = {}
    for backing in known:
        supports_by_key.setdefault(backing.achievement_key, []).append(backing)
    operation_id = context.operation_id if context is not None else (known[-1].operation_id if known else None)
    if operation_id is None:
        # An owned origin always has an operation even if neither account has an award yet.
        from .models import AccountProgressOrigin
        operation_id = db.scalar(select(AccountProgressOrigin.operation_id).where(
            AccountProgressOrigin.owner_user_id == owner_id,
        ).order_by(AccountProgressOrigin.origin_user_id).limit(1))
    if operation_id is None:
        raise ValueError("merge_operation_missing")
    event_game = db.get(CompletedGame, source_completed_game_id) if source_completed_game_id is not None else None
    if presentation_game_id is not None:
        event_game = db.scalar(select(CompletedGame).where(
            CompletedGame.game_type == game_type, CompletedGame.game_id == presentation_game_id,
        ))
    event_token = None
    if event_game is not None:
        event_token = hashlib.sha256(json.dumps({"game_id": event_game.game_id, "snapshot": event_game.snapshot_json,
            "seats": [(seat.id, seat.user_id, seat.player_key) for seat in event_game.participants]},
            sort_keys=True).encode()).hexdigest()
    for definition in _definitions(game_type):
        if only_keys is not None and definition.key not in only_keys:
            continue
        existing_supports = supports_by_key.setdefault(definition.key, [])
        projection = reconcile_award_backings(
            db, owner_id=owner_id, game_type=game_type, achievement_key=definition.key,
            now=now, validate=lambda row: _validate(db, row, cache=cache), supports=existing_supports,
        )
        row = existing.get(definition.key)
        if projection is None and row is not None and existing_supports and definition.key not in (continuity_dates or {}):
            # A closed cycle cannot keep its delivery identity or recover its old first date.
            db.delete(row)
            db.flush()
            row = None
            closed_before.add(definition.key)
        criterion = _versioned(proof, definition, game_type)
        if (projection is None or event_token is not None) and _qualified(db, game_type, definition.key, criterion, cache=cache):
            kind = "merge_threshold" if context is not None else "native_observed"
            continuity = projection.unlocked_at if projection is not None else (continuity_dates or {}).get(definition.key)
            genuine_date = row.unlocked_at if row is not None and not existing_supports else now
            criterion = {**criterion, "witness_origin_user_id": owner_id}
            if row is not None and not existing_supports:
                criterion.update({name: getattr(row, name, None) for name in (
                    "source_completed_game_id", "source_game_id", "presentation_game_id", "source_community_recipient_id",
                )})
            if row is None and source_completed_game_id is not None and not _qualified(
                db, game_type, definition.key, {**criterion, "excluded_game_id": source_completed_game_id}, cache=cache,
            ):
                criterion["source_completed_game_id"] = source_completed_game_id
            if row is None and presentation_game_id is not None and not _qualified(
                db, game_type, definition.key, {**criterion, "excluded_source_game_id": presentation_game_id}, cache=cache,
            ):
                criterion.update(source_game_id=presentation_game_id, presentation_game_id=presentation_game_id)
            if (row is None and context is None and game_type == "zilch"
                    and definition.criterion in {"cross_game_days", "cross_game_streak"}):
                from .cross_game_activity import cross_game_activity_for_user
                activity = cross_game_activity_for_user(db, db.get(User, owner_id))
                # A newly completed pair keeps the genuine Zilch report as its source,
                # including when the later ZDWA completion made the pair possible.
                criterion.update(source_game_id=activity.latest_zilch_game_id,
                                 presentation_game_id=presentation_game_id or activity.latest_zilch_game_id)
            witness = (f"event:{owner_id}:{definition.key}:{event_token}" if event_token is not None else
                       f"{kind}:{owner_id}:{definition.key}:{now.isoformat()}:{json.dumps(criterion, sort_keys=True)}")
            support_key = f"{game_type}:{hashlib.sha256(witness.encode()).hexdigest()}"
            if not any(backing.support_key == support_key for backing in existing_supports):
                existing_supports.append(_capture(db, owner_id=owner_id, game_type=game_type, definition=definition,
                         operation_id=operation_id, context=criterion, unlocked_at=genuine_date, kind=kind,
                         continuity_date=continuity, witness=witness))
            projection = reconcile_award_backings(
                db, owner_id=owner_id, game_type=game_type, achievement_key=definition.key,
                now=now, validate=lambda backing: _validate(db, backing, cache=cache), supports=existing_supports,
            )
        if projection is None:
            if row is not None:
                db.delete(row)
            continue
        if row is None:
            if game_type == "zdwa":
                row = UserAchievement(user_id=owner_id, achievement_key=definition.key,
                                      source_completed_game_id=criterion.get("source_completed_game_id"),
                                      unlocked_at=projection.unlocked_at)
            else:
                row = ZilchAchievementUnlock(user_id=owner_id, achievement_key=definition.key,
                                             definition_version=definition.definition_version,
                                             source_evidence_id=None, source_game_id=criterion.get("source_game_id"),
                                             presentation_game_id=criterion.get("presentation_game_id"),
                                             unlocked_at=projection.unlocked_at)
            db.add(row)
        else:
            row.unlocked_at = projection.unlocked_at
    db.flush()
    after = set(_rows(db, owner_id, game_type))
    return {"new_keys": sorted((after - before) | (after & closed_before)), "revoked_keys": sorted(before - after)}


def _consolidate(db, context, prepared, game_type):
    # A stale native unlock can survive failed post-delete cleanup. Only a
    # currently validated target witness may carry its earlier date forward.
    dates = {key: datetime.fromisoformat(value) for key, value in prepared["target_dates"].items()
             if key in prepared["target_supported_keys"]}
    source_keys = {row.achievement_key for row in award_backings(db, context.source_user_id, game_type)
                   if row.invalidated_at is None}
    copied = copy_active_backings(db, source_owner_id=context.source_user_id,
                                  target_owner_id=context.target_user_id, game_type=game_type,
                                  operation_id=context.operation_id, continuity_dates=dates)
    result = _reconcile(db, context.target_user_id, game_type, now=context.created_at, context=context, prepared=prepared)
    result["inherited_keys"] = sorted(source_keys - set(prepared["target_supported_keys"]))
    result["new_keys"] = sorted(set(result["new_keys"]) - set(result["inherited_keys"]))
    result["copied_supports"] = copied
    if game_type == "zdwa":
        result["resolutions"] = [resolution_metadata(game, seat, policy_version=context.policy_version)
                                 for game, seat in selected_zdwa_seats(db, context.target_user_id)]
    else:
        from .zilch_statistics import zilch_resolution_metadata_in_session
        result["resolutions"] = zilch_resolution_metadata_in_session(db, context.target_user_id)
    after_keys = set(_rows(db, context.target_user_id, game_type))
    after_rank = _rank_for_keys(game_type, after_keys)
    before_rank = prepared["before_rank"]
    result["public"] = {
        "before_points": before_rank["points"], "after_points": after_rank["points"],
        "before_rank": _friendly_rank(before_rank), "after_rank": _friendly_rank(after_rank),
        "achievement_count": len(after_keys), "inherited_achievement_count": len(result["inherited_keys"]),
        "new_achievement_count": len(result["new_keys"]), "games_played": len(result["resolutions"]),
    }
    return result


def prepare_zdwa_merge_in_session(db, context):
    return _prepare(db, context, "zdwa")


def consolidate_zdwa_merge_in_session(db, context, prepared):
    return _consolidate(db, context, prepared, "zdwa")


def prepare_zilch_merge_in_session(db, context):
    return _prepare(db, context, "zilch")


def consolidate_zilch_merge_in_session(db, context, prepared):
    return _consolidate(db, context, prepared, "zilch")


def _rank_for_keys(game_type, keys):
    if game_type == "zdwa":
        from .achievements import achievement_rank_for_keys
        return achievement_rank_for_keys(keys)
    from .zilch_achievements import zilch_achievement_points_for_keys, zilch_achievement_rank_for_points
    return zilch_achievement_rank_for_points(zilch_achievement_points_for_keys(keys))


def _friendly_rank(rank):
    translations = {"Spieler": "Player", "Fortgeschritten": "Advanced", "Meister": "Master", "Legende": "Legend",
                    "Großmeister": "Grandmaster", "Mythos": "Myth", "Experte": "Expert",
                    "Wirtshausmeister": "Tavern Master", "Würfelmythos": "Dice Myth"}
    return {"key": rank["key"], "de": rank["title"], "en": translations.get(rank["title"], rank["title"])}


def historical_award_supports_in_session(db, game_type, game_id, original_user_ids):
    """Original award moments, independent of a canonical owner's earlier union date."""
    from types import SimpleNamespace

    from .models import MergedAwardBacking
    game = db.scalar(select(CompletedGame).where(CompletedGame.game_type == game_type, CompletedGame.game_id == game_id))
    if game is None:
        return []
    rows = db.scalars(select(MergedAwardBacking).where(
        MergedAwardBacking.game_type == game_type, MergedAwardBacking.origin_user_id.in_(tuple(original_user_ids)),
        MergedAwardBacking.invalidated_at.is_(None), MergedAwardBacking.kind != "merge_threshold",
    ).order_by(MergedAwardBacking.original_unlocked_at, MergedAwardBacking.id))
    found = {}
    cache = {}
    for row in rows:
        proof = json.loads(row.context_json)
        source_matches = (proof.get("source_completed_game_id") == game.id if game_type == "zdwa" else
                          (proof.get("presentation_game_id") or proof.get("source_game_id")) == game_id)
        if game_type == "zilch" and proof.get("source_community_recipient_id"):
            source_matches = source_matches or db.scalar(select(ZilchCommunityMilestone.trigger_game_id).join(
                ZilchCommunityRecipient, ZilchCommunityRecipient.milestone_id == ZilchCommunityMilestone.id,
            ).where(ZilchCommunityRecipient.id == proof["source_community_recipient_id"])) == game_id
        if not source_matches or not _validate(db, row, cache=cache):
            continue
        key = (row.origin_user_id, row.achievement_key)
        found.setdefault(key, SimpleNamespace(user_id=row.origin_user_id, achievement_key=row.achievement_key,
                                               unlocked_at=row.original_unlocked_at,
                                               source_community_recipient_id=proof.get("source_community_recipient_id")))
    return list(found.values())
