"""Real ZDWA voice actions reuse the private table transport, never gameplay RNG."""

import json
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, WebSocketDisconnect
from starlette.testclient import TestClient

from app import hausdepp_voice as voice
from app import main, voice_activity
from app.active_games import load_active_games
from app.game_registry import start_game_if_ready
from app.game_snapshot import snapshot
from app.game_state import games, new_game
from app.game_websocket import MessageRateLimiter, _receive_messages
from app.game_ws_session import GameSocketSession, disconnect_session, handle_session_action
from tests import test_game_tours as accounts
from tests import test_hausdepp_voice as media

account = accounts.account
tour_store = accounts.tour_store


class Socket(media.VoiceSocket):
    def __init__(self, user_id):
        super().__init__(user_id)
        self.identity = SimpleNamespace(user_id=user_id, username=f"Voice{user_id}", achievement_rank={})
        self.frames = []
        self.cookies = {}
        self.close_codes = []

    async def receive_json(self):
        if self.frames:
            return self.frames.pop(0)
        raise WebSocketDisconnect()

    async def close(self, code=1000):
        self.close_codes.append(code)


class ZdwaVoiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.previous_games = set(games)
        await media.HausdeppVoiceTests.asyncSetUp(self)
        self.persistence = patch("app.game_state.save_active_game")
        self.persistence.start()

    async def asyncTearDown(self):
        await media.HausdeppVoiceTests.asyncTearDown(self)
        self.persistence.stop()
        for game_id in set(games) - self.previous_games:
            games.pop(game_id, None)

    @staticmethod
    def table(game_id, user_ids):
        game = new_game(game_id, "Voice table", max(2, len(user_ids)))
        sessions = []
        for user_id in user_ids:
            socket = Socket(user_id)
            player_id = f"{game_id}-p{user_id}"
            game["_players"].append({"id": player_id, "user_id": user_id, "ws": socket, "name": socket.identity.username})
            game["_scoreboards"][player_id] = {}
            sessions.append(GameSocketSession(socket, game, socket.identity, player_id=player_id))
        return game, sessions

    async def command(self, session, operation, **kwargs):
        self.counter += 1
        request_id = f"z{self.counter}"
        await voice.handle_voice_action(session, {"action": "zdwa_voice", "request_id": request_id,
                                                   "operation": operation, **kwargs})
        return next(message["zdwa_voice"] for message in reversed(session.websocket.messages)
                    if message.get("zdwa_voice", {}).get("request_id") == request_id)

    join = media.HausdeppVoiceTests.join
    publish = media.HausdeppVoiceTests.publish

    async def test_waiting_to_real_start_keeps_the_same_voice_room_and_explicit_microphone(self):
        token = await self.join()
        self.assertEqual(self.fake.calls, [])
        await self.publish(0, token)
        await self.command(self.sessions[0], "microphone", member_token=token, enabled=True)
        room_id = self.game["_zdwa_voice_room_id"]
        start_game_if_ready(self.game)
        self.assertTrue(self.game["_started"])
        await voice.refresh_voice_game(self.game)
        self.assertEqual(self.game["_zdwa_voice_room_id"], room_id)
        self.assertTrue(voice._rooms[room_id].members[1].microphone)
        self.assertNotIn("_hausdepp_voice_room_id", self.game)

    async def test_private_state_and_sdp_never_reach_spectators_guests_or_scoreboards(self):
        spectator = Socket(4)
        self.game["_spectators"].append({"id": "watcher", "user_id": 4, "ws": spectator})
        guest = Socket(5)
        guest.identity = None
        self.game["_players"].append({"id": "guest", "ws": guest, "name": "Guest", "user_id": None})
        token = await self.join()
        await self.publish(0, token)
        await self.command(self.sessions[0], "microphone", member_token=token, enabled=True)
        self.assertEqual(spectator.messages, [])
        self.assertEqual(guest.messages, [])
        unjoined = self.sessions[1].websocket.messages[-1]["zdwa_voice"]
        self.assertEqual(unjoined["publications"], [])
        public = json.dumps(snapshot(self.game))
        for secret in (token, self.game["_zdwa_voice_room_id"], "sessionDescription", "member_token", "allowed_user_ids"):
            self.assertNotIn(secret, public)

    async def test_current_seat_authentication_and_non_cpu_actor_remain_mandatory(self):
        original = self.sessions[0]
        cases = [GameSocketSession(Socket(1), self.game, original.auth_identity, player_id=original.player_id),
                 GameSocketSession(original.websocket, self.game, original.auth_identity,
                                   player_id=original.player_id, is_spectator=True)]
        for session in cases:
            self.assertEqual((await self.command(session, "join"))["error_code"], "hausdepp_voice_forbidden")
        for identity in (None, SimpleNamespace(user_id=99)):
            original.websocket.identity = identity
            self.assertEqual((await self.command(original, "join"))["error_code"], "hausdepp_voice_forbidden")
        original.websocket.identity = original.auth_identity
        self.game["_players"][0]["is_cpu"] = True
        self.assertEqual((await self.command(original, "join"))["error_code"], "hausdepp_voice_forbidden")
        self.assertEqual(self.fake.ice_calls, 0)

    async def test_solo_and_disabled_tables_have_no_voice_and_zilch_stays_excluded(self):
        self.game["_voice_enabled"] = False
        self.assertFalse((await self.command(self.sessions[0], "state"))["state"]["available"])
        self.game["_voice_enabled"] = True
        self.game["_players"] = self.game["_players"][:1]
        self.game["_started"] = True
        # A fake legacy participant list cannot supply ZDWA's second own seat.
        self.game["_participants"] = [{"user_id": 2}, {"user_id": 3, "is_cpu": True}]
        self.assertFalse((await self.command(self.sessions[0], "state"))["state"]["available"])
        self.game["_game_type"] = "zilch"
        await voice.handle_voice_action(self.sessions[0], {"request_id": "zilch", "operation": "join"})
        self.assertEqual(self.sessions[0].websocket.messages[-1]["hausdepp_voice"]["error_code"], "hausdepp_voice_forbidden")
        self.assertEqual(self.fake.ice_calls, 0)

    async def test_authorized_new_game_resume_stops_microphone_without_widening_the_roster(self):
        token = await self.join()
        await self.publish(0, token)
        await self.command(self.sessions[0], "microphone", member_token=token, enabled=True)
        source_room = self.game["_zdwa_voice_room_id"]
        self.game["_zdwa_voice_allowed_user_ids"] = [1, 2]
        target, sessions = self.table("next-round", [1, 2])
        voice.carry_voice_room(self.game, target, {1, 2, 3, 999})
        self.assertEqual(target["_zdwa_voice_allowed_user_ids"], [1, 2])
        original_room = voice._rooms[source_room]
        result = await self.command(sessions[0], "resume", member_token=token)
        self.assertTrue(result["ok"], result)
        member = voice._rooms[source_room].members[1]
        self.assertIs(member.game, target)
        self.assertFalse(member.microphone)
        self.assertFalse(member.speaking)
        # A genuinely new account rotates the private room, rather than joining
        # a source conversation through the copied allowlist.
        stranger = Socket(99)
        target["_players"].append({"id": "new-person", "user_id": 99, "ws": stranger, "name": "New"})
        await voice.refresh_voice_game(target)
        self.assertNotEqual(target["_zdwa_voice_room_id"], source_room)
        self.assertEqual(original_room.members, {})
        self.assertNotIn(source_room, voice._rooms)
        self.assertEqual(self.fake.sessions["s1"], {})

    async def test_real_rejoin_retires_old_device_media_and_old_token_cannot_resume(self):
        token = await self.join()
        await self.publish(0, token)
        await self.command(self.sessions[0], "microphone", member_token=token, enabled=True)
        player_id = self.sessions[0].player_id
        socket = Socket(1)
        current = GameSocketSession(socket, self.game, socket.identity)
        with patch("app.game_ws_session.user_play_banned", return_value=False), \
                patch("app.game_ws_session.broadcast", new=AsyncMock()), \
                patch("app.game_ws_session.clear_admin_away_on_rejoin"):
            self.assertFalse(await handle_session_action(current, "rejoin_game", {"player_id": player_id}))
        self.assertNotIn(1, voice._rooms[self.game["_zdwa_voice_room_id"]].members)
        self.assertEqual(self.sessions[0].websocket.close_codes, [1000])
        rejected = await self.command(self.sessions[0], "resume", member_token=token)
        self.assertFalse(rejected["ok"])
        joined = await self.command(current, "join")
        self.assertTrue(joined["ok"])
        self.assertNotEqual(joined["member_token"], token)
        self.assertFalse(joined["state"]["members"][0]["microphone"])

    async def test_late_provider_allocation_after_account_change_returns_no_sdp_or_session(self):
        token = await self.join()
        original_request = self.fake.request

        async def switch_after_allocation(method, path, payload=None):
            result = await original_request(method, path, payload)
            if path == "sessions/new":
                self.sessions[0].websocket.identity = SimpleNamespace(user_id=99)
            return result

        with patch.object(self.fake, "request", side_effect=switch_after_allocation):
            result = await self.command(self.sessions[0], "publish", member_token=token,
                                        sessionDescription=media.description(), mid="0")
        self.assertEqual(result["error_code"], "hausdepp_voice_forbidden")
        self.assertNotIn("session_id", result)
        self.assertNotIn("sessionDescription", result)
        self.assertEqual(self.fake.sessions["s1"], {})
        self.assertEqual(voice._rooms[self.game["_zdwa_voice_room_id"]].members, {})

    async def test_disconnect_has_grace_but_terminal_abort_immediately_retires_members(self):
        await self.join()
        room = voice._rooms[self.game["_zdwa_voice_room_id"]]
        with patch("app.game_ws_session.broadcast", new=AsyncMock()):
            await disconnect_session(self.sessions[0])
        self.assertIsNotNone(room.members[1].disconnected_at)
        self.game["_aborted"] = True
        await main._close_terminal_connections(self.game)
        self.assertEqual(room.members, {})

    async def test_actual_dispatch_accepts_only_the_zdwa_voice_envelope(self):
        socket = self.sessions[0].websocket
        socket.frames = [{"action": "hausdepp_voice", "request_id": "wrong", "operation": "join"},
                         {"action": "zdwa_voice", "request_id": "right", "operation": "state"}]
        with patch("app.game_websocket.user_play_banned", return_value=False):
            with self.assertRaises(WebSocketDisconnect):
                await _receive_messages(self.sessions[0], limiter=MessageRateLimiter(), finalize_game=lambda _game: None)
        self.assertTrue(any(message.get("zdwa_voice", {}).get("request_id") == "right" for message in socket.messages))
        self.assertTrue(any("hausdepp_voice" in message.get("error", "") for message in socket.messages))

    async def test_zilch_dispatch_rejects_zdwa_voice_before_provider_allocation(self):
        self.game["_game_type"] = "zilch"
        socket = self.sessions[0].websocket
        socket.frames = [{"action": "zdwa_voice", "request_id": "wrong", "operation": "join"}]
        with patch("app.game_websocket.user_play_banned", return_value=False), \
                patch("app.game_websocket.resolve_session", return_value=socket.identity), \
                patch("app.game_websocket.can_access_game", return_value=True):
            with self.assertRaises(WebSocketDisconnect):
                await _receive_messages(self.sessions[0], limiter=MessageRateLimiter(), finalize_game=lambda _game: None)
        self.assertTrue(any("zdwa_voice" in message.get("error", "") for message in socket.messages))
        self.assertFalse(any("zdwa_voice" in message for message in socket.messages))
        self.assertEqual(self.fake.ice_calls, 0)

    async def test_tracking_counts_only_authorized_join_and_pauses_disconnect_and_handoff_gaps(self):
        clock, rows = [0], []
        wall = datetime(2026, 10, 25, tzinfo=timezone.utc)

        def observe(counter, **kwargs):
            return voice_activity.observe_activity(counter, **kwargs, now=clock[0],
                                                   wall_time=wall + timedelta(seconds=clock[0]))

        def enqueue(values):
            rows.extend(values)
            return True

        with patch.object(voice, "observe_activity", side_effect=observe), \
                patch("app.analytics.enqueue_voice_activity", side_effect=enqueue):
            await self.command(self.sessions[0], "state")
            with patch.object(self.fake, "ice_servers", side_effect=voice.VoiceError("hausdepp_voice_provider_failed")):
                self.assertFalse((await self.command(self.sessions[0], "join"))["ok"])
            self.assertEqual(rows, [])
            token = await self.join()
            clock[0] = 10
            await self.command(self.sessions[0], "heartbeat", member_token=token)
            clock[0] = 15
            await voice.voice_socket_disconnected(self.sessions[0])
            clock[0] = 100
            await self.command(self.sessions[0], "resume", member_token=token)
            clock[0] = 110
            await self.command(self.sessions[0], "heartbeat", member_token=token)
            target, sessions = self.table("tracked-next-game", [1, 2])
            voice.carry_voice_room(self.game, target, {1, 2, 3})
            clock[0] = 120
            self.assertTrue((await self.command(sessions[0], "resume", member_token=token))["ok"])
            clock[0] = 125
            self.assertTrue((await self.command(sessions[0], "leave", member_token=token))["ok"])
            self.assertEqual(sum(row["activations"] for row in rows), 1)
            self.assertEqual(sum(row["connected_ms"] for row in rows), 30000)
            self.assertEqual({row["game_id"] for row in rows}, {self.game["_id"], target["_id"]})
            count = len(rows)
            self.assertFalse((await self.command(sessions[0], "heartbeat", member_token=token))["ok"])
            self.assertEqual(len(rows), count)
            # A fresh explicitly confirmed join after revocation is a new activation.
            clock[0] = 130
            self.assertTrue((await self.command(sessions[0], "join"))["ok"])
            self.assertEqual(sum(row["activations"] for row in rows), 2)


