"""Real checkpoint authorization for mixed Watten tables and live release flags."""

import json
from dataclasses import replace
from datetime import timedelta
from itertools import count

import pytest
from sqlalchemy import select

from app import watten_admissions, watten_features
from app.database import session_scope
from app.game_state import games
from app.models import ActiveGame, FeatureFlag, User
from app.security import utcnow
from app.watten_engine import (
    EngineRecipe,
    SeatBinding,
    preplay_available,
    restore_storage,
    start_match,
    storage_payload,
)
from app.watten_features import FEATURE_FIELDS
from app.watten_play import PlayProfile
from app.watten_recipe import WattenRecipe, recipe_from_payload, recipe_to_payload
from app.watten_rematch import create_follow_up
from app.watten_room import SeatReservation
from app.watten_runtime import (
    admit_account,
    apply_runtime_action,
    configure_watten_game,
    cryptographic_deal,
    new_watten_game,
    persist_watten_game,
    restore_watten_json,
    serialize_watten_game,
    snapshot_watten,
)
from app.watten_tournament import NockerlSeries
from tests.test_watten_match_evidence import NativeMatch
from tests.test_watten_runtime import LOCAL, account, engine_command
from tests.test_watten_runtime import server as server

_IDS = count()


def _policy(key, status):
    with session_scope() as db:
        row = db.get(FeatureFlag, key)
        if row is None:
            db.add(FeatureFlag(key=key, status=status, beta=False, version=1, updated_at=utcnow()))
        else:
            row.status, row.beta, row.version = status, False, row.version + 1


def _game(host, *, recipe=None):
    identity = host[0]
    game = new_watten_game(f"features-{next(_IDS)}", "Policy table", "2" if recipe is None else str(recipe.player_count))
    configure_watten_game(game, recipe or WattenRecipe(2, "normal", False, False), identity, None)
    persist_watten_game(game, creating=True)
    games[game["_id"]] = game
    return game


def _apply(game, actor, action, **values):
    identity = actor[0]
    member = next(item for item in game["_watten"].room.members if item.account_id == identity.user_id)
    runtime = game["_watten"]
    data = {"action": action, "command_id": f"policy-{next(_IDS)}", "revision": runtime.room.revision,
            "lifecycle_revision": runtime.lifecycle_revision, **values}
    candidate, _ack, _replayed, _private = apply_runtime_action(game, identity.user_id, member.participant_id, data)
    persist_watten_game(candidate)
    game.clear()
    game.update(candidate)
    return game


def _seat(game, actor, seat):
    identity = actor[0]
    if not any(item.account_id == identity.user_id for item in game["_watten"].room.members):
        candidate, _player = admit_account(game, identity, game["_watten"].room.revision, None)
        persist_watten_game(candidate)
        game.clear()
        game.update(candidate)
    if next(item for item in game["_watten"].room.members if item.account_id == identity.user_id).seat == seat:
        return game
    return _apply(game, actor, "watten_take_seat", seat=seat, team=seat % 2 if game["_expected"] == 4 else None)


@pytest.mark.parametrize("feature", FEATURE_FIELDS)
def test_normal_creator_cannot_activate_internal_recipe_or_favorite(server, feature):
    user = account(f"creator-{next(_IDS)}")
    count_players = 4 if feature == "watten.open_partner_hand" else 2
    recipe = replace(WattenRecipe(count_players, "normal", False, False), **{FEATURE_FIELDS[feature]: True})
    identity, cookie = user
    response = server.post("/api/games", headers={"Cookie": cookie, "Origin": LOCAL, "X-CSRF-Token": identity.csrf_token},
        json={"name": "Forged favorite", "game_type": "watten", "mode": str(count_players),
              "watten_recipe": recipe_to_payload(recipe)})
    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "watten_feature_staff_required"
    with session_scope() as db:
        assert db.scalar(select(ActiveGame.game_id)) is None


@pytest.mark.parametrize("feature", FEATURE_FIELDS)
def test_disabled_feature_rejects_even_staff_creation(server, feature):
    staff = account(f"staff-{next(_IDS)}", "admin")
    _policy(feature, "off")
    count_players = 4 if feature == "watten.open_partner_hand" else 2
    recipe = replace(WattenRecipe(count_players, "normal", False, False), **{FEATURE_FIELDS[feature]: True})
    with pytest.raises(ValueError, match="watten_feature_disabled"):
        _game(staff, recipe=recipe)


