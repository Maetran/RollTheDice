"""Native one-hour expiry, terminal delivery and restart-safe retirement."""

import asyncio
import json
from datetime import timedelta
from itertools import count
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from app import main, watten_runtime, watten_websocket
from app import watten_cpu_runtime as cpu
from app import watten_round_runtime as review
from app.active_games import load_active_games
from app.database import session_scope
from app.game_state import GAME_TIMEOUT, games
from app.game_ws_session import GameSocketSession
from app.models import AbandonedGame, ActiveGame, CompletedGame, WattenMatchCredit
from app.watten_runtime import (
    admit_account,
    apply_runtime_action,
    expire_inactive_game,
    persist_watten_game,
    restore_watten_json,
    serialize_watten_game,
)
from app.watten_websocket import _handle_locked, sweep_watten_games
from tests import test_watten_round_runtime as round_tests
from tests import test_watten_runtime as native
from tests.test_watten_match_evidence import NativeMatch

server = native.server


def assert_unscored():
    with session_scope() as db:
        for model in (AbandonedGame, CompletedGame, WattenMatchCredit):
            assert db.scalar(select(func.count()).select_from(model)) == 0


@pytest.mark.parametrize("departure", ("idle", "left", "disconnected"))
def test_deadline_closes_idle_left_and_disconnected_tables_once_without_scoring(server, monkeypatch, departure):
    game_id, owners, sessions = native.local_started(server, count_players=2)
    game = games[game_id]
    if departure == "left":
        leave = native.room_command(game_id, "watten_leave", "timeout-leave")
        asyncio.run(_handle_locked(sessions[0], "watten_leave", leave))
    elif departure == "disconnected":
        for player in game["_players"]:
            player["ws"] = None
    engine = game["_watten"].engine
    deadline = game["_last_activity"] + GAME_TIMEOUT
    now = deadline - timedelta(microseconds=1)
    monkeypatch.setattr(watten_runtime, "utcnow", lambda: now)
    assert asyncio.run(sweep_watten_games()) == 0
    assert games[game_id] is game
    observer = native.account("TimeoutObserver")
    observer_socket = native.CapturingSocket(observer)
    unbound_socket = native.CapturingSocket(owners[0])
    game["_spectators"].append({"id": "s-timeout", "user_id": observer[0].user_id, "ws": observer_socket})
    game["_live_sockets"] = [unbound_socket]
    for session in sessions:
        session.websocket.messages.clear()
    now = deadline
    assert asyncio.run(main._sweep_timeout_aborts()) == 1
    assert game_id not in games and game_id not in load_active_games()
    assert game["_watten"].engine == engine
    view = observer_socket.messages[-1]["scoreboard"]
    assert view["aborted"] and view["finished"] and not view["started"]
    assert view["abort_reason"] == "inactivity_timeout" and view["room"]["status"] == "closed"
    assert view["engine"] is None and view["round_review"] is None and view["score_history"] == []
    assert not view["paused"] and not view["can_resume"] and view["pending_call_events"] == []
    assert observer_socket.closes == [(1000, None)] and unbound_socket.closes == [(1000, None)]
    assert unbound_socket.messages == []
    for index, session in enumerate(sessions):
        expected = departure == "idle" or departure == "left" and index == 1
        assert len(session.websocket.messages) == int(expected)
    assert asyncio.run(sweep_watten_games()) == 0
    assert len(observer_socket.messages) == 1
    assert_unscored()


