"""Small native runner/storage/privacy regressions, no browser or benchmark."""

import asyncio
import json
from contextlib import contextmanager
from copy import deepcopy
from itertools import count
from threading import Event, Lock, get_ident
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from app import watten_cpu as cpu_policy
from app import watten_cpu_runtime as runner
from app import watten_runtime as runtime_module
from app.active_games import load_active_games, serializable_game_state
from app.database import session_scope
from app.game_state import games
from app.game_ws_session import GameSocketSession
from app.models import ActiveGame, CompletedGame, GameParticipant, User, UserBan
from app.security import utcnow
from app.watten_bidding import retourschneider_candidate
from app.watten_cpu import CpuBudget
from app.watten_cpu_memory import memory_to_storage
from app.watten_engine import EngineActor, EngineCommand
from app.watten_play import legal_cards
from app.watten_runtime import (
    _apply_engine_command,
    apply_runtime_action,
    persist_watten_game,
    restore_watten_json,
    snapshot_watten,
)
from app.watten_views import cpu_view
from app.watten_websocket import _handle_locked
from tests import test_watten_runtime as runtime_tests
from tests.test_watten_runtime import (  # noqa: F401
    CapturingSocket,
    account,
    create_game,
    engine_command,
    local_started,
    next_move,
    room_command,
)

server = runtime_tests.server


def test_public_cpu_authority_uses_all_active_humans_and_honors_bans_and_rollbacks(server, monkeypatch):
    game_id, owners, _sessions = local_started(server, count_players=4, cpus=(2, 3))
    game = games[game_id]
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", "https://zockdiewandan.online")
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", "0")
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW", "0")
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_PUBLIC_BETA", "1")
    authority = runner._authority(game)
    assert authority is not None and authority.public and authority.founder_id is None
    with session_scope() as db:
        runner._commit_guard(authority)(db, game)
        db.get(User, owners[1][0].user_id).is_active = False
    assert runner._authority(game) is None
    with session_scope() as db:
        with pytest.raises(ValueError, match="watten_cpu_access_required"):
            runner._commit_guard(authority)(db, game)
        db.get(User, owners[1][0].user_id).is_active = True
        db.add(UserBan(user_id=owners[1][0].user_id, scope="play", reason="isolated test", created_at=utcnow()))
    assert runner._authority(game) is None
    with session_scope() as db:
        with pytest.raises(ValueError, match="watten_cpu_access_required"):
            runner._commit_guard(authority)(db, game)
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_PUBLIC_BETA", "0")
    assert not runner.cpu_autoplay_enabled()
    with session_scope() as db, pytest.raises(ValueError, match="watten_cpu_access_required"):
        runner._commit_guard(authority)(db, game)


@pytest.fixture
def ready(monkeypatch):
    monkeypatch.setattr(runner, "CPU_POLICY_READY", True)
    # Unrelated runner tests do not negotiate the optional random mini-game.
    # Dedicated Blödeln cases below exercise real/pinned request and answer coins.
    monkeypatch.setattr(cpu_policy, "_bloedeln_coin", lambda *_args: False)
    monkeypatch.setattr(runner, "THINK_MIN_SECONDS", 0.01)
    monkeypatch.setattr(runner, "THINK_MAX_SECONDS", 0.01)
    monkeypatch.setattr(runner, "TRICK_REVEAL_SECONDS", 0.0)
    monkeypatch.setattr(runner, "CpuBudget", lambda _samples=1: CpuBudget(samples=1))


def deterministic_dealer(monkeypatch, seat=0):
    monkeypatch.setattr(runtime_module, "_RANDOM", SimpleNamespace(randrange=lambda _count: seat, shuffle=lambda _deck: None))


def accepted_engine(game, player, command):
    binding = next(item for item in game["_watten"].engine.recipe.bindings if item.player_id == player)
    fields = {key: command[key] for key in ("command_id", "deal_id", "opportunity", "phase", "kind", "value", "private_opportunity")}
    candidate, *_ = _apply_engine_command(game, EngineActor(player, binding.account_id), EngineCommand(**fields))
    persist_watten_game(candidate)
    game.update(candidate)


def complete_call(game_id):
    for number in range(8):
        state = games[game_id]["_watten"].engine
        if state.phase == "play" and state.preplay_request is None:
            return
        player, command = next_move(game_id, count(number))
        accepted_engine(games[game_id], player, command)
    raise AssertionError("No play")


