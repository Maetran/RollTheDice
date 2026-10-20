"""Public native conversation: nonce, privacy, phases and fresh socket authority."""

import asyncio
import json
from itertools import count

import pytest
from sqlalchemy import select

from app import watten_social as social
from app.auth import login, logout
from app.database import session_scope
from app.game_ws_session import GameSocketSession
from app.models import ActiveGame, User
from app.watten_engine import gestrichen_players
from app.watten_runtime import (
    game_lock,
    persist_watten_game,
    restore_watten_json,
    serialize_watten_game,
    snapshot_watten,
)
from app.watten_websocket import handle_watten_gameplay_action
from tests import test_watten_runtime as native
from tests.test_watten_match_evidence import NativeMatch
from tests.test_watten_progression_store import counts

server = native.server


def call(session, data):
    asyncio.run(handle_watten_gameplay_action(session, data["action"], data))


def last(session, key):
    return next(message[key] for message in reversed(session.websocket.messages) if key in message)


def history(session):
    call(session, {"action": "watten_social_history"})
    return last(session, "watten_social_history")


def message(stream, *, nonce=None, text="Public hello"):
    return {"action": "watten_chat_message", "channel_id": stream["channel_id"],
            "nonce": stream["next_nonce"] if nonce is None else nonce, "text": text}


def public_state(game):
    with session_scope() as db:
        stored = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"]))
        journal = counts(db)
    return snapshot_watten(game), serialize_watten_game(game), stored, journal


def attach(game, owners):
    sessions = []
    for owner, record in zip(owners, game["_players"]):
        record["ws"] = native.CapturingSocket(owner)
        sessions.append(GameSocketSession(record["ws"], game, owner[0], player_id=record["id"]))
    return sessions


def test_public_event_exact_allowlist_member_spectator_and_no_game_or_db_effect(server):
    game_id, owners, sessions = native.local_started(server, count_players=2)
    game, sender = native.games[game_id], sessions[0]
    observer = native.account("ActualSocialSpectator")
    observer_socket = native.CapturingSocket(observer)
    watcher = GameSocketSession(observer_socket, game, observer[0])
    call(watcher, {"action": "spectate_game", "expected_account_id": observer[0].user_id})
    for session in (*sessions, watcher):
        session.websocket.messages.clear()
    before = public_state(game)
    stream = history(sender)
    payload = message(stream, text="<img onerror=alert(1)> is plain text")
    call(sender, payload)
    event = last(sender, "watten_social_event")["event"]
    assert set(event) == {"id", "type", "sender_id", "display_name", "role", "text", "time"}
    assert event["type"] == "chat" and event["sender_id"] == sender.player_id and event["display_name"] == owners[0][0].username
    assert event["text"] == payload["text"] and event["role"] == "member"
    assert last(sessions[1], "watten_social_event")["event"] == last(watcher, "watten_social_event")["event"] == event
    assert last(sender, "watten_social_ack")["event_id"] == event["id"]
    assert all("scoreboard" not in item for session in (*sessions, watcher) for item in session.websocket.messages)
    stream = history(watcher)
    call(watcher, {"action": "watten_send_emoji", "channel_id": stream["channel_id"], "nonce": 1, "emoji": "👍"})
    watched = last(sender, "watten_social_event")["event"]
    assert watched["role"] == "spectator" and watched["sender_id"] == watcher.spectator_id and watched["emoji"] == "👍"
    assert set(watched) == {"id", "type", "sender_id", "display_name", "role", "emoji", "time"}
    assert all(key not in json.dumps(watched) for key in ('"user_id"', '"account_id"', '"hand"', '"call"', '"feedback"', '"seat"'))
    assert public_state(game) == before


