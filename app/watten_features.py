"""Live feature admission for new Watten matches; running rules stay frozen.

Authorization is deliberately outside recipes and engine evidence. A copied
favorite records settings, never authority. An internal selection records its
actual enabling account in the private checkpoint and that same active staff
account must occupy a human seat when the next match starts.
"""
from __future__ import annotations

import json
from dataclasses import replace

from sqlalchemy import select

from .account_progress import lock_account_rows, require_exact_active_account
from .database import database_schema_ready, session_scope
from .feature_flags import (
    account_can_activate_feature,
    feature_catalog,
    feature_settings,
    feature_status,
    lock_feature_policies,
)
from .models import ActiveGame
from .security import utcnow
from .watten_admissions import checkpoint_accounts
from .watten_engine import schlagwechsel_profile_supported

FEATURE_FIELDS = {
    "watten.schoeneres": "schoeneres_enabled",
    "watten.schlagwechsel": "schlagwechsel_enabled",
    "watten.critical": "critical",
    "watten.show_rechter": "show_rechter",
    "watten.trick_history": "trick_history",
    "watten.open_partner_hand": "partner_hand",
}


def selected_features(recipe):
    return frozenset(key for key, field in FEATURE_FIELDS.items() if getattr(recipe, field))


def validate_activators(value):
    if (type(value) is not tuple or any(type(item) is not tuple or len(item) != 2
            or type(item[0]) is not str or item[0] not in FEATURE_FIELDS or type(item[1]) is not int or item[1] < 1 for item in value)
            or len(dict(value)) != len(value)):
        raise ValueError("watten_invalid_feature_activators")


def validate_feature_presentation(value, recipe):
    if (type(value) is not tuple or any(type(item) is not tuple or len(item) != 2
            or type(item[0]) is not str or item[0] not in FEATURE_FIELDS or type(item[1]) is not bool for item in value)
            or len(dict(value)) != len(value)
            or not set(dict(value)) <= selected_features(recipe)):
        raise ValueError("watten_invalid_feature_presentation")


def creation_activators(recipe, account):
    return tuple((key, account) for key in sorted(selected_features(recipe)))


def feature_recipe_supported(recipe, feature):
    try:
        replace(recipe, **{FEATURE_FIELDS[feature]: True})
    except ValueError:
        return False
    return feature != "watten.schlagwechsel" or schlagwechsel_profile_supported(recipe.play_profile)


def change_feature(runtime, *, account, feature, enabled):
    """Waiting controls are account-bound, including a non-host staff player."""
    if runtime.engine is not None or runtime.room.status != "waiting":
        raise ValueError("watten_feature_waiting_required")
    if type(feature) is not str or feature not in FEATURE_FIELDS or type(enabled) is not bool:
        raise ValueError("watten_invalid_feature")
    member = next((item for item in runtime.room.members if item.account_id == account), None)
    host = member is not None and member.participant_id == runtime.room.host_participant_id
    with session_scope() as db:
        permitted = account_can_activate_feature(db, account, feature)
        status = feature_status(db, feature)
        if enabled:
            if not permitted:
                raise ValueError("watten_feature_disabled" if status == "off" else "watten_feature_staff_required")
            if member is None or member.seat is None:
                raise ValueError("watten_feature_staff_must_be_seated")
            if not feature_recipe_supported(runtime.room.recipe, feature):
                raise ValueError("watten_feature_incompatible")
            if status == "public" and not host:
                # Public table settings remain a host control. Staff may help
                # configure any table they actually participate in.
                from .feature_flags import is_feature_staff
                if not is_feature_staff(db, account):
                    raise ValueError("watten_host_required")
        elif not host:
            from .feature_flags import is_feature_staff
            if member is None or member.seat is None or not is_feature_staff(db, account):
                raise ValueError("watten_host_required")
    recipe = replace(runtime.room.recipe, **{FEATURE_FIELDS[feature]: enabled})
    activators = dict(runtime.feature_activators)
    if enabled:
        activators[feature] = account
    else:
        activators.pop(feature, None)
    return replace(runtime.room, recipe=recipe, revision=runtime.room.revision + 1), tuple(sorted(activators.items()))


def feature_controls(room, account, *, presentation=()):
    """Recipient-specific waiting controls, absent from hot/public snapshots."""
    if room.status != "waiting":
        # Frozen public labels carry no current selection authority. Every
        # participant and spectator sees the same active-match Beta markers.
        return {key: {"enabled": True, "can_select": False, "can_enable": False,
                      "status": "public", "beta": beta} for key, beta in presentation}
    member = next((item for item in room.members if item.account_id == account), None)
    if member is None:
        return {}
    if database_schema_ready():
        with session_scope() as db:
            from .feature_flags import is_feature_staff
            catalog = feature_catalog(db, account)["features"]
            staff = is_feature_staff(db, account) if account is not None else False
    else:
        # Pure historical projections and startup before migrations cannot
        # acquire new activation authority. Their frozen engine still renders.
        catalog = {key: {"status": "internal", "beta": False, "can_select": False}
                   for key in FEATURE_FIELDS}
        staff = False
    seated = member.seat is not None
    host = member.participant_id == room.host_participant_id
    result = {}
    for key, field in FEATURE_FIELDS.items():
        setting = catalog[key]
        enabled = getattr(room.recipe, field)
        authorized = bool(room.status == "waiting" and seated and setting["can_select"] and (host or staff))
        can_enable = authorized and feature_recipe_supported(room.recipe, key)
        can_remove = bool(room.status == "waiting" and enabled and (host or seated and staff))
        result[key] = {"enabled": enabled, "can_select": authorized or can_remove,
                       "can_enable": can_enable, "status": setting["status"], "beta": setting["beta"]}
    return result


