"""Native human activity is atomic; transport, replay and CPU persistence are not play."""

import asyncio
from contextlib import contextmanager
from datetime import timedelta
from itertools import count
from unittest.mock import patch

import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError

from app import watten_runtime
from app.auth import logout
from app.database import session_scope
from app.game_activity import play_day
from app.game_state import games
from app.models import ActiveGame, User
from app.security import utcnow
from app.watten_websocket import _handle_locked
from tests.test_watten_runtime import (
    advance_to_play,
    engine_command,
    local_started,
    next_move,
    receive_opponent_bid,
)
from tests.test_watten_runtime import (
    server as runtime_server,
)

server = runtime_server


def reset_days():
    with session_scope() as db:
        db.execute(update(User).values(last_played_on=None))


def days():
    with session_scope() as db:
        return dict(db.execute(select(User.id, User.last_played_on)).all())


def perform(sessions, player, command):
    session = next(item for item in sessions if item.player_id == player)
    asyncio.run(_handle_locked(session, command["action"], command))
    return session


def prepare_action(server, kind):
    game_id, owners, sessions = local_started(server, count_players=2)
    numbers = count(100)
    game = games[game_id]
    if kind == "announce_colour":
        player, command = next_move(game_id, numbers)
        perform(sessions, player, command)
    elif kind in {"play_card", "bid", "respond"}:
        advance_to_play(game_id, sessions, numbers)
        if kind in {"bid", "respond"}:
            player, command = next_move(game_id, numbers)
            perform(sessions, player, command)
            player = game["_watten"].engine.play.current_player_id
            command = engine_command(game_id, "bid", next(numbers))
            if kind == "respond":
                perform(sessions, player, command)
    if kind == "respond":
        engine = game["_watten"].engine
        player = engine.parties.decider(1 - engine.bid_state.pending.party)
        command = engine_command(game_id, "respond", next(numbers), "hold")
    elif kind == "bid":
        player = game["_watten"].engine.play.current_player_id
        command = engine_command(game_id, "bid", next(numbers))
    else:
        player, command = next_move(game_id, numbers)
    assert command["kind"] == kind
    reset_days()
    return game_id, owners, sessions, player, command


@pytest.mark.parametrize("kind", ("announce_strike", "announce_colour", "play_card", "bid", "respond"))
def test_only_fresh_human_actor_counts_and_replay_does_not_create_next_day(server, kind):
    game_id, owners, sessions, player, command = prepare_action(server, kind)
    actor = perform(sessions, player, command)
    today = play_day(utcnow())
    assert days() == {owner[0].user_id: today if owner[0].user_id == actor.auth_identity.user_id else None
                      for owner in owners}
    with patch("app.game_activity.play_day", return_value=today + timedelta(days=1)):
        perform(sessions, player, command)
    assert days()[actor.auth_identity.user_id] == today
    with session_scope() as db:
        stored = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id))
    assert watten_runtime.restore_watten_json(stored)["_watten"] == games[game_id]["_watten"]


def test_checkpoint_and_activity_rollback_together_and_same_command_can_retry(server):
    game_id, _owners, sessions, player, command = prepare_action(server, "play_card")
    previous = games[game_id]["_watten"]
    with session_scope() as db:
        stored_before = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id))
    real_scope = watten_runtime.session_scope

    @contextmanager
    def failing_commit():
        with real_scope() as db:
            yield db
            raise SQLAlchemyError("deliberate activity/checkpoint commit failure")

    with patch.object(watten_runtime, "session_scope", failing_commit):
        with pytest.raises(SQLAlchemyError):
            perform(sessions, player, command)
    assert games[game_id]["_watten"] == previous
    assert set(days().values()) == {None}
    with session_scope() as db:
        assert db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id)) == stored_before
    actor = perform(sessions, player, command)
    assert days()[actor.auth_identity.user_id] == play_day(utcnow())


def test_ladinisch_show_inspect_delivery_and_private_advice_never_count(server):
    game_id, _owners, sessions = local_started(server, count_players=4, blind=True)
    numbers = count(100)
    reset_days()
    advance_to_play(game_id, sessions, numbers)
    assert set(days().values()) == {None}
    # Public call deliveries and partner advice change no participation day.
    for session in sessions:
        runtime = games[game_id]["_watten"]
        delivery_ids = [item.delivery_id for item in runtime.deliveries if item.participant_id == session.player_id]
        command = {"action": "watten_delivery_ack", "command_id": f"delivery-{session.player_id}",
                   "revision": runtime.room.revision, "lifecycle_revision": runtime.lifecycle_revision,
                   "delivery_ids": delivery_ids}
        perform(sessions, session.player_id, command)
    session = sessions[0]
    receive_opponent_bid(game_id, sessions, numbers, session.player_id)
    state = games[game_id]["_watten"].engine
    party = state.parties.party_of(session.player_id)
    decider = state.parties.decider(party)
    session = next(item for item in sessions
                   if state.parties.party_of(item.player_id) == party and item.player_id != decider)
    # Bidding is genuine play; isolate the later private/transport operations.
    reset_days()
    perform(sessions, session.player_id, engine_command(game_id, "partner_feedback", next(numbers), "good", session.player_id))
    asyncio.run(_handle_locked(session, "get_state", {"action": "get_state"}))
    assert set(days().values()) == {None}


def test_stale_socket_or_rejected_card_does_not_count(server):
    game_id, owners, sessions, player, command = prepare_action(server, "play_card")
    bad = {**command, "command_id": "invalid-card", "value": "not-a-card"}
    with pytest.raises(ValueError):
        perform(sessions, player, bad)
    assert set(days().values()) == {None}
    session = next(item for item in sessions if item.player_id == player)
    owner = next(owner for owner in owners if owner[0].user_id == session.auth_identity.user_id)
    logout(owner[1].split("=", 1)[1])
    asyncio.run(_handle_locked(session, command["action"], command))
    assert set(days().values()) == {None}
    assert session.websocket.closes[-1][0] == 1008


def test_default_checkpoint_or_forged_nonhuman_actor_never_counts(server):
    game_id, _owners, _sessions = local_started(server, count_players=2, cpus=(1,))
    reset_days()
    game = games[game_id]
    watten_runtime.persist_watten_game(game)
    assert set(days().values()) == {None}
    cpu = game["_watten"].room.cpus[0]
    for forged in ((True, cpu.participant_id), (1, cpu.participant_id), (999999, "not-a-member")):
        with pytest.raises(ValueError, match="watten_actor_not_bound"):
            watten_runtime.persist_watten_game(game, human_actor=forged)
    assert set(days().values()) == {None}
