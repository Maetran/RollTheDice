"""Ephemeral public Watten conversation, separate from engine and partner advice.

Only current authorized human sockets receive events/history. The bounded cache
is process-local and deliberately absent from the strict checkpoint codec. It
provides no restart history, game progress, automatic resume or CPU observation.
"""

from __future__ import annotations

import hashlib
import secrets
import time
from collections import deque
from dataclasses import dataclass, field

from starlette.websockets import WebSocketDisconnect

from .lobby_chat import LobbyChatRateLimiter
from .security import utcnow
from .watten_recipe import dumps_canonical_json

SOCIAL_ACTIONS = frozenset({"watten_social_history", "watten_chat_message", "watten_send_emoji"})
EMOJIS = frozenset({"👍", "😂", "😮", "💩", "🎉", "🤞", "🙏", "😜", "🙄", "🤦", "😭", "🔥"})
_MAX_NONCE = 9_007_199_254_740_991
_CACHE_KEY = "_watten_social"
_ACTOR_LIMIT = 128
_IDLE_SECONDS = 300


class WattenSocialError(ValueError):
    pass


@dataclass(slots=True)
class _Actor:
    channel_id: str
    last_seen: float
    last_nonce: int = 0
    acks: deque = field(default_factory=lambda: deque(maxlen=64))
    rate: LobbyChatRateLimiter = field(default_factory=LobbyChatRateLimiter)


@dataclass(slots=True)
class _Social:
    game_id: str
    events: deque = field(default_factory=lambda: deque(maxlen=100))
    actors: dict[int, _Actor] = field(default_factory=dict)


def _state(game, *, create=False):
    state = game.get(_CACHE_KEY)
    if type(state) is not _Social or state.game_id != game["_id"]:
        if not create:
            return None
        state = game[_CACHE_KEY] = _Social(game["_id"])
    now = time.monotonic()
    for account in tuple(state.actors):
        if state.actors[account].last_seen <= now - _IDLE_SECONDS:
            del state.actors[account]
    return state


def _current(game, record, member, resolve_identity):
    websocket = record.get("ws")
    if websocket is None:
        return None
    identity = resolve_identity(websocket)
    collection = game["_players" if member else "_spectators"]
    owned = any(item["id"] == record["id"] and item.get("ws") is websocket
                and item.get("user_id") == record.get("user_id") for item in collection)
    bound = not member or any(item.participant_id == record["id"] and item.account_id == record.get("user_id")
                              for item in game["_watten"].room.members)
    if identity is None or identity.user_id != record.get("user_id") or not owned or not bound:
        return None
    return identity


def _sender(session, resolve_identity):
    member = not session.is_spectator
    role_id = session.player_id if member else session.spectator_id
    record = next((item for item in session.game["_players" if member else "_spectators"]
                   if item["id"] == role_id and item.get("ws") is session.websocket), None)
    identity = _current(session.game, record, member, resolve_identity) if record else None
    return record, identity, member


def _envelope(game, **values):
    return {"schema_version": 1, "game_id": game["_id"], **values}


async def _own_send(session, payload, resolve_identity, *, explain_exclusion=False):
    _record, identity, _member = _sender(session, resolve_identity)
    if identity is None or identity.lobby_chat_excluded and not explain_exclusion:
        return False
    await session.websocket.send_json(payload)
    return True


async def _fanout(game, event, resolve_identity):
    payload = {"watten_social_event": _envelope(game, event=event)}
    for member, collection in ((True, game["_players"]), (False, game["_spectators"])):
        for record in list(collection):
            websocket = record.get("ws")
            if websocket is None:
                continue
            try:
                identity = _current(game, record, member, resolve_identity)
                if identity is None:
                    record["ws"] = None
                    await websocket.close(code=1008)
                    continue
                if not identity.lobby_chat_excluded:
                    await websocket.send_json(payload)
            except (WebSocketDisconnect, RuntimeError, OSError):
                if record.get("ws") is websocket:
                    record["ws"] = None


