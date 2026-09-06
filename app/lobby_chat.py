"""Audience-scoped, short-lived cross-game lobby chat transport.

Every event records the accounts that were connected to the enabled chat at
send time. History therefore helps those players resume a recent conversation
without revealing messages from a period in which they were signed out.
"""

from __future__ import annotations

import asyncio
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import delete, select

from .auth import AuthIdentity, resolve_session, websocket_origin_allowed
from .database import session_scope
from .game_types import DEFAULT_GAME_TYPE, ZILCH_GAME_TYPE
from .models import LobbyChatMessage, LobbyChatMessageRecipient
from .security import utcnow

LOBBY_CHAT_HISTORY_DAYS = 3
LOBBY_CHAT_PURGE_INTERVAL_SECONDS = 60 * 60
MAX_LOBBY_CHAT_MESSAGE_LENGTH = 400
_MESSAGE_LIMIT = 5
_MESSAGE_WINDOW_SECONDS = 30
_RATE_LIMITER_RETENTION_SECONDS = 5 * 60

ReserveConnection = Callable[[WebSocket], str | None]
ReleaseConnection = Callable[[str | None], None]
ResolveIdentity = Callable[[WebSocket], AuthIdentity | None]


@dataclass(frozen=True)
class LobbyChatConnection:
    websocket: WebSocket
    user_id: int


class LobbyChatHub:
    """Process-local fan-out for accounts currently eligible for lobby chat."""

    def __init__(self) -> None:
        self._connections: list[LobbyChatConnection] = []
        self._rate_limiters: dict[int, LobbyChatRateLimiter] = {}

    def connect(self, websocket: WebSocket, user_id: int) -> bool:
        """Register one account socket and return whether it is that user's first."""
        first_connection = not any(connection.user_id == user_id for connection in self._connections)
        if not any(connection.websocket is websocket for connection in self._connections):
            self._connections.append(LobbyChatConnection(websocket=websocket, user_id=user_id))
        return first_connection

    def disconnect(self, websocket: WebSocket) -> None:
        self._connections = [connection for connection in self._connections if connection.websocket is not websocket]

    def is_connected(self, websocket: WebSocket) -> bool:
        return any(connection.websocket is websocket for connection in self._connections)

    def _eligible_connections(
        self,
        resolve_identity: ResolveIdentity,
        *,
        recipient_user_ids: set[int] | None = None,
    ) -> list[LobbyChatConnection]:
        eligible: list[LobbyChatConnection] = []
        stale: list[WebSocket] = []
        for connection in tuple(self._connections):
            if recipient_user_ids is not None and connection.user_id not in recipient_user_ids:
                continue
            identity = resolve_identity(connection.websocket)
            if (
                identity is None
                or not identity.lobby_chat_enabled
                or identity.lobby_chat_excluded
                or identity.user_id != connection.user_id
            ):
                stale.append(connection.websocket)
                continue
            eligible.append(connection)
        for websocket in stale:
            self.disconnect(websocket)
        return eligible

    def eligible_user_ids(self, resolve_identity: ResolveIdentity) -> set[int]:
        """Return the account audience that is enabled and authenticated now."""
        return {connection.user_id for connection in self._eligible_connections(resolve_identity)}

    async def broadcast(
        self,
        payload: dict[str, object],
        *,
        recipient_user_ids: set[int],
        resolve_identity: ResolveIdentity,
    ) -> None:
        """Deliver only to the event's authorized audience and retire stale sockets."""
        connections = self._eligible_connections(
            resolve_identity,
            recipient_user_ids=recipient_user_ids,
        )
        if not connections:
            return
        results = await asyncio.gather(
            *(connection.websocket.send_json(payload) for connection in connections),
            return_exceptions=True,
        )
        for connection, result in zip(connections, results, strict=True):
            if isinstance(result, BaseException):
                self.disconnect(connection.websocket)

    def allow_message(self, user_id: int) -> bool:
        """Rate-limit accounts across reconnects and browser tabs."""
        now = time.monotonic()
        stale_user_ids = [
            connected_user_id
            for connected_user_id, limiter in self._rate_limiters.items()
            if limiter.last_seen_at <= now - _RATE_LIMITER_RETENTION_SECONDS
        ]
        for connected_user_id in stale_user_ids:
            self._rate_limiters.pop(connected_user_id, None)
        limiter = self._rate_limiters.setdefault(user_id, LobbyChatRateLimiter())
        return limiter.allow(now=now)


