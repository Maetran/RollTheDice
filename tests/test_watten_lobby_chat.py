"""Local-only lobby transport, fixed audiences and identifier-free Watten DTOs."""

import asyncio
from datetime import datetime, timedelta

import pytest
from httpx import Headers as HTTPHeaders
from sqlalchemy import delete, func, select
from starlette.datastructures import Headers, QueryParams
from starlette.websockets import WebSocketDisconnect

from app import lobby_chat as chat
from app import main
from app.auth import logout
from app.database import session_scope
from app.models import LobbyChatMessage, LobbyChatMessageRecipient, User
from app.security import utcnow
from tests import test_watten_runtime as native

server = native.server
PUBLIC = {"id", "kind", "sender", "is_admin", "game_type", "sent_at", "text"}


@pytest.fixture(autouse=True)
def fresh_hub(monkeypatch):
    monkeypatch.setattr(main, "lobby_chat_hub", chat.LobbyChatHub())


def url(owner, context="watten"):
    return f"ws://localhost:8127/ws/lobby-chat?context={context}&expected_account_id={owner[0].user_id}"


def probe(socket):
    socket.send_json({"action": "probe"})
    frames = []
    while True:
        frame = socket.receive_json()
        if frame == {"error": "lobby_chat_action_unknown"}:
            return frames
        frames.append(frame)


def test_real_local_shared_audience_and_id_free_live_history_without_late_join_leak(server):
    owner, peer, late = (native.account(name) for name in ("WattenLobbyOwner", "SuiteLobbyPeer", "LateLobbyPeer"))
    assert chat.lobby_chat_context("watten") == "watten"
    with server.websocket_connect(url(owner), headers={"cookie": owner[1]}) as watten:
        with server.websocket_connect(url(peer, "zilch"), headers={"cookie": peer[1]}) as zilch:
            assert probe(watten) == probe(zilch) == []
            zilch.send_json({"action": "lobby_chat_message", "text": "Shared hello"})
            legacy = zilch.receive_json()["lobby_chat"]
            safe = watten.receive_json()["lobby_chat"]
            assert legacy["user_id"] == peer[0].user_id
            assert set(safe) == PUBLIC and safe == {key: value for key, value in legacy.items() if key != "user_id"}
            watten.send_json({"action": "lobby_chat_message", "text": "<b>Plain Watten</b>", "game_type": "zdwa"})
            own, other = watten.receive_json()["lobby_chat"], zilch.receive_json()["lobby_chat"]
            assert own == other and set(own) == PUBLIC
            assert own["game_type"] == "watten" and own["sender"] == owner[0].username
            assert own["text"] == "<b>Plain Watten</b>"
    with server.websocket_connect(url(owner), headers={"cookie": owner[1]}) as restored:
        frames = probe(restored)
        assert len(frames) == 2 and all(frame["lobby_chat_history"] for frame in frames)
        assert all(set(frame["lobby_chat"]) == PUBLIC for frame in frames)
        assert all(datetime.fromisoformat(frame["lobby_chat"]["sent_at"]).utcoffset() == timedelta(0) for frame in frames)
    with server.websocket_connect(url(late), headers={"cookie": late[1]}) as outsider:
        assert probe(outsider) == []
    with session_scope() as db:
        event = db.scalar(select(LobbyChatMessage).where(LobbyChatMessage.game_type == "watten"))
        recipients = set(db.scalars(select(LobbyChatMessageRecipient.user_id).where(
            LobbyChatMessageRecipient.message_id == event.id)))
        assert recipients == {owner[0].user_id, peer[0].user_id}
    # Generic internal readers fail closed unless a guarded local caller opts in.
    assert len(chat.load_lobby_chat_history(owner[0].user_id)) == 1
    assert len(chat.load_lobby_chat_history(owner[0].user_id, include_watten=True)) == 2