def _parse(data):
    action = data.get("action")
    if action == "watten_social_history":
        if set(data) != {"action"}:
            raise WattenSocialError("watten_social_invalid_request")
        return None
    content = "text" if action == "watten_chat_message" else "emoji"
    if (action not in SOCIAL_ACTIONS or set(data) != {"action", "channel_id", "nonce", content}
            or type(data["channel_id"]) is not str or len(data["channel_id"]) != 32
            or type(data["nonce"]) is not int or not 1 <= data["nonce"] <= _MAX_NONCE):
        raise WattenSocialError("watten_social_invalid_request")
    value = data[content]
    if content == "text":
        if (type(value) is not str or not 1 <= len(value) <= 400 or not value.strip()
                or any(ord(character) < 32 and character not in {"\n", "\t"} for character in value)):
            raise WattenSocialError("watten_social_invalid_text")
        return "chat", "text", value.strip()
    if type(value) is not str or value not in EMOJIS:
        raise WattenSocialError("watten_social_invalid_emoji")
    return "emoji", "emoji", value


async def handle_watten_social(session, data, resolve_identity):
    """Called after the table lock; never route these commands into the engine."""
    try:
        record, identity, member = _sender(session, resolve_identity)
        if identity is None:
            raise WattenSocialError("watten_social_actor_not_bound")
        if identity.lobby_chat_excluded:
            raise WattenSocialError("watten_social_excluded")
        parsed = _parse(data)
        if parsed is None:
            state = _state(session.game, create=True)
            actor = state.actors.get(identity.user_id)
            if actor is None:
                if len(state.actors) >= _ACTOR_LIMIT:
                    raise WattenSocialError("watten_social_busy")
                actor = state.actors[identity.user_id] = _Actor(secrets.token_hex(16), time.monotonic())
            actor.last_seen = time.monotonic()
            await _own_send(session, {"watten_social_history": _envelope(session.game,
                events=list(state.events), channel_id=actor.channel_id, next_nonce=actor.last_nonce + 1,
                can_send=not identity.lobby_chat_muted, live_only=True)}, resolve_identity)
            return
        if identity.lobby_chat_muted:
            raise WattenSocialError("watten_social_muted")
        state = _state(session.game)
        actor = state.actors.get(identity.user_id) if state else None
        if actor is None or actor.channel_id != data["channel_id"]:
            raise WattenSocialError("watten_social_stale_channel")
        kind, content, value = parsed
        digest = hashlib.sha256(dumps_canonical_json({"type": kind, content: value}).encode()).hexdigest()
        nonce = data["nonce"]
        prior = next((item for item in actor.acks if item[0] == nonce), None)
        if prior is not None and prior[1] != digest:
            raise WattenSocialError("watten_social_nonce_conflict")
        if prior is not None:
            event_id, replayed = prior[2], True
        else:
            if nonce != actor.last_nonce + 1:
                raise WattenSocialError("watten_social_stale_nonce")
            if not actor.rate.allow(now=time.monotonic()):
                raise WattenSocialError("watten_social_rate_limited")
            event_id, replayed = secrets.token_hex(16), False
            event = {"id": event_id, "type": kind, "sender_id": record["id"], "display_name": identity.username,
                     "role": "member" if member else "spectator", content: value, "time": utcnow().isoformat()}
            # Install in process memory before any await. Retries only ACK the
            # same accepted event and cannot consume a second nonce/rate slot.
            state.events.append(event)
            actor.acks.append((nonce, digest, event_id))
            actor.last_nonce = nonce
            actor.last_seen = time.monotonic()
            await _fanout(session.game, event, resolve_identity)
        # Authentication/ownership is resolved again after every awaited fanout.
        await _own_send(session, {"watten_social_ack": _envelope(session.game, channel_id=actor.channel_id,
            nonce=nonce, event_id=event_id, replayed=replayed, next_nonce=actor.last_nonce + 1)}, resolve_identity)
    except WattenSocialError as exc:
        nonce = data.get("nonce")
        await _own_send(session, {"watten_social_error": _envelope(session.game,
            nonce=nonce if type(nonce) is int and 1 <= nonce <= _MAX_NONCE else None, code=str(exc))},
            resolve_identity, explain_exclusion=True)
