"""Committed retirement removes real-session voice discovery and fake SFU tracks."""
import asyncio

from app import account_merge
from app import hausdepp_voice as voice
from app.auth import issue_session_for_user, resolve_session
from app.database import session_scope
from app.models import User
from tests import test_hausdepp_voice as transport
from tests.test_account_merge_transaction import actor as actor
from tests.test_account_progress import store as store
from tests.test_user_accounts import request_for


def test_merge_reap_rechecks_actual_sessions_on_completed_table_and_keeps_target_voice(actor, monkeypatch):
    for name, value in {"ROLLTHEDICE_VOICE_ENABLED": "1", "ROLLTHEDICE_VOICE_SFU_APP_ID": "fixture-app",
                        "ROLLTHEDICE_VOICE_SFU_APP_SECRET": "fixture-secret"}.items():
        monkeypatch.setenv(name, value)
    sockets = {}
    with session_scope() as db:
        for user_id in (2, 3):
            _identity, token = issue_session_for_user(db, db.get(User, user_id))
            socket = sockets[user_id] = transport.VoiceSocket(user_id)
            socket.cookies = {"rollthedice_session": token}
    game = {"_id": "completed-voice-merge", "_game_type": "hausdepp", "_finished": True,
            "_aborted": False, "_players": [{"id": f"p{uid}", "user_id": uid, "ws": socket}
                                            for uid, socket in sockets.items()]}
    room = voice.VoiceRoom("voice-merge", {2, 3}, games={game["_id"]: game})
    fake = transport.FakeProvider()
    for uid, socket in sockets.items():
        session = f"s{uid}"
        fake.sessions[session] = {"0": {"mid": "0", "location": "local"}}
        room.members[uid] = voice.VoiceMember(uid, f"p{uid}", game, socket, f"token-{uid}",
            session_id=session, microphone=True, publication_ready=True, track_name=f"voice-{uid}", mids={"0"})
    monkeypatch.setattr(voice, "_rooms", {room.id: room})
    monkeypatch.setattr(voice, "_cleanup", [])
    monkeypatch.setattr(voice, "provider", fake)
    try:
        asyncio.run(voice.reap_voice())
        assert set(room.members) == {2, 3}
        with session_scope() as db:
            preview = account_merge.preview_merge_in_session(db, actor_id=4, source_id=3, target_id=2)
        with session_scope() as db:
            account_merge.apply_merge_in_session(db, identity=actor[0], request=request_for(), source_id=3,
                target_id=2, fingerprint=preview["fingerprint"], idempotency_key="completed-voice-merge",
                current_password="ValidOwnerPassword9")
        asyncio.run(voice.reap_voice())
        assert resolve_session(sockets[3]) is None
        assert resolve_session(sockets[2]).user_id == 2
        assert set(room.members) == {2}
        assert fake.sessions["s3"] == {} and fake.sessions["s2"]
        assert any(method == "PUT" and path == "sessions/s3/tracks/close" for method, path, _body in fake.calls)
        assert {item["user_id"] for item in voice._state(room, game, publications=True)["publications"]} == {2}
    finally:
        asyncio.run(voice.stop_voice())
