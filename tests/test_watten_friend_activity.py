"""Accepted native starts, private recipient consent and local-only live DTOs."""

import asyncio
import json
from copy import deepcopy
from datetime import timedelta

import pytest
from httpx import Headers
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from starlette.websockets import WebSocketDisconnect

from app import friend_activity as friends
from app import watten_cpu_runtime as runner
from app import watten_websocket as transport
from app.auth import logout
from app.database import session_scope
from app.game_state import games
from app.game_ws_session import GameSocketSession
from app.models import ActiveGame, PushInviteAllowedSender, User
from app.security import utcnow
from app.watten_engine import EngineActor, EngineCommand
from app.watten_runtime import (
    _apply_engine_command,
    admit_account,
    apply_runtime_action,
    persist_watten_game,
    restore_watten_json,
    serialize_watten_game,
)
from tests import test_watten_runtime as native

server = native.server
KEYS = {"schema_version", "id", "game_id", "game_type", "players", "player_count", "mode", "started_at", "expires_at", "spectator_url"}


@pytest.fixture(autouse=True)
def isolated_hub(monkeypatch):
    monkeypatch.setattr(friends, "friend_activity_hub", friends.FriendActivityHub())
    # This package tests the manual-start publisher; do not start CPU timers
    # or load the shared machine with a policy match behind a focused test.
    monkeypatch.setattr(runner, "watch_game", lambda _game: None)


def select_friend(viewer, player):
    with session_scope() as db:
        db.add(PushInviteAllowedSender(recipient_user_id=viewer[0].user_id, sender_user_id=player[0].user_id, created_at=utcnow()))


def waiting(server, count_players=2, cpus=(), password=None):
    owners = [native.account(f"StartParticipant{seat}") for seat in range(count_players - len(cpus))]
    game_id = native.create_game(server, owners[0], count=count_players, cpus=cpus, password=password)
    game, sessions = games[game_id], []
    for seat, owner in zip((seat for seat in range(count_players) if seat not in cpus), owners, strict=True):
        candidate, player = admit_account(game, owner[0], game["_watten"].room.revision, password)
        game.update(candidate)
        socket = native.CapturingSocket(owner)
        next(item for item in game["_players"] if item["id"] == player)["ws"] = socket
        sessions.append(GameSocketSession(socket, game, owner[0], player_id=player))
        candidate, *_ = apply_runtime_action(game, owner[0].user_id, player,
            native.room_command(game_id, "watten_take_seat", f"seat-{seat}", seat=seat, team=seat % 2 if count_players == 4 else None))
        persist_watten_game(candidate)
        game.update(candidate)
    assert not game["_started"] and game["_watten"].engine is None
    return game, owners, sessions


def act(session, data):
    return asyncio.run(transport.handle_watten_gameplay_action(session, data["action"], data))


def listen(owner, *, native_context=True):
    socket = native.CapturingSocket(owner)
    friends.friend_activity_hub.connect(socket, owner[0].user_id, context="watten" if native_context else None)
    return socket


def stored(game):
    with session_scope() as db:
        return db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"]))


@pytest.mark.parametrize(("count_players", "cpus"), ((2, ()), (3, (2,)), (4, (2, 3))))
def test_manual_start_is_after_commit_once_and_native_2_3_4_dto_never_counts_duplicate_transport_or_cpu_as_friend(server, count_players, cpus):
    game, owners, sessions = waiting(server, count_players, cpus)
    viewer = native.account("WatchingSelectedFriend")
    select_friend(viewer, owners[0])
    devices = [listen(viewer), listen(viewer)]
    legacy = listen(viewer, native_context=False)
    assert all(not device.messages for device in devices)
    observed = []

    async def after_commit(payload):
        persisted = restore_watten_json(stored(game))
        assert persisted["_started"] and persisted["_watten"].engine is not None
        observed.append(deepcopy(payload))
        devices[0].messages.append(payload)

    devices[0].send_json = after_commit
    command = native.room_command(game["_id"], "watten_start", "manual-start")
    act(sessions[0], command)
    assert len(observed) == len(devices[1].messages) == 1 and legacy.messages == []
    dto = observed[0]["friend_activity"]
    assert set(dto) == KEYS and dto["schema_version"] == 1 and dto["game_type"] == "watten"
    assert dto["players"] == [{"username": owners[0][0].username}]
    assert dto["mode"] == str(count_players) and dto["player_count"] == count_players
    assert dto["spectator_url"] == f"/watten/spiel/{game['_id']}/zuschauen"
    assert not {"account_id", "user_id", "hand", "call", "cards", "stock", "feedback", "password", "recipe"} & set(dto)
    assert devices[1].messages == observed
    doubled_transport = {**game, "_players": game["_players"] * 2}
    projection = friends._recipient_payload(doubled_transport, viewer[0], now=utcnow(), connection=devices[1])
    assert projection == observed[0]
    act(sessions[0], command)
    assert len(observed) == len(devices[1].messages) == 1
    serialized = serialize_watten_game(game)
    assert "_friend_activity_announced" not in serialized
    restored = restore_watten_json(json.dumps(serialized))
    assert "_friend_activity_announced" not in restored
    games[game["_id"]] = restored
    bound = next(item for item in restored["_players"] if item["id"] == sessions[0].player_id)
    bound["ws"] = sessions[0].websocket
    resumed = GameSocketSession(bound["ws"], restored, owners[0][0], player_id=bound["id"])
    act(resumed, command)
    assert len(observed) == len(devices[1].messages) == 1