async def until(predicate, *, seconds=3):
    end = asyncio.get_running_loop().time() + seconds
    while not predicate():
        assert asyncio.get_running_loop().time() < end, "CPU deadline did not complete"
        await asyncio.sleep(0.002)


def test_blocked_policy_leaves_event_loop_responsive_and_cancelled_job_never_commits(server, ready, monkeypatch):
    deterministic_dealer(monkeypatch)
    game_id, _owners, _sessions = local_started(server, count_players=2, cpus=(1,))
    game = games[game_id]
    before = serializable_game_state(game)
    entered, release, finished = Event(), Event(), Event()
    main_thread = get_ident()
    actual = runner.decide

    def blocking(view, memory, **values):
        assert get_ident() != main_thread
        assert "_watten" not in view and not hasattr(memory, "engine")
        entered.set()
        try:
            assert release.wait(5), "test did not release pure computation"
            return actual(view, memory, **values)
        finally:
            finished.set()

    monkeypatch.setattr(runner, "decide", blocking)

    async def scenario():
        ticks = 0

        async def heartbeat():
            nonlocal ticks
            while not finished.is_set():
                ticks += 1
                await asyncio.sleep(0.001)

        pulse = asyncio.create_task(heartbeat())
        try:
            runner.watch_game(game)
            await until(entered.is_set)
            previous = ticks
            await asyncio.sleep(0.015)
            assert ticks > previous and not finished.is_set()
            await runner.stop_cpu_runners()
            assert serializable_game_state(game) == before
            release.set()
            await until(finished.is_set)
            await asyncio.sleep(0)
            assert serializable_game_state(game) == before and not runner._JOBS
            with session_scope() as db:
                restored = restore_watten_json(db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id)))
                assert serializable_game_state(restored) == before
        finally:
            release.set()
            await until(finished.is_set)
            await runner.stop_cpu_runners()
            await pulse

    asyncio.run(scenario())


def test_policy_pool_keeps_two_slots_until_cancelled_computation_actually_finishes(monkeypatch):
    entered = [Event() for _ in range(3)]
    released = [Event() for _ in range(3)]
    counter_lock = Lock()
    active = peak = 0

    def blocking(_view, _memory, *, seed, **_values):
        nonlocal active, peak
        with counter_lock:
            active += 1
            peak = max(peak, active)
        entered[seed].set()
        try:
            assert released[seed].wait(5), "test did not release pure computation"
            return seed
        finally:
            with counter_lock:
                active -= 1

    monkeypatch.setattr(runner, "decide", blocking)

    async def scenario():
        tasks = [asyncio.create_task(runner._decide_snapshot({}, None, seed=seed, events=(), budget=None, skill=None))
                 for seed in range(3)]
        try:
            await until(lambda: entered[0].is_set() and entered[1].is_set())
            tasks[0].cancel()
            with pytest.raises(asyncio.CancelledError):
                await tasks[0]
            await asyncio.sleep(0.015)
            assert not entered[2].is_set() and peak == 2
            released[0].set()
            await until(entered[2].is_set)
            released[1].set()
            released[2].set()
            assert await tasks[1] == 1 and await tasks[2] == 2 and peak == 2
        finally:
            for event in released:
                event.set()
            await asyncio.gather(*tasks, return_exceptions=True)

    asyncio.run(scenario())


def test_public_ban_during_thread_computation_revokes_the_proposal_before_commit(server, ready, monkeypatch):
    deterministic_dealer(monkeypatch)
    game_id, owners, _sessions = local_started(server, count_players=2, cpus=(1,))
    game = games[game_id]
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", "https://zockdiewandan.online")
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", "0")
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_PUBLIC_BETA", "1")
    before = serializable_game_state(game)
    entered, release, finished = Event(), Event(), Event()
    actual = runner.decide

    def blocking(view, memory, **values):
        entered.set()
        try:
            assert release.wait(5)
            return actual(view, memory, **values)
        finally:
            finished.set()

    monkeypatch.setattr(runner, "decide", blocking)

    async def scenario():
        try:
            runner.watch_game(game)
            await until(entered.is_set)
            job = next(iter(runner._JOBS.values()))
            with session_scope() as db:
                db.add(UserBan(user_id=owners[0][0].user_id, scope="play", reason="isolated test", created_at=utcnow()))
            release.set()
            await job.task
            assert serializable_game_state(game) == before and not runner._JOBS
            with session_scope() as db:
                restored = restore_watten_json(db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id)))
                assert serializable_game_state(restored) == before
        finally:
            release.set()
            await until(finished.is_set)
            await runner.stop_cpu_runners()

    asyncio.run(scenario())


