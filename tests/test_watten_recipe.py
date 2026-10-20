"""Secret-free versioned Watten recipe: confirmed profiles, options and strict JSON."""

import json

import pytest

from app.watten_play import PlayProfile
from app.watten_recipe import (
    MAX_JSON_CHARS,
    RECIPE_SCHEMA_VERSION,
    WATTEN_RULESET_ID,
    WATTEN_RULESET_VERSION,
    WattenRecipe,
    WattenRecipeError,
    recipe_from_json,
    recipe_from_payload,
    recipe_to_json,
    recipe_to_payload,
)

SHAPES = ((2, "normal", False), (2, "ladinisch", False), (3, "normal", False),
          (4, "normal", False), (4, "ladinisch", False), (4, "ladinisch", True))
ALLOWED_KEYS = {
    "kind", "schema_version", "ruleset_id", "ruleset_version", "player_count", "determination", "blind",
    "critical", "target_points", "cpu_seats", "show_rechter", "trick_history", "partner_hand", "password_required",
    "voice_enabled", "schoeneres_enabled", "tournament_nockerl_target",
}


def code_of(action, *args, **kwargs):
    with pytest.raises(WattenRecipeError) as caught:
        action(*args, **kwargs)
    return caught.value.code


def payload(**changes):
    base = recipe_to_payload(WattenRecipe(4, "ladinisch", True, False, cpu_seats=(3,)))
    base.update(changes)
    return base


def test_defaults_are_the_conservative_confirmed_options():
    recipe = WattenRecipe(4, "ladinisch", True, False)
    assert (recipe.target_points, recipe.cpu_seats, recipe.show_rechter, recipe.trick_history,
            recipe.partner_hand, recipe.password_required, recipe.voice_enabled,
            recipe.schoeneres_enabled) == (11, (), False, False, False, False, True, False)
    assert (recipe.ruleset_id, recipe.ruleset_version) == (WATTEN_RULESET_ID, WATTEN_RULESET_VERSION)
    assert recipe.play_profile == PlayProfile(4, "ladinisch", True, False)


@pytest.mark.parametrize("shape", SHAPES)
@pytest.mark.parametrize("critical", (False, True))
def test_every_confirmed_profile_roundtrips_with_all_options(shape, critical):
    count, determination, blind = shape
    recipe = WattenRecipe(count, determination, blind, critical, target_points=15,
                          cpu_seats=tuple(range(count - 1, 0, -1)), show_rechter=True, trick_history=True,
                          partner_hand=not blind and count > 2, password_required=True, schoeneres_enabled=count != 3)
    assert recipe.cpu_seats == tuple(range(1, count))
    data = recipe_to_payload(recipe)
    assert set(data) == ALLOWED_KEYS and data["schema_version"] == RECIPE_SCHEMA_VERSION
    assert recipe_from_payload(data) == recipe
    text = recipe_to_json(recipe)
    assert recipe_from_json(text) == recipe and recipe_to_json(recipe_from_json(text)) == text
    assert json.loads(text) == data


@pytest.mark.parametrize("args, code", (
    ((2, "normal", True, False), "watten_blind_requires_four_player_ladinisch"),
    ((4, "normal", True, False), "watten_blind_requires_four_player_ladinisch"),
    ((3, "ladinisch", False, False), "watten_three_player_requires_normal"),
    ((5, "normal", False, False), "watten_invalid_profile"),
    ((True, "normal", False, False), "watten_invalid_profile"),
    ((4, "guter", False, False), "watten_invalid_profile"),
    ((4, "normal", False, 1), "watten_invalid_profile"),
))
def test_profiles_reuse_the_play_profile_rules(args, code):
    assert code_of(WattenRecipe, *args) == code


@pytest.mark.parametrize("target", (2, 0, -1, True, 11.0, "11", None))
def test_target_points_are_true_integers_of_at_least_three(target):
    assert WattenRecipe(2, "normal", False, False, target_points=3).target_points == 3
    assert code_of(WattenRecipe, 2, "normal", False, False, target_points=target) == "watten_invalid_target_points"


@pytest.mark.parametrize("seats", ((0, 0), (4,), (-1,), (True,), (1.0,), [1], "1"))
def test_cpu_seats_are_unique_valid_seat_indices(seats):
    assert code_of(WattenRecipe, 4, "ladinisch", True, False, cpu_seats=seats) == "watten_invalid_cpu_seats"


@pytest.mark.parametrize("count", (2, 3, 4))
def test_at_least_one_seat_stays_human(count):
    determination = "ladinisch" if count == 4 else "normal"
    assert code_of(WattenRecipe, count, determination, count == 4, False,
                   cpu_seats=tuple(range(count))) == "watten_cpu_seats_need_a_human"


@pytest.mark.parametrize("option", ("show_rechter", "trick_history", "partner_hand", "password_required", "voice_enabled", "schoeneres_enabled"))
def test_options_are_true_booleans(option):
    assert code_of(WattenRecipe, 4, "normal", False, False, **{option: 1}) == "watten_invalid_recipe_option"


