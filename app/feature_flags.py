"""Owner-managed availability, independent of a table's selected game rules.

The registry is code-owned: administrators can release an implemented feature,
but cannot invent arbitrary capability names. Missing rows use explicit defaults
without writes on read, so an upgrade does not change the existing game beta.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError

from .database import database_schema_ready, session_scope
from .game_types import GAME_TYPES
from .models import (
    AccountOwnership,
    AccountProgressOrigin,
    FeatureFlag,
    FeatureFlagAudit,
    FeaturePolicyLock,
    GamePresentation,
    User,
)
from .ownership import require_owner
from .security import as_utc, utcnow


@dataclass(frozen=True)
class FeatureDefinition:
    key: str
    game: str
    label_de: str
    label_en: str
    description_de: str
    description_en: str
    default_status: str = "off"


FEATURES = (
    FeatureDefinition("hausdepp.four_of_a_kind_as_ten", "hausdepp", "Vier Gleiche aus der Hand", "Four matching cards from hand",
                      "Vier gleichzeitig gespielte gleiche Handkarten schlagen jeden Wert und räumen das Paket ab.",
                      "Four matching cards played together from hand beat any rank and clear the pile.", "internal"),
    FeatureDefinition("watten.schoeneres", "watten", "Schöneres", "Schöneres",
                      "Schöneres als Tischregel auswählen.", "Select Schöneres as a table rule.", "internal"),
    FeatureDefinition("watten.schlagwechsel", "watten", "Schlagwechsel", "Strike swap",
                      "Schlagwechsel als Tischregel auswählen.", "Select strike swap as a table rule.", "internal"),
    FeatureDefinition("watten.critical", "watten", "Kritische", "Critical cards",
                      "Mit kritischen Karten spielen.", "Play with critical cards.", "internal"),
    FeatureDefinition("watten.show_rechter", "watten", "Rechter-Anzeige", "Rechter indicator",
                      "Die Rechter-Anzeige am Tisch einschalten.", "Enable the Rechter indicator at the table.", "internal"),
    FeatureDefinition("watten.trick_history", "watten", "Stichverlauf", "Trick history",
                      "Den Stichverlauf am Tisch einschalten.", "Enable trick history at the table.", "internal"),
    FeatureDefinition("watten.open_partner_hand", "watten", "Partnerblatt offen", "Open partner hand",
                      "Das Partnerblatt am Tisch offen anzeigen.", "Show the partner's hand at the table.", "internal"),
)
FEATURE_REGISTRY = {feature.key: feature for feature in FEATURES}
STATUSES = frozenset({"off", "internal", "public"})
PRIVATE_HEADERS = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"}


def _error(status: int, detail: str) -> HTTPException:
    return HTTPException(status_code=status, detail=detail, headers=PRIVATE_HEADERS)


def _definition(key: str) -> FeatureDefinition:
    definition = FEATURE_REGISTRY.get(key)
    if definition is None:
        raise _error(404, "feature_not_found")
    return definition


def _stored(db, table, key_column, key: str):
    # Column mappings deliberately bypass the ORM identity map. A long-lived
    # table/session must see a release change made by another request.
    return db.execute(select(table).where(key_column == key)).mappings().one_or_none()


def feature_settings(db, key: str) -> dict:
    definition = _definition(key)
    stored = _stored(db, FeatureFlag.__table__, FeatureFlag.key, key)
    return {
        "key": key, "game": definition.game,
        "status": stored["status"] if stored else definition.default_status,
        "beta": bool(stored["beta"]) if stored else False,
        "version": stored["version"] if stored else 0,
        "updated_at": as_utc(stored["updated_at"]).isoformat() if stored else None,
        "label": {"de": definition.label_de, "en": definition.label_en},
        "description": {"de": definition.description_de, "en": definition.description_en},
    }


def feature_status(db, key: str) -> str:
    return feature_settings(db, key)["status"]


def game_settings(db, game: str) -> dict:
    if game not in GAME_TYPES:
        raise _error(404, "game_not_found")
    stored = _stored(db, GamePresentation.__table__, GamePresentation.game, game)
    return {"key": game, "beta": bool(stored["beta"]) if stored else game == "watten",
            "version": stored["version"] if stored else 0,
            "updated_at": as_utc(stored["updated_at"]).isoformat() if stored else None}


def game_beta(db, game: str) -> bool:
    return game_settings(db, game)["beta"]


def public_game_beta(game: str) -> bool:
    """Convenience for page rendering; this changes labels, never game access."""
    if game not in GAME_TYPES:
        raise _error(404, "game_not_found")
    if not database_schema_ready():
        return game == "watten"
    with session_scope() as db:
        return game_beta(db, game)


def lock_feature_policies(db, keys=None) -> None:
    """Acquire after account locks and before reading a start-time policy.

    The singleton also serializes policy reads when a known flag has no stored
    row yet. An owner change either commits before the start snapshot or waits
    until that snapshot has committed; it cannot slip between validation and
    the game's durable write. SQLite gets a write reservation, PostgreSQL a row
    lock. A missing migration guard fails closed.
    """
    if keys is not None:
        for key in keys:
            _definition(key)
    result = db.execute(update(FeaturePolicyLock).where(FeaturePolicyLock.id == 1).values(id=FeaturePolicyLock.id))
    if result.rowcount != 1:
        raise _error(503, "feature_settings_unavailable")


def _account_authority(db, account) -> tuple[int | None, bool]:
    user_id = account if type(account) is int else getattr(account, "user_id", None) or getattr(account, "id", None)
    if user_id is None:
        return None, False
    account_row = db.execute(select(User.id, User.role).where(
        User.id == user_id, User.is_active.is_(True),
        ~select(AccountProgressOrigin.origin_user_id).where(
            AccountProgressOrigin.origin_user_id == User.id).exists(),
    )).one_or_none()
    return (account_row.id, account_row.role == "admin") if account_row else (None, False)


def is_feature_staff(db, account) -> bool:
    return _account_authority(db, account)[1]


def account_can_activate_feature(db, account, key: str) -> bool:
    """A caller must separately require a player seat for table activation."""
    user_id, staff = _account_authority(db, account)
    status = feature_status(db, key)
    return bool(user_id is not None and (status == "public" or (status == "internal" and staff)))


def feature_catalog(db, user=None) -> dict:
    user_id, staff = _account_authority(db, user)
    capabilities = {}
    for definition in FEATURES:
        settings = feature_settings(db, definition.key)
        status = settings["status"]
        capabilities[definition.key] = {
            "status": status, "beta": settings["beta"],
            "can_select": bool(user_id is not None and (status == "public" or (status == "internal" and staff))),
        }
    return {"viewer_id": user_id, "features": capabilities,
            "games": {game: {"beta": game_beta(db, game)} for game in sorted(GAME_TYPES)}}


def admin_feature_catalog(db, actor_user_id: int) -> dict:
    # require_admin already authenticates; read again for the displayed write
    # capability rather than trusting the identity's previously loaded flags.
    viewer_id, staff = _account_authority(db, actor_user_id)
    if not staff:
        raise _error(403, "admin_required")
    audit = db.execute(select(FeatureFlagAudit.__table__).order_by(FeatureFlagAudit.id.desc()).limit(100)).mappings()
    return {
        "viewer_id": viewer_id,
        "can_manage": bool(db.scalar(select(AccountOwnership.user_id).where(
            AccountOwnership.user_id == actor_user_id)) is not None),
        "features": [feature_settings(db, definition.key) for definition in FEATURES],
        "games": [game_settings(db, game) for game in sorted(GAME_TYPES)],
        "audit": [{"id": row["id"], "target_type": row["target_type"], "key": row["target_key"],
                   "actor_user_id": row["actor_user_id"], "actor_username": row["actor_username"],
                   "created_at": as_utc(row["created_at"]).isoformat(),
                   "before": json.loads(row["before_json"]), "after": json.loads(row["after_json"])} for row in audit],
    }


def _write(db, model, key_column, key: str, values: dict, version: int, actor: User, before: dict) -> None:
    now = utcnow()
    changed = {**values, "version": version + 1, "updated_at": now, "updated_by_user_id": actor.id}
    if version == 0:
        # Competing first writes from different owners can race on PostgreSQL.
        # A savepoint keeps the outer audit/settings transaction usable on a
        # uniqueness failure and translates that failure to the same CAS error.
        try:
            with db.begin_nested():
                db.execute(insert(model).values(**{key_column.key: key}, **changed))
        except IntegrityError as exc:
            raise _error(409, "feature_settings_changed") from exc
    else:
        result = db.execute(update(model).where(key_column == key, model.version == version).values(**changed))
        if result.rowcount != 1:
            raise _error(409, "feature_settings_changed")
    target_type = "feature" if model is FeatureFlag else "game"
    previous = {field: before[field] for field in values}
    db.add(FeatureFlagAudit(target_type=target_type, target_key=key, actor_user_id=actor.id,
                            actor_username=actor.username, before_json=json.dumps(previous, sort_keys=True),
                            after_json=json.dumps(values, sort_keys=True), created_at=now))
    db.flush()


def _require_current_owner(db, actor_user_id: int) -> User:
    actor = require_owner(db, actor_user_id)
    # require_owner locks and refreshes the account. Also bypass a membership
    # instance the caller may have loaded before a different owner revoked it.
    if db.scalar(select(AccountOwnership.user_id).where(AccountOwnership.user_id == actor_user_id)) is None:
        raise _error(403, "owner_required")
    return actor


def set_feature_settings(db, *, actor_user_id: int, key: str, status: str, beta: bool, version: int) -> dict:
    actor = _require_current_owner(db, actor_user_id)
    lock_feature_policies(db, [key])
    before = feature_settings(db, key)
    if status not in STATUSES or (beta and status != "public"):
        raise _error(422, "feature_settings_invalid")
    if before["version"] != version:
        raise _error(409, "feature_settings_changed")
    values = {"status": status, "beta": beta}
    _write(db, FeatureFlag, FeatureFlag.key, key, values, version, actor, before)
    return feature_settings(db, key)


def set_game_beta(db, *, actor_user_id: int, game: str, beta: bool, version: int) -> dict:
    actor = _require_current_owner(db, actor_user_id)
    lock_feature_policies(db)
    before = game_settings(db, game)
    if before["version"] != version:
        raise _error(409, "feature_settings_changed")
    _write(db, GamePresentation, GamePresentation.game, game, {"beta": beta}, version, actor, before)
    return game_settings(db, game)