def test_gameplay_and_intentional_resume_renew_activity_but_views_chat_and_rejoin_do_not(server, monkeypatch):
    game_id, owners, sessions = native.local_started(server, count_players=2)
    game = games[game_id]
    original = game["_last_activity"]
    now = original + timedelta(minutes=59)
    monkeypatch.setattr(watten_runtime, "utcnow", lambda: now)
    for data in ({"action": "get_state"}, {"action": "watten_social_history"}):
        asyncio.run(_handle_locked(sessions[0], data["action"], data))
    stream = sessions[0].websocket.messages[-1]["watten_social_history"]
    chat = {"action": "watten_chat_message", "channel_id": stream["channel_id"],
            "nonce": stream["next_nonce"], "text": "Still here"}
    asyncio.run(_handle_locked(sessions[0], chat["action"], chat))
    rejoining = GameSocketSession(native.CapturingSocket(owners[0]), game, owners[0][0])
    asyncio.run(_handle_locked(rejoining, "rejoin_game", {
        "action": "rejoin_game", "revision": game["_watten"].room.revision}))
    sessions[0] = rejoining
    assert game["_last_activity"] == original
    player, command = native.next_move(game_id, count())
    sender = next(item for item in sessions if item.player_id == player)
    asyncio.run(_handle_locked(sender, command["action"], command))
    assert game["_last_activity"] == now
    now = original + GAME_TIMEOUT
    assert asyncio.run(sweep_watten_games()) == 0
    leave = native.room_command(game_id, "watten_leave", "resume-before-expiry")
    asyncio.run(_handle_locked(sessions[0], "watten_leave", leave))
    now += timedelta(minutes=59)
    returned = GameSocketSession(native.CapturingSocket(owners[0]), game, owners[0][0])
    asyncio.run(_handle_locked(returned, "rejoin_game", {
        "action": "rejoin_game", "revision": game["_watten"].room.revision,
        "resume": True, "lifecycle_revision": game["_watten"].lifecycle_revision}))
    assert game["_last_activity"] == now and not game["_watten"].absent
    now += timedelta(minutes=2)
    assert asyncio.run(sweep_watten_games()) == 0


def test_terminal_checkpoint_commit_failure_is_safe_and_restart_retires_without_credit(server, monkeypatch):
    game_id, owners, sessions = native.local_started(server, count_players=2)
    game = games[game_id]
    now = game["_last_activity"] + GAME_TIMEOUT
    monkeypatch.setattr(watten_runtime, "utcnow", lambda: now)
    # A failed commit cannot install a speculative abort.
    before = serialize_watten_game(game)
    original_persist = watten_runtime.persist_watten_game
    monkeypatch.setattr(watten_runtime, "persist_watten_game", lambda *_args, **_kwargs: (_ for _ in ()).throw(SQLAlchemyError("offline")))
    with pytest.raises(SQLAlchemyError):
        expire_inactive_game(game)
    assert serialize_watten_game(game) == before
    monkeypatch.setattr(watten_runtime, "persist_watten_game", original_persist)
    assert expire_inactive_game(game)
    raw = serialize_watten_game(game)
    assert raw["_watten"]["schema_version"] == 5
    assert restore_watten_json(json.dumps(raw))["_watten"] == game["_watten"]
    assert not expire_inactive_game(game)
    for bad in (None, "manual", True):
        raw["_watten"]["abort_reason"] = bad
        with pytest.raises(ValueError):
            restore_watten_json(json.dumps(raw))
    with pytest.raises(ValueError, match="room_closed"):
        admit_account(game, owners[0][0], game["_watten"].room.revision, None)
    with pytest.raises(ValueError, match="room_closed"):
        apply_runtime_action(game, owners[0][0].user_id, sessions[0].player_id,
                             native.room_command(game_id, "watten_leave", "late-leave"))
    # Simulate a restart after the terminal checkpoint committed and before
    # publication/deletion. Startup must retire it before CPU scheduling.
    games.clear()
    games.update(load_active_games())
    assert games[game_id]["_aborted"] and not games[game_id]["_completion_persisted"]
    assert asyncio.run(main._sweep_timeout_aborts()) == 1
    assert game_id not in games and game_id not in load_active_games()
    assert_unscored()