def test_memory_is_committed_before_cpu_inspection_ack_closes_window_and_restores_without_repeek(server, ready, monkeypatch):
    deterministic_dealer(monkeypatch)
    game_id, owners, sessions = local_started(server, count_players=4, blind=True, cpus=(1, 2, 3))
    game = games[game_id]
    human = sessions[0]
    accepted_engine(game, human.player_id, engine_command(game_id, "show_ready", "human-show"))
    captured = []
    real_decide = runner.decide

    def checked(view, memory, **kwargs):
        current = game["_watten"]
        assert view == cpu_view(current.engine, player_id=memory.player_id)
        assert set(view).isdisjoint({"stock", "bottom_cards", "call", "account_id", "_watten"})
        captured.append((deepcopy(view), memory_to_storage(memory)))
        return real_decide(view, memory, **kwargs)

    monkeypatch.setattr(runner, "decide", checked)

    async def scenario():
        try:
            runner.watch_game(game)
            await until(lambda: game["_watten"].engine.phase == "inspection")
            cpu = next(item for item in game["_watten"].room.cpus if item.seat == 1)
            memory = next(item for item in game["_watten"].cpu_memories if item.player_id == cpu.participant_id)
            assert memory.inspected is not None
            with session_scope() as db:
                stored = restore_watten_json(db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id)))
            assert next(item for item in stored["_watten"].cpu_memories if item.player_id == cpu.participant_id).inspected == memory.inspected
            await until(lambda: 1 in game["_watten"].engine.acknowledged)
            assert cpu_view(game["_watten"].engine, player_id=cpu.participant_id)["inspection"] is None
            restored = restore_watten_json(json.dumps(serializable_game_state(game)))
            assert next(item for item in restored["_watten"].cpu_memories if item.player_id == cpu.participant_id).inspected == memory.inspected
            assert cpu_view(restored["_watten"].engine, player_id=cpu.participant_id)["inspection"] is None
            assert restored["_watten"].engine.phase == "inspection"  # human has not ACKed
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())
    inspector_calls = [view for view, _memory in captured if view["viewer"]["seat"] == 1]
    assert [view["phase"] for view in inspector_calls] == ["show_ready", "inspection"]
    for view, _memory in captured:
        if view["viewer"]["seat"] != 1:
            assert view["hand"] == [{"back": True}] * 5
    assert owners[0][0].user_id not in {item.account_id for item in game["_watten"].engine.recipe.bindings if item.account_id is None}


def test_cpu_optional_bloedeln_request_is_saved_and_never_answers_for_human(server, ready, monkeypatch):
    deterministic_dealer(monkeypatch)
    monkeypatch.setattr(cpu_policy, "_bloedeln_coin", lambda _snap, purpose: purpose == "request")
    game_id, _owners, sessions = local_started(server, count_players=4, blind=True, cpus=(3,))
    game = games[game_id]

    async def scenario():
        try:
            runner.watch_game(game)
            await until(lambda: game["_watten"].engine.preplay_request is not None)
            pending = game["_watten"].engine.preplay_request
            assert (pending.kind, pending.requester, pending.responder) == ("bloedeln", 3, 2)
            await asyncio.sleep(0.04)
            for _ in range(3):
                runner.watch_game(game)
            await asyncio.sleep(0.04)
            assert game["_watten"].engine.preplay_request == pending
            with session_scope() as db:
                saved = restore_watten_json(db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id)))
            assert saved["_watten"].engine.preplay_request == pending
            await _handle_locked(sessions[2], "watten_command", engine_command(game_id, "preplay_decline", "human-choice"))
            assert game["_watten"].engine.bloedeln_decisions == ((2, False), (3, True))
            assert not game["_watten"].engine.bloedeln and game["_watten"].engine.preplay_request is None
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())