def test_seated_nonhost_admin_enables_internal_for_normal_host_and_all_players(server):
    host, staff = account("normal-host"), account("seated-admin", "admin")
    game = _game(host)
    _seat(game, host, 0)
    _seat(game, staff, 1)
    assert not snapshot_watten(game, "p1")["room"]["feature_controls"]["watten.schoeneres"]["can_select"]
    assert snapshot_watten(game, "p2")["room"]["feature_controls"]["watten.schoeneres"]["can_select"]
    _apply(game, staff, "watten_set_feature", feature="watten.schoeneres", enabled=True)
    _apply(game, staff, "watten_set_feature", feature="watten.schlagwechsel", enabled=True)
    _apply(game, host, "watten_start")
    assert game["_watten"].engine.recipe.schoeneres_enabled
    assert game["_watten"].engine.recipe.schlagwechsel_enabled
    # Both human callers may use the already authorized table rule. This is
    # game use, so normal players do not need staff privileges themselves.
    for player in ("p1", "p2"):
        assert "request_schoeneres" in snapshot_watten(game, player)["engine"]["actions"]
    with session_scope() as db:
        stored = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"]))
    assert "_watten_feature_action" not in game and "_watten_feature_action" not in stored
    restored = restore_watten_json(stored)
    assert restored["_watten"].feature_activators == game["_watten"].feature_activators


def test_staff_spectator_or_unseated_member_cannot_activate(server):
    host, staff = account("host-seats"), account("unseated-admin", "admin")
    game = _game(host)
    _seat(game, host, 0)
    candidate, _player = admit_account(game, staff[0], game["_watten"].room.revision, None)
    persist_watten_game(candidate)
    game.clear()
    game.update(candidate)
    assert not snapshot_watten(game, viewer_account_id=staff[0].user_id)["room"]["feature_controls"]["watten.critical"]["can_select"]
    with pytest.raises(ValueError, match="watten_feature_staff_must_be_seated"):
        _apply(game, staff, "watten_set_feature", feature="watten.critical", enabled=True)


def test_start_rechecks_enabling_staff_role_and_host_can_remove_blocked_feature(server):
    host, staff = account("host-recheck"), account("admin-recheck", "admin")
    game = _game(host)
    _seat(game, host, 0)
    _seat(game, staff, 1)
    _apply(game, staff, "watten_set_feature", feature="watten.critical", enabled=True)
    with session_scope() as db:
        db.get(User, staff[0].user_id).role = "user"
    with pytest.raises(ValueError, match="watten_feature_staff_required"):
        _apply(game, host, "watten_start")
    assert game["_watten"].engine is None
    control = snapshot_watten(game, "p1")["room"]["feature_controls"]["watten.critical"]
    assert control["can_select"] and not control["can_enable"]
    _apply(game, host, "watten_set_feature", feature="watten.critical", enabled=False)
    _apply(game, host, "watten_start")
    assert not game["_watten"].engine.recipe.profile.critical


def test_live_disable_blocks_new_start_but_preserves_running_match_and_reconnect(server):
    host, guest = account("public-host"), account("public-guest")
    _policy("watten.critical", "public")
    recipe = WattenRecipe(2, "normal", False, True)
    game = _game(host, recipe=recipe)
    _seat(game, host, 0)
    _seat(game, guest, 1)
    _policy("watten.critical", "off")
    with pytest.raises(ValueError, match="watten_feature_disabled"):
        _apply(game, host, "watten_start")
    _policy("watten.critical", "public")
    _apply(game, host, "watten_start")
    frozen = game["_watten"].engine.recipe
    _policy("watten.critical", "off")
    restored = restore_watten_json(json.dumps(serialize_watten_game(game)))
    assert restored["_watten"].engine.recipe == frozen
    # A subsequent authorized card-game command can still checkpoint the
    # immutable rules after the global feature is disabled.
    engine = game["_watten"].engine
    player = engine.recipe.seats[(engine.dealer_seat + 1) % 2]
    identity = host[0] if player == "p1" else guest[0]
    candidate, _ack, _replayed, _private = apply_runtime_action(game, identity.user_id, player,
        engine_command(game["_id"], "announce_strike", next(_IDS), "7"))
    persist_watten_game(candidate)
    assert candidate["_watten"].engine.recipe == frozen


def test_stolen_internal_activation_needs_the_same_staff_member_seated_at_start(server):
    staff, host = account("creator-admin", "admin"), account("new-host")
    game = _game(staff, recipe=WattenRecipe(2, "normal", False, False, schoeneres_enabled=True))
    _seat(game, host, 0)
    # The creation intent is private and tied to the creator; merely retaining
    # their unseated room membership cannot authorize a normal player's match.
    _apply(game, staff, "watten_place_cpu", seat=1)
    with pytest.raises(ValueError, match="watten_feature_staff_must_be_seated"):
        _apply(game, staff, "watten_start")