@pytest.mark.parametrize("phase", ("strike", "inspection", "bid", "gestrichen", "paused", "finished"))
def test_public_communication_never_consumes_gameplay_opportunity_in_any_phase(server, phase):
    players = 4 if phase == "inspection" else 2
    owners = [native.account(f"PhaseSocial{index}") for index in range(players)]
    match = NativeMatch(players, target=3, determination="ladinisch" if phase == "inspection" else "normal", blind=phase == "inspection")
    if phase == "inspection":
        for seat in sorted(match.engine.inspectors):
            match.act(match.engine.recipe.seats[seat], "show_ready")
        assert match.engine.phase == "inspection"
    elif phase != "strike":
        match.ready()
        if phase == "bid":
            match.card()
            match.act(match.engine.play.current_player_id, "bid")
            assert match.engine.bid_state.pending is not None
        elif phase == "gestrichen":
            while match.engine.phase == "play":
                match.card()
            assert match.engine.phase == "deal_complete"
            match.next_deal()
            match.ready()
            assert gestrichen_players(match.engine)
        elif phase == "paused":
            match.room("watten_leave")
            assert match.runtime.absent
        elif phase == "finished":
            match.finish()
    persist_watten_game(match.game, creating=True)
    sessions = attach(match.game, owners)
    before = public_state(match.game)
    engine = match.engine
    stream = history(sessions[0])
    call(sessions[0], message(stream))
    assert last(sessions[0], "watten_social_ack")["next_nonce"] == 2
    assert match.engine is engine and public_state(match.game) == before


def test_nonce_replay_conflict_rate_and_bounded_history_never_republish_or_evict_other_actors(server, monkeypatch):
    game_id, _owners, sessions = native.local_started(server, count_players=2)
    game = native.games[game_id]
    clock = [1000.0]
    monkeypatch.setattr(social.time, "monotonic", lambda: clock[0])
    stream, other = history(sessions[0]), history(sessions[1])
    first = message(stream, nonce=1)
    call(sessions[0], first)
    event_id = last(sessions[0], "watten_social_ack")["event_id"]
    sessions[1].websocket.messages.clear()
    call(sessions[0], first)
    assert last(sessions[0], "watten_social_ack")["replayed"] and not sessions[1].websocket.messages
    call(sessions[0], {**first, "text": "changed same nonce"})
    assert last(sessions[0], "watten_social_error")["code"] == "watten_social_nonce_conflict"
    for nonce in range(2, 6):
        call(sessions[0], message(stream, nonce=nonce))
    call(sessions[0], message(stream, nonce=6))
    assert last(sessions[0], "watten_social_error")["code"] == "watten_social_rate_limited"
    assert history(sessions[0])["next_nonce"] == 6
    # Other accounts' independent acknowledgements/rates do not change ours.
    call(sessions[1], message(other))
    for nonce in range(6, 106):
        clock[0] += 31
        call(sessions[0], message(stream, nonce=nonce))
        assert last(sessions[0], "watten_social_ack")["nonce"] == nonce
    state = game[social._CACHE_KEY]
    assert len(state.events) == 100 and len(state.actors[sessions[0].auth_identity.user_id].acks) == 64
    call(sessions[0], first)
    assert last(sessions[0], "watten_social_error")["code"] == "watten_social_stale_nonce"
    assert len(history(sessions[0])["events"]) == 100
    assert all(item["id"] != event_id for item in history(sessions[0])["events"])


@pytest.mark.parametrize("damage", ("bool_nonce", "gap", "spoof", "long", "blank", "control", "emoji"))
def test_strict_social_messages_cannot_spoof_or_advance_nonce_when_invalid(server, damage):
    _game_id, _owners, sessions = native.local_started(server, count_players=2)
    session = sessions[0]
    stream = history(session)
    data = message(stream)
    if damage == "bool_nonce":
        data["nonce"] = True
    elif damage == "gap":
        data["nonce"] = 2
    elif damage == "spoof":
        data["sender_id"] = sessions[1].player_id
    elif damage == "long":
        data["text"] = "x" * 401
    elif damage == "blank":
        data["text"] = "   "
    elif damage == "control":
        data["text"] = "bad\x00text"
    else:
        data = {"action": "watten_send_emoji", "channel_id": stream["channel_id"], "nonce": 1, "emoji": "🂡"}
    call(session, data)
    assert last(session, "watten_social_error")["code"].startswith("watten_social_")
    assert history(session)["events"] == [] and history(session)["next_nonce"] == 1
    assert not any("watten_social_event" in message for message in sessions[1].websocket.messages)


