"""Independent race checks around account revocation and changing voice groups."""

from __future__ import annotations

import asyncio
import os
import unittest
from unittest.mock import patch

from app import hausdepp_voice as voice
from app.game_ws_session import GameSocketSession
from tests.test_hausdepp_voice import FakeProvider, VoiceSocket, description


class BarrierProvider(FakeProvider):
    def __init__(self):
        super().__init__()
        self.block_location = None
        self.block_new = False
        self.block_ice = False
        self.entered = asyncio.Event()
        self.release = asyncio.Event()

    async def ice_servers(self):
        if self.block_ice:
            self.entered.set()
            await self.release.wait()
        return await super().ice_servers()

    async def request(self, method, path, payload=None):
        if (path == "sessions/new" and self.block_new or
                path.endswith("tracks/new") and payload and payload.get("tracks")
                and payload["tracks"][0].get("location") == self.block_location):
            self.entered.set()
            await self.release.wait()
        return await super().request(method, path, payload)


class HausdeppVoiceSecurityTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.provider = BarrierProvider()
        self.environment = patch.dict(os.environ, {
            "ROLLTHEDICE_VOICE_ENABLED": "1", "ROLLTHEDICE_VOICE_SFU_APP_ID": "test-app",
            "ROLLTHEDICE_VOICE_SFU_APP_SECRET": "test-secret",
            "ROLLTHEDICE_VOICE_TURN_KEY_ID": "", "ROLLTHEDICE_VOICE_TURN_API_TOKEN": "",
        })
        self.environment.start()
        self.provider_patch = patch.object(voice, "provider", self.provider)
        self.provider_patch.start()
        self.authentication = patch.object(voice, "resolve_session", lambda socket: socket.identity)
        self.authentication.start()
        self.bans = patch.object(voice, "user_play_banned", return_value=False)
        self.bans.start()
        self.game = {"_id": "security-table", "_game_type": "hausdepp", "_players": [], "_aborted": False}
        self.sessions = []
        for uid in (1, 2):
            websocket = VoiceSocket(uid)
            player_id = f"security-player-{uid}"
            self.game["_players"].append({"id": player_id, "user_id": uid, "ws": websocket})
            self.sessions.append(GameSocketSession(websocket, self.game, websocket.identity, player_id=player_id))
        self.sequence = 0

    async def asyncTearDown(self):
        self.provider.release.set()
        await voice.stop_voice()
        voice._cleanup.clear()
        self.bans.stop()
        self.authentication.stop()
        self.provider_patch.stop()
        self.environment.stop()

    async def command(self, index, operation, **payload):
        self.sequence += 1
        request_id = f"security-{self.sequence}"
        websocket = self.sessions[index].websocket
        await voice.handle_voice_action(self.sessions[index], {
            "request_id": request_id, "operation": operation, **payload,
        })
        return next(message["hausdepp_voice"] for message in reversed(websocket.messages)
                    if message.get("hausdepp_voice", {}).get("request_id") == request_id)

    async def join(self, index):
        reply = await self.command(index, "join")
        self.assertTrue(reply["ok"], reply)
        return reply["member_token"]

    async def test_roster_change_waits_for_inflight_allocation_then_retires_its_media(self):
        token = await self.join(0)
        room = voice._rooms[self.game["_hausdepp_voice_room_id"]]
        self.provider.block_location = "local"
        publishing = asyncio.create_task(self.command(0, "publish", member_token=token,
                                                     sessionDescription=description(), mid="0"))
        await asyncio.wait_for(self.provider.entered.wait(), 2)
        self.game["_players"].append({"id": "outsider", "user_id": 3, "ws": VoiceSocket(3)})
        refresh_entered = asyncio.Event()
        original_room_for = voice._room_for

        async def observe_refresh(game):
            refresh_entered.set()
            return await original_room_for(game)

        refreshing = None
        try:
            with patch.object(voice, "_room_for", observe_refresh):
                refreshing = asyncio.create_task(voice.refresh_voice_game(self.game))
                await asyncio.wait_for(refresh_entered.wait(), 2)
                # Inspecting before the paused allocation finishes can miss its
                # eventual track. The same room lock must serialize both paths.
                self.assertFalse(any(method == "GET" for method, _, _ in self.provider.calls))
        finally:
            self.provider.release.set()
            await asyncio.gather(publishing, *([refreshing] if refreshing else []))
        self.assertNotEqual(room.id, self.game["_hausdepp_voice_room_id"])
        self.assertEqual(room.members, {})
        self.assertTrue(all(not tracks for tracks in self.provider.sessions.values()))

    async def test_logout_during_publish_rejects_success_and_retires_late_media(self):
        token = await self.join(0)
        self.provider.block_location = "local"
        publishing = asyncio.create_task(self.command(0, "publish", member_token=token,
                                                     sessionDescription=description(), mid="0"))
        try:
            await asyncio.wait_for(self.provider.entered.wait(), 2)
            self.sessions[0].websocket.identity = None
        finally:
            self.provider.release.set()
        reply = await publishing
        self.assertFalse(reply["ok"], reply)
        self.assertNotIn("sessionDescription", reply)
        self.assertNotIn(1, voice._rooms[self.game["_hausdepp_voice_room_id"]].members)
        self.assertTrue(all(not tracks for tracks in self.provider.sessions.values()))

    async def test_logout_during_join_ice_rejects_membership_without_allocating_media(self):
        self.provider.block_ice = True
        joining = asyncio.create_task(self.command(0, "join"))
        try:
            await asyncio.wait_for(self.provider.entered.wait(), 2)
            self.sessions[0].websocket.identity = None
        finally:
            self.provider.release.set()
        reply = await joining
        self.assertFalse(reply["ok"], reply)
        self.assertEqual(reply["error_code"], "hausdepp_voice_forbidden")
        self.assertNotIn("sessionDescription", reply)
        self.assertNotIn("session_id", reply)
        self.assertNotIn("member_token", reply)
        self.assertEqual(voice._rooms[self.game["_hausdepp_voice_room_id"]].members, {})
        self.assertEqual(self.provider.calls, [])
        self.assertEqual(self.provider.sessions, {})

    async def test_logout_during_lazy_session_allocation_cleans_known_id_without_publishing(self):
        token = await self.join(0)
        self.assertEqual(self.provider.calls, [])
        self.provider.block_new = True
        publishing = asyncio.create_task(self.command(0, "publish", member_token=token,
                                                     sessionDescription=description(), mid="0"))
        try:
            await asyncio.wait_for(self.provider.entered.wait(), 2)
            room = voice._rooms[self.game["_hausdepp_voice_room_id"]]
            self.assertTrue(room.lock.locked())
            self.assertTrue(room.members[1].lock.locked())
            self.sessions[0].websocket.identity = None
        finally:
            self.provider.release.set()
        reply = await publishing
        self.assertFalse(reply["ok"], reply)
        self.assertEqual(reply["error_code"], "hausdepp_voice_forbidden")
        self.assertNotIn("sessionDescription", reply)
        self.assertNotIn("session_id", reply)
        self.assertNotIn(1, room.members)
        self.assertFalse(any(path.endswith("tracks/new") for _, path, _ in self.provider.calls))
        self.assertIn(("GET", "sessions/s1", None), self.provider.calls)
        self.assertEqual(self.provider.sessions, {"s1": {}})
        self.assertEqual(voice._cleanup, [])

    async def test_logout_during_subscribe_closes_new_receive_track_before_reply(self):
        publisher_token, listener_token = await self.join(0), await self.join(1)
        published = await self.command(0, "publish", member_token=publisher_token,
                                       sessionDescription=description(), mid="0")
        self.assertTrue(published["ok"], published)
        ready = await self.command(0, "microphone", member_token=publisher_token, enabled=True)
        self.assertTrue(ready["ok"], ready)
        self.provider.block_location = "remote"
        subscribing = asyncio.create_task(self.command(1, "subscribe", member_token=listener_token, user_ids=[1]))
        try:
            await asyncio.wait_for(self.provider.entered.wait(), 2)
            self.sessions[1].websocket.identity = None
        finally:
            self.provider.release.set()
        reply = await subscribing
        self.assertFalse(reply["ok"], reply)
        self.assertNotIn("sessionDescription", reply)
        self.assertEqual(self.provider.sessions["s2"], {})
        self.assertNotIn(2, voice._rooms[self.game["_hausdepp_voice_room_id"]].members)

    async def test_room_cap_cannot_evict_a_pending_join_with_no_member_yet(self):
        self.provider.block_ice = True
        with patch.object(voice, "MAX_ROOMS", 1):
            joining = asyncio.create_task(self.command(0, "join"))
            try:
                await asyncio.wait_for(self.provider.entered.wait(), 2)
                room_id = self.game["_hausdepp_voice_room_id"]
                room = voice._rooms[room_id]
                self.assertTrue(room.lock.locked())
                self.assertEqual(room.members, {})
                websocket = VoiceSocket(3)
                other_game = {"_id": "capacity-table", "_game_type": "hausdepp", "_aborted": False,
                              "_players": [{"id": "other-player", "user_id": 3, "ws": websocket}]}
                self.sessions.append(GameSocketSession(websocket, other_game, websocket.identity, player_id="other-player"))
                rejected = await self.command(2, "state")
                self.assertFalse(rejected["ok"], rejected)
                self.assertEqual(rejected["error_code"], "hausdepp_voice_unavailable")
                self.assertEqual(list(voice._rooms), [room_id])
                self.assertIs(voice._rooms[room_id], room)
            finally:
                self.provider.release.set()
                joined = await joining
        self.assertTrue(joined["ok"], joined)
        self.assertIn(1, voice._rooms[room_id].members)
        self.assertIsNone(joined["session_id"])
        self.assertEqual(self.provider.calls, [])

    async def test_status_without_audio_does_not_retain_an_idle_table(self):
        state = await self.command(0, "state")
        self.assertTrue(state["ok"], state)
        room_id = state["state"]["room_id"]
        room = voice._rooms[room_id]
        self.assertEqual(room.members, {})
        await voice.reap_voice(now=room.last_used + 61)
        self.assertNotIn(room_id, voice._rooms)
        self.assertEqual(self.provider.calls, [])