def test_schlagwechsel_flag_controls_engine_actions_and_legacy_snapshots_keep_rule():
    recipe = EngineRecipe(PlayProfile(2, "normal", False, False),
        (SeatBinding("p1", 1), SeatBinding("p2", 2)), schlagwechsel_enabled=False)
    cards = cryptographic_deal(2, 0)
    engine = start_match(recipe, "flagged-deal", cards, first_dealer="p1")
    assert not preplay_available(engine, "schlagwechsel")
    raw = storage_payload(engine)
    assert not restore_storage(raw).recipe.schlagwechsel_enabled
    raw["recipe"].pop("schlagwechsel_enabled")
    assert restore_storage(raw).recipe.schlagwechsel_enabled
    legacy = recipe_to_payload(WattenRecipe(2, "normal", False, False))
    legacy.pop("schlagwechsel_enabled")
    assert recipe_from_payload(legacy).schlagwechsel_enabled


@pytest.mark.parametrize("feature", FEATURE_FIELDS)
def test_each_internal_feature_requires_staff_for_waiting_selection_and_start(server, feature):
    host, staff = account(f"host-option-{next(_IDS)}"), account(f"staff-option-{next(_IDS)}", "admin")
    game = _game(host, recipe=WattenRecipe(4, "normal", False, False, cpu_seats=(2, 3)))
    _seat(game, host, 0)
    _seat(game, staff, 1)
    with pytest.raises(ValueError, match="watten_feature_staff_required"):
        _apply(game, host, "watten_set_feature", feature=feature, enabled=True)
    _apply(game, staff, "watten_set_feature", feature=feature, enabled=True)
    _apply(game, host, "watten_start")
    assert getattr(game["_watten"].room.recipe, FEATURE_FIELDS[feature])
    assert dict(game["_watten"].feature_activators)[feature] == staff[0].user_id


def test_rematch_rechecks_copied_internal_authority_without_rewriting_source(server):
    host, staff = account("rematch-feature-host"), account("rematch-feature-admin", "admin")
    match = NativeMatch(target=3, schoeneres=True, game_id=f"rematch-feature-{next(_IDS)}")
    match.ready()
    match.finish()
    match.game["_watten"] = replace(match.runtime, feature_activators=(("watten.schoeneres", staff[0].user_id),))
    persist_watten_game(match.game, creating=True)
    games[match.game["_id"]] = match.game
    before_recipe = match.runtime.room.recipe
    result = create_follow_up(match.game["_id"], host[0], {"command_id": "feature-follow-up",
        "revision": match.runtime.room.revision, "protection": {"mode": "disabled"}})
    game = result.target
    games[game["_id"]] = game
    assert game["_watten"].room.recipe == before_recipe
    assert result.source["_watten"].engine.recipe == match.runtime.engine.recipe
    with session_scope() as db:
        db.get(User, staff[0].user_id).role = "user"
    _seat(game, staff, 1)
    with pytest.raises(ValueError, match="watten_feature_staff_required"):
        _apply(game, host, "watten_start")
    assert game["_watten"].engine is None
    # The normal host can remove the inherited option and continue.
    _apply(game, host, "watten_set_feature", feature="watten.schoeneres", enabled=False)
    _apply(game, host, "watten_start")
    assert not game["_watten"].engine.recipe.schoeneres_enabled


@pytest.mark.parametrize("binding", ["reservation", "continuation"])
def test_feature_guard_prelocks_lower_id_reserved_and_continuation_accounts(server, monkeypatch, binding):
    reserved, host = account("reserved-lower-id", "admin"), account("host-higher-id", "admin")
    lower, higher = reserved[0].user_id, host[0].user_id
    assert lower < higher
    game = _game(host)
    _seat(game, host, 0)
    runtime = game["_watten"]
    expiry = utcnow() + timedelta(minutes=5) if binding == "reservation" else utcnow() - timedelta(minutes=5)
    series = None if binding == "reservation" else NockerlSeries(
        "previous-series", (f"h:{higher}", f"h:{lower}"), (1, 0), completed_games=1,
        last_game_id="previous-match", continuation_locked=True)
    room = replace(runtime.room, reservations=(SeatReservation(lower, 1, expiry),), series=series)
    game["_watten"] = replace(runtime, room=room)
    persist_watten_game(game)
    real_accounts = watten_features.lock_account_rows
    real_policy = watten_features.lock_feature_policies
    held, events = set(), []
    guarded = False

    def lock_accounts(db, accounts):
        ordered = tuple(sorted(accounts))
        # Reacquiring an already held row is harmless. Acquiring a new User
        # after the policy guard can deadlock an owner's User -> policy write.
        assert not guarded or set(ordered) <= held
        result = real_accounts(db, ordered)
        held.update(ordered)
        events.append(("accounts", ordered))
        return result

    def lock_policy(db, keys=None):
        nonlocal guarded
        assert held == {lower, higher}
        events.append(("policy",))
        guarded = True
        return real_policy(db, keys)

    monkeypatch.setattr(watten_features, "lock_account_rows", lock_accounts)
    monkeypatch.setattr(watten_admissions, "lock_account_rows", lock_accounts)
    monkeypatch.setattr(watten_features, "lock_feature_policies", lock_policy)
    _apply(game, host, "watten_set_feature", feature="watten.critical", enabled=True)
    assert events[:2] == [("accounts", (lower, higher)), ("policy",)]
    assert game["_watten"].room.recipe.critical


