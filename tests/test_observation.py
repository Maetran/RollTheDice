"""Recording policy, strict data boundary, access and expiry."""

import json
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import main
from app.api_observation import router
from app.auth import issue_session_for_user
from app.database import configure_database, session_scope, upgrade_database
from app.models import AccountOwnership, ObservationEvent, ObservationPolicy, ObservationRecording, User
from app.observation import RETENTION_DAYS, finish_observation, prune_recordings, record_observation
from app.security import utcnow

BASE = Path(__file__).resolve().parents[1]
ID = "00000001" + "a" * 24


@pytest.fixture
def identities(tmp_path):
    with patch.dict("os.environ", {"ROLLTHEDICE_DATABASE_URL": f"sqlite:///{tmp_path}/observation.sqlite"}):
        configure_database(tmp_path)
        upgrade_database(BASE)
        now = utcnow()
        with session_scope() as db:
            db.add_all(User(id=i, username=f"Player{i}", username_normalized=f"player{i}",
                            role="user" if i == 3 else "admin", password_hash="unused",
                            created_at=now, updated_at=now) for i in (1, 2, 3))
            db.flush()
            db.add(AccountOwnership(user_id=1, is_founder=True, created_at=now))
            db.flush()
            found = {i: issue_session_for_user(db, db.get(User, i)) for i in (1, 2, 3)}
        yield found
    configure_database(main.DATA_DIR)


@pytest.fixture
def client(identities):
    application = FastAPI()
    application.include_router(router)
    with TestClient(application, base_url="http://testserver", headers={"Origin": "http://testserver"}) as client:
        sign_in(client, identities, 1)
        yield client


def sign_in(client, identities, user_id):
    identity, token = identities[user_id]
    client.cookies.set("rollthedice_session", token)
    client.headers["X-CSRF-Token"] = identity.csrf_token
    client.headers["X-Account-Expected-Id"] = str(user_id)


def record(db, **kwargs):
    args = dict(game_type="hausdepp", recording_id=ID, sequence=0, actor_seat=0, actor_kind="human",
                action={"kind": "play", "cards": ["hearts-6"]},
                context={"phase": "playing", "actor_hand": ["hearts-6"],
                         "seats": [{"seat": 0, "kind": "human", "hand_count": 1}]}, eligible_user_ids=[3],
                actor_user_id=3, expected_policy_version=max(1, db.get(ObservationPolicy, 1).version))
    args.update(kwargs)
    return record_observation(db, **args)


def test_default_off_admin_permission_and_account_binding(client, identities):
    snapshot = client.get("/api/admin/observation")
    assert snapshot.status_code == 200
    assert snapshot.headers["cache-control"] == "no-store"
    assert snapshot.json()["enabled"] is False and snapshot.json()["mode"] == "selected"
    with session_scope() as db:
        assert record(db) is False
    sign_in(client, identities, 2)
    assert client.get("/api/admin/observation").json()["can_manage"] is False
    assert client.get("/api/admin/observation/recordings").status_code == 403
    assert client.put("/api/admin/observation", json={"enabled": True, "mode": "all", "selected_user_ids": [], "version": 0}).status_code == 403
    sign_in(client, identities, 3)
    assert client.get("/api/admin/observation").status_code == 403
    sign_in(client, identities, 1)
    assert client.get("/api/admin/observation", headers={"X-Account-Expected-Id": "3"}).status_code == 409
    client.headers.pop("X-CSRF-Token")
    assert client.put("/api/admin/observation", json={"enabled": True, "mode": "all", "selected_user_ids": [], "version": 0}).status_code == 403


