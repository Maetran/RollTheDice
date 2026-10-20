"""Versioned, secret-free Watten table recipe for favorites and rematches.

A recipe is a strict allowlist of table settings: the confirmed play profile,
the ruleset, target points, concrete CPU seat wishes and whole-table options.
It never holds a password or verifier, invitation, reservation, session,
account or participant ID, hand or call; ``password_required`` only records
that the table is protected. Payload and JSON transitions reject unknown
fields, unknown versions, duplicate JSON keys and booleans posing as integers.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Final

from .watten_play import PlayProfile, WattenPlayError
from .watten_tournament import valid_target

RECIPE_SCHEMA_VERSION: Final = 1
WATTEN_RULESET_ID: Final = "watten-house"
# Version 1 is the owner decision record of 18 October 2026.
WATTEN_RULESET_VERSION: Final = 1
DEFAULT_TARGET_POINTS: Final = 11
MIN_TARGET_POINTS: Final = 3
MAX_JSON_CHARS: Final = 65_536
_RECIPE_KIND: Final = "watten_recipe"
_KNOWN_RULESETS: Final = frozenset({(WATTEN_RULESET_ID, WATTEN_RULESET_VERSION)})
_RECIPE_KEYS: Final = frozenset({
    "kind", "schema_version", "ruleset_id", "ruleset_version", "player_count", "determination", "blind",
    "critical", "target_points", "cpu_seats", "show_rechter", "trick_history", "partner_hand",
    "password_required", "voice_enabled", "schoeneres_enabled", "tournament_nockerl_target",
})


class WattenRecipeError(ValueError):
    """A stable validation reason; nothing is stored or partially applied."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True, slots=True)
class WattenRecipe:
    """Complete table settings, valid for any account and any new room.

    CPU seats are logical seat indices, normalized ascending; at least one
    seat stays human. ``show_rechter`` and ``trick_history`` default off.
    ``partner_hand`` is an explicit open-game option and needs a partner, so
    it is unavailable in blind and two-player games. Guter/Schlechter are
    not representable.
    """

    player_count: int
    determination: str
    blind: bool
    critical: bool
    target_points: int = DEFAULT_TARGET_POINTS
    cpu_seats: tuple[int, ...] = ()
    show_rechter: bool = False
    trick_history: bool = False
    partner_hand: bool = False
    password_required: bool = False
    voice_enabled: bool = True
    schoeneres_enabled: bool = False
    tournament_nockerl_target: int | None = None
    ruleset_id: str = WATTEN_RULESET_ID
    ruleset_version: int = WATTEN_RULESET_VERSION

    def __post_init__(self) -> None:
        try:
            PlayProfile(self.player_count, self.determination, self.blind, self.critical)
        except WattenPlayError as exc:
            raise WattenRecipeError(exc.code) from exc
        if (type(self.ruleset_id) is not str or type(self.ruleset_version) is not int
                or (self.ruleset_id, self.ruleset_version) not in _KNOWN_RULESETS):
            raise WattenRecipeError("watten_unknown_ruleset")
        if type(self.target_points) is not int or self.target_points < MIN_TARGET_POINTS:
            raise WattenRecipeError("watten_invalid_target_points")
        if any(type(option) is not bool for option in (
                self.show_rechter, self.trick_history, self.partner_hand, self.password_required, self.voice_enabled,
                self.schoeneres_enabled)):
            raise WattenRecipeError("watten_invalid_recipe_option")
        if self.schoeneres_enabled and self.player_count == 3:
            raise WattenRecipeError("watten_schoeneres_requires_two_callers")
        if not valid_target(self.tournament_nockerl_target) or self.tournament_nockerl_target is not None and self.player_count == 3:
            raise WattenRecipeError("watten_invalid_tournament_target")
        if (type(self.cpu_seats) is not tuple
                or any(type(seat) is not int or not 0 <= seat < self.player_count for seat in self.cpu_seats)
                or len(set(self.cpu_seats)) != len(self.cpu_seats)):
            raise WattenRecipeError("watten_invalid_cpu_seats")
        if len(self.cpu_seats) >= self.player_count:
            raise WattenRecipeError("watten_cpu_seats_need_a_human")
        if self.partner_hand and self.blind:
            raise WattenRecipeError("watten_partner_hand_requires_open_play")
        if self.partner_hand and self.player_count == 2:
            raise WattenRecipeError("watten_partner_hand_requires_partners")
        object.__setattr__(self, "cpu_seats", tuple(sorted(self.cpu_seats)))

    @property
    def play_profile(self) -> PlayProfile:
        return PlayProfile(self.player_count, self.determination, self.blind, self.critical)


