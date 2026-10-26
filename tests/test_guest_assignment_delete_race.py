"""A deleted guest seat becomes an HTTP conflict before assignment can write."""
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import api_users
from app.auth import issue_session_for_user
from app.database import get_engine, session_scope
from app.game_history import delete_completed_game
from app.models import AssignmentAudit, CompletedGame, DeletedGame, GameParticipant, User, UserAchievement
from tests.test_account_progress import store as store
from tests.test_dice_account_merge import _dice_store as _dice_store
from tests.test_dice_account_merge import zdwa_game


def test_guest_assignment_reports_conflict_when_other_session_deletes_before_first_writer_lock(_dice_store):
    with get_engine().connect() as connection:
        assert connection.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
    with session_scope() as db:
        db.get(User, 3).role = db.get(User, 4).role = "admin"
        guest_game = zdwa_game(db, "deleted-guest-assignment", [(None, 1000)])
        participant_id = guest_game.participants[0].id
        identity, token = issue_session_for_user(db, db.get(User, 4))
    original_lock = api_users.lock_account_rows
    deleted = []

    def delete_before_first_writer_lock(db, user_ids):
        # The HTTP handler has already read the real guest seat, but pysqlite
        # has not begun a write transaction. Deletion commits in another Session.
        participant = next(row for row in db.identity_map.values() if isinstance(row, GameParticipant))
        assert participant.id == participant_id and participant.user_id is None
        assert not db.connection().connection.driver_connection.in_transaction
        deleted.append(delete_completed_game(game_id="deleted-guest-assignment", admin_user_id=3,
                                             reason="Delete before assigning the guest seat"))
        return original_lock(db, user_ids)

    app = FastAPI()
    app.include_router(api_users.router)
    with (patch.dict("os.environ", {"ROLLTHEDICE_SITE_ORIGIN": "http://testserver", "ROLLTHEDICE_COOKIE_SECURE": "0"}),
          patch("app.api_users.lock_account_rows", side_effect=delete_before_first_writer_lock),
          TestClient(app, raise_server_exceptions=False, headers={"Origin": "http://testserver"}) as client):
        client.cookies.set("rollthedice_session", token)
        response = client.put(f"/api/admin/game-participants/{participant_id}/assignment", json={"user_id": 2},
                              headers={"X-CSRF-Token": identity.csrf_token})
    assert len(deleted) == 1
    assert deleted[0]["affected_user_ids"] == []
    with session_scope() as db:
        assert db.get(GameParticipant, participant_id) is None
        assert db.scalar(select(CompletedGame).where(CompletedGame.game_id == "deleted-guest-assignment")) is None
        tombstone = db.scalar(select(DeletedGame).where(DeletedGame.game_id == "deleted-guest-assignment"))
        assert tombstone is not None and tombstone.deleted_by_user_id == 3
        assert not list(db.scalars(select(AssignmentAudit)))
        assert not list(db.scalars(select(UserAchievement).where(UserAchievement.user_id == 2)))
    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "participant_assignment_changed"
