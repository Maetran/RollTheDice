"""Account-bound, ephemeral Hausdepp audio signaling. Audio never enters this app.

Cloudflare SFU identifiers are discovered only after seating authorization. This
module owns every provider mutation and never accepts a provider URL, session or
remote publication identifier from a browser. Room membership is process-local,
like the existing game sockets; only the non-secret room lineage is durable.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import re
import secrets
import time
from collections import deque
from dataclasses import dataclass, field
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .auth import resolve_session
from .game_types import HAUSDEPP_GAME_TYPE, game_type_from_state
from .moderation import user_play_banned

logger = logging.getLogger(__name__)
HEARTBEAT_SECONDS = 30
RECONNECT_SECONDS = 12
MAX_SDP_BYTES = 65536
ROOM_IDLE_SECONDS = 60
MAX_ROOMS = 128
MAX_MEMBERS = 128
ALLOCATION_BURST = 6
ALLOCATION_HOURLY = 30
MAX_ALLOCATION_ACCOUNTS = 4096
_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_REQUEST_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")
_rooms: dict[str, VoiceRoom] = {}
_cleanup: list[VoiceCleanup] = []
_watchdog: asyncio.Task | None = None
_allocations: dict[int, deque[float]] = {}
_admissions: dict[int, deque[float]] = {}


class VoiceError(ValueError):
    """A safe, translatable error code, without SDP or provider diagnostics."""


def voice_available() -> bool:
    return (os.getenv("ROLLTHEDICE_VOICE_ENABLED", "0").strip().lower() in {"1", "true", "yes", "on"}
            and bool(_ID.fullmatch(os.getenv("ROLLTHEDICE_VOICE_SFU_APP_ID", "")))
            and bool(os.getenv("ROLLTHEDICE_VOICE_SFU_APP_SECRET", "")))


class CloudflareVoiceProvider:
    """Small bounded REST adapter; fixed host, no redirects, no secret logging."""

    async def request(self, method: str, path: str, payload: dict | None = None) -> dict:
        return await asyncio.to_thread(self._request, method, path, payload)

    @staticmethod
    def _request(method: str, path: str, payload: dict | None) -> dict:
        app_id = os.getenv("ROLLTHEDICE_VOICE_SFU_APP_ID", "")
        secret = os.getenv("ROLLTHEDICE_VOICE_SFU_APP_SECRET", "")
        if not _ID.fullmatch(app_id) or not secret:
            raise VoiceError("hausdepp_voice_unavailable")
        url = f"https://rtc.live.cloudflare.com/v1/apps/{app_id}/{path}"
        return CloudflareVoiceProvider._http_request(
            method, url, secret, payload,
            missing_session_ok=method == "GET" and bool(re.fullmatch(r"sessions/[A-Za-z0-9_-]{1,128}", path)),
        )

    @staticmethod
    def _http_request(method: str, url: str, secret: str, payload: dict | None, *, missing_session_ok: bool = False) -> dict:
        body = json.dumps(payload).encode() if payload is not None else None
        request = Request(url, data=body, method=method, headers={
            "Authorization": f"Bearer {secret}", "Content-Type": "application/json",
            "User-Agent": "RollTheDice-HausdeppVoice/1.0 (+https://zockdiewandan.online)",
        })
        try:
            class NoRedirect(HTTPRedirectHandler):
                def redirect_request(self, _req, _fp, _code, _msg, _headers, _newurl):
                    return None

            with build_opener(NoRedirect()).open(request, timeout=10) as response:
                if response.url != url:
                    raise VoiceError("hausdepp_voice_provider_failed")
                raw = response.read(262145)
            if len(raw) > 262144:
                raise VoiceError("hausdepp_voice_provider_failed")
            result = json.loads(raw)
        except HTTPError as exc:
            if missing_session_ok and exc.code == 404:
                return {"tracks": [], "_session_absent": True}
            raise VoiceError("hausdepp_voice_provider_failed") from exc
        except (URLError, TimeoutError, OSError, ValueError) as exc:
            raise VoiceError("hausdepp_voice_provider_failed") from exc
        if not isinstance(result, dict) or result.get("errorCode"):
            raise VoiceError("hausdepp_voice_provider_failed")
        return result

    async def ice_servers(self) -> list[dict]:
        key_id = os.getenv("ROLLTHEDICE_VOICE_TURN_KEY_ID", "")
        token = os.getenv("ROLLTHEDICE_VOICE_TURN_API_TOKEN", "")
        if not key_id and not token:
            return [{"urls": ["stun:stun.cloudflare.com:3478"]}]
        if not _ID.fullmatch(key_id) or not token:
            raise VoiceError("hausdepp_voice_unavailable")
        result = await asyncio.to_thread(self._http_request, "POST",
                                        f"https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers",
                                        token, {"ttl": 3600})
        servers = result.get("iceServers")
        if not isinstance(servers, list) or len(servers) > 8:
            raise VoiceError("hausdepp_voice_provider_failed")
        clean = []
        for server in servers:
            if not isinstance(server, dict):
                raise VoiceError("hausdepp_voice_provider_failed")
            urls = server.get("urls")
            urls = [urls] if isinstance(urls, str) else urls
            if (not isinstance(urls, list) or len(urls) > 16
                    or any(not isinstance(url, str) or len(url) > 256
                           or not re.fullmatch(r"(?:stun|turn|turns):(?:stun|turn)\.cloudflare\.com:\d+(?:\?transport=(?:udp|tcp))?", url)
                           for url in urls)):
                raise VoiceError("hausdepp_voice_provider_failed")
            item = {"urls": [url for url in urls if not re.search(r":53(?:\?|$)", url)]}
            for key in ("username", "credential"):
                if key in server:
                    if not isinstance(server[key], str) or len(server[key]) > 1024:
                        raise VoiceError("hausdepp_voice_provider_failed")
                    item[key] = server[key]
            if item["urls"]:
                clean.append(item)
        return clean


provider = CloudflareVoiceProvider()


@dataclass
class VoiceMember:
    user_id: int
    player_id: str
    game: dict
    websocket: object
    token: str
    session_id: str | None = None
    last_seen: float = field(default_factory=time.monotonic)
    disconnected_at: float | None = None
    microphone: bool = False
    speaking: bool = False
    track_name: str | None = None
    publication_ready: bool = False
    mids: set[str] = field(default_factory=set)
    subscriptions: dict[int, tuple[str, str, str]] = field(default_factory=dict)
    ice_servers: list[dict] = field(default_factory=list)
    awaiting_answer: bool = False
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


@dataclass
class VoiceCleanup:
    """Only provider identifiers survive retries, never sockets or account data."""

    session_id: str
    mids: set[str]
    attempts: int = 0
    next_attempt: float = 0


@dataclass
class VoiceRoom:
    id: str
    allowed_users: set[int]
    games: dict[str, dict] = field(default_factory=dict)
    members: dict[int, VoiceMember] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    last_used: float = field(default_factory=time.monotonic)


def _roster(game: dict) -> set[int]:
    return {p["user_id"] for p in [*game.get("_players", []), *game.get("_participants", [])]
            if type(p.get("user_id")) is int and p["user_id"] > 0
            and not p.get("is_cpu") and p.get("type") != "cpu"}


def _game_eligible(game: dict) -> bool:
    """Waiting friends may opt in; a played table needs two durable accounts."""
    if game_type_from_state(game) != HAUSDEPP_GAME_TYPE or game.get("_aborted"):
        return False
    waiting = not game.get("_started") and not game.get("_finished") and game.get("_hausdepp") is None
    return waiting or len(_roster(game)) >= 2


def carry_voice_room(source: dict, target: dict, user_ids: set[int]) -> None:
    """A server-created rematch may retain only its original account roster."""
    room_id = source.get("_hausdepp_voice_room_id")
    if isinstance(room_id, str) and _ID.fullmatch(room_id):
        target["_hausdepp_voice_room_id"] = room_id
        target["_hausdepp_voice_allowed_user_ids"] = sorted(user_ids)


def _actor(session, *, require_eligible: bool = True):
    identity = resolve_session(session.websocket)
    player = next((p for p in session.game.get("_players", []) if p.get("id") == session.player_id), None)
    if (game_type_from_state(session.game) != HAUSDEPP_GAME_TYPE or session.is_spectator
            or not identity or not player or player.get("user_id") != identity.user_id
            or player.get("ws") is not session.websocket or session.game.get("_aborted")
            or user_play_banned(identity.user_id)):
        raise VoiceError("hausdepp_voice_forbidden")
    if require_eligible and not _game_eligible(session.game):
        raise VoiceError("hausdepp_voice_unavailable")
    return identity, player


def _consume_budget(budgets: dict[int, deque[float]], user_id: int, *, now: float | None = None) -> None:
    """Bound each account across leave, new sockets and different table IDs."""
    now = time.monotonic() if now is None else now
    for account_id, entries in list(budgets.items()):
        while entries and entries[0] <= now - 3600:
            entries.popleft()
        if not entries:
            budgets.pop(account_id, None)
    entries = budgets.get(user_id)
    if entries is None:
        if len(budgets) >= MAX_ALLOCATION_ACCOUNTS:
            raise VoiceError("hausdepp_voice_rate_limited")
        entries = budgets[user_id] = deque()
    if len(entries) >= ALLOCATION_HOURLY or sum(timestamp > now - 60 for timestamp in entries) >= ALLOCATION_BURST:
        raise VoiceError("hausdepp_voice_rate_limited")
    # A lost provider response may have succeeded and must still count.
    entries.append(now)


def _consume_allocation(user_id: int, *, now: float | None = None) -> None:
    _consume_budget(_allocations, user_id, now=now)


def _consume_admission(user_id: int, *, now: float | None = None) -> None:
    _consume_budget(_admissions, user_id, now=now)


async def _ensure_sfu_session(member: VoiceMember, session) -> str:
    """Allocate only when validated media is ready, under room/member locks."""
    if member.session_id is None:
        if len(_cleanup) >= MAX_MEMBERS:
            raise VoiceError("hausdepp_voice_unavailable")
        _consume_allocation(member.user_id)
        result = await provider.request("POST", "sessions/new")
        session_id = result.get("sessionId")
        if not isinstance(session_id, str) or not _ID.fullmatch(session_id):
            raise VoiceError("hausdepp_voice_provider_failed")
        # Record first so revoked authorization can retire the known allocation.
        member.session_id = session_id
        _actor(session)
    return member.session_id


async def _room_for(game: dict) -> VoiceRoom:
    _prune_rooms(time.monotonic())
    room_id = game.get("_hausdepp_voice_room_id")
    allowed = game.get("_hausdepp_voice_allowed_user_ids")
    allowed = {x for x in allowed if type(x) is int and x > 0} if isinstance(allowed, list) else _roster(game)
    room = _rooms.get(room_id) if isinstance(room_id, str) else None
    if room is None:
        if len(_rooms) >= MAX_ROOMS:
            idle = sorted((r for r in _rooms.values() if not r.members and not r.lock.locked()), key=lambda r: r.last_used)
            if not idle:
                raise VoiceError("hausdepp_voice_unavailable")
            _rooms.pop(idle[0].id, None)
        room_id = room_id if isinstance(room_id, str) and _ID.fullmatch(room_id) else secrets.token_hex(16)
        room = VoiceRoom(room_id, allowed)
        _rooms[room_id] = room
    async with room.lock:
        current_id = game.get("_hausdepp_voice_room_id")
        if isinstance(current_id, str) and current_id != room.id and current_id in _rooms:
            # A previous waiter already rotated this group while we waited.
            return await _room_for(game)
        if not _roster(game).issubset(room.allowed_users):
            # Serialize behind any in-flight publication before inspecting and
            # closing it; a late SFU result cannot survive group invalidation.
            old_room = room
            old_room.games.pop(str(game["_id"]), None)
            for member in list(old_room.members.values()):
                if member.game is game:
                    async with member.lock:
                        await _remove_member(old_room, member)
            if not old_room.members:
                _rooms.pop(old_room.id, None)
                old_room.games.clear()
            room = VoiceRoom(secrets.token_hex(16), _roster(game))
            _rooms[room.id] = room
        game["_hausdepp_voice_room_id"] = room.id
        game["_hausdepp_voice_allowed_user_ids"] = sorted(room.allowed_users)
        room.games[str(game["_id"])] = game
        room.last_used = time.monotonic()
    _start_watchdog()
    return room


def _prune_rooms(now: float) -> None:
    for room in list(_rooms.values()):
        if room.lock.locked():
            continue
        if not room.members and not room.lock.locked() and now - room.last_used >= ROOM_IDLE_SECONDS:
            _rooms.pop(room.id, None)
            continue
        attached = {str(member.game["_id"]) for member in room.members.values()}
        for game_id, game in list(room.games.items()):
            if game_id not in attached and not any(p.get("ws") for p in game.get("_players", [])):
                room.games.pop(game_id, None)
        # Rematch history is not voice history. Six members can occupy at most
        # six current tables; keep two additional waiting/status tables.
        for game_id in list(room.games):
            if len(room.games) <= 8:
                break
            if game_id not in attached:
                room.games.pop(game_id, None)


def _state(room: VoiceRoom, game: dict, *, publications: bool) -> dict:
    if not voice_available() or not _game_eligible(game):
        return {"event": "state", "available": False, "room_id": None, "members": [], "publications": []}
    seats = {p["user_id"]: p["id"] for p in game.get("_players", [])
             if type(p.get("user_id")) is int and p["user_id"] in room.allowed_users}
    result = {"event": "state", "available": voice_available(), "room_id": room.id, "members": [
        {"user_id": uid, "player_id": seats[uid], "audio": uid in room.members,
         "microphone": bool(room.members.get(uid) and room.members[uid].microphone),
         "speaking": bool(room.members.get(uid) and room.members[uid].speaking)} for uid in sorted(seats)
    ], "publications": []}
    if publications:
        result["publications"] = [{"user_id": m.user_id, "session_id": m.session_id, "track_name": m.track_name}
                                  for m in room.members.values()
                                  if m.track_name and m.session_id and m.publication_ready and _game_eligible(m.game)]
    return result


async def _broadcast(room: VoiceRoom) -> None:
    # Deliberately not game_realtime.broadcast: spectators receive no voice data.
    for game in list(room.games.values()):
        for player in list(game.get("_players", [])):
            websocket = player.get("ws")
            if websocket is None:
                continue
            identity = resolve_session(websocket)
            if not identity or identity.user_id != player.get("user_id") or user_play_banned(identity.user_id):
                continue
            member = room.members.get(identity.user_id)
            joined = bool(member and member.websocket is websocket)
            try:
                await asyncio.wait_for(websocket.send_json({"hausdepp_voice": _state(room, game, publications=joined)}), 2)
            except (TimeoutError, RuntimeError, OSError):
                continue


def _sdp(value: object, kind: str) -> dict:
    if not isinstance(value, dict) or set(value) != {"type", "sdp"} or value.get("type") != kind:
        raise VoiceError("hausdepp_voice_invalid_request")
    sdp = value.get("sdp")
    if not isinstance(sdp, str) or not 1 <= len(sdp.encode()) <= MAX_SDP_BYTES or "\x00" in sdp:
        raise VoiceError("hausdepp_voice_invalid_request")
    media = [line for line in sdp.splitlines() if line.startswith("m=")]
    if not media or len(media) > 32 or any(not line.startswith("m=audio ") for line in media):
        raise VoiceError("hausdepp_voice_audio_only")
    return {"type": kind, "sdp": sdp}


def _provider_result(result: dict) -> dict:
    clean = {key: result[key] for key in ("sessionDescription", "requiresImmediateRenegotiation", "tracks") if key in result}
    if "sessionDescription" in clean:
        value = clean["sessionDescription"]
        if not isinstance(value, dict) or value.get("type") not in {"offer", "answer"}:
            raise VoiceError("hausdepp_voice_provider_failed")
        _sdp(value, value["type"])
    return clean


def _track_results(member: VoiceMember, result: dict) -> list[dict]:
    tracks = result.get("tracks", [])
    if not isinstance(tracks, list) or len(tracks) > 6:
        raise VoiceError("hausdepp_voice_provider_failed")
    for track in tracks:
        if not isinstance(track, dict):
            raise VoiceError("hausdepp_voice_provider_failed")
        mid = track.get("mid")
        if isinstance(mid, str) and _ID.fullmatch(mid):
            member.mids.add(mid)
    if any(track.get("errorCode") for track in tracks):
        raise VoiceError("hausdepp_voice_provider_failed")
    member.awaiting_answer = bool(result.get("requiresImmediateRenegotiation")
                                  or (result.get("sessionDescription") or {}).get("type") == "offer")
    return tracks


async def _cleanup_member(member: VoiceMember | VoiceCleanup) -> bool:
    """Inspect too: a timed-out provider mutation may have allocated more mids."""
    if member.session_id is None:
        return True
    try:
        state = await provider.request("GET", f"sessions/{member.session_id}")
        if state.get("_session_absent") is True:
            member.mids.clear()
            return True
        for track in state.get("tracks", []):
            if isinstance(track, dict) and isinstance(track.get("mid"), str) and _ID.fullmatch(track["mid"]):
                member.mids.add(track["mid"])
        if not member.mids:
            return True
        result = await provider.request("PUT", f"sessions/{member.session_id}/tracks/close", {
            "tracks": [{"mid": mid} for mid in sorted(member.mids)], "force": True,
        })
        for track in result.get("tracks", []):
            if isinstance(track, dict) and (not track.get("errorCode") or track.get("errorCode") == "close_track_error"):
                member.mids.discard(track.get("mid"))
        return not member.mids
    except VoiceError:
        return False


async def _remove_member(room: VoiceRoom, member: VoiceMember) -> None:
    if room.members.get(member.user_id) is not member:
        return
    room.members.pop(member.user_id, None)
    member.microphone = member.speaking = False
    member.publication_ready = False
    # Withdraw discovery immediately, before network cleanup.
    if not await _cleanup_member(member):
        if not any(job.session_id == member.session_id for job in _cleanup):
            _cleanup.append(VoiceCleanup(member.session_id, set(member.mids)))
        logger.warning("Voice media cleanup queued for retry")


def _start_watchdog() -> None:
    global _watchdog
    if _watchdog is None or _watchdog.done():
        _watchdog = asyncio.create_task(_watch(), name="hausdepp-voice-watchdog")


async def reap_voice(*, now: float | None = None) -> None:
    now = time.monotonic() if now is None else now
    for room in list(_rooms.values()):
        changed = False
        async with room.lock:
            for member in list(room.members.values()):
                identity = resolve_session(member.websocket)
                owns = any(p.get("user_id") == member.user_id and p.get("ws") is member.websocket
                           for p in member.game.get("_players", []))
                expired = (now - member.last_seen > HEARTBEAT_SECONDS
                           or member.disconnected_at is not None and now - member.disconnected_at > RECONNECT_SECONDS)
                if (not voice_available() or not identity or identity.user_id != member.user_id
                        or user_play_banned(member.user_id) or not _game_eligible(member.game) or expired
                        or not owns and member.disconnected_at is None):
                    async with member.lock:
                        await _remove_member(room, member)
                    changed = True
        if changed:
            await _broadcast(room)
    for member in list(_cleanup):
        if now < member.next_attempt:
            continue
        member.attempts += 1
        if await _cleanup_member(member):
            _cleanup.remove(member)
        else:
            member.next_attempt = now + min(60, 2 ** min(member.attempts, 6))
    _prune_rooms(now)


async def _watch() -> None:
    try:
        while _rooms or _cleanup:
            await asyncio.sleep(3)
            await reap_voice()
    except asyncio.CancelledError:
        return


async def stop_voice() -> None:
    """Application shutdown: revoke all publications and retire the watchdog."""
    global _watchdog
    if _watchdog is not None:
        _watchdog.cancel()
        await asyncio.gather(_watchdog, return_exceptions=True)
        _watchdog = None
    for room in list(_rooms.values()):
        async with room.lock:
            for member in list(room.members.values()):
                async with member.lock:
                    await _remove_member(room, member)
    _rooms.clear()
    _allocations.clear()
    _admissions.clear()


async def voice_socket_disconnected(session, *, revoke: bool = False) -> None:
    for room in list(_rooms.values()):
        changed = False
        async with room.lock:
            for member in list(room.members.values()):
                if member.websocket is session.websocket:
                    if revoke:
                        async with member.lock:
                            await _remove_member(room, member)
                        changed = True
                    else:
                        member.disconnected_at = time.monotonic()
        if changed:
            await _broadcast(room)


async def refresh_voice_game(game: dict) -> None:
    if game_type_from_state(game) != HAUSDEPP_GAME_TYPE or not game.get("_hausdepp_voice_room_id"):
        return
    room = await _room_for(game)
    async with room.lock:
        for member in list(room.members.values()):
            if member.game is game and not _game_eligible(game):
                async with member.lock:
                    await _remove_member(room, member)
    await _broadcast(room)


async def handle_voice_action(session, data: dict) -> None:
    request_id = data.get("request_id")
    reply = {"request_id": request_id if isinstance(request_id, str) and _REQUEST_ID.fullmatch(request_id) else None}
    try:
        if reply["request_id"] is None or len(json.dumps(data).encode()) > 98304:
            raise VoiceError("hausdepp_voice_invalid_request")
        identity, player = _actor(session, require_eligible=False)
        operation = data.get("operation")
        if operation not in {"state", "join", "publish", "subscribe", "answer", "microphone", "leave", "heartbeat", "resume"}:
            raise VoiceError("hausdepp_voice_invalid_request")
        if not voice_available():
            if operation == "state":
                reply.update(ok=True, state={"event": "state", "available": False, "room_id": None, "members": [], "publications": []})
            else:
                raise VoiceError("hausdepp_voice_unavailable")
        else:
            room = await _room_for(session.game)
            async with room.lock:
                if operation != "state":
                    _actor(session)
                member = room.members.get(identity.user_id)
                if operation == "state":
                    reply.update(ok=True, state=_state(room, session.game,
                                                      publications=bool(member and member.websocket is session.websocket)))
                elif operation == "join":
                    if member and member.websocket is not session.websocket:
                        async with member.lock:
                            await _remove_member(room, member)
                        member = None
                    if member is None:
                        if len(_cleanup) >= MAX_MEMBERS or sum(len(r.members) for r in _rooms.values()) >= MAX_MEMBERS:
                            raise VoiceError("hausdepp_voice_unavailable")
                        _consume_admission(identity.user_id)
                        member = VoiceMember(identity.user_id, player["id"], session.game, session.websocket,
                                             secrets.token_urlsafe(32))
                        member.ice_servers = await provider.ice_servers()
                        _actor(session)
                        room.members[identity.user_id] = member
                    member.last_seen = time.monotonic()
                    reply.update(ok=True, room_id=room.id, member_token=member.token, session_id=member.session_id,
                                 ice_servers=member.ice_servers, state=_state(room, session.game, publications=True))
                    _start_watchdog()
                else:
                    token = data.get("member_token")
                    if not member or not isinstance(token, str) or not hmac.compare_digest(member.token, token):
                        raise VoiceError("hausdepp_voice_membership_required")
                    if operation == "resume":
                        member.game, member.player_id, member.websocket = session.game, player["id"], session.websocket
                        member.disconnected_at = None
                    elif member.websocket is not session.websocket:
                        raise VoiceError("hausdepp_voice_membership_required")
                    async with member.lock:
                        member.last_seen = time.monotonic()
                        reply.update(ok=True, **await _member_operation(room, member, operation, data, session))
                        if operation != "leave":
                            _actor(session)
            if operation != "state":
                await _broadcast(room)
            # Broadcasting can yield to logout or takeover too. Revalidate
            # immediately before releasing any correlated provider response.
            _actor(session, require_eligible=operation != "state")
    except (VoiceError, TypeError, OverflowError) as exc:
        if (isinstance(exc, VoiceError) and str(exc) in {
                "hausdepp_voice_provider_failed", "hausdepp_voice_forbidden", "hausdepp_voice_unavailable",
        } and "room" in locals()):
            failed_member = room.members.get(identity.user_id)
            if failed_member and failed_member.websocket is session.websocket and failed_member.game is session.game:
                async with room.lock:
                    async with failed_member.lock:
                        await _remove_member(room, failed_member)
                await _broadcast(room)
        reply = {"request_id": reply.get("request_id"), "ok": False,
                 "error_code": str(exc) if isinstance(exc, VoiceError) else "hausdepp_voice_invalid_request"}
    await session.websocket.send_json({"hausdepp_voice": reply})


async def _member_operation(room: VoiceRoom, member: VoiceMember, operation: str, data: dict, session) -> dict:
    if operation == "leave":
        await _remove_member(room, member)
        return {"state": _state(room, session.game, publications=False)}
    if operation in {"heartbeat", "resume"}:
        return {"room_id": room.id, "session_id": member.session_id, "ice_servers": member.ice_servers,
                "state": _state(room, session.game, publications=True)}
    if operation == "microphone":
        enabled, speaking = data.get("enabled"), data.get("speaking", False)
        if type(enabled) is not bool or type(speaking) is not bool or enabled and not member.track_name:
            raise VoiceError("hausdepp_voice_invalid_request")
        if enabled:
            # The publisher acknowledges its connected peer before discovery.
            # Later pauses retain this track and its existing subscriptions.
            member.publication_ready = True
        member.microphone, member.speaking = enabled, enabled and speaking
        return {"state": _state(room, session.game, publications=True)}
    if member.awaiting_answer and operation != "answer":
        raise VoiceError("hausdepp_voice_negotiation_pending")
    if operation == "publish":
        description = _sdp(data.get("sessionDescription"), "offer")
        mid = data.get("mid")
        if member.track_name or not isinstance(mid, str) or not _ID.fullmatch(mid) or f"a=mid:{mid}" not in description["sdp"].splitlines():
            raise VoiceError("hausdepp_voice_invalid_request")
        track_name = secrets.token_hex(16)
        await _ensure_sfu_session(member, session)
        result = await provider.request("POST", f"sessions/{member.session_id}/tracks/new", {
            "sessionDescription": description, "tracks": [{"location": "local", "mid": mid, "trackName": track_name}],
        })
        tracks = _track_results(member, result)
        if len(tracks) != 1 or not result.get("sessionDescription"):
            raise VoiceError("hausdepp_voice_provider_failed")
        member.mids.add(mid)
        member.track_name = track_name
    elif operation == "subscribe":
        user_ids = data.get("user_ids")
        if (not isinstance(user_ids, list) or len(user_ids) > 5 or any(type(uid) is not int for uid in user_ids)
                or len(set(user_ids)) != len(user_ids)):
            raise VoiceError("hausdepp_voice_invalid_request")
        publishers = []
        for uid in user_ids:
            publisher = room.members.get(uid)
            if (uid == member.user_id or uid not in room.allowed_users or not publisher
                    or not publisher.track_name or not publisher.publication_ready):
                raise VoiceError("hausdepp_voice_forbidden")
            previous = member.subscriptions.get(uid)
            if not previous or previous[1:] != (publisher.session_id, publisher.track_name):
                publishers.append(publisher)
        removed = []
        for uid, (mid, session_id, track_name) in list(member.subscriptions.items()):
            publisher = room.members.get(uid)
            if uid not in user_ids or not publisher or (publisher.session_id, publisher.track_name) != (session_id, track_name):
                result = await provider.request("PUT", f"sessions/{member.session_id}/tracks/close", {
                    "tracks": [{"mid": mid}], "force": True,
                })
                track_results = result.get("tracks", [])
                if not any(track.get("mid") == mid and (not track.get("errorCode") or track.get("errorCode") == "close_track_error")
                           for track in track_results if isinstance(track, dict)):
                    raise VoiceError("hausdepp_voice_provider_failed")
                member.subscriptions.pop(uid, None)
                member.mids.discard(mid)
                removed.append({"user_id": uid, "mid": mid})
        if not publishers:
            return {"session_id": member.session_id, "tracks": [], "removed": removed,
                    "requiresImmediateRenegotiation": False}
        await _ensure_sfu_session(member, session)
        result = await provider.request("POST", f"sessions/{member.session_id}/tracks/new", {
            "tracks": [{"location": "remote", "sessionId": p.session_id, "trackName": p.track_name} for p in publishers],
        })
        tracks = _track_results(member, result)
        if len(tracks) != len(publishers) or not result.get("sessionDescription"):
            raise VoiceError("hausdepp_voice_provider_failed")
        for index, track in enumerate(tracks):
            publisher = next((p for p in publishers if track.get("sessionId") == p.session_id and track.get("trackName") == p.track_name),
                             publishers[index] if index < len(publishers) else None)
            if publisher and isinstance(track.get("mid"), str):
                member.subscriptions[publisher.user_id] = (track["mid"], publisher.session_id, publisher.track_name)
                track["user_id"] = publisher.user_id
        result["removed"] = removed
    elif operation == "answer":
        if not member.awaiting_answer:
            raise VoiceError("hausdepp_voice_invalid_request")
        result = await provider.request("PUT", f"sessions/{member.session_id}/renegotiate", {
            "sessionDescription": _sdp(data.get("sessionDescription"), "answer"),
        })
        member.awaiting_answer = False
    else:
        raise VoiceError("hausdepp_voice_invalid_request")
    return {**_provider_result(result), "session_id": member.session_id,
            **({"removed": result["removed"]} if "removed" in result else {})}