def test_partner_hand_is_only_an_explicit_open_game_option_with_partners():
    assert WattenRecipe(4, "normal", False, False, partner_hand=True).partner_hand
    assert WattenRecipe(4, "ladinisch", False, True, partner_hand=True).partner_hand
    assert WattenRecipe(3, "normal", False, False, partner_hand=True).partner_hand
    assert code_of(WattenRecipe, 4, "ladinisch", True, False,
                   partner_hand=True) == "watten_partner_hand_requires_open_play"
    assert code_of(WattenRecipe, 2, "normal", False, False,
                   partner_hand=True) == "watten_partner_hand_requires_partners"


@pytest.mark.parametrize("ruleset", (("other", 1), (WATTEN_RULESET_ID, 2), (WATTEN_RULESET_ID, True), (None, 1)))
def test_unknown_rulesets_are_rejected(ruleset):
    ruleset_id, version = ruleset
    assert code_of(WattenRecipe, 4, "normal", False, False, ruleset_id=ruleset_id,
                   ruleset_version=version) == "watten_unknown_ruleset"


@pytest.mark.parametrize("secret", ("password", "verifier", "passphrase", "invitation", "reservation", "session",
                                    "hands", "call", "account_id", "participant_id", "guter"))
def test_secrets_identities_and_unknown_fields_never_enter_a_recipe(secret):
    assert code_of(recipe_from_payload, payload(**{secret: "x"})) == "watten_recipe_unknown_field"


@pytest.mark.parametrize("key", sorted(ALLOWED_KEYS - {"voice_enabled", "schoeneres_enabled", "tournament_nockerl_target"}))
def test_every_field_is_required(key):
    data = payload()
    del data[key]
    assert code_of(recipe_from_payload, data) == "watten_recipe_missing_field"


def test_legacy_recipes_default_new_preplay_option_off_and_solo_cannot_enable_it():
    data = payload()
    data.pop("voice_enabled")
    data.pop("schoeneres_enabled")
    data.pop("tournament_nockerl_target")
    restored = recipe_from_payload(data)
    assert restored.voice_enabled and not restored.schoeneres_enabled and restored.tournament_nockerl_target is None
    assert code_of(WattenRecipe, 3, "normal", False, False,
                   schoeneres_enabled=True) == "watten_schoeneres_requires_two_callers"


@pytest.mark.parametrize("target", (1, 3, 5, 8, 10, 15, 20, 37, 9_007_199_254_740_991))
@pytest.mark.parametrize("count", (2, 4))
def test_tournament_target_accepts_presets_and_free_positive_safe_integers(target, count):
    recipe = WattenRecipe(count, "normal", False, False, tournament_nockerl_target=target)
    assert recipe_from_payload(recipe_to_payload(recipe)) == recipe


@pytest.mark.parametrize("target", (0, -1, True, 3.5, "5", 9_007_199_254_740_992))
def test_tournament_target_rejects_non_positive_inexact_values(target):
    assert code_of(WattenRecipe, 4, "normal", False, False,
                   tournament_nockerl_target=target) == "watten_invalid_tournament_target"


def test_three_player_rotating_solo_does_not_offer_a_fixed_team_tournament():
    assert code_of(WattenRecipe, 3, "normal", False, False,
                   tournament_nockerl_target=5) == "watten_invalid_tournament_target"


@pytest.mark.parametrize("changes, code", (
    ({"kind": "watten_room"}, "watten_recipe_invalid_payload"),
    ({"schema_version": 2}, "watten_unknown_recipe_version"),
    ({"schema_version": True}, "watten_unknown_recipe_version"),
    ({"schema_version": 1.0}, "watten_unknown_recipe_version"),
    ({"player_count": True}, "watten_invalid_profile"),
    ({"blind": 1}, "watten_invalid_profile"),
    ({"target_points": True}, "watten_invalid_target_points"),
    ({"ruleset_version": True}, "watten_unknown_ruleset"),
    ({"cpu_seats": [True]}, "watten_invalid_cpu_seats"),
    ({"cpu_seats": (3,)}, "watten_invalid_cpu_seats"),
    ({"cpu_seats": "3"}, "watten_invalid_cpu_seats"),
    ({"show_rechter": 0}, "watten_invalid_recipe_option"),
))
def test_payloads_distinguish_integers_booleans_and_versions(changes, code):
    assert code_of(recipe_from_payload, payload(**changes)) == code


@pytest.mark.parametrize("value", ([], None, "recipe", 1))
def test_non_object_payloads_are_rejected(value):
    assert code_of(recipe_from_payload, value) == "watten_recipe_invalid_payload"


def test_strict_json_rejects_duplicates_constants_floats_and_unbounded_input():
    text = recipe_to_json(WattenRecipe(2, "normal", False, False))
    assert text.startswith('{"blind":false,')
    for broken in (text.replace('{"blind":false,', '{"blind":false,"blind":false,', 1),
                   text.replace('"target_points":11', '"target_points":NaN'),
                   text.replace('"target_points":11', '"target_points":Infinity'),
                   text[:-1], b"{}", None, " " * (MAX_JSON_CHARS + 1), "[" * 60_000):
        assert code_of(recipe_from_json, broken) == "watten_invalid_json"
    assert code_of(recipe_from_json, text.replace('"target_points":11', '"target_points":11.0')) == (
        "watten_invalid_target_points")