@pytest.mark.parametrize("accepted", (False, True))
def test_cpu_answers_human_bloedeln_request_from_hidden_hand_and_saves_only_own_answer(server, ready, monkeypatch, accepted):
    deterministic_dealer(monkeypatch)
    monkeypatch.setattr(cpu_policy, "_bloedeln_coin", lambda _snap, purpose: accepted and purpose == "answer")
    game_id, _owners, sessions = local_started(server, count_players=4, blind=True, cpus=(3,))
    game = games[game_id]

    async def scenario():
        try:
            await _handle_locked(sessions[2], "watten_command", engine_command(game_id, "request_bloedeln", "human-request"))
            await until(lambda: game["_watten"].engine.preplay_request is None)
            engine = game["_watten"].engine
            assert engine.phase == "show_ready" and engine.bloedeln is accepted
            assert engine.bloedeln_decisions == ((2, True), (3, accepted))
            for seat in range(4):
                assert snapshot_watten(game, engine.recipe.seats[seat])["engine"]["preplay"]["bloedeln_cards"] == []
            with session_scope() as db:
                saved = restore_watten_json(db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id)))
            assert saved["_watten"].engine == engine
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())


def test_bound_blind_human_can_bid_and_rejoin_pending_offer_but_other_blind_cannot_answer(server, ready, monkeypatch):
    deterministic_dealer(monkeypatch)
    game_id, owners, sessions = local_started(server, count_players=4, blind=True, target=11)
    game = games[game_id]
    complete_call(game_id)
    player, card = next_move(game_id, count(100))
    accepted_engine(game, player, card)
    state = game["_watten"].engine
    blind = sessions[2]
    assert state.play.current_player_id == blind.player_id and state.recipe.seats.index(blind.player_id) not in state.inspectors
    data = engine_command(game_id, "bid", "human-blind-offer")

    async def scenario():
        await _handle_locked(blind, "watten_command", data)
        before = game["_watten"]
        assert before.engine.phase == "bid_response" and before.engine.play == state.play
        with pytest.raises(ValueError, match="designated_decider"):
            await _handle_locked(sessions[3], "watten_command", engine_command(game_id, "respond", "forged-answer", "counter"))
        await _handle_locked(blind, "watten_command", data)
        assert game["_watten"].bid_counters == before.bid_counters
        with session_scope() as db:
            saved = restore_watten_json(db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id)))
        games[game_id] = saved
        joined = GameSocketSession(CapturingSocket(owners[2]), saved, owners[2][0])
        await _handle_locked(joined, "rejoin_game", {"action": "rejoin_game", "revision": saved["_watten"].room.revision,
                                                     "player_id": blind.player_id, "expected_account_id": owners[2][0].user_id})
        view = snapshot_watten(saved, joined.player_id)["engine"]
        assert view["bid"]["pending"]["decider"] == before.engine.recipe.seats[1]
        assert view["actions"] == [] and saved["_watten"].engine.play == state.play
        assert sum(item.initiated for item in saved["_watten"].bid_counters) == 1

    asyncio.run(scenario())


def test_inspection_ack_reschedules_current_opportunity_and_pause_cancels_old_timer(server, ready, monkeypatch):
    deterministic_dealer(monkeypatch, seat=1)
    monkeypatch.setattr(runner, "THINK_MIN_SECONDS", 0.08)
    monkeypatch.setattr(runner, "THINK_MAX_SECONDS", 0.08)
    game_id, owners, sessions = local_started(server, cpus=(2, 3), blind=True)
    game = games[game_id]
    for index, seat in enumerate((1, 2)):
        player = game["_watten"].engine.recipe.seats[seat]
        accepted_engine(game, player, engine_command(game_id, "show_ready", f"ready-{index}"))

    async def scenario():
        try:
            runner.watch_game(game)
            cpu = game["_watten"].engine.recipe.seats[2]
            job = runner._JOBS[(game_id, cpu)]
            ack = engine_command(game_id, "inspection_ack", "other-inspector")
            await _handle_locked(sessions[1], "watten_command", ack)
            assert runner._JOBS[(game_id, cpu)] is not job
            assert runner._JOBS[(game_id, cpu)].context != job.context
            before = game["_watten"].engine
            leave = room_command(game_id, "watten_leave", "pause-before-fire")
            await _handle_locked(sessions[0], "watten_leave", leave)
            assert not any(key[0] == game_id for key in runner._JOBS)
            await asyncio.sleep(0.1)
            assert game["_watten"].engine == before
            returned = GameSocketSession(CapturingSocket(owners[0]), game, owners[0][0])
            await _handle_locked(returned, "rejoin_game", {"action": "rejoin_game", "revision": game["_watten"].room.revision,
                                                         "resume": True, "lifecycle_revision": game["_watten"].lifecycle_revision})
            assert runner._JOBS[(game_id, cpu)].context != job.context
            await until(lambda: game["_watten"].engine.opportunity > before.opportunity)
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())


