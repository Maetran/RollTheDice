"""Real, migrated SQLite + engine + observer + owner export, without live accounts."""

import asyncio
import json
import random
from datetime import timedelta
from unittest.mock import AsyncMock

from sqlalchemy import func, select

from app.active_games import save_active_game
from app.database import session_scope
from app.hausdepp_engine import project_state
from app.hausdepp_gameplay import apply_hausdepp_command, publish_hausdepp_transition
from app.hausdepp_state import configure_hausdepp_game, join_hausdepp_player, new_hausdepp_game, start_hausdepp_game
from app.models import ObservationEvent, ObservationRecording

pytest_plugins = ("tests.test_observation",)


def _hausdepp_game(monkeypatch, *, register=True):
    # A reproducible complete round avoids an occasional indefinite low-card
    # cycle from the deliberately simple test policy.
    rng = random.Random(0)
    monkeypatch.setattr("app.hausdepp_engine.SystemRandom", lambda: rng)
    monkeypatch.setattr("app.hausdepp_state._DEALER_RANDOM", random.Random(1))
    monkeypatch.setattr("app.hausdepp_gameplay.broadcast", AsyncMock())
    monkeypatch.setattr("app.hausdepp_cpu_runner.maybe_schedule_cpu_turn", lambda *_args, **_kwargs: None)
    game = new_hausdepp_game("real-hausdepp-test", "Private table title", "2", register=register)
    configure_hausdepp_game(game, host_user_id=1, cpu_count=1)
    join_hausdepp_player(game, {"id": "human-id-sentinel", "name": "private-player-name",
                               "user_id": 1, "ws": object(), "resume_token": "private-token"})
    start_hausdepp_game(game)
    if register:
        assert save_active_game(game)
    return game


def _hausdepp_step(game):
    before = game["_hausdepp"]
    actor = before["current_player_id"]
    view = project_state(before, actor)
    if not view["available_actions"]:
        for person in before["players"]:
            trial = project_state(before, person["id"])
            if trial["available_actions"]:
                actor, view = person["id"], trial
                break
    kind = next(kind for kind in ("peek", "draw", "play", "pickup", "afterthrow")
                if kind in view["available_actions"])
    cards = [view["playable_cards"][0]] if kind in {"play", "afterthrow"} else None
    participant = next(item for item in game["_participants"] if item["id"] == actor)
    apply_hausdepp_command(game, actor, {"action": kind, "cards": cards, "version": before["version"]},
                           trusted_cpu=participant["is_cpu"])
    asyncio.run(publish_hausdepp_transition(game))


def _policy(client, version, enabled, selected=(1,)):
    result = client.put("/api/admin/observation", json={"enabled": enabled, "mode": "selected",
                                                       "selected_user_ids": list(selected), "version": version})
    assert result.status_code == 200, result.text
    return result.json()["version"]


def _expire_hausdepp(game):
    from app.game_state import GAME_TIMEOUT, check_timeout_and_abort
    from app.security import utcnow

    now = utcnow()
    game["_last_activity"] = now - GAME_TIMEOUT - timedelta(seconds=1)
    assert check_timeout_and_abort(game, now=now)


def test_real_hausdepp_recording_and_owner_export(client, monkeypatch):
    response = client.put("/api/admin/observation", json={
        "enabled": True, "mode": "selected", "selected_user_ids": [1], "version": 0,
    })
    assert response.status_code == 200, response.text
    game = _hausdepp_game(monkeypatch)
    moves = 0
    while not game["_finished"] and moves < 500:
        _hausdepp_step(game)
        moves += 1
    assert game["_finished"] and moves < 500
    listing = client.get("/api/admin/observation/recordings").json()["items"]
    assert len(listing) == 1 and listing[0]["game_type"] == "hausdepp"
    assert listing[0]["status"] == "partial" and listing[0]["finished_at"] is not None
    assert listing[0]["outcome"]["status"] == "finished"
    recording_id = listing[0]["id"]
    items = []
    after = -1
    while True:
        page = client.get(f"/api/admin/observation/recordings/{recording_id}/events?limit=200&after={after}").json()
        items.extend(page["items"])
        if page["next_after"] is None:
            break
        after = page["next_after"]
    assert len(items) == moves
    assert {item["actor_kind"] for item in items} == {"human", "cpu"}
    encoded = json.dumps({"listing": listing, "items": items})
    assert all(secret not in encoded for secret in ("human-id-sentinel", "private-player-name", "private-token", "real-hausdepp-test"))
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(ObservationEvent)) == moves
        assert db.get(ObservationRecording, recording_id).outcome_json is not None


