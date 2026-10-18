"""Small native runner/storage/privacy regressions, no browser or benchmark."""

import asyncio
import json
from contextlib import contextmanager
from copy import deepcopy
from itertools import count
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from app import watten_cpu_runtime as runner
from app import watten_runtime as runtime_module
from app.active_games import load_active_games, serializable_game_state
from app.database import session_scope
from app.game_state import games
from app.game_ws_session import GameSocketSession
from app.models import ActiveGame, CompletedGame, GameParticipant
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


@pytest.fixture
def ready(monkeypatch):
    monkeypatch.setattr(runner, "CPU_POLICY_READY", True)
    monkeypatch.setattr(runner, "THINK_MIN_SECONDS", 0.01)
    monkeypatch.setattr(runner, "THINK_MAX_SECONDS", 0.01)
    monkeypatch.setattr(runner, "CpuBudget", lambda: CpuBudget(samples=1))


def deterministic_dealer(monkeypatch, seat=0):
    monkeypatch.setattr(runtime_module, "_RANDOM", SimpleNamespace(randrange=lambda _count: seat, shuffle=lambda _deck: None))


def accepted_engine(game, player, command):
    binding = next(item for item in game["_watten"].engine.recipe.bindings if item.player_id == player)
    fields = {key: command[key] for key in ("command_id", "deal_id", "opportunity", "phase", "kind", "value", "private_opportunity")}
    candidate, *_ = _apply_engine_command(game, EngineActor(player, binding.account_id), EngineCommand(**fields))
    persist_watten_game(candidate)
    game.update(candidate)


def complete_call(game_id):
    for number in range(5):
        if games[game_id]["_watten"].engine.phase == "play":
            return
        player, command = next_move(game_id, count(number))
        accepted_engine(games[game_id], player, command)
    raise AssertionError("No play")


async def until(predicate, *, seconds=3):
    end = asyncio.get_running_loop().time() + seconds
    while not predicate():
        assert asyncio.get_running_loop().time() < end, "CPU deadline did not complete"
        await asyncio.sleep(0.002)


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
    assert [view["phase"] for view, _memory in captured] == ["show_ready", "inspection"]
    assert owners[0][0].user_id not in {item.account_id for item in game["_watten"].engine.recipe.bindings if item.account_id is None}


def test_private_unrelated_feedback_preserves_deadline_and_pause_cancels_old_timer(server, ready, monkeypatch):
    deterministic_dealer(monkeypatch, seat=1)
    monkeypatch.setattr(runner, "THINK_MIN_SECONDS", 0.08)
    monkeypatch.setattr(runner, "THINK_MAX_SECONDS", 0.08)
    game_id, owners, sessions = local_started(server, cpus=(2, 3))
    game = games[game_id]
    complete_call(game_id)

    async def scenario():
        try:
            runner.watch_game(game)
            cpu = game["_watten"].engine.recipe.seats[2]
            job = runner._JOBS[(game_id, cpu)]
            feedback = engine_command(game_id, "partner_feedback", "other-partner", "unsure", sessions[1].player_id)
            await _handle_locked(sessions[1], "watten_command", feedback)
            assert runner._JOBS[(game_id, cpu)] is job
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


def test_storage_v2_strict_bindings_and_v1_human_compatibility_without_denied_reconstruction(server, monkeypatch):
    game_id, _owners, _sessions = local_started(server, count_players=2)
    raw = serializable_game_state(games[game_id])
    raw["_watten"].pop("cpu_memories")
    raw["_watten"]["schema_version"] = 1
    restored = restore_watten_json(json.dumps(raw))
    assert restored["_watten"].engine == games[game_id]["_watten"].engine
    assert serializable_game_state(restored)["_watten"]["schema_version"] == 2
    # A fresh separate account/game avoids fabricating any human CPU identity.
    owner = account("LegacyCpuOwner")
    waiting_id = create_game(server, owner, cpus=(1,))
    waiting = serializable_game_state(games[waiting_id])
    waiting["_watten"].pop("cpu_memories")
    waiting["_watten"]["schema_version"] = 1
    waiting_restored = restore_watten_json(json.dumps(waiting))
    assert waiting_restored["_watten"].engine is None
    assert restore_watten_json(json.dumps(serializable_game_state(waiting_restored)))["_watten"] == waiting_restored["_watten"]
    cpu_id, _owners, _sessions = local_started_reusing_account(server, owner)
    cpu_raw = serializable_game_state(games[cpu_id])
    bad = deepcopy(cpu_raw)
    bad["_watten"]["cpu_memories"] = []
    with pytest.raises(ValueError, match="watten_invalid_cpu_memory"):
        restore_watten_json(json.dumps(bad))
    cpu_raw["_watten"].pop("cpu_memories")
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


@pytest.mark.skipif(not runner.CPU_POLICY_READY, reason="Separate policy review/fixes still pending")
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
                    data = room_command(game_id, "watten_next_deal", next(numbers), deal_id=state.deal_id, opportunity=state.opportunity)
                    await _handle_locked(human, data["action"], data)
                else:
                    view = snapshot_watten(game, human.player_id)["engine"]
                    actions = view["actions"]
                    kind = next((kind for kind in ("announce_strike", "announce_colour", "show_ready", "inspection_ack", "play_card") if kind in actions), None)
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
            with session_scope() as db:
                assert db.scalar(select(func.count(CompletedGame.id))) == 1
                assert db.scalar(select(func.count(GameParticipant.id))) == count_players
                assert db.scalar(select(func.count(GameParticipant.id)).where(GameParticipant.user_id.is_not(None))) == 1
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())