def test_channels_expire_without_reopening_old_nonces_and_actor_cache_is_bounded(server, monkeypatch):
    _game_id, _owners, sessions = native.local_started(server, count_players=2)
    clock = [1000.0]
    monkeypatch.setattr(social.time, "monotonic", lambda: clock[0])
    stream = history(sessions[0])
    call(sessions[0], message(stream))
    monkeypatch.setattr(social, "_ACTOR_LIMIT", 1)
    call(sessions[1], {"action": "watten_social_history"})
    assert last(sessions[1], "watten_social_error")["code"] == "watten_social_busy"
    clock[0] += 301
    newer = history(sessions[0])
    assert newer["channel_id"] != stream["channel_id"] and newer["next_nonce"] == 1
    assert len(newer["events"]) == 1
    call(sessions[0], message(stream))
    assert last(sessions[0], "watten_social_error")["code"] == "watten_social_stale_channel"
    assert len(history(sessions[0])["events"]) == 1


def test_current_moderation_readonly_mute_exclusion_and_new_names_are_enforced(server):
    _game_id, owners, sessions = native.local_started(server, count_players=2)
    stream = history(sessions[0])
    with session_scope() as db:
        user = db.get(User, owners[0][0].user_id)
        user.username, user.lobby_chat_muted, user.lobby_chat_enabled = "CurrentSocialName", True, False
    readonly = history(sessions[0])
    assert not readonly["can_send"]
    call(sessions[0], message(stream))
    assert last(sessions[0], "watten_social_error")["code"] == "watten_social_muted"
    with session_scope() as db:
        db.get(User, owners[0][0].user_id).lobby_chat_muted = False
    call(sessions[0], message(stream))
    assert last(sessions[1], "watten_social_event")["event"]["display_name"] == "CurrentSocialName"
    with session_scope() as db:
        db.get(User, owners[0][0].user_id).lobby_chat_excluded = True
    call(sessions[0], {"action": "watten_social_history"})
    assert last(sessions[0], "watten_social_error")["code"] == "watten_social_excluded"
    sessions[0].websocket.messages.clear()
    other = history(sessions[1])
    call(sessions[1], message(other))
    assert not sessions[0].websocket.messages


def test_restart_has_no_history_and_unbound_or_cpu_forged_records_cannot_publish(server):
    game_id, owners, sessions = native.local_started(server, count_players=2)
    game = native.games[game_id]
    stream = history(sessions[0])
    call(sessions[0], message(stream, text="UNPERSISTED PUBLIC CHAT"))
    raw = json.dumps(serialize_watten_game(game))
    assert "UNPERSISTED PUBLIC CHAT" not in raw and social._CACHE_KEY not in raw
    restored = restore_watten_json(raw)
    fresh = attach(restored, owners)
    assert history(fresh[0])["events"] == []
    stranger = native.account("UnadmittedSocial")
    unaffiliated = GameSocketSession(native.CapturingSocket(stranger), game, stranger[0])
    call(unaffiliated, {"action": "watten_social_history"})
    assert unaffiliated.websocket.closes[-1][0] == 1008
    # A forged transport record cannot turn a server-owned CPU into a human.
    game["_players"].append({"id": "p999", "name": "CPU", "user_id": owners[0][0].user_id, "ws": fresh[0].websocket})
    fake_cpu = GameSocketSession(fresh[0].websocket, game, owners[0][0], player_id="p999")
    call(fake_cpu, {"action": "watten_social_history"})
    assert not any("watten_social_event" in item for item in fake_cpu.websocket.messages)
    assert len(game[social._CACHE_KEY].events) == 1


def test_revocation_during_awaited_fanout_suppresses_late_peer_event_and_sender_ack(server, monkeypatch):
    _game_id, owners, sessions = native.local_started(server, count_players=3)
    stream = history(sessions[0])
    for session in sessions:
        session.websocket.messages.clear()
    original = sessions[0].websocket.send_json

    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()

        async def held(message):
            entered.set()
            await release.wait()
            await original(message)

        monkeypatch.setattr(sessions[0].websocket, "send_json", held)
        task = asyncio.create_task(handle_watten_gameplay_action(sessions[0], "watten_chat_message", message(stream)))
        await asyncio.wait_for(entered.wait(), timeout=2)
        logout(owners[0][1].split("=", 1)[1])
        logout(owners[2][1].split("=", 1)[1])
        login(native.request_for(host="localhost:8127", origin=native.LOCAL), owners[1][0].username,
              "runtime-account-password-123")
        release.set()
        await asyncio.wait_for(task, timeout=2)

    asyncio.run(scenario())
    assert not any("watten_social_ack" in item for item in sessions[0].websocket.messages)
    assert not sessions[2].websocket.messages and sessions[2].websocket.closes[-1][0] == 1008
    assert last(sessions[1], "watten_social_event")["event"]["text"] == "Public hello"


