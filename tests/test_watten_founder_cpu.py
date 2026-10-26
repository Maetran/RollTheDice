"""Founder background authority and source-bound commits; no browser or benchmark."""

import asyncio
from dataclasses import replace
from unittest.mock import Mock

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app import watten_cpu_runtime as runner
from app import watten_runtime as runtime
from app.active_games import load_active_games
from app.database import session_scope
from app.game_state import games
from app.models import (
    ActiveGame,
    CompletedGame,
    FeatureFlag,
    User,
    WattenAchievementGrant,
    WattenMatchCredit,
    WattenMatchEvidence,
)
from app.ownership import bind_founder
from app.product_hosts import DEFAULT_SITE_ORIGIN
from app.security import utcnow
from app.watten_engine import EngineActor, EngineCommand
from app.watten_room import SeatReservation
from app.watten_views import cpu_view
from tests import test_watten_cpu_runtime as prior
from tests import test_watten_runtime as native
from tests.test_user_accounts import request_for
from tests.test_watten_match_evidence import NativeMatch

server = native.server
ready = prior.ready


def production(monkeypatch):
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", DEFAULT_SITE_ORIGIN)
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", "0")
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW", "1")


def owner_game(server, monkeypatch, *, count=2, blind=False, mixed=False):
    prior.deterministic_dealer(monkeypatch)
    native.account("NotTheFounder")  # No account-1 shortcut may authorize this table.
    cpus = (count - 1,) if mixed else tuple(range(1, count))
    game_id, owners, sessions = native.local_started(server, count_players=count, blind=blind, cpus=cpus)
    founder = owners[0]
    assert founder[0].user_id == 2 and not founder[0].is_founder
    with session_scope() as db:
        db.execute(update(User).where(User.id == founder[0].user_id).values(role="admin"))
        bind_founder(db, founder[0].user_id)
    production(monkeypatch)
    for owner, session in zip(owners, sessions):
        session.websocket.request = request_for(host="zockdiewandan.online", origin=DEFAULT_SITE_ORIGIN, cookie=owner[1])
    return games[game_id], founder, sessions


def stored(game):
    with session_scope() as db:
        return db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"]))


def result_counts():
    with session_scope() as db:
        return tuple(db.scalar(select(func.count()).select_from(model))
                     for model in (CompletedGame, WattenMatchEvidence, WattenMatchCredit, WattenAchievementGrant))


async def run_once(game):
    runner.watch_game(game)
    await prior.until(lambda: not any(key[0] == game["_id"] for key in runner._JOBS))


@pytest.mark.parametrize("count,blind", ((2, False), (3, False), (4, True)))
def test_real_nonfirst_founder_and_explicit_cpus_can_progress_without_a_manufactured_human_connection(server, ready, monkeypatch, count, blind):
    game, founder, sessions = owner_game(server, monkeypatch, count=count, blind=blind)
    games.update(load_active_games())
    game = games[game["_id"]]
    assert all(item["ws"] is None for item in game["_players"])
    before, captured = game["_watten"].engine, []
    actual = runner.decide

    def checked(view, memory, **options):
        assert view == cpu_view(game["_watten"].engine, player_id=memory.player_id)
        assert not {"call", "stock", "account_id", "_watten"} & view.keys()
        captured.append(memory.player_id)
        return actual(view, memory, **options)

    monkeypatch.setattr(runner, "decide", checked)

    async def scenario():
        try:
            await runner.resume_cpu_games(games)
            await prior.until(lambda: game["_watten"].engine != before)
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())
    assert captured and len(game["_watten"].room.members) == 1
    assert game["_watten"].room.members[0].account_id == founder[0].user_id
    assert runtime.restore_watten_json(stored(game))["_watten"] == game["_watten"]
    assert all(item.account_id is None for item in game["_watten"].engine.recipe.bindings[1:])
    assert not sessions[0].websocket.closes


@pytest.mark.parametrize("count,determination,blind,critical", tuple(
    (count, determination, blind, critical)
    for count, determination, blind in ((2, "normal", False), (2, "ladinisch", False), (3, "normal", False),
                                        (4, "normal", False), (4, "ladinisch", False), (4, "ladinisch", True))
    for critical in (False, True)))