@pytest.fixture
def creation(account, monkeypatch):
    application = FastAPI()
    application.add_api_route("/api/games", main.api_games_create, methods=["POST"])
    monkeypatch.setattr(main, "enforce_game_creation_rate_limit", lambda _request: None)
    previous = set(games)
    with TestClient(application) as client:
        client.cookies.update(account.client.cookies)
        client.headers.update(account.client.headers)
        yield client, account.user_id
    for game_id in set(games) - previous:
        games.pop(game_id, None)


def test_create_voice_flag_survives_recovery_and_new_round_has_validated_public_lineage(creation):
    client, user_id = creation
    source = new_game("zdwa-source", "Source", 2)
    source.update(_finished=True, _voice_enabled=False, _zdwa_voice_room_id="private-sfu-room",
                  _zdwa_voice_allowed_user_ids=[user_id])
    source["_players"] = [{"id": "owner", "name": "Owner", "user_id": user_id},
                          {"id": "other", "name": "Other", "user_id": user_id + 1}]
    response = client.post("/api/games", json={"name": "Next", "mode": "2", "voice_enabled": False,
                                                "source_game_id": source["_id"]})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["source_game_id"] == source["_id"]
    assert data["voice_group_id"] == source["_id"]
    target = games[data["game_id"]]
    assert target["_zdwa_voice_allowed_user_ids"] == [user_id]
    public = snapshot(target)
    assert public["_voice_enabled"] is False
    assert public["_voice_group_id"] == source["_id"]
    assert "private-sfu-room" not in json.dumps(public)
    # The second original player did not create the target. Its authorized
    # scoreboard still supplies the same non-secret lineage for local intent.
    target["_players"] = [{**player, "id": f"next-{player['id']}"} for player in source["_players"]]
    assert snapshot(target, "next-owner")["_voice_group_id"] == source["_id"]
    assert snapshot(target, "next-other")["_voice_group_id"] == source["_id"]
    restored = load_active_games()[data["game_id"]]
    assert restored["_voice_enabled"] is False
    assert restored["_voice_group_id"] == source["_id"]
    assert restored["_zdwa_voice_room_id"] == "private-sfu-room"