def recipe_to_payload(recipe: WattenRecipe) -> dict:
    """Explicit allowlist payload; not a client projection of a live room."""
    if not isinstance(recipe, WattenRecipe):
        raise WattenRecipeError("watten_invalid_recipe")
    return {
        "kind": _RECIPE_KIND,
        "schema_version": RECIPE_SCHEMA_VERSION,
        "ruleset_id": recipe.ruleset_id,
        "ruleset_version": recipe.ruleset_version,
        "player_count": recipe.player_count,
        "determination": recipe.determination,
        "blind": recipe.blind,
        "critical": recipe.critical,
        "target_points": recipe.target_points,
        "cpu_seats": list(recipe.cpu_seats),
        "show_rechter": recipe.show_rechter,
        "trick_history": recipe.trick_history,
        "partner_hand": recipe.partner_hand,
        "password_required": recipe.password_required,
        "voice_enabled": recipe.voice_enabled,
        "schoeneres_enabled": recipe.schoeneres_enabled,
        "tournament_nockerl_target": recipe.tournament_nockerl_target,
    }


def require_fields(payload: object, keys: frozenset[str], error: type[ValueError], prefix: str) -> dict:
    """Return a payload dict with exactly ``keys``; unknown and missing fields fail."""
    if type(payload) is not dict:
        raise error(f"{prefix}_invalid_payload")
    if set(payload) - keys:
        raise error(f"{prefix}_unknown_field")
    if keys - set(payload):
        raise error(f"{prefix}_missing_field")
    return payload


def recipe_from_payload(payload: object) -> WattenRecipe:
    # Recipes saved before the voice option existed retain its default. Every
    # subsequent projection and save emits the complete normalized recipe.
    if type(payload) is dict and "voice_enabled" not in payload:
        payload = {**payload, "voice_enabled": True}
    if type(payload) is dict and "schoeneres_enabled" not in payload:
        payload = {**payload, "schoeneres_enabled": False}
    if type(payload) is dict and "tournament_nockerl_target" not in payload:
        payload = {**payload, "tournament_nockerl_target": None}
    fields = require_fields(payload, _RECIPE_KEYS, WattenRecipeError, "watten_recipe")
    if fields["kind"] != _RECIPE_KIND:
        raise WattenRecipeError("watten_recipe_invalid_payload")
    if type(fields["schema_version"]) is not int or fields["schema_version"] != RECIPE_SCHEMA_VERSION:
        raise WattenRecipeError("watten_unknown_recipe_version")
    if type(fields["cpu_seats"]) is not list:
        raise WattenRecipeError("watten_invalid_cpu_seats")
    return WattenRecipe(
        player_count=fields["player_count"],
        determination=fields["determination"],
        blind=fields["blind"],
        critical=fields["critical"],
        target_points=fields["target_points"],
        cpu_seats=tuple(fields["cpu_seats"]),
        show_rechter=fields["show_rechter"],
        trick_history=fields["trick_history"],
        partner_hand=fields["partner_hand"],
        password_required=fields["password_required"],
        voice_enabled=fields["voice_enabled"],
        schoeneres_enabled=fields["schoeneres_enabled"],
        tournament_nockerl_target=fields["tournament_nockerl_target"],
        ruleset_id=fields["ruleset_id"],
        ruleset_version=fields["ruleset_version"],
    )


def dumps_canonical_json(payload: dict) -> str:
    """Deterministic compact JSON for an already validated payload."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result: dict = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _reject_constant(name: str) -> object:
    raise ValueError(f"non-finite JSON number {name}")


def loads_strict_json(text: object) -> object:
    """Parse bounded JSON without duplicate keys, NaN or infinities."""
    if type(text) is not str or len(text) > MAX_JSON_CHARS:
        raise WattenRecipeError("watten_invalid_json")
    try:
        return json.loads(text, object_pairs_hook=_unique_object, parse_constant=_reject_constant)
    except (ValueError, RecursionError) as exc:
        raise WattenRecipeError("watten_invalid_json") from exc


def recipe_to_json(recipe: WattenRecipe) -> str:
    return dumps_canonical_json(recipe_to_payload(recipe))


def recipe_from_json(text: object) -> WattenRecipe:
    return recipe_from_payload(loads_strict_json(text))