def test_off_and_policy_windows_recover_and_close_only_on_real_timeout(client, monkeypatch):
    from app.models import ActiveGame

    game = _hausdepp_game(monkeypatch)
    _hausdepp_step(game)
    assert "_decision_observation" not in game
    version = _policy(client, 0, True)
    _hausdepp_step(game)
    first = game["_decision_observation"]["id"]
    assert client.get(f"/api/admin/observation/recordings/{first}/events").status_code == 404
    version = _policy(client, version, False)
    marker = dict(game["_decision_observation"])
    _hausdepp_step(game)
    assert game["_decision_observation"] == marker
    version = _policy(client, version, True)
    _hausdepp_step(game)
    second = game["_decision_observation"]["id"]
    assert second != first and game["_decision_observation"]["previous_ids"] == [first]
    version = _policy(client, version, True)
    _hausdepp_step(game)
    third = game["_decision_observation"]["id"]
    assert len({first, second, third}) == 3
    with session_scope() as db:
        persisted = json.loads(db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"])))
    assert persisted["_decision_observation"]["previous_ids"] == [first, second]
    assert client.get("/api/admin/observation/recordings").json()["items"] == []
    _expire_hausdepp(game)
    rows = client.get("/api/admin/observation/recordings").json()["items"]
    assert {row["id"] for row in rows} == {first, second, third}
    assert all(row["status"] == "partial" and row["finished_at"] for row in rows)
    assert next(row for row in rows if row["id"] == first)["outcome"] is None
    assert next(row for row in rows if row["id"] == third)["outcome"] == {"status": "aborted"}


def test_deleting_midgame_never_recreates_old_recording(client, monkeypatch):
    game = _hausdepp_game(monkeypatch)
    version = _policy(client, 0, True)
    _hausdepp_step(game)
    first = game["_decision_observation"]["id"]
    deleted = client.request("DELETE", "/api/admin/observation/recordings", json={"version": version})
    assert deleted.status_code == 200
    version = _policy(client, deleted.json()["version"], True)
    _hausdepp_step(game)
    second = game["_decision_observation"]["id"]
    assert first != second and first in game["_decision_observation"]["previous_ids"]
    _expire_hausdepp(game)
    assert [row["id"] for row in client.get("/api/admin/observation/recordings").json()["items"]] == [second]
    with session_scope() as db:
        assert db.get(ObservationRecording, first) is None


def test_rejected_unbound_checkpoint_never_writes_observation(client, monkeypatch):
    _policy(client, 0, True)
    game = _hausdepp_game(monkeypatch, register=False)
    _hausdepp_step(game)
    assert "_decision_observation_pending" not in game
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(ObservationEvent)) == 0


def test_checkpoint_database_failure_never_writes_observation_or_breaks_move(client, monkeypatch):
    from sqlalchemy.exc import OperationalError

    _policy(client, 0, True)
    game = _hausdepp_game(monkeypatch)
    before = game["_hausdepp"]
    actor = before["current_player_id"]
    participant = next(item for item in game["_participants"] if item["id"] == actor)
    apply_hausdepp_command(game, actor, {"action": "peek", "version": before["version"]},
                           trusted_cpu=participant["is_cpu"])
    assert game["_hausdepp"]["version"] > before["version"]
    assert game.get("_decision_observation_pending") is not None
    with monkeypatch.context() as patch:
        patch.setattr("app.active_games.session_scope", lambda: (_ for _ in ()).throw(
            OperationalError("database offline", {}, RuntimeError("offline"))))
        asyncio.run(publish_hausdepp_transition(game))
    assert "_decision_observation_pending" not in game
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(ObservationEvent)) == 0