def test_failed_start_transaction_cannot_publish_or_install_and_retry_publishes_once(server, monkeypatch):
    game, owners, sessions = waiting(server, cpus=(1,))
    viewer = native.account("FailedStartViewer")
    select_friend(viewer, owners[0])
    socket = listen(viewer)
    original, before = transport.persist_watten_game, stored(game)
    command = native.room_command(game["_id"], "watten_start", "retry-same-start")

    def fail(_candidate, *, human_actor):
        assert human_actor is None  # Starting a table is not a played action.
        raise SQLAlchemyError("deterministic checkpoint failure")

    monkeypatch.setattr(transport, "persist_watten_game", fail)
    with pytest.raises(SQLAlchemyError, match="checkpoint failure"):
        act(sessions[0], command)
    assert socket.messages == [] and not game["_started"] and stored(game) == before
    assert "_friend_activity_announced" not in game
    monkeypatch.setattr(transport, "persist_watten_game", original)
    act(sessions[0], command)
    assert len(socket.messages) == 1
    # A later accepted transition, including a server-owned CPU command, has
    # no start publisher. This uses the same command path as the CPU runner.
    player, move = native.next_move(game["_id"], iter(range(100)))
    if player == sessions[0].player_id:
        act(sessions[0], move)
    else:
        fields = {key: move[key] for key in ("command_id", "deal_id", "opportunity", "phase", "kind", "value", "private_opportunity")}
        candidate, *_ = _apply_engine_command(game, EngineActor(player, None), EngineCommand(**fields))
        persist_watten_game(candidate)
        game.update(candidate)
    assert len(socket.messages) == 1


def test_recipient_must_opt_in_select_friend_be_active_and_not_be_a_participant(server):
    game, owners, sessions = waiting(server)
    viewers = [native.account(name) for name in ("NoSelection", "OptedOut", "InactiveViewer", "ConsentingViewer")]
    for viewer in viewers[1:]:
        select_friend(viewer, owners[0])
    select_friend(owners[1], owners[0])
    with session_scope() as db:
        db.get(User, viewers[1][0].user_id).friend_activity_enabled = False
        db.get(User, viewers[2][0].user_id).is_active = False
        # Display names are resolved from current active accounts, not the
        # frozen game's historical roster label.
        db.get(User, owners[0][0].user_id).username = "RenamedSelectedFriend"
    sockets = [listen(viewer) for viewer in (*viewers, owners[1])]
    act(sessions[0], native.room_command(game["_id"], "watten_start", "consent-start"))
    assert [len(socket.messages) for socket in sockets] == [0, 0, 0, 1, 0]
    assert sockets[3].messages[0]["friend_activity"]["players"] == [{"username": "RenamedSelectedFriend"}]


def test_protected_table_and_stale_start_never_publish_or_disclose_secret(server):
    game, owners, sessions = waiting(server, password="Fresh-private-code")
    viewer = native.account("ProtectedFriendViewer")
    select_friend(viewer, owners[0])
    socket = listen(viewer)
    act(sessions[0], native.room_command(game["_id"], "watten_start", "protected-start"))
    assert socket.messages == []
    assert friends._recipient_payload(game, viewer[0], now=utcnow(), connection=socket) is None
    public = {**game, "_passphrase": None}
    assert friends._recipient_payload(public, viewer[0], now=utcnow() + timedelta(seconds=61), connection=socket) is None
    assert friends._recipient_payload(public, viewer[0], now=utcnow() - timedelta(seconds=1), connection=socket) is None
    assert friends._recipient_payload(public, viewer[0], now=utcnow()) is None  # Missing connection fails closed.


