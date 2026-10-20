"""Voice permissions, provider isolation and retirement without live media."""

from __future__ import annotations

import copy
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError

from app import hausdepp_voice as voice
from app.game_ws_session import GameSocketSession


def description(kind="offer", mid="0", media="audio"):
    return {"type": kind, "sdp": f"v=0\r\nm={media} 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:{mid}\r\na=sendrecv\r\n"}


class VoiceSocket:
    def __init__(self, user_id):
        self.identity = SimpleNamespace(user_id=user_id)
        self.messages = []

    async def send_json(self, message):
        self.messages.append(copy.deepcopy(message))


class FakeProvider:
    def __init__(self):
        self.calls = []
        self.sessions = {}
        self.fail_publish = False
        self.fail_close = False

    async def ice_servers(self):
        return [{"urls": ["stun:stun.cloudflare.com:3478"]}]

    async def request(self, method, path, payload=None):
        self.calls.append((method, path, copy.deepcopy(payload)))
        if path == "sessions/new":
            session_id = f"s{len(self.sessions) + 1}"
            self.sessions[session_id] = {}
            return {"sessionId": session_id}
        session_id = path.split("/")[1]
        tracks = self.sessions[session_id]
        if method == "GET":
            return {"tracks": list(tracks.values())}
        if path.endswith("tracks/close"):
            if self.fail_close:
                raise voice.VoiceError("hausdepp_voice_provider_failed")
            for track in payload["tracks"]:
                tracks.pop(track["mid"], None)
            return {"tracks": payload["tracks"], "requiresImmediateRenegotiation": False}
        if path.endswith("renegotiate"):
            return {}
        result_tracks = []
        for item in payload["tracks"]:
            mid = item.get("mid", str(len(tracks)))
            track = {**item, "mid": mid}
            tracks[mid] = track
            result_tracks.append(track)
        remote = payload["tracks"][0]["location"] == "remote"
        if self.fail_publish:
            result_tracks[0]["errorCode"] = "internal_error"
        return {"sessionDescription": description("offer" if remote else "answer"),
                "tracks": result_tracks, "requiresImmediateRenegotiation": remote}


class HausdeppVoiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict(os.environ, {"ROLLTHEDICE_VOICE_ENABLED": "1",
                                          "ROLLTHEDICE_VOICE_SFU_APP_ID": "test-app",
                                          "ROLLTHEDICE_VOICE_SFU_APP_SECRET": "test-secret",
                                          "ROLLTHEDICE_VOICE_TURN_KEY_ID": "",
                                          "ROLLTHEDICE_VOICE_TURN_API_TOKEN": ""})
        self.env.start()
        self.fake = FakeProvider()
        self.provider_patch = patch.object(voice, "provider", self.fake)
        self.provider_patch.start()
        self.auth_patch = patch.object(voice, "resolve_session", lambda socket: socket.identity)
        self.auth_patch.start()
        self.ban_patch = patch.object(voice, "user_play_banned", return_value=False)
        self.ban_patch.start()
        self.game, self.sessions = self.table("table-a", [1, 2, 3])
        self.counter = 0

    async def asyncTearDown(self):
        self.fake.fail_close = False
        await voice.stop_voice()
        voice._cleanup.clear()
        self.ban_patch.stop()
        self.auth_patch.stop()
        self.provider_patch.stop()
        self.env.stop()

    @staticmethod
    def table(game_id, user_ids):
        game = {"_id": game_id, "_game_type": "hausdepp", "_players": [], "_spectators": [],
                "_last_activity": "unchanged", "_aborted": False}
        sessions = []
        for user_id in user_ids:
            socket = VoiceSocket(user_id)
            player_id = f"{game_id}-p{user_id}"
            game["_players"].append({"id": player_id, "user_id": user_id, "ws": socket})
            sessions.append(GameSocketSession(socket, game, socket.identity, player_id=player_id))
        return game, sessions

    async def command(self, session, operation, **kwargs):
        self.counter += 1
        request_id = f"r{self.counter}"
        await voice.handle_voice_action(session, {"action": "hausdepp_voice", "request_id": request_id,
                                                   "operation": operation, **kwargs})
        return next(message["hausdepp_voice"] for message in reversed(session.websocket.messages)
                    if message.get("hausdepp_voice", {}).get("request_id") == request_id)

    async def join(self, index=0):
        result = await self.command(self.sessions[index], "join")
        self.assertTrue(result["ok"], result)
        return result["member_token"]

    async def publish(self, index, token):
        result = await self.command(self.sessions[index], "publish", member_token=token,
                                    sessionDescription=description(), mid="0")
        self.assertTrue(result["ok"], result)
        return result

    async def test_disabled_or_unconfigured_feature_exposes_no_provider_identifiers(self):
        for missing in ("ROLLTHEDICE_VOICE_ENABLED", "ROLLTHEDICE_VOICE_SFU_APP_ID", "ROLLTHEDICE_VOICE_SFU_APP_SECRET"):
            with patch.dict(os.environ, {missing: ""}):
                state = await self.command(self.sessions[0], "state")
                self.assertEqual(state["state"], {"event": "state", "available": False, "room_id": None,
                                                   "members": [], "publications": []})
                joined = await self.command(self.sessions[0], "join")
                self.assertEqual(joined["error_code"], "hausdepp_voice_unavailable")
        self.assertEqual(self.fake.calls, [])

    async def test_guest_spectator_stale_socket_foreign_account_and_banned_account_are_rejected(self):
        session = self.sessions[0]
        cases = [GameSocketSession(VoiceSocket(1), self.game, session.auth_identity, player_id=session.player_id),
                 GameSocketSession(session.websocket, self.game, session.auth_identity, player_id=session.player_id,
                                   is_spectator=True)]
        for candidate in cases:
            self.assertEqual((await self.command(candidate, "join"))["error_code"], "hausdepp_voice_forbidden")
        session.websocket.identity = None
        self.assertFalse((await self.command(session, "join"))["ok"])
        session.websocket.identity = SimpleNamespace(user_id=99)
        self.assertFalse((await self.command(session, "join"))["ok"])
        session.websocket.identity = session.auth_identity
        with patch.object(voice, "user_play_banned", return_value=True):
            self.assertFalse((await self.command(session, "join"))["ok"])
        self.assertEqual(self.fake.calls, [])

    async def test_unjoined_seats_get_status_only_and_spectators_get_nothing(self):
        spectator = VoiceSocket(4)
        self.game["_spectators"].append({"id": "spectator", "user_id": 4, "ws": spectator})
        token = await self.join()
        await self.publish(0, token)
        other_state = self.sessions[1].websocket.messages[-1]["hausdepp_voice"]
        self.assertEqual(other_state["publications"], [])
        self.assertTrue(other_state["members"][0]["audio"])
        self.assertNotIn("member_token", json.dumps(other_state))
        self.assertNotIn("s1", json.dumps(other_state))
        self.assertEqual(spectator.messages, [])
        own_state = await self.command(self.sessions[0], "state")
        self.assertEqual(len(own_state["state"]["publications"]), 1)

    async def test_publish_subscribe_answer_and_microphone_state(self):
        token_a, token_b = await self.join(0), await self.join(1)
        invalid = await self.command(self.sessions[0], "microphone", member_token=token_a, enabled=True)
        self.assertFalse(invalid["ok"])
        await self.publish(0, token_a)
        mic = await self.command(self.sessions[0], "microphone", member_token=token_a, enabled=True, speaking=True)
        self.assertTrue(mic["state"]["members"][0]["speaking"])
        mic = await self.command(self.sessions[0], "microphone", member_token=token_a, enabled=False, speaking=True)
        self.assertFalse(mic["state"]["members"][0]["speaking"])
        subscription = await self.command(self.sessions[1], "subscribe", member_token=token_b, user_ids=[1])
        self.assertTrue(subscription["requiresImmediateRenegotiation"])
        self.assertEqual(subscription["tracks"][0]["user_id"], 1)
        pending = await self.command(self.sessions[1], "subscribe", member_token=token_b, user_ids=[1])
        self.assertEqual(pending["error_code"], "hausdepp_voice_negotiation_pending")
        answer = await self.command(self.sessions[1], "answer", member_token=token_b,
                                    sessionDescription=description("answer"))
        self.assertTrue(answer["ok"])
        removed = await self.command(self.sessions[1], "subscribe", member_token=token_b, user_ids=[])
        self.assertEqual(removed["removed"], [{"user_id": 1, "mid": "0"}])
        self.assertEqual(self.fake.sessions["s2"], {})

    async def test_foreign_room_and_forged_member_tokens_cannot_subscribe(self):
        token = await self.join()
        other_game, other_sessions = self.table("table-b", [10, 11])
        foreign = await self.command(other_sessions[0], "join")
        result = await self.command(self.sessions[0], "subscribe", member_token=token, user_ids=[10],
                                    session_id=foreign["session_id"], track_name="forged")
        self.assertEqual(result["error_code"], "hausdepp_voice_forbidden")
        bad = await self.command(self.sessions[1], "heartbeat", member_token=token)
        self.assertEqual(bad["error_code"], "hausdepp_voice_membership_required")
        self.assertNotEqual(other_game["_hausdepp_voice_room_id"], self.game["_hausdepp_voice_room_id"])

    async def test_audio_only_bounded_payload_and_validated_mid(self):
        token = await self.join()
        for sdp, mid in ((description(media="video"), "0"), (description(media="application"), "0"),
                         ({"type": "offer", "sdp": "a" * 65537}, "0"), (description(), "999")):
            result = await self.command(self.sessions[0], "publish", member_token=token,
                                        sessionDescription=sdp, mid=mid)
            self.assertFalse(result["ok"], result)
        result = await self.command(self.sessions[0], "subscribe", member_token=token, user_ids=list(range(6)))
        self.assertFalse(result["ok"])
        self.assertEqual(len(self.fake.calls), 1)

    async def test_heartbeat_does_not_touch_game_and_expiry_retires_media(self):
        token = await self.join()
        await self.publish(0, token)
        await self.command(self.sessions[0], "heartbeat", member_token=token)
        self.assertEqual(self.game["_last_activity"], "unchanged")
        room = voice._rooms[self.game["_hausdepp_voice_room_id"]]
        await voice.reap_voice(now=room.members[1].last_seen + 31)
        self.assertEqual(room.members, {})
        self.assertEqual(self.fake.sessions["s1"], {})

    async def test_logout_retires_provider_media_independently_of_inbound_actions(self):
        token = await self.join()
        await self.publish(0, token)
        self.sessions[0].websocket.identity = None
        await voice.reap_voice()
        self.assertEqual(self.fake.sessions["s1"], {})

    async def test_deliberate_leave_and_device_takeover_revoke_media_immediately(self):
        token = await self.join()
        await self.publish(0, token)
        await voice.voice_socket_disconnected(self.sessions[0], revoke=True)
        self.assertEqual(self.fake.sessions["s1"], {})
        self.assertFalse((await self.command(self.sessions[0], "resume", member_token=token))["ok"])
        token = await self.join()
        await self.publish(0, token)
        result = await self.command(self.sessions[0], "leave", member_token=token)
        self.assertTrue(result["ok"])
        self.assertEqual(self.fake.sessions["s2"], {})

    async def test_short_disconnect_resume_and_same_roster_rematch_preserve_session(self):
        token = await self.join()
        await self.publish(0, token)
        await voice.voice_socket_disconnected(self.sessions[0])
        self.game["_players"][0]["ws"] = None
        rematch, sessions = self.table("rematch", [1])
        voice.carry_voice_room(self.game, rematch, {1, 2, 3})
        resumed = await self.command(sessions[0], "resume", member_token=token)
        self.assertTrue(resumed["ok"], resumed)
        self.assertEqual(resumed["session_id"], "s1")
        self.assertEqual(resumed["room_id"], self.game["_hausdepp_voice_room_id"])
        self.assertEqual(len([call for call in self.fake.calls if call[1] == "sessions/new"]), 1)

    async def test_new_group_resets_audio_and_old_token_cannot_resume(self):
        token = await self.join()
        await self.publish(0, token)
        original = self.game["_hausdepp_voice_room_id"]
        self.game["_players"].append({"id": "outsider", "user_id": 4, "ws": VoiceSocket(4)})
        await voice.refresh_voice_game(self.game)
        self.assertNotEqual(original, self.game["_hausdepp_voice_room_id"])
        self.assertEqual(self.fake.sessions["s1"], {})
        result = await self.command(self.sessions[0], "resume", member_token=token)
        self.assertFalse(result["ok"])

    async def test_uncertain_provider_failure_withdraws_publication_and_retries_cleanup(self):
        token = await self.join()
        self.fake.fail_publish = True
        self.fake.fail_close = True
        result = await self.command(self.sessions[0], "publish", member_token=token,
                                    sessionDescription=description(), mid="0")
        self.assertFalse(result["ok"])
        self.assertEqual(voice._rooms[self.game["_hausdepp_voice_room_id"]].members, {})
        self.assertEqual(len(voice._cleanup), 1)
        self.fake.fail_close = False
        await voice.reap_voice()
        self.assertEqual(voice._cleanup, [])
        self.assertEqual(self.fake.sessions["s1"], {})

    async def test_republished_user_closes_old_receiver_before_subscribing_replacement(self):
        token_a, token_b = await self.join(0), await self.join(1)
        await self.publish(0, token_a)
        await self.command(self.sessions[1], "subscribe", member_token=token_b, user_ids=[1])
        await self.command(self.sessions[1], "answer", member_token=token_b, sessionDescription=description("answer"))
        await self.command(self.sessions[0], "leave", member_token=token_a)
        token_a = await self.join(0)
        await self.publish(0, token_a)
        replaced = await self.command(self.sessions[1], "subscribe", member_token=token_b, user_ids=[1])
        self.assertTrue(replaced["ok"])
        self.assertEqual(replaced["removed"], [{"user_id": 1, "mid": "0"}])
        self.assertEqual(replaced["tracks"][0]["sessionId"], "s3")

    async def test_optional_turn_credentials_are_short_lived_and_filter_browser_blocked_port(self):
        servers = {"iceServers": [{"urls": ["stun:stun.cloudflare.com:3478"]},
                                  {"urls": ["turn:turn.cloudflare.com:53?transport=udp",
                                            "turns:turn.cloudflare.com:443?transport=tcp"],
                                   "username": "temporary-user", "credential": "temporary-secret"}]}
        with patch.dict(os.environ, {"ROLLTHEDICE_VOICE_TURN_KEY_ID": "test-key",
                                     "ROLLTHEDICE_VOICE_TURN_API_TOKEN": "server-only-token"}), \
                patch.object(voice.CloudflareVoiceProvider, "_http_request", return_value=servers) as http:
            result = await voice.CloudflareVoiceProvider().ice_servers()
        self.assertEqual(http.call_args.args, ("POST",
                         "https://rtc.live.cloudflare.com/v1/turn/keys/test-key/credentials/generate-ice-servers",
                         "server-only-token", {"ttl": 3600}))
        self.assertEqual(result[1]["urls"], ["turns:turn.cloudflare.com:443?transport=tcp"])
        self.assertNotIn("server-only-token", json.dumps(result))

    async def test_allocation_budget_ignores_idempotent_join_but_survives_new_sockets(self):
        token = await self.join()
        for _ in range(10):
            self.assertEqual((await self.command(self.sessions[0], "join"))["member_token"], token)
        self.assertEqual(len([call for call in self.fake.calls if call[1] == "sessions/new"]), 1)
        await self.command(self.sessions[0], "leave", member_token=token)
        for _ in range(voice.ALLOCATION_BURST - 1):
            token = await self.join()
            await self.command(self.sessions[0], "leave", member_token=token)
        new_socket = VoiceSocket(1)
        self.game["_players"][0]["ws"] = new_socket
        replacement = GameSocketSession(new_socket, self.game, new_socket.identity, player_id=self.sessions[0].player_id)
        result = await self.command(replacement, "join")
        self.assertEqual(result, {"request_id": result["request_id"], "ok": False,
                                  "error_code": "hausdepp_voice_rate_limited"})
        self.assertEqual(len([call for call in self.fake.calls if call[1] == "sessions/new"]), voice.ALLOCATION_BURST)

    async def test_allocation_budget_expires_and_registry_is_bounded(self):
        voice._consume_allocation(1, now=100)
        for _ in range(voice.ALLOCATION_BURST - 1):
            voice._consume_allocation(1, now=100)
        with self.assertRaisesRegex(voice.VoiceError, "rate_limited"):
            voice._consume_allocation(1, now=101)
        voice._consume_allocation(1, now=161)
        with patch.object(voice, "MAX_ALLOCATION_ACCOUNTS", 1):
            with self.assertRaisesRegex(voice.VoiceError, "rate_limited"):
                voice._consume_allocation(2, now=162)
            voice._consume_allocation(2, now=3762)
        self.assertEqual(set(voice._allocations), {2})

    async def test_expired_provider_session_404_clears_known_mids_and_retry_job(self):
        job = voice.VoiceCleanup("expired-session", {"0", "1"})
        voice._cleanup.append(job)
        with patch.object(voice, "provider", voice.CloudflareVoiceProvider()), \
                patch.object(voice, "build_opener") as opener:
            opener.return_value.open.side_effect = HTTPError(
                "https://rtc.live.cloudflare.com/v1/apps/test-app/sessions/expired-session", 404, "gone", {}, None,
            )
            await voice.reap_voice()
        self.assertEqual(voice._cleanup, [])
        self.assertEqual(job.mids, set())
        self.assertEqual(opener.return_value.open.call_count, 1)


