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
        client.headers["X-Account-Expected-Id"] = str(actor[0].user_id)
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
    client.headers["X-Account-Expected-Id"] = "2"
    pending = client.get("/api/account/merges/pending")
    assert pending.status_code == 200
    assert pending.json()["viewer_id"] == 2
    assert {item["operation_id"] for item in pending.json()["operations"]} == {"a" * 32, operation_id}
    ack = client.post(f"/api/account/merges/{operation_id}/acknowledge", headers={"X-Account-Expected-Id": "2"})
    assert ack.status_code == 200, ack.text
    with session_scope() as db:
        assert db.get(AccountMergeOperation, "a" * 32).acknowledged_at is None
        assert db.get(AccountMergeOperation, operation_id).acknowledged_at is not None


@pytest.mark.parametrize("headers", [
    {}, {"X-Account-Expected-Id": "3"}, {"X-Account-Expected-Id": "04"},
    {"X-Account-Expected-Id": "invalid"},
    [("X-Account-Expected-Id", "4"), ("X-Account-Expected-Id", "4")],
])
def test_http_receipt_requires_one_exact_mounted_account_before_ack(client, headers):
    # This case explicitly supplies the mounted receipt identity, including
    # absence. Do not inherit the owner-page header from the fixture.
    client.headers.pop("X-Account-Expected-Id", None)
    result = client.post(f"/api/account/merges/{'a' * 32}/acknowledge", headers=headers)
    assert result.status_code == 409, result.text
    assert result.json()["detail"] == "account_changed"
    assert result.headers["cache-control"] == "no-store"
    with session_scope() as db:
        assert db.get(AccountMergeOperation, "a" * 32).acknowledged_at is None
    if headers:
        pending = client.get("/api/account/merges/pending", headers=headers)
        assert pending.status_code == 409
        assert pending.json()["detail"] == "account_changed"


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


@pytest.mark.parametrize("action", ["preview", "apply"])
@pytest.mark.parametrize("headers", [{}, {"X-Account-Expected-Id": "3"},
                                   [("X-Account-Expected-Id", "4"), ("X-Account-Expected-Id", "4")]])
def test_owner_merge_posts_reject_missing_switched_or_ambiguous_mounted_identity(client, action, headers):
    client.headers.pop("X-Account-Expected-Id", None)
    body = {"source_user_id": 3, "target_user_id": 2}
    if action == "apply":
        body.update(fingerprint="a" * 64, idempotency_key="mounted-admin-fixture", confirmed=True,
                    current_password="ValidOwnerPassword9")
    response = client.post(f"/api/admin/account-merges/{action}", headers=headers, json=body)
    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "account_changed"
    with session_scope() as db:
        assert db.get(User, 3).is_active
        assert db.get(AccountProgressOrigin, 3) is None