def test_timed_delivery_rechecks_revoked_late_socket_and_changed_selection_before_send(server):
    game, owners, _sessions = waiting(server)
    candidate, *_ = apply_runtime_action(game, owners[0][0].user_id, game["_players"][0]["id"],
                                        native.room_command(game["_id"], "watten_start", "prepare"))
    persist_watten_game(candidate)
    game.update(candidate)
    viewers = [native.account(name) for name in ("FirstDelivery", "RevokedBeforeSend", "SelectionRemovedBeforeSend")]
    for viewer in viewers:
        select_friend(viewer, owners[0])
    sockets = [listen(viewer) for viewer in viewers]

    async def revoke_and_remove(payload):
        logout(viewers[1][1].split("=", 1)[1])
        with session_scope() as db:
            db.delete(db.get(PushInviteAllowedSender, (viewers[2][0].user_id, owners[0][0].user_id)))
        sockets[0].messages.append(payload)

    sockets[0].send_json = revoke_and_remove
    asyncio.run(friends.friend_activity_hub.publish_start(game))
    assert [len(socket.messages) for socket in sockets] == [1, 0, 0]


@pytest.mark.parametrize(("site", "host", "flag"), (
    (native.LOCAL, "localhost:8127", "0"), ("https://zockdiewandan.online", "localhost:8127", "1"),
    (native.LOCAL, "zockdiewandan.online", "1"), (native.LOCAL, "watten.zockdiewandan.online", "1"),
    (native.LOCAL, "localhost.evil.invalid", "1"),
))
def test_native_socket_gate_precedes_auth_db_work(server, monkeypatch, site, host, flag):
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", site)
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", flag)

    def forbidden(*_args, **_kwargs):
        pytest.fail("Closed native subscriber must not read auth state")

    monkeypatch.setattr(friends, "resolve_session", forbidden)
    with pytest.raises(WebSocketDisconnect) as caught:
        with server.websocket_connect("ws://localhost:8127/ws/friend-activity?context=watten",
                                      headers={"host": host, "x-forwarded-host": "localhost:8127"}):
            pass
    assert caught.value.code == 1008


def test_real_native_subscription_expected_account_and_live_only_reconnect(server):
    game, owners, sessions = waiting(server, count_players=4)
    viewer, wrong = native.account("RealSocketViewer"), native.account("OtherMountedAccount")
    select_friend(viewer, owners[0])
    url = f"ws://localhost:8127/ws/friend-activity?context=watten&expected_account_id={viewer[0].user_id}"
    for headers, target in (
        ({"Cookie": wrong[1]}, url), ({"Cookie": viewer[1]}, url + "&expected_account_id=true"),
        (Headers([("host", "localhost:8127"), ("host", "evil.invalid"), ("cookie", viewer[1])]), url),
    ):
        with pytest.raises(WebSocketDisconnect) as caught:
            with server.websocket_connect(target, headers=headers):
                pass
        assert caught.value.code == 1008
    with server.websocket_connect(url, headers={"Cookie": viewer[1]}) as socket:
        assert socket.receive_json() == {"friend_activity_ready": {"viewer_id": viewer[0].user_id, "enabled": True}}
        act(sessions[0], native.room_command(game["_id"], "watten_start", "real-start"))
        dto = socket.receive_json()["friend_activity"]
        assert set(dto) == KEYS and dto["mode"] == "4"
    with server.websocket_connect(url, headers={"Cookie": viewer[1]}) as reconnect:
        assert reconnect.receive_json()["friend_activity_ready"]["enabled"] is True
        reconnect.send_json({"action": "ping"})
        assert reconnect.receive_json() == {"pong": True}  # No historical start replay.


def test_native_recipient_receives_explicit_safe_suite_route_but_legacy_keeps_its_payload(server, monkeypatch):
    monkeypatch.setenv("ROLLTHEDICE_ZILCH_ACCESS_MODE", "public")
    viewer, selected = native.account("NativeSuiteViewer"), native.account("SelectedSuiteFriend")
    select_friend(viewer, selected)
    native_socket, legacy_socket = listen(viewer), listen(viewer, native_context=False)
    for product, prefix in (("zdwa", ""), ("zilch", "/zilch"), ("hausdepp", "/hausdepp")):
        game = {"_id": f"safe-{product}", "_game_type": product, "_started": True,
                "_started_at": utcnow().isoformat(), "_mode": "2", "_expected": 2, "_play_mode": "multiplayer",
                "_players": [{"id": "friend", "user_id": selected[0].user_id}, {"id": "other", "name": "Other human"}]}
        asyncio.run(friends.friend_activity_hub.publish_start(game))
        assert legacy_socket.messages[-1]["friend_activity"]["players"] == [{"id": selected[0].user_id, "username": selected[0].username}]
        dto = native_socket.messages[-1]["friend_activity"]
        assert set(dto) == KEYS and dto["players"] == [{"username": selected[0].username}]
        assert dto["spectator_url"] == f"{prefix}/spiel/safe-{product}/zuschauen"
        assert "user_id" not in json.dumps(dto)