def test_hausdepp_departure_records_withdrawal_and_nonstandard_outcome(client, monkeypatch):
    from app.hausdepp_departure import _propose_departure
    from app.hausdepp_departure_store import persist_hausdepp_departure
    from app.security import utcnow

    _policy(client, 0, True)
    game = _hausdepp_game(monkeypatch)
    _hausdepp_step(game)
    departed_at = utcnow()
    proposed, forfeited = _propose_departure(game, "human-id-sentinel", game["_hausdepp"]["version"], departed_at)
    assert forfeited and proposed["_finished"]
    assert persist_hausdepp_departure(proposed, user_id=1, player_id="human-id-sentinel", result_id=game["_id"],
                                     departed_at=departed_at, forfeited_round=True)["departure_persisted"]
    game.update(proposed)
    asyncio.run(publish_hausdepp_transition(game))
    listing = client.get("/api/admin/observation/recordings").json()["items"]
    assert len(listing) == 1 and listing[0]["outcome"]["round_end_reason"] == "insufficient_players"
    assert listing[0]["outcome"]["loser_seat"] is None
    assert len(listing[0]["outcome"]["withdrawn_seats"]) == 1
    assert listing[0]["outcome"]["remaining_seat"] is not None
    events = client.get(f'/api/admin/observation/recordings/{listing[0]["id"]}/events').json()["items"]
    assert events[-1]["action"]["kind"] == "withdraw"


def test_nonselected_human_has_only_public_actions_in_selected_game(client, monkeypatch):
    _policy(client, 0, True)
    monkeypatch.setattr("app.hausdepp_gameplay.broadcast", AsyncMock())
    monkeypatch.setattr("app.hausdepp_cpu_runner.maybe_schedule_cpu_turn", lambda *_args, **_kwargs: None)
    game = new_hausdepp_game("selected-boundary-test", "Mixed table", "3", register=True)
    configure_hausdepp_game(game, host_user_id=1, cpu_count=1)
    for index in (1, 2):
        join_hausdepp_player(game, {"id": f"human-{index}", "name": f"PrivateName{index}",
                                   "user_id": index, "ws": object(), "resume_token": f"token-{index}"})
    start_hausdepp_game(game)
    assert save_active_game(game)
    for _ in range(120):
        if game["_finished"]:
            break
        _hausdepp_step(game)
    if not game["_finished"]:
        _expire_hausdepp(game)
    recording_id = client.get("/api/admin/observation/recordings").json()["items"][0]["id"]
    items, after = [], -1
    while True:
        page = client.get(f"/api/admin/observation/recordings/{recording_id}/events?limit=200&after={after}").json()
        items.extend(page["items"])
        if page["next_after"] is None:
            break
        after = page["next_after"]
    selected = [event for event in items if event["actor_kind"] == "human" and event["actor_selected"]]
    other = [event for event in items if event["actor_kind"] == "human" and not event["actor_selected"]]
    cpu = [event for event in items if event["actor_kind"] == "cpu"]
    assert selected and other and cpu
    assert all("actor_hand" in event["context"] for event in selected + cpu)
    private = {"actor_hand", "private_peek", "private_peek_in_stock", "available_actions", "playable_cards",
               "playable_groups", "after", "inspection", "partner_hand", "feedback"}
    assert all(not (private & set(event["context"])) for event in other)
    assert "PrivateName" not in json.dumps(items) and "human-1" not in json.dumps(items)


