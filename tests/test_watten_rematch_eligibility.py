"""A fresh exact original roster gates new tables, never existing target retries."""
from types import SimpleNamespace

import pytest
from sqlalchemy import event

from app import watten_rematch_eligibility as eligibility
from app import watten_runtime
from app.database import get_engine, session_scope
from app.models import AccountMergeOperation, AccountProgressOrigin, User
from app.security import utcnow
from app.watten_runtime import snapshot_watten
from tests import test_watten_runtime as native
from tests.test_watten_match_evidence import NativeMatch
from tests.test_watten_rematch import checkpoints, command, post, source_for

server = native.server


@pytest.fixture(autouse=True)
def fixed_deal(monkeypatch):
    monkeypatch.setattr(watten_runtime, "_RANDOM", SimpleNamespace(randrange=lambda _n: 0, shuffle=lambda _d: None))


@pytest.mark.parametrize("restriction", ("inactive", "retired", "retired_active"))
def test_unavailable_original_has_precise_private_host_projection_and_atomic_http_rejection(server, restriction):
    match, owners = source_for()
    source = match.game
    assert snapshot_watten(source, "p1")["room"]["rematch"]["can_create"]
    if restriction != "inactive":
        native.account("NewRosterProgressOwner")
    with session_scope() as db:
        db.get(User, 2).is_active = restriction == "retired_active"
        if restriction != "inactive":
            db.add(AccountMergeOperation(id="d" * 32, actor_user_id=1, source_user_id=2, target_user_id=3,
                idempotency_key="roster-retirement", preview_fingerprint="e" * 64, created_at=utcnow(), summary_json="{}"))
            db.flush()
            db.add(AccountProgressOrigin(origin_user_id=2, owner_user_id=3, operation_id="d" * 32))
    before = checkpoints()
    own = snapshot_watten(source, "p1")["room"]["rematch"]
    assert own == {"source_game_id": None, "game_id": None, "can_create": False,
                   "unavailable_reason": eligibility.ORIGINAL_ROSTER_UNAVAILABLE}
    for viewer in (None, "p2"):
        public = snapshot_watten(source, viewer)["room"]["rematch"]
        assert not public["can_create"] and "unavailable_reason" not in public
    response = post(server, source, owners[0], command(source))
    assert response.status_code == 409 and response.json()["detail"] == eligibility.ORIGINAL_ROSTER_UNAVAILABLE
    assert response.headers["cache-control"] == "no-store"
    assert checkpoints() == before and source["_watten"].room.rematch_room_id is None
    assert "NewRosterProgressOwner" not in response.text
    if restriction == "inactive":
        with session_scope() as db:
            db.get(User, 2).is_active = True
        # Reactivation is visible immediately; there is no persistent permission cache.
        assert snapshot_watten(source, "p1")["room"]["rematch"]["can_create"]


def test_new_rematch_checks_originals_under_shared_sorted_account_locks(server, monkeypatch):
    match, owners = source_for()
    seen = []
    original_lock = eligibility.lock_account_rows

    def record_lock(db, accounts):
        seen.append(tuple(accounts))
        return original_lock(db, accounts)

    monkeypatch.setattr(eligibility, "lock_account_rows", record_lock)
    response = post(server, match.game, owners[0], command(match.game))
    assert response.status_code == 200, response.text
    assert seen == [(1, 2)]


def test_existing_linked_target_retry_is_not_reclassified_after_original_becomes_inactive(server, monkeypatch):
    match, owners = source_for()
    data = command(match.game)
    first = post(server, match.game, owners[0], data)
    assert first.status_code == 200, first.text
    target = first.json()["game_id"]
    before = checkpoints()
    with session_scope() as db:
        db.get(User, 2).is_active = False
    monkeypatch.setattr(eligibility, "original_roster_available",
                        lambda *_args, **_kwargs: pytest.fail("existing link must not create a new original roster"))
    projected = snapshot_watten(match.game, "p1")["room"]["rematch"]
    assert projected == {"source_game_id": None, "game_id": target, "can_create": False}
    retry = post(server, match.game, owners[0], data)
    assert retry.status_code == 200 and retry.json()["game_id"] == target and not retry.json()["created"]
    assert checkpoints() == before


def test_display_check_is_readonly_bounded_and_absent_from_live_nonhost_and_public_snapshots(server, monkeypatch):
    match, _owners = source_for()
    statements = []

    def record(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(get_engine(), "before_cursor_execute", record)
    try:
        for _ in range(2):
            before = len(statements)
            assert snapshot_watten(match.game, "p1")["room"]["rematch"]["can_create"]
            assert len(statements) - before == 2
        assert all(statement.lstrip().upper().startswith("SELECT") for statement in statements)
    finally:
        event.remove(get_engine(), "before_cursor_execute", record)
    monkeypatch.setattr(eligibility, "read_rematch_unavailable_reason",
                        lambda _room: pytest.fail("hot/public/nonhost views must not read roster authority"))
    live = NativeMatch(2, target=3, game_id="ongoing-no-rematch-query")
    live.ready()
    waiting = NativeMatch(2, start=False, game_id="waiting-no-public-feature-query")
    statements.clear()
    event.listen(get_engine(), "before_cursor_execute", record)
    try:
        assert not snapshot_watten(live.game, "p1")["room"]["rematch"]["can_create"]
        assert snapshot_watten(live.game, "p1")["room"]["feature_controls"] == {}
        for viewer in (None, "p2"):
            public = snapshot_watten(match.game, viewer)["room"]
            assert not public["rematch"]["can_create"] and public["feature_controls"] == {}
        for outsider in (None, 999):
            assert snapshot_watten(waiting.game, viewer_account_id=outsider)["room"]["feature_controls"] == {}
        assert not statements
    finally:
        event.remove(get_engine(), "before_cursor_execute", record)


def test_failed_display_read_is_not_a_stale_positive_permission(server, monkeypatch):
    from sqlalchemy.exc import SQLAlchemyError

    match, _owners = source_for()

    def fail_read(*_args, **_kwargs):
        raise SQLAlchemyError("private storage detail")

    monkeypatch.setattr(eligibility, "original_roster_available", fail_read)
    rematch = snapshot_watten(match.game, "p1")["room"]["rematch"]
    assert not rematch["can_create"] and rematch["unavailable_reason"] == "watten_storage_unavailable"