def _change_intent(runtime, intent):
    if (type(intent) is not tuple or len(intent) != 3 or type(intent[0]) is not int
            or type(intent[1]) is not str or intent[1] not in FEATURE_FIELDS or type(intent[2]) is not bool):
        raise ValueError("watten_invalid_feature")
    account, feature, enabled = intent
    member = next((item for item in runtime.room.members if item.account_id == account), None)
    if member is None or getattr(runtime.room.recipe, FEATURE_FIELDS[feature]) != enabled:
        raise ValueError("watten_actor_not_bound")
    return member, feature, enabled


def _validate_change_authority(db, runtime, intent):
    from .feature_flags import is_feature_staff

    member, feature, enabled = _change_intent(runtime, intent)
    host = member.participant_id == runtime.room.host_participant_id
    staff = is_feature_staff(db, member.account_id)
    if enabled:
        if not feature_recipe_supported(runtime.room.recipe, feature):
            raise ValueError("watten_feature_incompatible")
        status = feature_status(db, feature)
        if not account_can_activate_feature(db, member.account_id, feature):
            raise ValueError("watten_feature_disabled" if status == "off" else "watten_feature_staff_required")
        if member.seat is None:
            raise ValueError("watten_feature_staff_must_be_seated")
        if status == "public" and not host and not staff:
            raise ValueError("watten_host_required")
    elif not host and (not staff or member.seat is None):
        raise ValueError("watten_host_required")


def validate_checkpoint_features(db, checkpoint, *, creating=False):
    """Enforce policy in the checkpoint transaction, sharing account merge locks.

    Existing games lock their stored source before the ascending account rows
    and policy guard. Live policy changes and START cannot pass one another
    between the final authorization read and commit. No subsequent command,
    reconnect, result write or historical recovery changes a started recipe.
    """
    from .watten_runtime import restore_watten_json

    runtime = checkpoint["_watten"]
    previous = None
    if not creating:
        raw = db.scalar(select(ActiveGame.state_json).where(
            ActiveGame.game_id == checkpoint["_id"]).with_for_update())
        if raw is None:
            raise ValueError("watten_checkpoint_missing")
        # Running snapshots are immutable and already authorized. Avoid
        # replaying CPU-memory validation on every subsequent card command.
        if json.loads(raw)["_watten"]["engine"] is not None:
            return
        previous = restore_watten_json(raw, refresh_titles=False)["_watten"]
    starting = runtime.engine is not None
    selected = selected_features(runtime.room.recipe)
    changed = selected if previous is None or starting else frozenset(
        key for key in selected if key not in selected_features(previous.room.recipe)
        or dict(runtime.feature_activators).get(key) != dict(previous.feature_activators).get(key))
    intent = checkpoint.get("_watten_feature_action")
    if previous is not None and not starting:
        edited = {key for key, field in FEATURE_FIELDS.items()
                  if getattr(runtime.room.recipe, field) != getattr(previous.room.recipe, field)
                  or dict(runtime.feature_activators).get(key) != dict(previous.feature_activators).get(key)}
        if edited and intent is None:
            raise ValueError("watten_feature_activation_required")
        if intent is not None:
            _member, feature, _enabled = _change_intent(runtime, intent)
            if edited - {feature}:
                raise ValueError("watten_invalid_feature")
    if not changed and intent is None:
        return
    accounts = {member.account_id for member in runtime.room.members}
    # The later membership writer also locks reservations and fixed-series
    # originals. Prelock its complete set, so it never waits on a new User row
    # while holding the policy guard against an owner User -> policy write.
    lock_account_rows(db, checkpoint_accounts(runtime.room, now=utcnow()))
    if intent is not None:
        member, feature, _enabled = _change_intent(runtime, intent)
        require_exact_active_account(db, member.account_id)
        changed = changed | {feature}
    lock_feature_policies(db, changed)
    if intent is not None:
        _validate_change_authority(db, runtime, intent)
    # A removal still needs fresh actor authority, but an off option being
    # removed must not be rejected as though it were newly activated.
    changed = changed & selected
    activators = dict(runtime.feature_activators)
    presentation = []
    for feature in sorted(changed):
        if (previous is not None or runtime.engine is None) and not feature_recipe_supported(runtime.room.recipe, feature):
            raise ValueError("watten_feature_incompatible")
        settings = feature_settings(db, feature)
        status = settings["status"]
        if status == "off":
            raise ValueError("watten_feature_disabled")
        if status == "public":
            if settings["beta"]:
                presentation.append((feature, True))
            continue
        account = activators.get(feature)
        if account is None:
            raise ValueError("watten_feature_activation_required")
        if account not in accounts or not account_can_activate_feature(db, account, feature):
            raise ValueError("watten_feature_staff_required")
        # The creator may prepare internal settings before taking their seat;
        # every actual activation at an existing table and match start needs it.
        if (starting or previous is not None) and not any(
                member.account_id == account and member.seat is not None for member in runtime.room.members):
            raise ValueError("watten_feature_staff_must_be_seated")

    if starting:
        checkpoint["_watten"] = replace(runtime, feature_presentation=tuple(presentation))