@pytest.mark.parametrize(("site", "host", "enabled"), (
    (native.LOCAL, "localhost:8127", "0"),
    ("https://zockdiewandan.online", "localhost:8127", "1"),
    (native.LOCAL, "zockdiewandan.online", "1"),
    (native.LOCAL, "localhost.evil.invalid", "1"),
    (native.LOCAL, "watten.zockdiewandan.online", "1"),
    (native.LOCAL, "localhost:8127, evil.invalid", "1"),
))
def test_disabled_or_production_watten_socket_rejected_before_session_or_history_db(server, monkeypatch, site, host, enabled):
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", site)
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", enabled)

    def forbidden(*_args, **_kwargs):
        pytest.fail("Closed Watten context must not query authentication or history")

    monkeypatch.setattr(chat, "resolve_session", forbidden)
    monkeypatch.setattr(chat, "load_lobby_chat_history", forbidden)
    with pytest.raises(WebSocketDisconnect) as caught:
        with server.websocket_connect("/ws/lobby-chat?context=watten", headers={"host": host,
                "x-forwarded-host": "localhost:8127", "x-forwarded-proto": "http"}):
            pass
    assert caught.value.code == 1008


def test_duplicate_host_and_account_binding_rejected_before_accept_or_persistence(server):
    owner, wrong = native.account("BoundLobby"), native.account("OtherBoundLobby")
    for headers, path in (
        (HTTPHeaders([("host", "localhost:8127"), ("host", "evil.invalid"), ("cookie", owner[1])]), url(owner)),
        ({"cookie": wrong[1]}, url(owner)),
        ({"cookie": owner[1]}, url(owner) + "&expected_account_id=1"),
        ({"cookie": owner[1]}, "ws://localhost:8127/ws/lobby-chat?context=watten&expected_account_id=true"),
        ({}, "ws://localhost:8127/ws/lobby-chat?context=watten"),
    ):
        with pytest.raises(WebSocketDisconnect) as caught:
            with server.websocket_connect(path, headers=headers):
                pass
        assert caught.value.code == 1008
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(LobbyChatMessage)) == 0


def test_moderation_global_optin_text_bounds_rate_reconnect_and_expiration(server):
    owner, peer = native.account("ModeratedWattenLobby"), native.account("ReadOnlyWattenLobby")
    with session_scope() as db:
        db.get(User, peer[0].user_id).lobby_chat_muted = True
    with server.websocket_connect(url(owner), headers={"cookie": owner[1]}) as sender:
        with server.websocket_connect(url(peer), headers={"cookie": peer[1]}) as muted:
            muted.send_json({"action": "lobby_chat_message", "text": "Blocked by mute"})
            assert muted.receive_json() == {"error": "lobby_chat_muted"}
            for invalid in ("", "x" * 401, "bad\x01text"):
                sender.send_json({"action": "lobby_chat_message", "text": invalid})
                assert sender.receive_json() == {"error": "lobby_chat_message_invalid"}
            for index in range(5):
                sender.send_json({"action": "lobby_chat_message", "text": "x" * 400 if index == 0 else str(index)})
                assert sender.receive_json()["lobby_chat"] == muted.receive_json()["lobby_chat"]
            sender.send_json({"action": "lobby_chat_message", "text": "Too many"})
            assert sender.receive_json() == {"error": "lobby_chat_rate_limited"}
    with server.websocket_connect(url(owner), headers={"cookie": owner[1]}) as reconnected:
        assert len(probe(reconnected)) == 5
        reconnected.send_json({"action": "lobby_chat_message", "text": "Reconnect does not reset rate"})
        assert reconnected.receive_json() == {"error": "lobby_chat_rate_limited"}
    for setting, expected in (("lobby_chat_enabled", "lobby_chat_disabled"), ("lobby_chat_excluded", "lobby_chat_excluded")):
        with session_scope() as db:
            user = db.get(User, owner[0].user_id)
            user.lobby_chat_enabled = setting != "lobby_chat_enabled"
            user.lobby_chat_excluded = setting == "lobby_chat_excluded"
        with server.websocket_connect(url(owner), headers={"cookie": owner[1]}) as blocked:
            assert blocked.receive_json() == {"error": expected}
            assert probe(blocked) == []
    now = utcnow()
    chat.record_lobby_chat_event(kind="message", sender=peer[0], game_type="watten", text="Expired",
                                recipient_user_ids={peer[0].user_id}, now=now - timedelta(days=3, seconds=1))
    assert chat.purge_expired_lobby_chat_messages(now=now) == 1
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(LobbyChatMessage)) == 5
        assert db.scalar(select(func.count()).select_from(LobbyChatMessageRecipient)) == 10
        db.execute(delete(LobbyChatMessage))
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(LobbyChatMessageRecipient)) == 0


