"""Public DRAFT Watten achievement labels, with private source validation.

Only current-generation persisted grants may appear. Full account validation
is reused once per distinct account on the bounded requested page, in the same
read session. No source identifiers or private projections leave this module.
"""

from __future__ import annotations

from sqlalchemy import exists, func, select

from .database import database_schema_ready, session_scope
from .models import User, WattenAchievementGrant, WattenProgressState
from .security import as_utc
from .watten_account import _owned_matches, _progress
from .watten_progression import DRAFT_ACHIEVEMENTS, DRAFT_CATALOG_VERSION
from .watten_surprises import SURPRISE_ACHIEVEMENTS


class WattenAchievementFeedError(ValueError):
    pass


def _require(condition, code="watten_feed_invalid_request"):
    if not condition:
        raise WattenAchievementFeedError(code)


def _achievement(grant):
    definition = next((item for item in (*DRAFT_ACHIEVEMENTS, *SURPRISE_ACHIEVEMENTS) if item.achievement_id == grant.achievement_id
                       and 1 <= grant.catalog_version <= DRAFT_CATALOG_VERSION), None)
    if definition is None:
        name = {"de": "Gespeicherter Watten-Erfolg", "en": "Stored Watten achievement"}
        description = {"de": "Die ursprüngliche Bedingung ist in diesem Katalog nicht enthalten.",
                       "en": "The original condition is not part of this catalog."}
    else:
        name = {"de": definition.name.de, "en": definition.name.en}
        description = {"de": definition.condition.de, "en": definition.condition.en}
    return {"id": definition.achievement_id if definition else "archived", "name": name, "description": description,
            "actual_xp": grant.xp, "catalog_version": grant.catalog_version, "archived": definition is None}


def build_watten_achievement_feed(viewer_user_id: int, *, page=1, limit=12) -> dict:
    _require(type(viewer_user_id) is int and viewer_user_id > 0 and type(page) is int and page >= 1
             and type(limit) is int and 1 <= limit <= 30)
    _require(database_schema_ready(), "watten_feed_unavailable")
    with session_scope() as db:
        users = list(db.execute(select(User.id, User.is_active)))
        existing = {identifier for identifier, _active in users}
        _require(any(identifier == viewer_user_id and active for identifier, active in users), "watten_feed_invalid_user")
        # A missing epoch must not silently remove an active grant owner before
        # pagination. Detect this using identity metadata, before private JSON.
        orphan = select(User.id).where(User.is_active.is_(True),
            exists(select(WattenAchievementGrant.user_id).where(WattenAchievementGrant.user_id == User.id)),
            ~exists(select(WattenProgressState.user_id).where(WattenProgressState.user_id == User.id))).limit(1)
        _require(db.scalar(orphan) is None, "watten_feed_invalid_source")
        from .account_progress import owned_origin_ids
        from .models import AccountProgressOrigin
        if db.scalar(select(AccountProgressOrigin.origin_user_id).limit(1)) is not None:
            from .watten_merge import _journals, effective_awards, feed_award_candidates, project_progress
            names = dict(db.execute(select(User.id, User.username).where(User.is_active.is_(True))).all())
            candidates = [(award["unlocked_at"], owner, key, award)
                          for owner, awards in feed_award_candidates(db, names).items() for key, award in awards.items()]
            candidates.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
            total, offset = len(candidates), (page - 1) * limit
            entries, validated = [], {}
            from types import SimpleNamespace
            for at, owner, key, award in candidates[offset:offset + limit]:
                if owner not in validated:
                    matches = list(_owned_matches(db, owner, existing))
                    progress, _credits = _progress(db, owner, matches)
                    identities = owned_origin_ids(db, owner)
                    journals = _journals(db, identities, seed={owner: (matches, progress, _credits)}, existing=existing)
                    actual_awards = effective_awards(db, owner, journals=journals)
                    if len(identities) > 1:
                        progress, _credits = project_progress(db, owner, progress, journals=journals, awards=actual_awards)
                    validated[owner] = progress, actual_awards
                progress, actual_awards = validated[owner]
                _require(actual_awards.get(key) == award, "watten_feed_invalid_source")
                grant = SimpleNamespace(achievement_id=key, catalog_version=award["catalog_version"], xp=award["xp"])
                entries.append({"reached_at": as_utc(at).isoformat(),
                    "player": {"display_name": names[owner], "is_self": owner == viewer_user_id,
                               "title": progress["title"]}, "achievement": _achievement(grant)})
            return {"schema_version": 1, "game_type": "watten", "status": "draft", "coverage": {"complete": True},
                    "entries": entries, "pagination": {"page": page, "limit": limit, "total_entries": total,
                        "total_pages": max(1, (total + limit - 1) // limit), "has_next": offset + limit < total,
                        "has_previous": page > 1}}
        criteria = (User.is_active.is_(True), WattenAchievementGrant.generation == WattenProgressState.generation)
        base = select(WattenAchievementGrant, User.username).join(
            User, User.id == WattenAchievementGrant.user_id).join(
                WattenProgressState, WattenProgressState.user_id == WattenAchievementGrant.user_id).where(*criteria)
        total = db.scalar(select(func.count()).select_from(base.subquery()))
        offset = (page - 1) * limit
        rows = list(db.execute(base.order_by(WattenAchievementGrant.reached_at.desc(),
                                             WattenAchievementGrant.user_id.desc(),
                                             WattenAchievementGrant.achievement_id.desc()).offset(offset).limit(limit))) if offset < total else []
        validated = {}
        try:
            for grant, _name in rows:
                account = grant.user_id
                if account not in validated:
                    matches = list(_owned_matches(db, account, existing))
                    progress, _credits = _progress(db, account, matches)
                    _require(progress["generation"] == grant.generation, "watten_feed_invalid_source")
                    validated[account] = progress
            entries = [{"reached_at": as_utc(grant.reached_at).isoformat(),
                        "player": {"display_name": name, "is_self": grant.user_id == viewer_user_id,
                                   "title": validated[grant.user_id]["title"]},
                        "achievement": _achievement(grant)} for grant, name in rows]
        except (ValueError, TypeError, KeyError, OverflowError) as exc:
            raise WattenAchievementFeedError("watten_feed_invalid_source") from exc
    return {"schema_version": 1, "game_type": "watten", "status": "draft", "coverage": {"complete": True},
            "entries": entries, "pagination": {"page": page, "limit": limit, "total_entries": total,
                "total_pages": max(1, (total + limit - 1) // limit), "has_next": offset + limit < total,
                "has_previous": page > 1}}