def test_real_watten_recording_and_owner_export(client, monkeypatch):
    from app.decision_observation_runtime import emit_observation, finish_terminal_observations
    from app.watten_engine import EngineActor, announcement_roles
    from app.watten_play import legal_cards
    from app.watten_runtime import _apply_engine_command, apply_runtime_action, persist_watten_game
    from tests.test_watten_match_evidence import NativeMatch

    response = client.put("/api/admin/observation", json={
        "enabled": True, "mode": "selected", "selected_user_ids": [1], "version": 0,
    })
    assert response.status_code == 200, response.text
    monkeypatch.setattr("app.watten_round_runtime.review_deadlines", lambda _game: None)
    match = NativeMatch(cpus=(1,), target=11, game_id="watten-secret-runtime-id")
    persist_watten_game(match.game, creating=True)
    moves = 0
    while match.engine.phase != "match_complete" and moves < 300:
        state = match.engine
        if state.phase == "deal_complete":
            runtime = match.runtime
            candidate, _ack, replayed, _private = apply_runtime_action(match.game, 1, "p1", {
                "action": "watten_next_deal", "command_id": f"next-{moves}", "revision": runtime.room.revision,
                "lifecycle_revision": runtime.lifecycle_revision, "deal_id": state.deal_id,
                "opportunity": state.opportunity,
            })
            assert not replayed
            persist_watten_game(candidate)
            match.install(candidate)
            continue
        roles = announcement_roles(state)
        if state.phase == "strike":
            seat, kind, value = roles.strike_announcer, "announce_strike", "7"
        elif state.phase == "colour":
            seat, kind, value = roles.suit_announcer, "announce_colour", "bells"
        else:
            assert state.phase == "play"
            seat = state.recipe.seats.index(state.play.current_player_id)
            kind = "play_card"
            value = legal_cards(state.play, state.bid_state, state.play.current_player_id)[0]
        binding = state.recipe.bindings[seat]
        command = match.command(binding.player_id, kind, value)
        candidate, _ack, replayed, _private = _apply_engine_command(
            match.game, EngineActor(binding.player_id, binding.account_id), command)
        assert not replayed
        persist_watten_game(candidate)
        emit_observation(candidate.pop("_decision_observation_pending", None))
        finish_terminal_observations(candidate)
        match.install(candidate)
        moves += 1
    assert match.engine.phase == "match_complete" and moves < 300
    listing = client.get("/api/admin/observation/recordings").json()["items"]
    assert len(listing) == 1 and listing[0]["game_type"] == "watten"
    assert listing[0]["status"] == "partial" and listing[0]["finished_at"] is not None
    assert listing[0]["outcome"]["status"] == "finished"
    assert listing[0]["outcome"]["winner_parties"]
    recording_id = listing[0]["id"]
    items = client.get(f"/api/admin/observation/recordings/{recording_id}/events?limit=200").json()["items"]
    assert len(items) == moves
    assert {item["actor_kind"] for item in items} == {"human", "cpu"}
    assert "watten-secret-runtime-id" not in json.dumps({"listing": listing, "items": items})
    from app.models import ActiveGame

    with session_scope() as db:
        raw = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == match.game["_id"]))
    assert "_decision_observation" not in json.loads(raw)


def test_watten_disabled_window_closes_after_authoritative_inactivity_abort(client, monkeypatch):
    from app.decision_observation_runtime import emit_observation
    from app.game_state import GAME_TIMEOUT
    from app.models import ActiveGame
    from app.security import utcnow
    from app.watten_engine import EngineActor, announcement_roles
    from app.watten_runtime import _apply_engine_command, expire_inactive_game, persist_watten_game
    from tests.test_watten_match_evidence import NativeMatch

    version = _policy(client, 0, True)
    match = NativeMatch(cpus=(1,), target=3, game_id="watten-abort-test")
    persist_watten_game(match.game, creating=True)
    state = match.engine
    binding = state.recipe.bindings[announcement_roles(state).strike_announcer]
    command = match.command(binding.player_id, "announce_strike", "7")
    candidate, _ack, _replayed, _private = _apply_engine_command(
        match.game, EngineActor(binding.player_id, binding.account_id), command)
    persist_watten_game(candidate)
    emit_observation(candidate.pop("_decision_observation_pending"))
    match.install(candidate)
    recording_id = match.game["_decision_observation"]["id"]
    assert client.get(f"/api/admin/observation/recordings/{recording_id}/events").status_code == 404
    _policy(client, version, False)
    match.game["_last_activity"] = utcnow() - GAME_TIMEOUT - timedelta(seconds=1)
    persist_watten_game(match.game)
    assert expire_inactive_game(match.game)
    listing = client.get("/api/admin/observation/recordings").json()["items"]
    assert len(listing) == 1 and listing[0]["id"] == recording_id
    assert listing[0]["finished_at"] and listing[0]["status"] == "partial" and listing[0]["outcome"] is None
    assert client.get(f"/api/admin/observation/recordings/{recording_id}/events").status_code == 200
    with session_scope() as db:
        raw = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == match.game["_id"]))
    assert "_decision_observation" not in json.loads(raw)