def test_socket_command_at_deadline_publishes_abort_instead_of_ack_or_rejoin(server, monkeypatch):
    game_id, owners, sessions = native.local_started(server, count_players=2)
    game = games[game_id]
    due = game["_last_activity"] + GAME_TIMEOUT
    monkeypatch.setattr(watten_runtime, "utcnow", lambda: due)
    returned = GameSocketSession(native.CapturingSocket(owners[0]), game, owners[0][0])
    assert asyncio.run(_handle_locked(returned, "rejoin_game", {
        "action": "rejoin_game", "revision": game["_watten"].room.revision, "resume": True,
        "lifecycle_revision": game["_watten"].lifecycle_revision}))
    assert returned.player_id is None and game_id not in games
    assert sessions[1].websocket.messages[-1]["scoreboard"]["abort_reason"] == "inactivity_timeout"
    assert all("watten_command" not in message for message in returned.websocket.messages)
    assert_unscored()


def test_completed_match_is_never_converted_to_timeout(server, monkeypatch):
    native.account("CompletedTimeoutOne")
    native.account("CompletedTimeoutTwo")
    match = NativeMatch(target=3, game_id="completed-timeout")
    match.ready()
    match.finish()
    game, game_id = match.game, match.game["_id"]
    persist_watten_game(game)
    games[game_id] = game
    result = game["_watten_result"]
    monkeypatch.setattr(watten_runtime, "utcnow", lambda: game["_last_activity"] + timedelta(days=30))
    assert asyncio.run(sweep_watten_games()) == 0
    assert game["_watten_result"] == result and game["_completion_persisted"] and not game["_aborted"]
    with session_scope() as db:
        assert db.scalar(select(ActiveGame.game_id).where(ActiveGame.game_id == game_id)) == game_id


def test_failed_checkpoint_deletion_retries_without_duplicate_terminal_delivery(server, monkeypatch):
    game_id, _owners, sessions = native.local_started(server, count_players=2)
    game = games[game_id]
    due = game["_last_activity"] + GAME_TIMEOUT
    monkeypatch.setattr(watten_runtime, "utcnow", lambda: due)
    scope = watten_websocket.session_scope

    def failed_scope():
        raise SQLAlchemyError("delete unavailable")

    monkeypatch.setattr(watten_websocket, "session_scope", failed_scope)
    assert asyncio.run(sweep_watten_games()) == 0
    assert games[game_id]["_aborted"] and game_id in load_active_games()
    deliveries = [len(session.websocket.messages) for session in sessions]
    monkeypatch.setattr(watten_websocket, "session_scope", scope)
    assert asyncio.run(sweep_watten_games()) == 1
    assert game_id not in games and game_id not in load_active_games()
    assert [len(session.websocket.messages) for session in sessions] == deliveries


def test_stale_process_cannot_abort_newer_gameplay_or_remove_a_durable_timeout(server, monkeypatch):
    game_id, _owners, sessions = native.local_started(server, count_players=2)
    game = games[game_id]
    stale = watten_runtime.copy_game(game)
    original = game["_last_activity"]
    now = original + timedelta(minutes=59)
    monkeypatch.setattr(watten_runtime, "utcnow", lambda: now)
    player, command = native.next_move(game_id, count())
    sender = next(item for item in sessions if item.player_id == player)
    asyncio.run(_handle_locked(sender, command["action"], command))
    now = original + GAME_TIMEOUT
    with pytest.raises(ValueError, match="stale_checkpoint"):
        expire_inactive_game(stale)
    assert not game["_aborted"] and not stale["_aborted"]
    assert not expire_inactive_game(game)
    now = game["_last_activity"] + GAME_TIMEOUT
    assert expire_inactive_game(game)
    with pytest.raises(ValueError, match="stale_checkpoint"):
        persist_watten_game(stale)
    assert load_active_games()[game_id]["_aborted"]
    assert_unscored()


