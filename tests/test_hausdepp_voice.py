"""Voice permissions, provider isolation and retirement without live media."""

from __future__ import annotations

import copy
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.error import HTTPError

from app import hausdepp_voice as voice
from app.game_ws_session import GameSocketSession
from app.hausdepp_state import configure_hausdepp_game, join_hausdepp_player, new_hausdepp_game
from app.hausdepp_waiting import handle_waiting_action
from app.voice_usage import MAX_COUNTER


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
        self.ice_calls = 0
        self.sessions = {}
        self.fail_publish = False
        self.fail_close = False

    async def ice_servers(self):
        self.ice_calls += 1
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
        await self.command(self.sessions[0], "microphone", member_token=token, enabled=True)
        other_state = self.sessions[1].websocket.messages[-1]["hausdepp_voice"]
        self.assertEqual(other_state["publications"], [])
        self.assertTrue(other_state["members"][0]["audio"])
        self.assertNotIn("member_token", json.dumps(other_state))
        self.assertNotIn("s1", json.dumps(other_state))
        self.assertEqual(spectator.messages, [])
        own_state = await self.command(self.sessions[0], "state")
        self.assertEqual(len(own_state["state"]["publications"]), 1)

    async def test_publication_is_discoverable_only_after_connected_microphone_acknowledgment(self):
        token_a, token_b = await self.join(0), await self.join(1)
        await self.publish(0, token_a)
        room = voice._rooms[self.game["_hausdepp_voice_room_id"]]
        self.assertFalse(room.members[1].publication_ready)
        for operation, payload in (("state", {}), ("microphone", {"member_token": token_a, "enabled": False})):
            result = await self.command(self.sessions[0], operation, **payload)
            self.assertEqual(result["state"]["publications"], [])
        listener_state = await self.command(self.sessions[1], "state")
        self.assertEqual(listener_state["state"]["publications"], [])
        rejected = await self.command(self.sessions[1], "subscribe", member_token=token_b, user_ids=[1])
        self.assertEqual(rejected["error_code"], "hausdepp_voice_forbidden")
        self.assertEqual(len(self.fake.sessions), 1)
        self.assertNotIn(2, voice._allocations)
        token_b = await self.join(1)

        acknowledged = await self.command(self.sessions[0], "microphone", member_token=token_a, enabled=True)
        publications = acknowledged["state"]["publications"]
        self.assertEqual(len(publications), 1)
        self.assertEqual(publications[0]["session_id"], "s1")
        self.assertTrue(room.members[1].publication_ready)
        listener_state = await self.command(self.sessions[1], "state")
        self.assertEqual(listener_state["state"]["publications"], publications)
        subscribed = await self.command(self.sessions[1], "subscribe", member_token=token_b, user_ids=[1])
        self.assertTrue(subscribed["ok"], subscribed)
        await self.command(self.sessions[1], "answer", member_token=token_b, sessionDescription=description("answer"))

        muted = await self.command(self.sessions[0], "microphone", member_token=token_a, enabled=False)
        self.assertEqual(muted["state"]["publications"], publications)
        self.assertTrue(room.members[1].publication_ready)
        self.assertIn(1, room.members[2].subscriptions)
        left = await self.command(self.sessions[0], "leave", member_token=token_a)
        self.assertTrue(left["ok"], left)
        self.assertEqual(self.fake.sessions["s1"], {})
        listener_state = await self.command(self.sessions[1], "state")
        self.assertEqual(listener_state["state"]["publications"], [])

    async def test_unacknowledged_publication_is_cleaned_up_on_leave(self):
        token = await self.join()
        await self.publish(0, token)
        member = voice._rooms[self.game["_hausdepp_voice_room_id"]].members[1]
        self.assertFalse(member.publication_ready)
        await self.command(self.sessions[0], "leave", member_token=token)
        self.assertEqual(self.fake.sessions["s1"], {})
        self.assertEqual(voice._cleanup, [])

    async def test_listening_without_media_never_allocates_an_sfu_session(self):
        joined = await self.command(self.sessions[0], "join")
        self.assertTrue(joined["ok"], joined)
        self.assertIsNone(joined["session_id"])
        self.assertEqual(joined["state"]["publications"], [])
        token = joined["member_token"]
        for operation, payload in (("heartbeat", {}), ("resume", {}), ("subscribe", {"user_ids": []})):
            result = await self.command(self.sessions[0], operation, member_token=token, **payload)
            self.assertTrue(result["ok"], result)
            self.assertIsNone(result["session_id"])
        left = await self.command(self.sessions[0], "leave", member_token=token)
        self.assertTrue(left["ok"], left)
        self.assertEqual(self.fake.calls, [])
        self.assertEqual(self.fake.ice_calls, 1)
        self.assertEqual(voice._allocations, {})
        self.assertEqual(voice._cleanup, [])

    async def test_waiting_voice_is_revoked_when_host_starts_alone_with_cpus(self):
        game = new_hausdepp_game("solo-cpu", "Solo CPU", "2", register=False)
        configure_hausdepp_game(game, host_user_id=1, cpu_count=1, manual_start=True)
        host = {**self.game["_players"][0], "name": "Host"}
        join_hausdepp_player(game, host)
        self.game = game
        self.sessions[0].game = game
        token = await self.join()
        await self.publish(0, token)
        room = voice._rooms[game["_hausdepp_voice_room_id"]]

        with patch("app.hausdepp_waiting.save_active_game"), \
                patch("app.hausdepp_waiting.snapshot", return_value={}), \
                patch("app.hausdepp_waiting.broadcast", new_callable=AsyncMock), \
                patch("app.hausdepp_experience.record_table_experience"), \
                patch("app.friend_activity.publish_friend_game_start", new_callable=AsyncMock), \
                patch("app.hausdepp_cpu_runner.maybe_schedule_cpu_turn"):
            await handle_waiting_action(self.sessions[0], "hausdepp_start_game", {})

        self.assertTrue(game["_started"])
        self.assertEqual(room.members, {})
        self.assertEqual(self.fake.sessions["s1"], {})
        self.assertFalse(self.sessions[0].websocket.messages[-1]["hausdepp_voice"]["available"])
        state = await self.command(self.sessions[0], "state")
        self.assertTrue(state["ok"], state)
        self.assertFalse(state["state"]["available"])
        for operation, payload in (("join", {}), ("publish", {"member_token": token,
                                   "sessionDescription": description(), "mid": "0"})):
            result = await self.command(self.sessions[0], operation, **payload)
            self.assertEqual(result["error_code"], "hausdepp_voice_unavailable")
        self.assertEqual(self.fake.ice_calls, 1)
        self.assertEqual(len(self.fake.sessions), 1)

    async def test_two_durable_accounts_stay_eligible_with_cpus_offline_and_between_rounds(self):
        self.game["_players"] = self.game["_players"][:2]
        self.game["_players"][1]["ws"] = None
        self.game.update(_started=True, _play_mode="cpu", _hausdepp={"phase": "playing", "players": ["cpu-1"]},
                         _participants=[{"id": "human-1", "user_id": 1}, {"id": "human-2", "user_id": 2},
                                        {"id": "cpu-1", "user_id": None, "is_cpu": True}])
        token = await self.join()
        await self.publish(0, token)
        room = voice._rooms[self.game["_hausdepp_voice_room_id"]]
        # Domain participants remain authoritative when a person has finished
        # or no longer has a transport player during a tournament summary.
        self.game["_players"] = self.game["_players"][:1]
        self.game.update(_finished=True, _hausdepp={"phase": "finished"},
                         _hausdepp_tournament={"completed": False, "round_number": 2})
        await voice.refresh_voice_game(self.game)
        await voice.reap_voice()
        state = await self.command(self.sessions[0], "state")
        self.assertTrue(state["state"]["available"])
        self.assertIn(1, room.members)
        self.assertTrue(self.fake.sessions["s1"])
        self.assertTrue((await self.command(self.sessions[0], "heartbeat", member_token=token))["ok"])

    async def test_played_table_needs_distinct_positive_non_cpu_account_ids(self):
        self.game["_players"] = self.game["_players"][:1]
        self.game["_participants"] = [{"user_id": uid} for uid in (1, 1, None, 0, -1, True)] + [
            {"user_id": 2, "is_cpu": True}, {"user_id": 3, "type": "cpu"},
        ]
        self.game["_hausdepp_voice_allowed_user_ids"] = [1, 2, 3]
        for flags in ({"_started": True}, {"_finished": True}, {"_hausdepp": {"phase": "playing"}}):
            self.game.update(_started=False, _finished=False, _hausdepp=None)
            self.game.update(flags)
            state = await self.command(self.sessions[0], "state")
            self.assertTrue(state["ok"], state)
            self.assertFalse(state["state"]["available"])
            self.assertEqual(state["state"]["publications"], [])
            joined = await self.command(self.sessions[0], "join")
            self.assertEqual(joined["error_code"], "hausdepp_voice_unavailable")
        self.assertEqual(self.fake.ice_calls, 0)
        self.assertEqual(self.fake.calls, [])

    async def test_old_shared_room_cannot_enable_a_new_solo_cpu_game(self):
        token = await self.join()
        await self.publish(0, token)
        room = voice._rooms[self.game["_hausdepp_voice_room_id"]]
        next_game, next_sessions = self.table("new-solo-cpu", [1])
        next_game.update(_started=True, _hausdepp={"phase": "playing"},
                         _participants=[{"user_id": 1}, {"user_id": None, "is_cpu": True}])
        voice.carry_voice_room(self.game, next_game, {1, 2, 3})
        state = await self.command(next_sessions[0], "state")
        self.assertTrue(state["ok"], state)
        self.assertFalse(state["state"]["available"])
        self.assertEqual(state["state"]["publications"], [])
        for operation, payload in (("join", {}), ("resume", {"member_token": token})):
            rejected = await self.command(next_sessions[0], operation, **payload)
            self.assertEqual(rejected["error_code"], "hausdepp_voice_unavailable")
        await voice.refresh_voice_game(next_game)
        self.assertTrue(self.sessions[0].websocket.messages[-1]["hausdepp_voice"]["available"])
        self.assertFalse(next_sessions[0].websocket.messages[-1]["hausdepp_voice"]["available"])
        await voice.reap_voice()
        self.assertIs(room.members[1].game, self.game)
        self.assertTrue(self.fake.sessions["s1"])
        self.assertTrue((await self.command(self.sessions[0], "heartbeat", member_token=token))["ok"])
        self.assertEqual(self.fake.ice_calls, 1)

    async def test_reaper_retires_media_if_table_becomes_cpu_only_without_refresh(self):
        self.game["_players"] = self.game["_players"][:1]
        token = await self.join()
        await self.publish(0, token)
        self.game.update(_started=True, _hausdepp={"phase": "playing"})
        await voice.reap_voice()
        self.assertEqual(voice._rooms[self.game["_hausdepp_voice_room_id"]].members, {})
        self.assertEqual(self.fake.sessions["s1"], {})
        self.assertFalse(self.sessions[0].websocket.messages[-1]["hausdepp_voice"]["available"])

    async def test_cpu_only_transition_during_sfu_allocation_sends_no_media_or_identifier(self):
        self.game["_players"] = self.game["_players"][:1]
        token = await self.join()
        original_request = self.fake.request

        async def become_cpu_only(method, path, payload=None):
            result = await original_request(method, path, payload)
            if path == "sessions/new":
                self.game.update(_started=True, _hausdepp={"phase": "playing"})
            return result

        with patch.object(self.fake, "request", side_effect=become_cpu_only):
            reply = await self.command(self.sessions[0], "publish", member_token=token,
                                       sessionDescription=description(), mid="0")
        self.assertEqual(reply["error_code"], "hausdepp_voice_unavailable")
        self.assertNotIn("session_id", reply)
        self.assertNotIn("sessionDescription", reply)
        self.assertEqual([path for _, path, _ in self.fake.calls], ["sessions/new", "sessions/s1"])
        self.assertEqual(self.fake.sessions["s1"], {})
        self.assertEqual(voice._rooms[self.game["_hausdepp_voice_room_id"]].members, {})

    async def test_publish_subscribe_answer_and_microphone_state(self):
        token_a, token_b = await self.join(0), await self.join(1)
        self.assertEqual(self.fake.calls, [])
        invalid = await self.command(self.sessions[0], "microphone", member_token=token_a, enabled=True)
        self.assertFalse(invalid["ok"])
        published = await self.publish(0, token_a)
        self.assertEqual(published["session_id"], "s1")
        mic = await self.command(self.sessions[0], "microphone", member_token=token_a, enabled=True, speaking=True)
        self.assertTrue(mic["state"]["members"][0]["speaking"])
        mic = await self.command(self.sessions[0], "microphone", member_token=token_a, enabled=False, speaking=True)
        self.assertFalse(mic["state"]["members"][0]["speaking"])
        subscription = await self.command(self.sessions[1], "subscribe", member_token=token_b, user_ids=[1])
        self.assertEqual(subscription["session_id"], "s2")
        self.assertTrue(subscription["requiresImmediateRenegotiation"])
        self.assertEqual(subscription["tracks"][0]["user_id"], 1)
        pending = await self.command(self.sessions[1], "subscribe", member_token=token_b, user_ids=[1])
        self.assertEqual(pending["error_code"], "hausdepp_voice_negotiation_pending")
        answer = await self.command(self.sessions[1], "answer", member_token=token_b,
                                    sessionDescription=description("answer"))
        self.assertTrue(answer["ok"])
        self.assertEqual(answer["session_id"], "s2")
        unchanged = await self.command(self.sessions[1], "subscribe", member_token=token_b, user_ids=[1])
        self.assertEqual(unchanged["tracks"], [])
        self.assertEqual(unchanged["session_id"], "s2")
        removed = await self.command(self.sessions[1], "subscribe", member_token=token_b, user_ids=[])
        self.assertEqual(removed["removed"], [{"user_id": 1, "mid": "0"}])
        self.assertEqual(self.fake.sessions["s2"], {})
        self.assertEqual(len([call for call in self.fake.calls if call[1] == "sessions/new"]), 2)
        self.assertEqual({uid: len(entries) for uid, entries in voice._allocations.items()}, {1: 1, 2: 1})

    async def test_foreign_room_and_forged_member_tokens_cannot_subscribe(self):
        token = await self.join()
        other_game, other_sessions = self.table("table-b", [10, 11])
        foreign = await self.command(other_sessions[0], "join")
        self.assertIsNone(foreign["session_id"])
        result = await self.command(self.sessions[0], "subscribe", member_token=token, user_ids=[10],
                                    session_id="forged-provider-session", track_name="forged")
        self.assertEqual(result["error_code"], "hausdepp_voice_forbidden")
        bad = await self.command(self.sessions[1], "heartbeat", member_token=token)
        self.assertEqual(bad["error_code"], "hausdepp_voice_membership_required")
        self.assertNotEqual(other_game["_hausdepp_voice_room_id"], self.game["_hausdepp_voice_room_id"])
        self.assertEqual(self.fake.calls, [])
        self.assertEqual(voice._allocations, {})

    async def test_audio_only_bounded_payload_and_validated_mid(self):
        token = await self.join()
        for sdp, mid in ((description(media="video"), "0"), (description(media="application"), "0"),
                         ({"type": "offer", "sdp": "a" * 65537}, "0"), (description(), "999")):
            result = await self.command(self.sessions[0], "publish", member_token=token,
                                        sessionDescription=sdp, mid=mid)
            self.assertFalse(result["ok"], result)
        result = await self.command(self.sessions[0], "subscribe", member_token=token, user_ids=list(range(6)))
        self.assertFalse(result["ok"])
        self.assertEqual(self.fake.calls, [])
        self.assertEqual(voice._allocations, {})

    async def test_heartbeat_does_not_touch_game_and_expiry_retires_media(self):
        token = await self.join()
        await self.publish(0, token)
        await self.command(self.sessions[0], "heartbeat", member_token=token)
        self.assertEqual(self.game["_last_activity"], "unchanged")
        room = voice._rooms[self.game["_hausdepp_voice_room_id"]]
        await voice.reap_voice(now=room.members[1].last_seen + 31)
        self.assertEqual(room.members, {})
        self.assertEqual(self.fake.sessions["s1"], {})

    async def test_usage_reports_are_optional_and_require_an_allocated_transport(self):
        token = await self.join()
        with patch.object(voice, "record_usage", return_value=True) as record:
            for operation, payload in (("heartbeat", {}), ("resume", {}),
                                       ("heartbeat", {"usage": {"received_bytes": 100, "sent_bytes": 200, "sequence": 1}})):
                reply = await self.command(self.sessions[0], operation, member_token=token, **payload)
                self.assertTrue(reply["ok"], reply)
            record.assert_not_called()
            await self.publish(0, token)
            heartbeat = await self.command(self.sessions[0], "heartbeat", member_token=token)
            self.assertTrue(heartbeat["ok"], heartbeat)
            record.assert_not_called()

    async def test_cumulative_usage_ignores_duplicates_stale_decreasing_and_invalid_reports(self):
        token = await self.join()
        await self.publish(0, token)
        member = voice._rooms[self.game["_hausdepp_voice_room_id"]].members[1]
        initial = {"received_bytes": 1000, "sent_bytes": 200, "sequence": 1}
        with patch.object(voice, "record_usage", return_value=True) as record:
            first = await self.command(self.sessions[0], "heartbeat", member_token=token, usage=initial)
            self.assertTrue(first["ok"], first)
            self.assertEqual(record.call_args.args, (1000, 200))
            self.assertEqual(set(record.call_args.kwargs), {"now"})
            member.usage.reported_at -= 2
            member.usage.attempted_at -= 2
            for invalid in (initial, {**initial, "sequence": 0}, {**initial, "received_bytes": 2000},
                            {**initial, "sequence": 2, "received_bytes": 999},
                            {**initial, "sequence": 2, "sent_bytes": 199},
                            {**initial, "sequence": True}, {**initial, "received_bytes": True},
                            {**initial, "sequence": 2, "sent_bytes": -1},
                            {**initial, "sequence": 2, "sent_bytes": "300"},
                            {**initial, "sequence": 2, "received_bytes": float("nan")},
                            {**initial, "sequence": 2, "received_bytes": MAX_COUNTER + 1},
                            {**initial, "sequence": MAX_COUNTER + 1},
                            {**initial, "sequence": 2, "account_id": "private"},
                            {"sequence": 2}, None, [], "invalid"):
                with self.subTest(usage=invalid):
                    reply = await self.command(self.sessions[0], "heartbeat", member_token=token, usage=invalid)
                    self.assertTrue(reply["ok"], reply)
            self.assertEqual(record.call_count, 1)
            self.assertEqual(member.usage.sequence, 1)
            next_report = await self.command(self.sessions[0], "resume", member_token=token,
                                             usage={"received_bytes": 1500, "sent_bytes": 350, "sequence": 2})
            self.assertTrue(next_report["ok"], next_report)
            self.assertEqual(record.call_args.args, (500, 150))
            self.assertEqual(record.call_count, 2)
            member.usage.reported_at -= 2
            member.usage.attempted_at -= 2
            await self.command(self.sessions[0], "heartbeat", member_token=token,
                               usage={"received_bytes": 1500, "sent_bytes": 350, "sequence": 3})
            self.assertEqual(record.call_args.args, (0, 0))
            self.assertEqual(record.call_count, 3)
        self.assertIs(voice._rooms[self.game["_hausdepp_voice_room_id"]].members[1], member)

    async def test_usage_rate_and_implausible_byte_increases_do_not_advance_the_baseline(self):
        token = await self.join()
        await self.publish(0, token)
        member = voice._rooms[self.game["_hausdepp_voice_room_id"]].members[1]
        with patch.object(voice, "record_usage", return_value=True) as record:
            excessive = await self.command(self.sessions[0], "heartbeat", member_token=token,
                                           usage={"received_bytes": 2 ** 40, "sent_bytes": 0, "sequence": 1})
            self.assertTrue(excessive["ok"], excessive)
            record.assert_not_called()
            await self.command(self.sessions[0], "heartbeat", member_token=token,
                               usage={"received_bytes": 1000, "sent_bytes": 200, "sequence": 1})
            self.assertEqual(record.call_count, 1)
            report = {"received_bytes": 2000, "sent_bytes": 300, "sequence": 2}
            await self.command(self.sessions[0], "heartbeat", member_token=token, usage=report)
            self.assertEqual(record.call_count, 1)
            self.assertEqual(member.usage.sequence, 1)
            member.usage.reported_at -= 2
            member.usage.attempted_at -= 2
            await self.command(self.sessions[0], "heartbeat", member_token=token, usage=report)
            self.assertEqual(record.call_count, 2)
            self.assertEqual(record.call_args.args, (1000, 100))

    async def test_leave_reports_last_delta_and_next_membership_has_a_fresh_counter(self):
        token = await self.join()
        await self.publish(0, token)
        with patch.object(voice, "record_usage", return_value=True) as record:
            reply = await self.command(self.sessions[0], "leave", member_token=token,
                                       usage={"received_bytes": 3000, "sent_bytes": 400, "sequence": 1})
            self.assertTrue(reply["ok"], reply)
            self.assertEqual(record.call_args.args, (3000, 400))
            self.assertEqual(self.fake.sessions["s1"], {})
            token = await self.join()
            await self.publish(0, token)
            reply = await self.command(self.sessions[0], "heartbeat", member_token=token,
                                       usage={"received_bytes": 100, "sent_bytes": 20, "sequence": 1})
            self.assertTrue(reply["ok"], reply)
            self.assertEqual(record.call_args.args, (100, 20))
            self.assertEqual(record.call_count, 2)

    async def test_usage_storage_failure_does_not_fail_voice_and_next_report_recovers_bytes(self):
        token = await self.join()
        await self.publish(0, token)
        member = voice._rooms[self.game["_hausdepp_voice_room_id"]].members[1]
        report = {"received_bytes": 1000, "sent_bytes": 200, "sequence": 1}
        with patch.object(voice, "record_usage", side_effect=RuntimeError("database unavailable")) as record:
            first = await self.command(self.sessions[0], "heartbeat", member_token=token, usage=report)
            repeated = await self.command(self.sessions[0], "heartbeat", member_token=token, usage=report)
            self.assertTrue(first["ok"], first)
            self.assertTrue(repeated["ok"], repeated)
            self.assertEqual(record.call_count, 1)
        self.assertIs(voice._rooms[self.game["_hausdepp_voice_room_id"]].members[1], member)
        self.assertEqual(member.usage.sequence, 0)
        self.assertTrue(self.fake.sessions["s1"])
        member.usage.attempted_at -= 2
        with patch.object(voice, "record_usage", return_value=True) as recovered:
            reply = await self.command(self.sessions[0], "heartbeat", member_token=token,
                                       usage={"received_bytes": 1500, "sent_bytes": 300, "sequence": 2})
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(recovered.call_args.args, (1500, 300))
        self.assertEqual(member.usage.sequence, 2)

    async def test_forged_membership_cannot_submit_usage(self):
        token = await self.join()
        await self.publish(0, token)
        with patch.object(voice, "record_usage", return_value=True) as record:
            reply = await self.command(self.sessions[1], "heartbeat", member_token=token,
                                       usage={"received_bytes": 1000, "sent_bytes": 200, "sequence": 1})
            self.assertEqual(reply["error_code"], "hausdepp_voice_membership_required")
            record.assert_not_called()

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
        await self.command(self.sessions[0], "microphone", member_token=token_a, enabled=True)
        await self.command(self.sessions[1], "subscribe", member_token=token_b, user_ids=[1])
        await self.command(self.sessions[1], "answer", member_token=token_b, sessionDescription=description("answer"))
        await self.command(self.sessions[0], "leave", member_token=token_a)
        token_a = await self.join(0)
        await self.publish(0, token_a)
        await self.command(self.sessions[0], "microphone", member_token=token_a, enabled=True)
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

    async def test_admission_budget_ignores_idempotent_join_but_survives_new_sockets(self):
        token = await self.join()
        for _ in range(10):
            self.assertEqual((await self.command(self.sessions[0], "join"))["member_token"], token)
        self.assertEqual(self.fake.ice_calls, 1)
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
        self.assertEqual(self.fake.ice_calls, voice.ALLOCATION_BURST)
        self.assertEqual(self.fake.calls, [])
        self.assertEqual(voice._allocations, {})

    async def test_exhausted_allocation_budget_allows_listening_but_blocks_first_media(self):
        for _ in range(voice.ALLOCATION_BURST):
            voice._consume_allocation(1)
        token = await self.join()
        result = await self.command(self.sessions[0], "publish", member_token=token,
                                    sessionDescription=description(), mid="0")
        self.assertEqual(result["error_code"], "hausdepp_voice_rate_limited")
        self.assertEqual(self.fake.calls, [])
        self.assertEqual(self.fake.ice_calls, 1)
        self.assertEqual(len(voice._admissions[1]), 1)
        self.assertEqual(len(voice._allocations[1]), voice.ALLOCATION_BURST)

    async def test_failed_allocation_response_still_consumes_budget(self):
        token = await self.join()
        with patch.object(self.fake, "request", side_effect=voice.VoiceError("hausdepp_voice_provider_failed")) as request:
            result = await self.command(self.sessions[0], "publish", member_token=token,
                                        sessionDescription=description(), mid="0")
        self.assertEqual(result["error_code"], "hausdepp_voice_provider_failed")
        self.assertEqual(request.call_args.args, ("POST", "sessions/new"))
        self.assertEqual(request.call_count, 1)
        self.assertEqual(len(voice._allocations[1]), 1)
        self.assertEqual(voice._rooms[self.game["_hausdepp_voice_room_id"]].members, {})
        self.assertEqual(voice._cleanup, [])

    async def test_failed_ice_response_still_consumes_admission_budget(self):
        with patch.object(self.fake, "ice_servers", side_effect=voice.VoiceError("hausdepp_voice_provider_failed")):
            result = await self.command(self.sessions[0], "join")
        self.assertEqual(result["error_code"], "hausdepp_voice_provider_failed")
        self.assertEqual(len(voice._admissions[1]), 1)
        self.assertEqual(voice._allocations, {})
        self.assertEqual(self.fake.calls, [])
        self.assertEqual(voice._rooms[self.game["_hausdepp_voice_room_id"]].members, {})

    async def test_allocation_budget_expires_and_registry_is_bounded(self):
        for registry, consume in ((voice._allocations, voice._consume_allocation),
                                  (voice._admissions, voice._consume_admission)):
            consume(1, now=100)
            for _ in range(voice.ALLOCATION_BURST - 1):
                consume(1, now=100)
            with self.assertRaisesRegex(voice.VoiceError, "rate_limited"):
                consume(1, now=101)
            consume(1, now=161)
            with patch.object(voice, "MAX_ALLOCATION_ACCOUNTS", 1):
                with self.assertRaisesRegex(voice.VoiceError, "rate_limited"):
                    consume(2, now=162)
                consume(2, now=3762)
            self.assertEqual(set(registry), {2})

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