def test_all_twelve_local_profiles_keep_unprivileged_human_cpu_execution(server, ready, monkeypatch,
                                                                       count, determination, blind, critical):
    prior.deterministic_dealer(monkeypatch)  # CPU seat 1 has the first normal announcement.
    human, _cookie = native.account("LocalHumanWithoutOwnership")
    assert not human.is_admin and not human.is_owner
    if critical:
        # This CPU profile matrix exercises a released critical-card ruleset
        # with an ordinary human; it must not manufacture internal authority.
        with session_scope() as db:
            db.add(FeatureFlag(key="watten.critical", status="public", beta=False, version=1, updated_at=utcnow()))
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW", "0")
    match = NativeMatch(count, determination=determination, blind=blind, cpus=tuple(range(1, count)),
                        start=False, game_id="0123456789abcdef")
    state = match.runtime
    match.game["_watten"] = replace(state, room=replace(state.room, recipe=replace(state.room.recipe, critical=critical)))
    match.room("watten_start")
    runtime.persist_watten_game(match.game, creating=True)
    game, before = match.game, match.engine
    games[game["_id"]] = game

    async def scenario():
        try:
            runner.watch_game(game)
            await prior.until(lambda: game["_watten"].engine != before)
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())
    assert runtime.restore_watten_json(stored(game))["_watten"] == game["_watten"]


@pytest.mark.parametrize("denial", ("default_off", "wrong_origin"))
def test_deployment_denial_cancels_background_jobs_before_policy_or_mutation(server, ready, monkeypatch, denial):
    game, _founder, _sessions = owner_game(server, monkeypatch)
    before, raw = game["_watten"], stored(game)
    if denial == "default_off":
        monkeypatch.delenv("ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW")
    else:
        monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", "https://untrusted.invalid")
    monkeypatch.setattr(runner, "decide", lambda *_args, **_options: pytest.fail("denied deployment ran policy"))

    async def scenario():
        try:
            await runner.resume_cpu_games(games)
            assert not runner._JOBS
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())
    assert stored(game) == raw and game["_watten"] == before


def test_flag_revoked_after_scheduling_is_rechecked_before_the_deadline_runs_policy(server, ready, monkeypatch):
    game, _founder, _sessions = owner_game(server, monkeypatch)
    raw, before = stored(game), game["_watten"]
    monkeypatch.setattr(runner, "decide", lambda *_args, **_options: pytest.fail("revoked pending timer ran policy"))

    async def scenario():
        try:
            runner.watch_game(game)
            assert runner._JOBS
            monkeypatch.setenv("ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW", "0")
            await prior.until(lambda: not runner._JOBS)
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())
    assert stored(game) == raw and game["_watten"] == before


def test_readiness_projection_is_pure_but_does_not_grant_background_authority(server, ready, monkeypatch):
    game, _founder, _sessions = owner_game(server, monkeypatch)
    monkeypatch.setattr(runner, "session_scope", lambda: pytest.fail("DTO performed a background DB read"))
    monkeypatch.setattr(runner, "watten_founder_account_id", lambda *_args, **_kwargs: pytest.fail("DTO queried founder"))
    assert runner.cpu_autoplay_enabled()
    assert runtime.snapshot_watten(game)["capabilities"]["cpu_autoplay"]


def test_startup_retains_mixed_human_checkpoint_but_never_schedules_it_for_founder_production(server, ready, monkeypatch):
    game, _founder, _sessions = owner_game(server, monkeypatch, count=3, mixed=True)
    raw = stored(game)
    games.clear()
    games.update(load_active_games())
    restored = games[game["_id"]]
    monkeypatch.setattr(runner, "decide", lambda *_args, **_options: pytest.fail("mixed room ran a CPU"))

    async def scenario():
        try:
            await runner.resume_cpu_games(games)
            assert not runner._JOBS
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())
    assert len(restored["_watten"].room.members) == 2 and stored(game) == raw


def test_foreign_reservation_is_not_an_owner_room_grant(server, monkeypatch):
    founder = native.account("WaitingFounder", role="admin")
    foreign = native.account("ReservedForeignHuman")
    game = games[native.create_game(server, founder, count=3, cpus=(2,))]
    with session_scope() as db:
        bind_founder(db, founder[0].user_id)
    state = game["_watten"]
    reservation = SeatReservation(foreign[0].user_id, 1, state.room.wait_expires_at)
    game["_watten"] = replace(state, room=replace(state.room, reservations=(reservation,)))
    runtime.persist_watten_game(game)
    production(monkeypatch)
    assert reservation.expires_at > utcnow()
    assert runner._authority(game) is None


def test_real_flag_revocation_inside_decide_aborts_before_memory_outbox_checkpoint_or_broadcast(server, ready, monkeypatch):
    game, _founder, sessions = owner_game(server, monkeypatch)
    before, raw, results = game["_watten"], stored(game), result_counts()
    actual = runner.decide

    def revoked(view, memory, **options):
        result = actual(view, memory, **options)
        monkeypatch.setenv("ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW", "0")
        return result

    monkeypatch.setattr(runner, "decide", revoked)

    async def scenario():
        try:
            await run_once(game)
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())
    assert game["_watten"] == before and stored(game) == raw and result_counts() == results
    assert not sessions[0].websocket.messages