def test_selected_policy_recording_export_deletion_and_version(client):
    body = {"enabled": True, "mode": "selected", "selected_user_ids": [3], "version": 0}
    result = client.put("/api/admin/observation", json=body)
    assert result.status_code == 200, result.text
    assert result.json()["selected_players"] == [{"id": 3, "username": "Player3"}]
    assert client.put("/api/admin/observation", json=body).status_code == 409
    with session_scope() as db:
        assert record(db, eligible_user_ids=[2], actor_user_id=2) is False
        assert record(db) is True
        assert record(db) is True  # idempotent replay
        assert finish_observation(db, recording_id=ID, eligible_user_ids=[3],
                                  outcome={"status": "finished", "loser_seat": 1, "finished_order": [0]})
    listing = client.get("/api/admin/observation/recordings").json()
    assert listing["items"][0]["status"] == "partial"
    assert listing["items"][0]["outcome"]["loser_seat"] == 1
    events = client.get(f"/api/admin/observation/recordings/{ID}/events").json()["items"]
    assert len(events) == 1 and events[0]["actor_kind"] == "human"
    assert "Player3" not in json.dumps(listing) + json.dumps(events)
    assert client.request("DELETE", "/api/admin/observation/recordings", json={"version": 0}).status_code == 409
    deleted = client.request("DELETE", "/api/admin/observation/recordings", json={"version": 1})
    assert deleted.json() == {"deleted": 1, "version": 2}
    assert not client.get("/api/admin/observation").json()["enabled"]
    assert client.get(f"/api/admin/observation/recordings/{ID}/events").status_code == 404
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(ObservationEvent)) == 0
        assert record(db) is False


def test_nested_privacy_boundary_rejects_identifiers(client):
    assert client.put("/api/admin/observation", json={"enabled": True, "mode": "all", "selected_user_ids": [], "version": 0}).status_code == 200
    for context in ({"seats": [{"seat": 0, "name": "Player3"}]},
                    {"after": {"event": {"player_id": "some-id"}}},
                    {"actor_hand": ["secret-user-id"]},
                    {"seats": [{"seat": 137, "kind": "human"}]},
                    {"inspection": {"cards": [{"role": "strike", "account_id": 7, "card": "bells-6"}]}},
                    {"feedback": [{"sender": 0, "recipient": 1, "value": {"cards": ["hearts-6"]}}]}):
        with session_scope() as db, pytest.raises(ValueError, match="observation_payload_invalid"):
            record(db, context=context)
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(ObservationRecording)) == 0


def test_expiry_removes_metadata_and_events(client):
    assert client.put("/api/admin/observation", json={"enabled": True, "mode": "all", "selected_user_ids": [], "version": 0}).status_code == 200
    with session_scope() as db:
        assert record(db)
        row = db.get(ObservationRecording, ID)
        row.started_at = utcnow() - timedelta(days=RETENTION_DAYS + 1)
    assert client.get("/api/admin/observation/recordings").json()["items"] == []
    with session_scope() as db:
        assert prune_recordings(db) == 1
        assert db.scalar(select(func.count()).select_from(ObservationEvent)) == 0
        assert db.scalar(select(func.count()).select_from(ObservationRecording)) == 0


def test_policy_changes_make_open_windows_partial_and_disable_before_next_event(client):
    body = {"enabled": True, "mode": "all", "selected_user_ids": [], "version": 0}
    assert client.put("/api/admin/observation", json=body).status_code == 200
    with session_scope() as db:
        assert record(db, started_at_beginning=True)
    body.update(enabled=False, version=1)
    assert client.put("/api/admin/observation", json=body).status_code == 200
    with session_scope() as db:
        assert record(db, sequence=1) is False
        assert db.get(ObservationRecording, ID).status == "partial"
        assert db.scalar(select(func.count()).select_from(ObservationEvent)) == 1
    body.update(enabled=True, version=2)
    assert client.put("/api/admin/observation", json=body).status_code == 200
    with session_scope() as db:
        assert not record(db, sequence=2)  # old token cannot revive an old policy window
        assert finish_observation(db, recording_id=ID, eligible_user_ids=[3], outcome={"status": "finished"})
        assert db.get(ObservationRecording, ID).status == "partial"
        assert db.get(ObservationRecording, ID).outcome_json is None
        assert record(db, recording_id="00000003" + "b" * 24)


def test_duplicate_concurrent_events_are_serialized_and_idempotent(client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    assert client.put("/api/admin/observation", json={"enabled": True, "mode": "all", "selected_user_ids": [], "version": 0}).status_code == 200
    gate = Barrier(2)

    def write():
        gate.wait(timeout=5)
        with session_scope() as db:
            return record(db)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(write) for _ in range(2)]
        assert [future.result(timeout=10) for future in futures] == [True, True]
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(ObservationEvent)) == 1
        with pytest.raises(ValueError, match="observation_event_conflict"):
            record(db, action={"kind": "pickup"})