def test_failed_cpu_checkpoint_never_installs_or_spins_and_restart_can_recover(server, ready, monkeypatch):
    deterministic_dealer(monkeypatch)
    game_id, _owners, _sessions = local_started(server, count_players=2, cpus=(1,))
    game = games[game_id]
    complete_call(game_id)
    before = game["_watten"]
    real_scope = runtime_module.session_scope

    @contextmanager
    def failed_scope():
        with real_scope() as db:
            yield db
            raise SQLAlchemyError("deliberate CPU commit failure")

    async def scenario():
        try:
            monkeypatch.setattr(runtime_module, "session_scope", failed_scope)
            runner.watch_game(game)
            await until(lambda: bool(runner._BLOCKED))
            assert game["_watten"] == before
            with session_scope() as db:
                assert restore_watten_json(db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id)))["_watten"] == before
                assert db.scalar(select(func.count(CompletedGame.id))) == 0
            runner.watch_game(game)
            assert not runner._JOBS
            monkeypatch.setattr(runtime_module, "session_scope", real_scope)
            restored = load_active_games()[game_id]
            games[game_id] = restored
            await runner.resume_cpu_games(games)
            await until(lambda: restored["_watten"].engine.opportunity > before.engine.opportunity)
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())


@pytest.mark.parametrize("version", (1, 2))
def test_storage_v3_strict_bindings_and_legacy_compatibility_without_denied_reconstruction(server, monkeypatch, version):
    game_id, _owners, _sessions = local_started(server, count_players=2)
    raw = serializable_game_state(games[game_id])
    raw["_watten"].pop("bid_counters")
    raw["_watten"].pop("round_review_started_at")
    if version == 1:
        raw["_watten"].pop("cpu_memories")
    raw["_watten"]["schema_version"] = version
    restored = restore_watten_json(json.dumps(raw))
    assert restored["_watten"].engine == games[game_id]["_watten"].engine
    assert restored["_watten"].bid_counters is None
    assert serializable_game_state(restored)["_watten"]["schema_version"] == 4
    # A fresh separate account/game avoids fabricating any human CPU identity.
    owner = account("LegacyCpuOwner")
    waiting_id = create_game(server, owner, cpus=(1,))
    waiting = serializable_game_state(games[waiting_id])
    waiting["_watten"].pop("bid_counters")
    waiting["_watten"].pop("round_review_started_at")
    if version == 1:
        waiting["_watten"].pop("cpu_memories")
    waiting["_watten"]["schema_version"] = version
    waiting_restored = restore_watten_json(json.dumps(waiting))
    assert waiting_restored["_watten"].engine is None
    assert restore_watten_json(json.dumps(serializable_game_state(waiting_restored)))["_watten"] == waiting_restored["_watten"]
    cpu_id, _owners, _sessions = local_started_reusing_account(server, owner)
    cpu_raw = serializable_game_state(games[cpu_id])
    legacy_v2 = deepcopy(cpu_raw)
    legacy_v2["_watten"].pop("bid_counters")
    legacy_v2["_watten"].pop("round_review_started_at")
    legacy_v2["_watten"]["schema_version"] = 2
    restored_v2 = restore_watten_json(json.dumps(legacy_v2))
    assert restored_v2["_watten"].cpu_memories == games[cpu_id]["_watten"].cpu_memories
    assert restored_v2["_watten"].bid_counters is None
    bad = deepcopy(cpu_raw)
    bad["_watten"]["cpu_memories"] = []
    with pytest.raises(ValueError, match="watten_invalid_cpu_memory"):
        restore_watten_json(json.dumps(bad))
    cpu_raw["_watten"].pop("cpu_memories")
    cpu_raw["_watten"].pop("bid_counters")
    cpu_raw["_watten"].pop("round_review_started_at")
    cpu_raw["_watten"]["schema_version"] = 1
    with pytest.raises(ValueError, match="watten_cpu_legacy_memory_unavailable"):
        restore_watten_json(json.dumps(cpu_raw))