@pytest.mark.parametrize("timing", ("wakeup", "policy_wait", "newer_checkpoint"))
def test_delayed_cpu_job_obeys_timeout_before_and_after_policy_without_self_cancel_or_stale_abort(server, monkeypatch, timing):
    monkeypatch.setattr(watten_runtime, "_RANDOM", SimpleNamespace(randrange=lambda _count: 0, shuffle=lambda _deck: None))
    game_id, _owners, sessions = native.local_started(server, count_players=2, cpus=(1,))
    game = games[game_id]
    runtime = game["_watten"]
    player = runtime.room.cpus[0].participant_id
    view = cpu._view(runtime, player)
    assert cpu._may_decide(view)
    deadline = game["_last_activity"] + GAME_TIMEOUT
    now = deadline if timing == "wakeup" else deadline - timedelta(microseconds=1)
    monkeypatch.setattr(watten_runtime, "utcnow", lambda: now)
    calls = []

    async def delayed_policy(*args, **kwargs):
        nonlocal now
        calls.append(True)
        turn = cpu.decide(*args, **kwargs)
        assert isinstance(turn.decision, cpu.CpuProposal)
        await asyncio.sleep(0)
        if timing == "newer_checkpoint":
            # Another process committed an actual permitted turn while this
            # policy awaited. Leave RAM stale so timeout must honor source CAS.
            candidate, *_ = watten_runtime._apply_engine_command(
                game, cpu.EngineActor(player, None), cpu.EngineCommand(**turn.decision.command_fields()))
            persist_watten_game(candidate)
        now = deadline
        return turn

    monkeypatch.setattr(cpu, "_decide_snapshot", delayed_policy)

    async def scenario():
        job = cpu._Job(game, cpu._context(runtime, view), asyncio.get_running_loop().time(), 1)
        cpu._JOBS[(game_id, player)] = job
        job.task = asyncio.create_task(cpu._run(game, player, job))
        await asyncio.wait_for(job.task, timeout=5)
        assert not job.task.cancelled() and (game_id, player) not in cpu._JOBS

    asyncio.run(scenario())
    assert calls == ([] if timing == "wakeup" else [True])
    if timing == "newer_checkpoint":
        durable = load_active_games()[game_id]
        assert not game["_aborted"] and not durable["_aborted"]
        assert durable["_watten"].engine.opportunity == runtime.engine.opportunity + 1
        assert game["_watten"].engine == runtime.engine
        assert sessions[0].websocket.messages == [] and sessions[0].websocket.closes == []
    else:
        assert game_id not in games and game_id not in load_active_games()
        assert game["_aborted"] and game["_watten"].engine == runtime.engine
        assert sessions[0].websocket.messages[-1]["scoreboard"]["abort_reason"] == "inactivity_timeout"
        assert sessions[0].websocket.closes == [(1000, None)]
    assert_unscored()


def test_delayed_review_job_retires_expired_source_without_advancing_or_cancelling_itself(server, monkeypatch):
    game, _owners, sessions = round_tests.completed_deal(server)
    runtime = game["_watten"]
    deadline = game["_last_activity"] + GAME_TIMEOUT
    monkeypatch.setattr(watten_runtime, "utcnow", lambda: deadline)
    monkeypatch.setattr(review, "utcnow", lambda: deadline)
    # Exercise the actual watcher invoked during retirement, including its
    # guard against cancelling the currently retiring review task.
    monkeypatch.setattr(review, "watch_game", round_tests.REAL_WATCH)

    async def scenario():
        job = review._Job(game, review._context(game))
        review._JOBS[game["_id"]] = job
        job.task = asyncio.create_task(review._run(game, job))
        await asyncio.wait_for(job.task, timeout=5)
        assert not job.task.cancelled() and game["_id"] not in review._JOBS

    asyncio.run(scenario())
    assert game["_id"] not in games and game["_id"] not in load_active_games()
    assert game["_aborted"] and game["_watten"].engine == runtime.engine
    for session in sessions:
        assert session.websocket.messages[-1]["scoreboard"]["abort_reason"] == "inactivity_timeout"
        assert session.websocket.closes == [(1000, None)]
    assert_unscored()