class LobbyChatRateLimiter:
    """Limit chat sends per account without retaining their messages."""

    def __init__(self) -> None:
        self._sent_at: deque[float] = deque()
        self.last_seen_at = 0.0

    def allow(self, *, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        self.last_seen_at = now
        while self._sent_at and self._sent_at[0] <= now - _MESSAGE_WINDOW_SECONDS:
            self._sent_at.popleft()
        if len(self._sent_at) >= _MESSAGE_LIMIT:
            return False
        self._sent_at.append(now)
        return True


def lobby_chat_context(value: object, *, fallback: str = DEFAULT_GAME_TYPE) -> str:
    """Normalize the product context shown beside the sender's name."""
    if value == ZILCH_GAME_TYPE:
        return ZILCH_GAME_TYPE
    if value == DEFAULT_GAME_TYPE:
        return DEFAULT_GAME_TYPE
    return ZILCH_GAME_TYPE if fallback == ZILCH_GAME_TYPE else DEFAULT_GAME_TYPE


def lobby_chat_history_cutoff(*, now: datetime | None = None) -> datetime:
    return (now or utcnow()) - timedelta(days=LOBBY_CHAT_HISTORY_DAYS)


def purge_expired_lobby_chat_messages(*, now: datetime | None = None) -> int:
    """Permanently delete chat history that is older than the three-day policy."""
    with session_scope() as db:
        result = db.execute(
            delete(LobbyChatMessage).where(LobbyChatMessage.created_at < lobby_chat_history_cutoff(now=now))
        )
        return int(getattr(result, "rowcount", 0) or 0)


def _event_payload(event: LobbyChatMessage) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": event.id,
        "kind": event.kind,
        "sender": event.sender_username,
        "user_id": event.sender_user_id,
        "game_type": event.game_type,
        "sent_at": event.created_at.isoformat(),
    }
    if event.kind == "message":
        payload["text"] = event.text or ""
    return {"lobby_chat": payload}


def load_lobby_chat_history(user_id: int, *, now: datetime | None = None) -> list[dict[str, object]]:
    """Load only recent events whose audience included this account."""
    cutoff = lobby_chat_history_cutoff(now=now)
    with session_scope() as db:
        events = db.scalars(
            select(LobbyChatMessage)
            .join(
                LobbyChatMessageRecipient,
                LobbyChatMessageRecipient.message_id == LobbyChatMessage.id,
            )
            .where(
                LobbyChatMessageRecipient.user_id == user_id,
                LobbyChatMessage.kind == "message",
                LobbyChatMessage.created_at >= cutoff,
            )
            .order_by(LobbyChatMessage.created_at.asc(), LobbyChatMessage.id.asc())
        ).all()
        return [_event_payload(event) for event in events]


def record_lobby_chat_event(
    *,
    kind: str,
    sender: AuthIdentity,
    game_type: str,
    recipient_user_ids: set[int],
    text: str | None = None,
    now: datetime | None = None,
) -> dict[str, object] | None:
    """Persist one event with its fixed recipient audience before delivery."""
    recipients = {user_id for user_id in recipient_user_ids if type(user_id) is int and user_id > 0}
    if not recipients:
        return None
    created_at = now or utcnow()
    with session_scope() as db:
        event = LobbyChatMessage(
            kind=kind,
            sender_user_id=sender.user_id,
            sender_username=sender.username,
            game_type=lobby_chat_context(game_type),
            text=text,
            created_at=created_at,
        )
        db.add(event)
        db.flush()
        db.add_all(
            LobbyChatMessageRecipient(message_id=event.id, user_id=user_id)
            for user_id in sorted(recipients)
        )
        db.flush()
        return _event_payload(event)