def local_started_reusing_account(server, owner):
    from app.watten_runtime import admit_account

    game_id = create_game(server, owner, cpus=(1,))
    game = games[game_id]
    game, player = admit_account(game, owner[0], game["_watten"].room.revision, None)
    games[game_id] = game
    for action, values in (("watten_take_seat", {"seat": 0, "team": None}), ("watten_start", {})):
        candidate, *_ = apply_runtime_action(game, owner[0].user_id, player, room_command(game_id, action, action, **values))
        persist_watten_game(candidate)
        game.update(candidate)
    return game_id, [owner], []


def test_cpu_names_reserve_all_human_names_and_readiness_never_grants_production(server, monkeypatch):
    monkeypatch.setattr(runner, "CPU_POLICY_READY", False)
    owner = account("Hansl")
    game_id = create_game(server, owner, count=4, cpus=(1, 2, 3))
    names = [name.casefold() for _player, name in games[game_id]["_watten"].names]
    assert len(set(names)) == 4
    assert not snapshot_watten(games[game_id])["capabilities"]["cpu_autoplay"]
    monkeypatch.setattr(runner, "CPU_POLICY_READY", True)
    assert runner.cpu_autoplay_enabled()
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", "https://zockdiewandan.online")
    assert not runner.cpu_autoplay_enabled()


def test_normal_three_cpu_solo_announces_both_and_only_its_authorized_calls_reach_memory(server, ready, monkeypatch):
    deterministic_dealer(monkeypatch)
    game_id, _owners, _sessions = local_started(server, count_players=3, cpus=(1, 2))
    game = games[game_id]

    async def scenario():
        try:
            runner.watch_game(game)
            await until(lambda: game["_watten"].engine.phase == "play")
            for memory in game["_watten"].cpu_memories:
                assert memory.strike is not None and memory.suit is not None
                assert memory.inspected is None
            assert len(game["_watten"].deliveries) == 2
            assert {item.participant_id for item in game["_watten"].deliveries} == {"p1"}
            assert all(item.account_id is None for item in game["_watten"].engine.recipe.bindings[1:])
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())


@pytest.mark.parametrize("blind", (False, True))
def test_cpu_partner_advises_privately_before_its_real_designated_bid_response(server, ready, monkeypatch, blind):
    deterministic_dealer(monkeypatch)
    game_id, _owners, sessions = local_started(server, count_players=4, cpus=(1, 2, 3), blind=blind)
    game, human = games[game_id], sessions[0]
    complete_call(game_id)
    numbers = count(100)  # call setup already used engine-0/engine-1 command IDs
    # Establish a legal first-card bidding opportunity for the human. The
    # response and private advice below must come from actual runner decisions.
    for _ in range(3):
        player, command = next_move(game_id, numbers)
        assert player != human.player_id
        accepted_engine(game, player, command)
    assert game["_watten"].engine.play.current_player_id == human.player_id
    waits = iter((0.05, 0.01, 0.01, 0.01))
    monkeypatch.setattr(runner, "_RANDOM", SimpleNamespace(uniform=lambda _low, _high: next(waits, 0.01)))
    captured = []
    real_apply, real_decide = runtime_module._apply_engine_command, runner.decide

    def checked(view, memory, **kwargs):
        assert view == cpu_view(game["_watten"].engine, player_id=memory.player_id)
        return real_decide(view, memory, **kwargs)

    def applied(current, actor, command):
        result = real_apply(current, actor, command)
        captured.append((command.kind, current["_watten"].engine.opportunity,
                         result[0]["_watten"].engine.opportunity, result[3]))
        return result

    monkeypatch.setattr(runner, "decide", checked)
    monkeypatch.setattr(runtime_module, "_apply_engine_command", applied)

    async def scenario():
        try:
            await _handle_locked(human, "watten_command", engine_command(game_id, "bid", "human-bid"))
            await until(lambda: any(kind == "respond" for kind, *_rest in captured))
            advice = next(item for item in captured if item[0] == "partner_feedback")
            assert advice[1] == advice[2]
            assert advice[3] == {game["_watten"].engine.recipe.seats[index] for index in (1, 3)}
            assert [kind for kind, *_rest in captured].index("partner_feedback") < [kind for kind, *_rest in captured].index("respond")
            if blind:
                first_response = [kind for kind, *_rest in captured].index("respond")
                assert sum(kind == "partner_feedback" for kind, *_rest in captured[:first_response]) == 1
            # The human opposite party receives only freshly projected public
            # state; the CPU pair's private advice never enters that DTO.
            assert all(not message["scoreboard"]["engine"]["feedback"]
                       for message in human.websocket.messages if "scoreboard" in message)
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())