def test_hausdepp_terminal_recovery_keeps_only_opaque_marker_until_backend_returns(client, monkeypatch):
    from app.active_games import load_active_games
    from app.models import ActiveGame

    _policy(client, 0, True)
    game = _hausdepp_game(monkeypatch)
    _hausdepp_step(game)
    marker = dict(game["_decision_observation"])
    game.update(_aborted=True, _finished=True, _started=False, _abort_reason="manual",
                _abandonment_accounted=True)
    # This is the exact gap after the terminal game commit and before the
    # separate observer commit; no final action or account IDs are persisted.
    game["_decision_observation_pending"] = {"context": {"private": "must-not-persist"}, "actor_user_id": 1}
    assert save_active_game(game)
    with session_scope() as db:
        raw = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"]))
    stored = json.loads(raw)
    assert stored["_decision_observation"] == marker
    assert "_decision_observation_pending" not in stored and "must-not-persist" not in raw
    recording_id = marker["id"]
    assert client.get(f"/api/admin/observation/recordings/{recording_id}/events").status_code == 404
    with monkeypatch.context() as patch:
        patch.setattr("app.observation.finish_observation", lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("observer unavailable")))
        load_active_games()
    with session_scope() as db:
        raw = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"]))
    assert json.loads(raw)["_decision_observation"] == marker
    assert client.get(f"/api/admin/observation/recordings/{recording_id}/events").status_code == 404
    load_active_games()
    assert client.get(f"/api/admin/observation/recordings/{recording_id}/events").status_code == 200
    with session_scope() as db:
        raw = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"]))
    assert raw is None or "_decision_observation" not in json.loads(raw)


def test_crash_after_last_hausdepp_checkpoint_closes_partial_without_storing_last_private_move(client, monkeypatch):
    from app.active_games import load_active_games
    from app.models import ActiveGame
    from tests.test_hausdepp_tournament import finish_round

    _policy(client, 0, True)
    game = _hausdepp_game(monkeypatch)
    _hausdepp_step(game)
    recording_id = game["_decision_observation"]["id"]
    with session_scope() as db:
        earlier = db.scalar(select(func.count()).select_from(ObservationEvent))
    # Use a conserved one-card endgame and a real accepted engine command,
    # then simulate a crash after the terminal checkpoint but before emit.
    finish_round(game, loser="cpu-1")
    assert game["_decision_observation_pending"] and game["_finished"]
    assert save_active_game(game)
    with session_scope() as db:
        raw = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"]))
    stored = json.loads(raw)
    assert stored["_decision_observation"]["id"] == recording_id
    assert "_decision_observation_pending" not in stored
    load_active_games()
    listing = client.get("/api/admin/observation/recordings").json()["items"]
    assert len(listing) == 1 and listing[0]["id"] == recording_id and listing[0]["status"] == "partial"
    events = client.get(f"/api/admin/observation/recordings/{recording_id}/events").json()["items"]
    assert len(events) == earlier  # final private move was not checkpointed


def test_watten_terminal_recovery_after_observer_failure(client, monkeypatch):
    from app.active_games import load_active_games
    from app.decision_observation_runtime import emit_observation
    from app.game_state import GAME_TIMEOUT
    from app.models import ActiveGame
    from app.security import utcnow
    from app.watten_engine import EngineActor, announcement_roles
    from app.watten_runtime import _apply_engine_command, expire_inactive_game, persist_watten_game
    from tests.test_watten_match_evidence import NativeMatch

    _policy(client, 0, True)
    match = NativeMatch(cpus=(1,), target=3, game_id="watten-recovery-test")
    persist_watten_game(match.game, creating=True)
    state = match.engine
    binding = state.recipe.bindings[announcement_roles(state).strike_announcer]
    command = match.command(binding.player_id, "announce_strike", "7")
    candidate, _ack, _replayed, _private = _apply_engine_command(
        match.game, EngineActor(binding.player_id, binding.account_id), command)
    persist_watten_game(candidate)
    emit_observation(candidate.pop("_decision_observation_pending"))
    match.install(candidate)
    marker = dict(match.game["_decision_observation"])
    match.game["_last_activity"] = utcnow() - GAME_TIMEOUT - timedelta(seconds=1)
    persist_watten_game(match.game)
    with monkeypatch.context() as patch:
        patch.setattr("app.observation.finish_observation", lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("observer unavailable")))
        assert expire_inactive_game(match.game)
        load_active_games()
    with session_scope() as db:
        raw = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == match.game["_id"]))
    stored = json.loads(raw)
    assert stored["_decision_observation"] == marker
    assert "_decision_observation_pending" not in stored
    assert client.get(f'/api/admin/observation/recordings/{marker["id"]}/events').status_code == 404
    load_active_games()
    assert client.get(f'/api/admin/observation/recordings/{marker["id"]}/events').status_code == 200
    with session_scope() as db:
        raw = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == match.game["_id"]))
    assert "_decision_observation" not in json.loads(raw)
