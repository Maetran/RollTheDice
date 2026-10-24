"""Two real SQLite-backed attempts must not claim the last login slot twice."""

import json
import secrets
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from threading import Event, Lock
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from starlette.requests import Request

from app import auth, auth_protection, database
from app.auth_protection import (
    LOGIN_WINDOW,
    enforce_login_rate_limit,
    record_login_attempt_failure,
    record_login_failure,
    release_login_attempt,
    reserve_login_attempt,
)
from app.models import AuthRateEvent
from app.security import utcnow


@pytest.fixture
def isolated_database(tmp_path, monkeypatch):
    # Preserve any previous process-local configuration without disposing it.
    for name, empty in (("_engine", None), ("_session_factory", None),
                        ("_database_url", None), ("_schema_ready", False)):
        monkeypatch.setattr(database, name, empty)
    monkeypatch.setenv("ROLLTHEDICE_DATABASE_URL", "")
    database.configure_database(tmp_path)
    database.upgrade_database(Path(__file__).resolve().parents[1])
    try:
        yield
    finally:
        database.get_engine().dispose()


def test_two_attempts_cannot_verify_against_the_same_last_failure_slot(isolated_database, monkeypatch):
    request = Request({"type": "http", "method": "POST", "scheme": "http", "path": "/api/auth/login",
                       "headers": [(b"host", b"testserver")], "query_string": b"",
                       "client": ("127.0.0.1", 1234), "server": ("testserver", 80)})
    auth.create_user("RateProof", secrets.token_urlsafe(24), must_change_password=False)
    key = enforce_login_rate_limit(request, "rateproof")
    for _ in range(4):
        record_login_failure(key)

    def failure_count():
        with database.session_scope() as db:
            return db.scalar(select(func.count()).select_from(AuthRateEvent).where(
                AuthRateEvent.kind == "login_failure", AuthRateEvent.client_key == key))

    entered, release, second_observed = Event(), Event(), Event()
    lock, verified = Lock(), []
    failure_writer = Mock(wraps=auth.record_login_attempt_failure)
    monkeypatch.setattr(auth, "record_login_attempt_failure", failure_writer)

    def gated_invalid_password(_password, _hash):
        with lock:
            verified.append(True)
            first = len(verified) == 1
        if first:
            entered.set()
        else:
            second_observed.set()
        if not release.wait(timeout=4):
            raise AssertionError("Password verification was not released")
        return False

    monkeypatch.setattr(auth, "verify_password", gated_invalid_password)

    def attempt(*, second=False):
        try:
            auth.login(request, "RateProof", "invalid-test-credential")
        except HTTPException as error:
            return error.status_code
        finally:
            if second:
                # A correct reservation rejects the second request before its
                # verifier runs. Never wait for a second verifier as a barrier.
                second_observed.set()
        raise AssertionError("An invalid password unexpectedly authenticated")

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(attempt)
        try:
            assert entered.wait(timeout=2)
            second = pool.submit(attempt, second=True)
            assert second_observed.wait(timeout=2)
            before = {"verification_calls": len(verified), "failure_writer_calls": failure_writer.call_count,
                      "database_failures": failure_count()}
        finally:
            release.set()
        statuses = [first.result(timeout=5), second.result(timeout=5)]

    result = {"before_release": before, "statuses": statuses, "verification_calls": len(verified),
              "failure_writer_calls": failure_writer.call_count, "database_failures": failure_count()}
    print(json.dumps(result, sort_keys=True))
    assert len(verified) == 1, result
    assert statuses == [401, 429], result
    assert failure_writer.call_count == 1 and result["database_failures"] == 5, result


def request_for_login():
    return Request({"type": "http", "method": "POST", "scheme": "http", "path": "/api/auth/login",
                    "headers": [(b"host", b"testserver")], "query_string": b"",
                    "client": ("127.0.0.1", 1234), "server": ("testserver", 80)})


def rate_rows():
    with database.session_scope() as db:
        return list(db.scalars(select(AuthRateEvent)))


