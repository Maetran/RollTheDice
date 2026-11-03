"""Native telemetry counts committed transitions, never safe command replays."""

import asyncio
from itertools import count

import pytest
from sqlalchemy.exc import SQLAlchemyError

from app import watten_http, watten_websocket
from app.game_ws_session import GameSocketSession
from tests import test_watten_runtime as native

server = native.server


def test_watten_server_events_follow_successful_creation_membership_and_nonreplayed_actions(server, monkeypatch):
    calls = []
    def record(*args):
        calls.append(args)
    monkeypatch.setattr(watten_http, "record_game_action", record)
    monkeypatch.setattr(watten_websocket, "record_game_action", record)
    owners = (native.account("AnalyticsHost"), native.account("AnalyticsGuest"))
    game_id = native.create_game(server, owners[0])
    game = native.games[game_id]
    assert calls == [("watten", "game_created", "2")]
    # Creation durably binds the host. Opening its socket is a reconnect;
    # the guest below is the one genuinely new account membership.
    assert {member.account_id for member in game["_watten"].room.members} == {owners[0][0].user_id}
    sessions = []

    async def scenario():
        numbers = count()
        for owner in owners:
            session = GameSocketSession(native.CapturingSocket(owner), game, owner[0])
            await watten_websocket._handle_locked(session, "join_game", {
                "action": "join_game", "revision": game["_watten"].room.revision})
            sessions.append(session)
            assert any(member.account_id == owner[0].user_id for member in game["_watten"].room.members)
            expected_joins = 0 if owner is owners[0] else 1
            assert calls.count(("watten", "join_game", "2")) == expected_joins
        assert {member.account_id for member in game["_watten"].room.members} == {owner[0].user_id for owner in owners}
        assert calls.count(("watten", "join_game", "2")) == 1
        replacement = GameSocketSession(native.CapturingSocket(owners[0]), game, owners[0][0])
        await watten_websocket._handle_locked(replacement, "rejoin_game", {
            "action": "rejoin_game", "revision": game["_watten"].room.revision})
        sessions[0] = replacement
        assert calls.count(("watten", "join_game", "2")) == 1
        for seat, session in enumerate(sessions):
            await watten_websocket._handle_locked(session, "watten_take_seat", native.room_command(
                game_id, "watten_take_seat", next(numbers), seat=seat, team=None))
        start = native.room_command(game_id, "watten_start", next(numbers))
        await watten_websocket._handle_locked(sessions[0], "watten_start", start)
        await watten_websocket._handle_locked(sessions[0], "watten_start", start)
        assert calls.count(("watten", "start_game", "2")) == 1
        player, command = native.next_move(game_id, numbers)
        actor = next(session for session in sessions if session.player_id == player)
        before = len(calls)
        with monkeypatch.context() as temporary:
            temporary.setattr(watten_websocket, "persist_watten_game", lambda *_args, **_kwargs: (_ for _ in ()).throw(SQLAlchemyError("unavailable")))
            with pytest.raises(SQLAlchemyError):
                await watten_websocket._handle_locked(actor, "watten_command", command)
        assert len(calls) == before
        await watten_websocket._handle_locked(actor, "watten_command", command)
        await watten_websocket._handle_locked(actor, "watten_command", command)
        assert calls.count(("watten", "choose_contract", "2")) == 1
        assert all(len(call) == 3 and call[0] == "watten" and call[2] == "2" for call in calls)

    asyncio.run(scenario())