@pytest.mark.parametrize("cpu_knower,raise_bid", ((True, False), (True, True), (False, True)))
def test_blind_cpu_card_turn_waits_for_cpu_knower_bid_decision_but_never_for_human(server, ready, monkeypatch,
                                                                               cpu_knower, raise_bid):
    deterministic_dealer(monkeypatch)
    cpus = (1, 2, 3) if cpu_knower else (2, 3)
    game_id, _owners, _sessions = local_started(server, count_players=4, cpus=cpus, blind=True)
    game = games[game_id]
    complete_call(game_id)
    for _ in range(2):
        player, command = next_move(game_id, count(100))
        accepted_engine(game, player, command)
    state = game["_watten"].engine
    knower, card_player = state.recipe.seats[1], state.recipe.seats[3]
    assert state.play.current_player_id == card_player
    start_opportunity = state.opportunity
    monkeypatch.setattr(cpu_policy, "_should_bid", lambda *_args: raise_bid)
    captured = []
    real_decide = runner.decide

    def checked(view, memory, **kwargs):
        result = real_decide(view, memory, **kwargs)
        captured.append((memory.player_id, result.decision))
        return result

    monkeypatch.setattr(runner, "decide", checked)

    async def scenario():
        try:
            runner.watch_game(game)
            assert ((game_id, card_player) not in runner._JOBS) is cpu_knower
            if cpu_knower:
                assert (game_id, knower) in runner._JOBS
            await until(lambda: game["_watten"].engine.opportunity > start_opportunity)
            if cpu_knower:
                assert captured[0][0] == knower
                if raise_bid:
                    assert captured[0][1].kind == "bid"
                    assert game["_watten"].engine.phase == "bid_response"
                    assert game["_watten"].engine.play.current_player_id == card_player
                else:
                    assert isinstance(captured[0][1], runner.CpuWait)
                    assert captured[1][0] == card_player and captured[1][1].kind == "play_card"
            else:
                assert captured[0][0] == card_player and captured[0][1].kind == ("bid" if raise_bid else "play_card")
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())


def test_shutdown_and_replaced_registry_cancel_or_reject_late_old_timer(server, ready, monkeypatch):
    deterministic_dealer(monkeypatch)
    monkeypatch.setattr(runner, "THINK_MIN_SECONDS", 0.1)
    monkeypatch.setattr(runner, "THINK_MAX_SECONDS", 0.1)
    game_id, _owners, _sessions = local_started(server, count_players=2, cpus=(1,))
    game = games[game_id]
    complete_call(game_id)
    before = game["_watten"]

    async def scenario():
        runner.watch_game(game)
        old_job = next(iter(runner._JOBS.values()))
        restored = restore_watten_json(json.dumps(serializable_game_state(game)))
        games[game_id] = restored
        runner.watch_game(restored)
        replacement = next(iter(runner._JOBS.values()))
        assert replacement is not old_job and replacement.owner is restored
        await until(lambda: restored["_watten"].engine.opportunity > before.engine.opportunity)
        assert game["_watten"] == before
        await runner.stop_cpu_runners()
        assert old_job.task.done() and not runner._JOBS
        current = restored["_watten"]
        runner.watch_game(restored)
        await runner.stop_cpu_runners()
        await asyncio.sleep(0.12)
        assert restored["_watten"] == current and not runner._JOBS

    asyncio.run(scenario())