class VoiceProviderTests(unittest.TestCase):
    def test_only_explicit_session_get_404_is_treated_as_absent(self):
        with patch.dict(os.environ, {"ROLLTHEDICE_VOICE_SFU_APP_ID": "test-app",
                                     "ROLLTHEDICE_VOICE_SFU_APP_SECRET": "private-value"}), \
                patch.object(voice, "build_opener") as opener:
            for method, path, code in (("GET", "sessions/known-session", 401),
                                       ("GET", "sessions/known-session", 500),
                                       ("POST", "sessions/new", 404),
                                       ("GET", "sessions/known-session/tracks/new", 404)):
                opener.return_value.open.side_effect = HTTPError("https://rtc.live.cloudflare.com/", code,
                                                                 "failure", {}, None)
                with self.subTest(method=method, path=path, code=code), self.assertRaises(voice.VoiceError):
                    voice.CloudflareVoiceProvider._request(method, path, None)
            opener.return_value.open.side_effect = HTTPError("https://rtc.live.cloudflare.com/", 404,
                                                             "failure", {}, None)
            with self.assertRaises(voice.VoiceError):
                voice.CloudflareVoiceProvider._http_request(
                    "POST", "https://rtc.live.cloudflare.com/v1/turn/keys/test-key/credentials/generate-ice-servers",
                    "private-value", {"ttl": 3600},
                )

    def test_fixed_provider_origin_bearer_secret_and_no_redirect_handler(self):
        response = unittest.mock.MagicMock()
        response.__enter__.return_value = response
        response.url = "https://rtc.live.cloudflare.com/v1/apps/app-123/sessions/new"
        response.read.return_value = b'{"sessionId":"session-123"}'
        with patch.dict(os.environ, {"ROLLTHEDICE_VOICE_SFU_APP_ID": "app-123",
                                     "ROLLTHEDICE_VOICE_SFU_APP_SECRET": "private-value"}), \
                patch.object(voice, "build_opener") as opener:
            opener.return_value.open.return_value = response
            result = voice.CloudflareVoiceProvider._request("POST", "sessions/new", None)
        self.assertEqual(result, {"sessionId": "session-123"})
        request = opener.return_value.open.call_args.args[0]
        self.assertEqual(request.full_url, response.url)
        self.assertEqual(request.get_header("Authorization"), "Bearer private-value")
        redirect_handler = opener.call_args.args[0]
        self.assertIsNone(redirect_handler.redirect_request(None, None, 302, "redirect", {}, "https://evil.invalid"))

    def test_oversized_provider_response_is_rejected(self):
        response = unittest.mock.MagicMock()
        response.__enter__.return_value = response
        response.url = "https://rtc.live.cloudflare.com/v1/apps/app-123/sessions/new"
        response.read.return_value = b"a" * 262145
        with patch.dict(os.environ, {"ROLLTHEDICE_VOICE_SFU_APP_ID": "app-123",
                                     "ROLLTHEDICE_VOICE_SFU_APP_SECRET": "private-value"}), \
                patch.object(voice, "build_opener") as opener:
            opener.return_value.open.return_value = response
            with self.assertRaises(voice.VoiceError):
                voice.CloudflareVoiceProvider._request("POST", "sessions/new", None)
