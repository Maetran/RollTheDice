"""Fresh feature admission for Hausdepp; an already-started table keeps its rules.

A saved favourite records a choice, never permission. The actual creator is
private durable authorization evidence, and must still be active and seated
when an internal table starts. Callers own the checkpoint transaction and lock
all other account rows before entering the shared feature-policy guard.
"""

from __future__ import annotations

from fastapi import HTTPException

from .account_progress import ProgressIdentityError, require_exact_active_account
from .feature_flags import account_can_activate_feature, feature_status, lock_feature_policies

FEATURE_KEY = "hausdepp.four_of_a_kind_as_ten"
RULE_FIELD = "_hausdepp_four_of_a_kind_as_ten"
CREATOR_FIELD = "_hausdepp_feature_creator_user_id"


class HausdeppFeatureError(ValueError):
    """A denied rule selection; the candidate must never be installed."""


def enabled(game: dict) -> bool:
    value = game.get(RULE_FIELD, False)
    if type(value) is not bool:
        raise HausdeppFeatureError("hausdepp_invalid_rule_option")
    return value


def creator_ids(game: dict) -> set[int]:
    """Accounts to prelock alongside an admission's other ascending User rows."""
    value = game.get(CREATOR_FIELD)
    return {value} if enabled(game) and type(value) is int and value > 0 else set()


def validate_checkpoint_features(db, game: dict, previous: dict | None = None, *, creating: bool = False) -> None:
    selected = enabled(game)
    engine = game.get("_hausdepp")
    old_engine = previous.get("_hausdepp") if previous else None
    if old_engine is not None:
        # A tournament's later rounds belong to this same frozen table. Live
        # policy/role changes apply to its next fresh table, not its next card.
        if (selected != enabled(previous) or engine is None
                or engine.get("four_of_a_kind_as_ten", False) != old_engine.get("four_of_a_kind_as_ten", False)):
            raise HausdeppFeatureError("hausdepp_rule_frozen")
        return
    if engine is not None and engine.get("four_of_a_kind_as_ten", False) is not selected:
        raise HausdeppFeatureError("hausdepp_invalid_rule_option")
    if not selected:
        return
    changed = (previous is None or not enabled(previous)
               or previous.get(CREATOR_FIELD) != game.get(CREATOR_FIELD))
    if not (creating or changed or engine is not None):
        return
    creator = game.get(CREATOR_FIELD)
    if type(creator) is not int or creator < 1 or (creating and creator != game.get("_hausdepp_host_user_id")):
        raise HausdeppFeatureError("hausdepp_feature_creator_required")
    try:
        require_exact_active_account(db, creator)
    except ProgressIdentityError as exc:
        raise HausdeppFeatureError("hausdepp_feature_creator_inactive") from exc
    try:
        lock_feature_policies(db, [FEATURE_KEY])
    except HTTPException as exc:
        raise HausdeppFeatureError("hausdepp_feature_settings_unavailable") from exc
    if feature_status(db, FEATURE_KEY) == "off":
        raise HausdeppFeatureError("hausdepp_feature_disabled")
    if not account_can_activate_feature(db, creator, FEATURE_KEY):
        raise HausdeppFeatureError("hausdepp_feature_staff_required")
    if engine is not None:
        seats = {person.get("id") for person in game.get("_participants", [])
                 if not person.get("is_cpu") and person.get("type") != "cpu" and person.get("user_id") == creator}
        if not any(person.get("id") in seats and person.get("user_id") == creator for person in game.get("_players", [])):
            raise HausdeppFeatureError("hausdepp_feature_creator_not_seated")