def test_incoming_auth_is_fresh_after_waiting_for_actual_table_lock(server):
    game_id, owners, sessions = native.local_started(server, count_players=2)
    stream = history(sessions[0])
    before = public_state(native.games[game_id])

    async def scenario():
        lock = game_lock(sessions[0].game)
        await lock.acquire()
        task = asyncio.create_task(handle_watten_gameplay_action(sessions[0], "watten_chat_message", message(stream)))
        await asyncio.sleep(0)
        logout(owners[0][1].split("=", 1)[1])
        lock.release()
        await asyncio.wait_for(task, timeout=2)

    asyncio.run(scenario())
    assert sessions[0].websocket.closes[-1][0] == 1008
    assert not native.games[game_id][social._CACHE_KEY].events
    assert public_state(native.games[game_id]) == before


def test_private_partner_feedback_never_enters_public_history(server):
    game_id, _owners, sessions = native.local_started(server, count_players=4)
    numbers = count()
    native.advance_to_play(game_id, sessions, numbers)
    native.receive_opponent_bid(game_id, sessions, numbers, sessions[0].player_id)
    history(sessions[0])
    call(sessions[0], native.engine_command(game_id, "partner_feedback", "private-advice", "good", sessions[0].player_id))
    assert history(sessions[0])["events"] == history(sessions[1])["events"] == []


def test_real_websocket_rejoin_reads_live_history_but_never_receives_gameplay_frames_for_chat(server):
    from contextlib import ExitStack

    owner = native.account("WireSocialOwner")
    game_id = native.create_game(server, owner)
    with ExitStack() as stack:
        socket, _player = native.join(server, stack, game_id, owner)
        socket.send_json({"action": "watten_social_history"})
        stream = socket.receive_json()["watten_social_history"]
        socket.send_json(message(stream, text="Actual websocket chat"))
        event = socket.receive_json()["watten_social_event"]["event"]
        ack = socket.receive_json()["watten_social_ack"]
        assert ack["event_id"] == event["id"] and not ack["replayed"]
    with ExitStack() as stack:
        socket, _player = native.join(server, stack, game_id, owner)
        socket.send_json({"action": "watten_social_history"})
        returned = socket.receive_json()["watten_social_history"]
        assert returned["events"] == [event] and returned["channel_id"] == stream["channel_id"]
        socket.send_json(message(stream, text="Actual websocket chat"))
        repeated = socket.receive_json()
        assert set(repeated) == {"watten_social_ack"} and repeated["watten_social_ack"]["replayed"]


def test_social_does_not_expire_or_extend_waiting_deadline_or_start_cpu_observation(server, monkeypatch):
    from dataclasses import replace
    from datetime import timedelta

    from app import watten_cpu_runtime as runner
    from app.security import utcnow

    owner = native.account("WaitingSocialOwner")
    match = NativeMatch(2, cpus=(1,), start=False)
    match.game["_watten"] = replace(match.runtime, room=replace(match.runtime.room, wait_expires_at=utcnow() - timedelta(seconds=1)))
    persist_watten_game(match.game, creating=True)
    session = attach(match.game, [owner])[0]
    before = public_state(match.game)
    monkeypatch.setattr(runner, "watch_game", lambda *_args: pytest.fail("social scheduled a CPU/game action"))
    monkeypatch.setattr(runner, "observe_cpu_memories", lambda *_args: pytest.fail("CPU observed public conversation"))
    stream = history(session)
    call(session, message(stream))
    assert match.runtime.room.status == "waiting" and match.runtime.engine is None
    assert public_state(match.game) == before
    # Even a forged generic transport record for an actual CPU cannot grant
    # the CPU human sender authority or expose the public log to its policy.
    cpu = match.runtime.room.cpus[0]
    fake_socket = native.CapturingSocket(owner)
    match.game["_players"].append({"id": cpu.participant_id, "name": "CPU", "user_id": owner[0].user_id, "ws": fake_socket})
    fake = GameSocketSession(fake_socket, match.game, owner[0], player_id=cpu.participant_id)
    call(fake, {"action": "watten_social_history"})
    assert not fake_socket.messages
    assert len(match.game[social._CACHE_KEY].events) == 1