def test_independent_concurrent_db_sessions_cannot_overbook_empty_window(isolated_database):
    start = Event()

    def reserve(_index):
        assert start.wait(timeout=2)
        try:
            return reserve_login_attempt(request_for_login(), "same-account")
        except HTTPException as error:
            assert error.status_code == 429
            return None

    with ThreadPoolExecutor(max_workers=6) as pool:
        pending = [pool.submit(reserve, index) for index in range(6)]
        start.set()
        receipts = [result.result(timeout=5) for result in pending]
    assert len([receipt for receipt in receipts if receipt]) == 5
    assert len(rate_rows()) == 5
    for receipt in receipts:
        if receipt:
            release_login_attempt(receipt)
    assert rate_rows() == []


def test_crashed_slots_persist_and_expire_at_the_existing_window(isolated_database, monkeypatch, tmp_path):
    clock = [utcnow()]
    monkeypatch.setattr(auth_protection, "utcnow", lambda: clock[0])
    for _ in range(5):
        reserve_login_attempt(request_for_login(), "crashed")
    database.configure_database(tmp_path)  # fresh sessions retain the committed abandoned slots
    for advance in (timedelta(), LOGIN_WINDOW):
        clock[0] += advance
        with pytest.raises(HTTPException) as blocked:
            reserve_login_attempt(request_for_login(), "crashed")
        assert blocked.value.status_code == 429
    clock[0] += timedelta(microseconds=1)
    receipt = reserve_login_attempt(request_for_login(), "crashed")
    assert len(rate_rows()) == 6  # expired rows do not count, even before daily cleanup
    release_login_attempt(receipt)


def test_stale_receipt_cannot_finalize_or_delete_a_reused_sqlite_row(isolated_database, monkeypatch):
    clock = [utcnow()]
    monkeypatch.setattr(auth_protection, "utcnow", lambda: clock[0])
    stale = reserve_login_attempt(request_for_login(), "reuse")
    release_login_attempt(stale)
    clock[0] += timedelta(microseconds=1)
    current = reserve_login_attempt(request_for_login(), "reuse")
    assert current.event_id == stale.event_id
    record_login_attempt_failure(stale)
    release_login_attempt(stale)
    assert [(row.id, row.kind) for row in rate_rows()] == [(current.event_id, "login_pending")]
    release_login_attempt(current)


def test_success_clears_its_own_slot_and_failures_but_preserves_foreign_pending(isolated_database, monkeypatch):
    request = request_for_login()
    auth.create_user("RateProof", secrets.token_urlsafe(24), must_change_password=False)
    key = enforce_login_rate_limit(request, "rateproof")
    for _ in range(3):
        record_login_failure(key)
    foreign = reserve_login_attempt(request, "rateproof")
    monkeypatch.setattr(auth, "verify_password", lambda *_args: True)
    identity, _token = auth.login(request, "RateProof", "unused-test-credential")
    assert identity.username == "RateProof"
    assert [(row.id, row.kind) for row in rate_rows()] == [(foreign.event_id, "login_pending")]
    record_login_attempt_failure(foreign)
    assert [row.kind for row in rate_rows()] == ["login_failure"]


def test_invalidated_password_proof_records_failure_without_leaving_pending(isolated_database, monkeypatch):
    auth.create_user("RateProof", secrets.token_urlsafe(24), must_change_password=False)
    monkeypatch.setattr(auth, "verify_password", lambda *_args: True)
    # Recovery can invalidate the stored password after its hash was checked.
    monkeypatch.setattr(auth, "lock_verified_password", lambda *_args: False)
    with pytest.raises(HTTPException) as rejected:
        auth.login(request_for_login(), "RateProof", "unused-test-credential")
    assert rejected.value.status_code == 401
    assert [row.kind for row in rate_rows()] == ["login_failure"]


@pytest.mark.parametrize("failure", ["verify_password", "issue_session_for_user"])
def test_unexpected_login_failure_releases_own_pending_without_erasing_failures(isolated_database, monkeypatch, failure):
    request = request_for_login()
    auth.create_user("RateProof", secrets.token_urlsafe(24), must_change_password=False)
    key = enforce_login_rate_limit(request, "rateproof")
    record_login_failure(key)
    monkeypatch.setattr(auth, "verify_password", lambda *_args: True)

    def broken(*_args):
        raise RuntimeError("isolated test failure")

    monkeypatch.setattr(auth, failure, broken)
    with pytest.raises(RuntimeError, match="isolated test failure"):
        auth.login(request, "RateProof", "unused-test-credential")
    assert [row.kind for row in rate_rows()] == ["login_failure"]