def _clean_message(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    message = value.strip()
    if not message or len(message) > MAX_LOBBY_CHAT_MESSAGE_LENGTH:
        return None
    if any(ord(character) < 32 and character not in {"\n", "\t"} for character in message):
        return None
    return message


async def _publish_lobby_chat_event(
    *,
    hub: LobbyChatHub,
    kind: str,
    sender: AuthIdentity,
    context: str,
    text: str | None = None,
) -> None:
    audience = hub.eligible_user_ids(resolve_session)
    if kind == "presence":
        # A player does not need a persistent system event announcing their
        # own arrival. Existing eligible players are the useful audience.
        audience.discard(sender.user_id)
    elif sender.user_id not in audience:
        return
    if not audience:
        return
    payload = record_lobby_chat_event(
        kind=kind,
        sender=sender,
        game_type=context,
        recipient_user_ids=audience,
        text=text,
    )
    if payload is not None:
        await hub.broadcast(
            payload,
            recipient_user_ids=audience,
            resolve_identity=resolve_session,
        )


async def _send_authorized_history(websocket: WebSocket, user_id: int) -> None:
    purge_expired_lobby_chat_messages()
    for payload in load_lobby_chat_history(user_id):
        await websocket.send_json({**payload, "lobby_chat_history": True})


async def serve_lobby_chat_websocket(
    websocket: WebSocket,
    *,
    hub: LobbyChatHub,
    context: str,
    reserve_connection: ReserveConnection,
    release_connection: ReleaseConnection,
) -> None:
    """Serve the account-only, audience-scoped lobby chat channel."""
    if not websocket_origin_allowed(websocket):
        await websocket.close(code=1008, reason="Origin rejected")
        return

    connection_address = reserve_connection(websocket)
    if connection_address is None:
        await websocket.close(code=1013, reason="Too many connections")
        return

    await websocket.accept()
    sender_context = lobby_chat_context(context)
    try:
        identity = resolve_session(websocket)
        if identity is not None and identity.lobby_chat_excluded:
            await websocket.send_json({"error": "lobby_chat_excluded"})
        elif identity is not None and identity.lobby_chat_enabled:
            hub.connect(websocket, identity.user_id)
            await _send_authorized_history(websocket, identity.user_id)
        elif identity is not None:
            await websocket.send_json({"error": "lobby_chat_disabled"})

        while True:
            try:
                payload = await websocket.receive_json()
            except ValueError:
                await websocket.send_json({"error": "lobby_chat_message_invalid"})
                continue
            if not isinstance(payload, dict) or payload.get("action") != "lobby_chat_message":
                await websocket.send_json({"error": "lobby_chat_action_unknown"})
                continue

            identity = resolve_session(websocket)
            if identity is None:
                hub.disconnect(websocket)
                await websocket.send_json({"error": "authentication_required"})
                continue
            if identity.lobby_chat_excluded:
                hub.disconnect(websocket)
                await websocket.send_json({"error": "lobby_chat_excluded"})
                continue
            if not identity.lobby_chat_enabled:
                hub.disconnect(websocket)
                await websocket.send_json({"error": "lobby_chat_disabled"})
                continue
            if identity.lobby_chat_muted:
                await websocket.send_json({"error": "lobby_chat_muted"})
                continue
            message = _clean_message(payload.get("text"))
            if message is None:
                await websocket.send_json({"error": "lobby_chat_message_invalid"})
                continue
            if not hub.allow_message(identity.user_id):
                await websocket.send_json({"error": "lobby_chat_rate_limited"})
                continue
            if not hub.is_connected(websocket):
                hub.connect(websocket, identity.user_id)
                await _send_authorized_history(websocket, identity.user_id)
            purge_expired_lobby_chat_messages()
            await _publish_lobby_chat_event(
                hub=hub,
                kind="message",
                sender=identity,
                context=sender_context,
                text=message,
            )
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(websocket)
        release_connection(connection_address)