@pytest.mark.parametrize("fault", ("authority_missing", "db_read_failure"))
def test_injected_commit_authority_loss_rolls_back_and_does_not_spin(server, ready, monkeypatch, fault):
    game, _founder, sessions = owner_game(server, monkeypatch)
    before, raw, failed = game["_watten"], stored(game), []
    actual_decide, actual_founder = runner.decide, runner.watten_founder_account_id

    def decision(view, memory, **options):
        value = actual_decide(view, memory, **options)
        failed.append(True)
        return value

    def authority(db, *, lock=False):
        actual = actual_founder(db, lock=lock)
        if failed:
            if fault == "db_read_failure":
                raise SQLAlchemyError("isolated authority read failure")
            return None  # Explicit fault injection; immutable founder is not actually revoked.
        return actual

    monkeypatch.setattr(runner, "decide", decision)
    monkeypatch.setattr(runner, "watten_founder_account_id", authority)

    async def scenario():
        try:
            await run_once(game)
            assert not runner._JOBS
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())
    assert failed == [True] and game["_watten"] == before and stored(game) == raw
    assert not sessions[0].websocket.messages


def test_actual_founder_deactivation_attempt_during_decide_is_rejected_by_immutable_database_protection(server, ready, monkeypatch):
    game, founder, _sessions = owner_game(server, monkeypatch)
    before, rejected = game["_watten"].engine, []
    actual = runner.decide

    def checked(view, memory, **options):
        value = actual(view, memory, **options)
        with pytest.raises(IntegrityError, match="owner_protected"), session_scope() as db:
            db.execute(update(User).where(User.id == founder[0].user_id).values(is_active=False))
        rejected.append(True)
        return value

    monkeypatch.setattr(runner, "decide", checked)

    async def scenario():
        try:
            runner.watch_game(game)
            await prior.until(lambda: game["_watten"].engine != before)
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())
    assert rejected
    with session_scope() as db:
        assert db.get(User, founder[0].user_id).is_active


@pytest.mark.parametrize("when", ("before_schedule", "inside_decide"))
def test_newer_durable_cpu_transition_is_never_overwritten_or_installed_from_stale_ram(server, ready, monkeypatch, when):
    game, _founder, sessions = owner_game(server, monkeypatch)
    before, raw, advanced_raw = game["_watten"], stored(game), []
    actual = runner.decide

    def advance(proposal):
        source = runtime.restore_watten_json(stored(game))
        candidate, *_ = runtime._apply_engine_command(source, EngineActor(proposal.player_id, None),
                                                       EngineCommand(**proposal.command_fields()))
        runtime.persist_watten_game(candidate)
        advanced_raw.append(stored(game))

    if when == "before_schedule":
        cpu = before.room.cpus[0].participant_id
        view = cpu_view(before.engine, player_id=cpu)
        memory = next(item for item in before.cpu_memories if item.player_id == cpu)
        proposal = actual(view, memory, seed=1, events=runner._events(before, cpu), budget=runner.CpuBudget()).decision
        advance(proposal)
        monkeypatch.setattr(runner, "decide", lambda *_args, **_options: pytest.fail("stale source reached policy"))
    else:
        def changed(view, memory, **options):
            value = actual(view, memory, **options)
            advance(value.decision)  # A separate real checkpoint transaction wins during decision.
            return value

        monkeypatch.setattr(runner, "decide", changed)

    async def scenario():
        try:
            await run_once(game)
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())
    assert advanced_raw and advanced_raw[0] != raw and stored(game) == advanced_raw[0]
    assert game["_watten"] == before and not sessions[0].websocket.messages


@pytest.mark.parametrize("failure", ("guard_reject", "false_cas"))
def test_source_bound_persist_guard_precedes_result_writers_and_false_cas_aborts_all_accounting(server, monkeypatch, failure):
    native.account("TerminalHuman")
    match = NativeMatch(2, cpus=(1,), target=3)
    match.ready()
    runtime.persist_watten_game(match.game, creating=True)
    original, before = stored(match.game), result_counts()
    match.finish()
    prior_state = match.game["_watten"]

    def guard(_db, _checkpoint):
        if failure == "guard_reject":
            raise ValueError("isolated authority rejection")

    if failure == "guard_reject":
        monkeypatch.setattr("app.watten_results.store_result_in_session", Mock(side_effect=AssertionError("guard ran after result writer")))
    else:
        monkeypatch.setattr(runtime, "_write_checkpoint", lambda *_args, **_options: False)
    with pytest.raises(ValueError, match="authority rejection|stale_checkpoint"):
        runtime.persist_watten_game(match.game, expected_source=original, commit_guard=guard)
    assert stored(match.game) == original and result_counts() == before
    assert match.game["_watten"] == prior_state and not match.game["_completion_persisted"]
    assert match.game["_watten_result"] is None