@pytest.mark.parametrize("failure,status", [("unknown", 404), ("ongoing", 409), ("aborted", 409),
                                            ("foreign", 403), ("guestseat", 403), ("zilch", 409),
                                            ("guest", 401), ("csrf", 403), ("origin", 403), ("target_zilch", 400)])
def test_new_round_rejects_unproven_source_before_publishing_any_table(creation, failure, status):
    client, user_id = creation
    source = new_game("zdwa-source-reject", "Source", 2)
    source.update(_finished=True)
    source["_players"] = [{"id": "owner", "user_id": user_id}]
    source_id = source["_id"]
    if failure == "unknown":
        source_id = "unknown-source"
    elif failure == "ongoing":
        source["_finished"] = False
    elif failure == "aborted":
        source["_aborted"] = True
    elif failure in {"foreign", "guestseat"}:
        source["_players"][0]["user_id"] = user_id + 1 if failure == "foreign" else None
    elif failure == "zilch":
        source["_game_type"] = "zilch"
    elif failure == "guest":
        client.cookies.clear()
    elif failure == "csrf":
        client.headers["x-csrf-token"] = "wrong"
    elif failure == "origin":
        client.headers["origin"] = "https://foreign.test"
    before = set(games)
    response = client.post("/api/games", json={"name": "Next", "mode": "2", "source_game_id": source_id,
                                                "game_type": "zilch" if failure == "target_zilch" else "zdwa"})
    assert response.status_code == status, response.text
    assert set(games) == before


def test_plain_guest_creation_stays_compatible_and_voice_flag_is_strict(creation):
    client, _user_id = creation
    client.cookies.clear()
    response = client.post("/api/games", json={"name": "Guest", "mode": "2", "voice_enabled": True})
    assert response.status_code == 200
    assert set(response.json()) == {"game_id"}
    for value in ("true", 1, None):
        assert client.post("/api/games", json={"name": "Guest", "mode": "2", "voice_enabled": value}).status_code == 422