class Socket:
    def __init__(self, owner, *, host="localhost:8127"):
        self.headers = Headers({"host": host, "cookie": owner[1]})
        self.cookies = dict([owner[1].split("=", 1)])
        self.query_params = QueryParams()
        self.messages = []
        self.before_send = None

    async def send_json(self, payload):
        if self.before_send:
            await self.before_send()
        self.messages.append(payload)


def test_live_fanout_rechecks_late_revocation_and_restricts_nonlocal_audience(server):
    first, late, remote = (native.account(name) for name in ("FirstLobbySocket", "LateRevokedLobby", "RemoteLobby"))
    sockets = [Socket(first), Socket(late), Socket(remote, host="zockdiewandan.online")]
    hub = chat.LobbyChatHub()
    for socket, owner in zip(sockets, (first, late, remote), strict=True):
        hub.connect(socket, owner[0].user_id, context="watten" if owner == first else "zdwa")
    audience = hub.eligible_user_ids(chat.resolve_session, watten_event=True)
    assert audience == {first[0].user_id, late[0].user_id}
    payload = chat.record_lobby_chat_event(kind="message", sender=first[0], game_type="watten",
                                         text="Public but local", recipient_user_ids=audience)

    async def revoke_late():
        logout(late[1].split("=", 1)[1])

    sockets[0].before_send = revoke_late
    asyncio.run(hub.broadcast(payload, recipient_user_ids={owner[0].user_id for owner in (first, late, remote)},
                              resolve_identity=chat.resolve_session))
    assert sockets[0].messages == [payload] and sockets[1].messages == sockets[2].messages == []
    assert not hub.is_connected(sockets[1])


def test_stored_watten_cannot_reappear_in_production_generic_history(server, monkeypatch):
    owner = native.account("HiddenProductionHistory")
    chat.record_lobby_chat_event(kind="message", sender=owner[0], game_type="watten", text="Private preview history",
                                recipient_user_ids={owner[0].user_id})
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", "https://zockdiewandan.online")
    with server.websocket_connect("wss://zockdiewandan.online/ws/lobby-chat?context=zdwa",
                                  headers={"cookie": owner[1]}) as prod:
        assert probe(prod) == []
        prod.send_json({"action": "lobby_chat_message", "text": "Released suite still works"})
        assert prod.receive_json()["lobby_chat"]["game_type"] == "zdwa"


def test_history_stops_after_session_revoked_during_prior_socket_send(server):
    owner = native.account("RevokedLobbyHistory")
    for context in ("zdwa", "watten"):
        chat.record_lobby_chat_event(kind="message", sender=owner[0], game_type=context, text="Authorized history",
                                    recipient_user_ids={owner[0].user_id})
    socket = Socket(owner)

    async def revoke_self():
        logout(owner[1].split("=", 1)[1])

    socket.before_send = revoke_self
    asyncio.run(chat._send_authorized_history(socket, owner[0].user_id, context="watten"))
    assert len(socket.messages) == 1 and socket.messages[0]["lobby_chat_history"]
    assert set(socket.messages[0]["lobby_chat"]) == PUBLIC


def test_real_http_shared_preference_csrf_preserves_local_socket_optin(server):
    owner = native.account("LobbyHttpConsent")
    headers = {"Cookie": owner[1], "Origin": native.LOCAL}
    endpoint = "/api/auth/preferences/lobby-chat"
    preference = {"lobby_chat_enabled": False, "lobby_chat_popups": False}
    assert server.put(endpoint, headers=headers, json=preference).status_code == 403
    headers["X-CSRF-Token"] = owner[0].csrf_token
    disabled = server.put(endpoint, headers=headers, json=preference)
    assert disabled.status_code == 200 and disabled.json() == preference
    current = server.get("/api/auth/me", headers={"Cookie": owner[1]}).json()
    assert current["user"]["preferences"]["lobby_chat_enabled"] is False
    with server.websocket_connect(url(owner), headers={"cookie": owner[1]}) as socket:
        assert socket.receive_json() == {"error": "lobby_chat_disabled"}
        assert probe(socket) == []
    preference["lobby_chat_enabled"] = True
    assert server.put(endpoint, headers=headers, json=preference).status_code == 200
    with server.websocket_connect(url(owner), headers={"cookie": owner[1]}) as socket:
        assert probe(socket) == []
        socket.send_json({"action": "lobby_chat_message", "text": "Explicitly enabled"})
        assert set(socket.receive_json()["lobby_chat"]) == PUBLIC