def test_host_next_deal_rotates_roles_and_cpu_memory_without_reusing_old_call_or_plays(server, ready, monkeypatch):
    deterministic_dealer(monkeypatch)
    game_id, _owners, sessions = local_started(server, count_players=2, cpus=(1,), target=11)
    game, human = games[game_id], sessions[0]
    complete_call(game_id)
    numbers = count(100)
    for _ in range(10):
        if game["_watten"].engine.phase == "deal_complete":
            break
        player, command = next_move(game_id, numbers)
        accepted_engine(game, player, command)
    previous = game["_watten"].engine
    assert previous.phase == "deal_complete"
    memory = game["_watten"].cpu_memories[0]
    assert memory.plays and memory.strike is not None and memory.suit is not None

    async def scenario():
        try:
            data = room_command(game_id, "watten_next_deal", "next", deal_id=previous.deal_id, opportunity=previous.opportunity)
            await _handle_locked(human, "watten_next_deal", data)
            current = game["_watten"].engine
            assert current.dealer_seat == 1 and current.deal_id != previous.deal_id
            fresh = game["_watten"].cpu_memories[0]
            assert fresh.deal_id == current.deal_id and not fresh.plays
            assert fresh.strike is None and fresh.suit is None and fresh.inspected is None
            assert current.phase == "strike"
            await _handle_locked(human, "watten_command", engine_command(game_id, "announce_strike", "new-strike", "8"))
            await until(lambda: game["_watten"].engine.phase == "play")
            assert game["_watten"].cpu_memories[0].strike == "8"
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())


@pytest.mark.parametrize("count_players,blind", ((2, False), (3, False), (4, True)))
def test_actual_short_mixed_match_uses_only_personal_policy_inputs_and_one_result(server, ready, monkeypatch, count_players, blind):
    game_id, _owners, sessions = local_started(server, count_players=count_players, cpus=tuple(range(1, count_players)), blind=blind)
    game = games[game_id]
    human = sessions[0]
    numbers = count()
    real_decide = runner.decide

    def checked(view, memory, **kwargs):
        assert view == cpu_view(game["_watten"].engine, player_id=memory.player_id)
        return real_decide(view, memory, **kwargs)

    monkeypatch.setattr(runner, "decide", checked)

    async def scenario():
        try:
            runner.watch_game(game)
            for _ in range(1000):
                state = game["_watten"].engine
                if state.phase == "match_complete":
                    break
                if state.phase == "deal_complete":
                    if retourschneider_candidate(state.ledger) is not None:
                        view = snapshot_watten(game, human.player_id)["engine"]
                        if "retourschneider" in view["actions"]:
                            data = engine_command(game_id, "retourschneider", next(numbers), "decline")
                            await _handle_locked(human, data["action"], data)
                        else:
                            await asyncio.sleep(0.004)
                        continue
                    # A CPU bid/go may finish before this human acts. Keep the
                    # first next-deal ID distinct from setup's room-0 seat ACK.
                    data = room_command(game_id, "watten_next_deal", f"cpu-loop-{next(numbers)}",
                                        deal_id=state.deal_id, opportunity=state.opportunity)
                    await _handle_locked(human, data["action"], data)
                else:
                    view = snapshot_watten(game, human.player_id)["engine"]
                    actions = view["actions"]
                    kind = next((kind for kind in ("preplay_decline", "announce_strike", "announce_colour", "show_ready", "inspection_ack", "play_card") if kind in actions), None)
                    value = "7" if kind == "announce_strike" else "bells" if kind == "announce_colour" else (
                        legal_cards(state.play, state.bid_state, human.player_id)[0] if kind == "play_card" else None)
                    if any(action.startswith("respond_") for action in actions):
                        kind, value = "respond", "hold"
                    if kind is not None:
                        data = engine_command(game_id, kind, next(numbers), value)
                        await _handle_locked(human, data["action"], data)
                    else:
                        await asyncio.sleep(0.004)
            assert game["_watten"].engine.phase == "match_complete", runner._BLOCKED
            assert game["_completion_persisted"]
            restored = restore_watten_json(json.dumps(serializable_game_state(game)))
            games[game_id] = restored
            await runner.resume_cpu_games(games)
            await asyncio.sleep(0.02)
            assert not any(key[0] == game_id for key in runner._JOBS)
            persist_watten_game(restored)
            persist_watten_game(restored)
            with session_scope() as db:
                assert db.scalar(select(func.count(CompletedGame.id))) == 1
                assert db.scalar(select(func.count(GameParticipant.id))) == count_players
                assert db.scalar(select(func.count(GameParticipant.id)).where(GameParticipant.user_id.is_not(None))) == 1
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())