def test_strict_realistic_watten_projection_and_action(client):
    assert client.put("/api/admin/observation", json={"enabled": True, "mode": "all", "selected_user_ids": [], "version": 0}).status_code == 200
    ctx = {"phase": "play", "profile": {"player_count": 2, "determination": "normal", "blind": False, "critical": True},
           "options": {"show_rechter": False, "open_partner_hand": False, "trick_history": False,
                       "schoeneres_enabled": False, "schlagwechsel_enabled": True},
           "actor_hand": ["hearts-7", "back"], "actions": ["play_card", "bid"],
           "current_trick": {"cards": [{"seat": 0, "card": "bells-6"}]}, "last_trick": None,
           "bid": {"accepted_stake": 2, "pending": None, "result": None},
           "scores": [{"seats": [0], "points": 0}, {"seats": [1], "points": 1}],
           "seats": [{"seat": 0, "kind": "human", "party": 0, "card_count": 2, "tricks_won": 0},
                     {"seat": 1, "kind": "cpu", "party": 1, "card_count": 3, "tricks_won": 1}],
           "target_points": 11, "inspection": {"cards": [{"role": "strike", "card": "bells-6"}]},
           "partner_hand": None, "feedback": [{"sender": 0, "recipient": 1, "value": "good"}],
           "reference_card": {"face": "back"}, "announced_strike": "U", "dealer_seat": 1,
           "announcement_roles": {"strike": 0, "colour": 1, "first_player": 0}, "deal_number": 1,
           "trick_history": None, "after": {"actor_hand": ["back"]}}
    with session_scope() as db:
        assert record(db, game_type="watten", actor_kind="cpu", actor_user_id=None,
                      action={"kind": "play_card", "value": "hearts-7"}, context=ctx)
        assert finish_observation(db, recording_id=ID, eligible_user_ids=[3],
                                  outcome={"status": "finished", "winner_parties": [[1]], "scores": [{"seats": [1], "points": 11}]})