@pytest.mark.parametrize("revoked", ["role", "active"])
def test_nonhost_staff_removal_rechecks_role_at_commit_and_leaves_checkpoint_unchanged(server, revoked):
    host, staff = account("remove-host"), account("remove-admin", "admin")
    game = _game(host)
    _seat(game, host, 0)
    _seat(game, staff, 1)
    _apply(game, staff, "watten_set_feature", feature="watten.critical", enabled=True)
    runtime = game["_watten"]
    command = {"action": "watten_set_feature", "command_id": "remove-before-demotion", "feature": "watten.critical",
               "enabled": False, "revision": runtime.room.revision, "lifecycle_revision": runtime.lifecycle_revision}
    candidate, *_ = apply_runtime_action(game, staff[0].user_id, "p2", command)
    with session_scope() as db:
        stored = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"]))
        setattr(db.get(User, staff[0].user_id), "role" if revoked == "role" else "is_active",
                "user" if revoked == "role" else False)
    reason = "watten_host_required" if revoked == "role" else "account_retired_or_inactive"
    with pytest.raises(ValueError, match=reason):
        persist_watten_game(candidate)
    with session_scope() as db:
        assert db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"])) == stored
    assert game["_watten"].room.recipe.critical


@pytest.mark.parametrize("count_players,determination,blind,feature", [
    (2, "normal", False, "watten.open_partner_hand"),
    (3, "normal", False, "watten.schoeneres"),
    (3, "normal", False, "watten.schlagwechsel"),
    (4, "ladinisch", True, "watten.open_partner_hand"),
    (4, "ladinisch", False, "watten.schlagwechsel"),
])
def test_authorized_waiting_controls_disable_incompatible_recipe_options(server, count_players, determination, blind, feature):
    staff = account("profile-control-admin", "admin")
    recipe = WattenRecipe(count_players, determination, blind, False, cpu_seats=tuple(range(1, count_players)))
    game = _game(staff, recipe=recipe)
    _seat(game, staff, 0)
    controls = snapshot_watten(game, "p1")["room"]["feature_controls"]
    assert controls[feature]["can_select"] and not controls[feature]["can_enable"]
    assert controls["watten.critical"]["can_enable"]
    with pytest.raises(ValueError, match="watten_feature_incompatible"):
        _apply(game, staff, "watten_set_feature", feature=feature, enabled=True)


@pytest.mark.parametrize("determination,blind", [("normal", False), ("ladinisch", False), ("ladinisch", True)])
def test_new_creation_rejects_inert_schlagwechsel_options(server, determination, blind):
    count_players = 3 if determination == "normal" else 4
    staff = account("incompatible-creator-admin", "admin")
    recipe = WattenRecipe(count_players, determination, blind, False, schlagwechsel_enabled=True)
    with pytest.raises(ValueError, match="watten_feature_incompatible"):
        _game(staff, recipe=recipe)


def test_normal_rematch_host_can_start_after_reserved_enabling_admin_joins(server):
    host, staff = account("positive-rematch-host"), account("positive-rematch-admin", "admin")
    match = NativeMatch(target=3, schoeneres=True, game_id=f"positive-rematch-{next(_IDS)}")
    match.ready()
    match.finish()
    match.game["_watten"] = replace(match.runtime, feature_activators=(("watten.schoeneres", staff[0].user_id),))
    persist_watten_game(match.game, creating=True)
    games[match.game["_id"]] = match.game
    result = create_follow_up(match.game["_id"], host[0], {"command_id": "positive-follow-up",
        "revision": match.runtime.room.revision, "protection": {"mode": "disabled"}})
    game = result.target
    games[game["_id"]] = game
    assert {member.account_id for member in game["_watten"].room.members} == {host[0].user_id}
    assert {reservation.account_id for reservation in game["_watten"].room.reservations} == {staff[0].user_id}
    # Reservations participate in lock order, but only the admitted, seated
    # enabling administrator grants the next match its internal authority.
    _seat(game, staff, 1)
    _apply(game, host, "watten_start")
    assert game["_watten"].engine.recipe.schoeneres_enabled
    assert not host[0].is_admin
    assert dict(game["_watten"].feature_activators)["watten.schoeneres"] == staff[0].user_id
