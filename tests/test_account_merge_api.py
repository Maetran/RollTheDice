"""Real HTTP boundaries and real passkey confirmation for merge operations."""
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api_account_merges import router as merge_router
from app.api_auth import router as auth_router
from app.api_passkeys import router as passkey_router
from app.auth import issue_session_for_user
from app.database import session_scope
from app.models import AccountMergeOperation, AccountProgressOrigin, User
from tests.test_account_merge_transaction import actor as actor
from tests.test_account_progress import store as store
from tests.test_passkeys import ORIGIN, RP_ID, SoftwareAuthenticator


@pytest.fixture
def client(actor):
    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(passkey_router)
    app.include_router(merge_router)
    with patch.dict("os.environ", {"ROLLTHEDICE_PASSKEYS_ENABLED": "1", "ROLLTHEDICE_SITE_ORIGIN": ORIGIN,
                                    "ROLLTHEDICE_ZILCH_ORIGIN": "https://zilch.example.test",
                                    "ROLLTHEDICE_WEBAUTHN_RP_ID": RP_ID, "ROLLTHEDICE_COOKIE_DOMAIN": "",
                                    "ROLLTHEDICE_COOKIE_SECURE": "1"}), \
            TestClient(app, base_url=ORIGIN, headers={"Origin": ORIGIN}) as client:
        client.cookies.set("rollthedice_session", actor[2])
        client.headers["X-CSRF-Token"] = actor[0].csrf_token
        yield client


def preview(client, target=2):
    result = client.post("/api/admin/account-merges/preview", json={"source_user_id": 3, "target_user_id": target})
    assert result.status_code == 200, result.text
    assert result.headers["cache-control"] == "no-store"
    assert result.headers["x-robots-tag"] == "noindex, nofollow"
    return result.json()


def payload(preview, *, target=2, **proof):
    return {"source_user_id": 3, "target_user_id": target, "fingerprint": preview["fingerprint"],
            "idempotency_key": "http-idempotency-key", "confirmed": True, **proof}


def test_http_owner_csrf_confirmation_and_private_preview(client, actor):
    rejected = client.post("/api/admin/account-merges/preview", json={"source_user_id": 3, "target_user_id": 2},
                           headers={"X-CSRF-Token": "wrong"})
    assert rejected.status_code == 403
    result = preview(client)
    assert "password" not in str(result).lower()
    with session_scope() as db:
        assert db.get(AccountProgressOrigin, 3) is None
        user = db.get(User, 3)
        identity, token = issue_session_for_user(db, user)
    client.cookies.set("rollthedice_session", token)
    client.headers["X-CSRF-Token"] = identity.csrf_token
    assert client.post("/api/admin/account-merges/preview", json={"source_user_id": 3, "target_user_id": 2}).status_code == 403


def test_http_apply_commit_precedes_voice_cleanup_and_exact_operation_ack(client, actor):
    result = preview(client)
    body = payload(result, current_password="ValidOwnerPassword9")

    async def check_committed_before_cleanup():
        with session_scope() as db:
            assert not db.get(User, 3).is_active
            assert db.get(AccountProgressOrigin, 3).owner_user_id == 2

    with patch("app.hausdepp_voice.reap_voice", side_effect=check_committed_before_cleanup) as reap:
        applied = client.post("/api/admin/account-merges/apply", json=body)
        assert applied.status_code == 200, applied.text
        assert reap.call_count == 1
        replay = client.post("/api/admin/account-merges/apply", json=body)
        assert replay.status_code == 200, replay.text
        assert replay.json()["replayed"] is True
    operation_id = applied.json()["operation_id"]
    with session_scope() as db:
        identity, token = issue_session_for_user(db, db.get(User, 2))
    client.cookies.set("rollthedice_session", token)
    client.headers["X-CSRF-Token"] = identity.csrf_token
    pending = client.get("/api/account/merges/pending")
    assert pending.status_code == 200
    assert pending.json()["viewer_id"] == 2
    assert {item["operation_id"] for item in pending.json()["operations"]} == {"a" * 32, operation_id}
    ack = client.post(f"/api/account/merges/{operation_id}/acknowledge")
    assert ack.status_code == 200, ack.text
    with session_scope() as db:
        assert db.get(AccountMergeOperation, "a" * 32).acknowledged_at is None
        assert db.get(AccountMergeOperation, operation_id).acknowledged_at is not None


def test_http_self_target_real_passkey_after_preview_and_idempotent_retry(client, actor):
    authenticator = SoftwareAuthenticator()
    start = client.post("/api/auth/passkeys/registration/options", json={"current_password": "ValidOwnerPassword9"})
    assert start.status_code == 200, start.text
    verified = client.post("/api/auth/passkeys/registration/verify", json={
        "credential": authenticator.registration(start.json()["options"]), "label": "Owner key",
    })
    assert verified.status_code == 200, verified.text
    result = preview(client, target=4)
    challenge = client.post("/api/auth/passkeys/reauthentication/options", json={
        "action": "merge_accounts", "target": f"3:4:{result['fingerprint']}",
    })
    assert challenge.status_code == 200, challenge.text
    proof = {"token": challenge.json()["token"], "credential": authenticator.authentication(challenge.json()["options"])}
    body = payload(result, target=4, passkey=proof)
    with patch("app.hausdepp_voice.reap_voice"):
        applied = client.post("/api/admin/account-merges/apply", json=body)
        assert applied.status_code == 200, applied.text
        assert applied.json()["target_user_id"] == actor[0].user_id
        assert client.get("/api/auth/me").json()["user"]["id"] == actor[0].user_id
        replay = client.post("/api/admin/account-merges/apply", json=body)
        assert replay.status_code == 200, replay.text
        assert replay.json()["operation_id"] == applied.json()["operation_id"]
        assert replay.json()["replayed"] is True