def test_inflight_recording_is_serialized_with_off_and_delete(client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from app.observation import change_policy, delete_recordings, lock_policy

    assert client.put("/api/admin/observation", json={"enabled": True, "mode": "all", "selected_user_ids": [], "version": 0}).status_code == 200

    def run_race(sequence, administrative_write, recording_id=ID):
        acquired, proceed = Event(), Event()

        def writer():
            with session_scope() as db:
                lock_policy(db)
                acquired.set()
                assert proceed.wait(5)
                return record(db, sequence=sequence, recording_id=recording_id)

        def administrator():
            assert acquired.wait(5)
            with session_scope() as db:
                return administrative_write(db)

        with ThreadPoolExecutor(max_workers=2) as pool:
            ongoing = pool.submit(writer)
            assert acquired.wait(5)
            change = pool.submit(administrator)
            proceed.set()
            assert ongoing.result(timeout=10) is True
            return change.result(timeout=10)

    result = run_race(0, lambda db: change_policy(db, actor_user_id=1, enabled=False, mode="all", selected_user_ids=[], version=1))
    assert not result["enabled"]
    with session_scope() as db:
        assert record(db, sequence=1) is False
        assert db.scalar(select(func.count()).select_from(ObservationEvent)) == 1
    assert client.put("/api/admin/observation", json={"enabled": True, "mode": "all", "selected_user_ids": [], "version": 2}).status_code == 200
    # A fresh policy window needs a fresh, version-bound pseudonym.
    with session_scope() as db:
        assert record(db, recording_id="00000003" + "b" * 24)
    result = run_race(1, lambda db: delete_recordings(db, actor_user_id=1, version=3), "00000003" + "b" * 24)
    assert result["deleted"] == 2
    with session_scope() as db:
        assert record(db, sequence=2) is False
        assert db.scalar(select(func.count()).select_from(ObservationEvent)) == 0
        assert db.scalar(select(func.count()).select_from(ObservationRecording)) == 0


def test_selected_actor_redaction_and_no_live_export(client):
    assert client.put("/api/admin/observation", json={"enabled": True, "mode": "selected",
                      "selected_user_ids": [3], "version": 0}).status_code == 200
    private = {"phase": "playing", "actor_hand": ["hearts-6"], "discard": ["bells-7"],
               "private_peek": ["leaves-8"], "available_actions": ["play", "pickup"],
               "after": {"actor_hand": ["acorns-9"]},
               "partner_hand": {"seat": 1, "cards": ["bells-8"]},
               "feedback": [{"sender": 1, "recipient": 0, "value": "good"}]}
    with session_scope() as db:
        assert record(db, eligible_user_ids=[2, 3], actor_user_id=2, context=private)
        assert record(db, sequence=1, eligible_user_ids=[2, 3], actor_user_id=3, context=private)
        assert record(db, sequence=2, eligible_user_ids=[2, 3], actor_user_id=None, actor_kind="cpu", context=private)
        assert not record(db, sequence=3, eligible_user_ids=[2, 3], actor_user_id=2,
                          game_type="watten", action={"kind": "partner_feedback", "value": "good"}, context=private)
    # No raw view can reveal the remaining hidden information during play.
    assert client.get("/api/admin/observation/recordings").json()["items"] == []
    assert client.get(f"/api/admin/observation/recordings/{ID}/events").status_code == 404
    with session_scope() as db:
        assert finish_observation(db, recording_id=ID, eligible_user_ids=[2, 3], outcome={"status": "finished"})
    events = client.get(f"/api/admin/observation/recordings/{ID}/events").json()["items"]
    assert [item["actor_selected"] for item in events] == [False, True, False]
    assert events[0]["context"] == {"phase": "playing", "discard": ["bells-7"]}
    assert events[1]["context"]["actor_hand"] == ["hearts-6"]
    assert events[2]["context"]["actor_hand"] == ["hearts-6"]
    assert all("partner_hand" not in item["context"] and "feedback" not in item["context"] for item in events)


def test_guest_human_stays_public_even_in_all_mode(client):
    assert client.put("/api/admin/observation", json={"enabled": True, "mode": "all", "selected_user_ids": [], "version": 0}).status_code == 200
    with session_scope() as db:
        assert record(db, actor_user_id=None)
        event = db.get(ObservationEvent, (ID, 0))
        assert not event.actor_selected
        assert "actor_hand" not in json.loads(event.context_json)


def test_off_terminal_closes_existing_partial_without_persisting_new_result(client):
    assert client.put("/api/admin/observation", json={"enabled": True, "mode": "selected",
                      "selected_user_ids": [3], "version": 0}).status_code == 200
    with session_scope() as db:
        assert record(db)
    assert client.put("/api/admin/observation", json={"enabled": False, "mode": "selected",
                      "selected_user_ids": [], "version": 1}).status_code == 200
    assert client.get(f"/api/admin/observation/recordings/{ID}/events").status_code == 404
    with session_scope() as db:
        assert not record(db, sequence=1)
        assert finish_observation(db, recording_id=ID, eligible_user_ids=[3],
                                  outcome={"status": "finished", "loser_seat": 1})
    result = client.get("/api/admin/observation/recordings").json()["items"]
    assert result[0]["status"] == "partial" and result[0]["outcome"] is None
    assert len(client.get(f"/api/admin/observation/recordings/{ID}/events").json()["items"]) == 1
    assert client.request("DELETE", "/api/admin/observation/recordings", json={"version": 2}).status_code == 200
    with session_scope() as db:
        assert not finish_observation(db, recording_id=ID, eligible_user_ids=[3], outcome={"status": "finished"})
        assert db.get(ObservationRecording, ID) is None


def test_finalize_and_delete_do_not_resurrect_deleted_records(client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from app.observation import delete_recordings, lock_policy

    assert client.put("/api/admin/observation", json={"enabled": True, "mode": "all", "selected_user_ids": [], "version": 0}).status_code == 200
    with session_scope() as db:
        assert record(db)
    acquired, proceed = Event(), Event()

    def finalize():
        with session_scope() as db:
            lock_policy(db)
            acquired.set()
            assert proceed.wait(5)
            return finish_observation(db, recording_id=ID, eligible_user_ids=[3], outcome={"status": "finished"})

    def erase():
        assert acquired.wait(5)
        with session_scope() as db:
            return delete_recordings(db, actor_user_id=1, version=1)

    with ThreadPoolExecutor(max_workers=2) as pool:
        final = pool.submit(finalize)
        assert acquired.wait(5)
        deleted = pool.submit(erase)
        proceed.set()
        assert final.result(timeout=10)
        assert deleted.result(timeout=10)["deleted"] == 1
    with session_scope() as db:
        assert not finish_observation(db, recording_id=ID, eligible_user_ids=[3], outcome={"status": "finished"})
        assert db.scalar(select(func.count()).select_from(ObservationRecording)) == 0
        assert db.scalar(select(func.count()).select_from(ObservationEvent)) == 0


def test_precheck_is_read_only_fail_closed_and_never_replaces_write_check(client):
    from app.observation import observation_may_record

    with session_scope() as db:
        assert not observation_may_record(db, [3])
        assert db.scalar(select(func.count()).select_from(ObservationRecording)) == 0
    assert client.put("/api/admin/observation", json={"enabled": True, "mode": "selected",
                      "selected_user_ids": [3], "version": 0}).status_code == 200
    with session_scope() as db:
        assert observation_may_record(db, [3])
        assert not observation_may_record(db, [2])
        assert not observation_may_record(db, [])
    assert client.put("/api/admin/observation", json={"enabled": False, "mode": "selected",
                      "selected_user_ids": [3], "version": 1}).status_code == 200
    with session_scope() as db:
        assert not observation_may_record(db, [3])
        assert not record(db)
        assert db.scalar(select(func.count()).select_from(ObservationRecording)) == 0


def test_deleted_window_cannot_be_revived_across_reenable(client):
    from app.observation import new_recording_id, observation_may_record

    assert client.put("/api/admin/observation", json={"enabled": True, "mode": "all", "selected_user_ids": [], "version": 0}).status_code == 200
    with session_scope() as db:
        version = observation_may_record(db, [3])
        assert version == 1
        old_id = new_recording_id(version)
        assert old_id.startswith("00000001") and len(old_id) == 32
        assert record(db, recording_id=old_id, expected_policy_version=version)
    assert client.request("DELETE", "/api/admin/observation/recordings", json={"version": 1}).status_code == 200
    assert client.put("/api/admin/observation", json={"enabled": True, "mode": "all", "selected_user_ids": [], "version": 2}).status_code == 200
    with session_scope() as db:
        version = observation_may_record(db, [3])
        assert version == 3
        assert not record(db, recording_id=old_id, expected_policy_version=1)
        assert not record(db, recording_id=old_id, expected_policy_version=3)
        assert not finish_observation(db, recording_id=old_id, eligible_user_ids=[3], outcome={"status": "finished"})
        assert record(db, recording_id=new_recording_id(version), expected_policy_version=version)
        assert db.scalar(select(func.count()).select_from(ObservationRecording)) == 1


def test_first_observed_sequence_cannot_imply_completeness_when_prefix_missing(client):
    assert client.put("/api/admin/observation", json={"enabled": True, "mode": "all", "selected_user_ids": [], "version": 0}).status_code == 200
    with session_scope() as db:
        assert record(db, sequence=4, started_at_beginning=True)
        assert finish_observation(db, recording_id=ID, eligible_user_ids=[3], outcome={"status": "finished"})
        assert db.get(ObservationRecording, ID).status == "partial"


def test_hausdepp_withdrawal_and_insufficient_players_are_distinct(client):
    assert client.put("/api/admin/observation", json={"enabled": True, "mode": "all", "selected_user_ids": [], "version": 0}).status_code == 200
    with session_scope() as db:
        assert record(db, action={"kind": "withdraw"})
        with pytest.raises(ValueError, match="observation_payload_invalid"):
            record(db, sequence=1, action={"kind": "withdraw", "cards": ["hearts-6"]})
        assert finish_observation(db, recording_id=ID, eligible_user_ids=[3],
                                  outcome={"status": "aborted", "withdrawn_seats": [0],
                                           "round_end_reason": "insufficient_players", "remaining_seat": 1})
    result = client.get("/api/admin/observation/recordings").json()["items"][0]["outcome"]
    assert result["round_end_reason"] == "insufficient_players"
    assert result["remaining_seat"] == 1 and result["withdrawn_seats"] == [0]
