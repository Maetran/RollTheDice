"""Only an explicit guide acknowledgement suppresses the new card-game guide."""

import sqlite3
from contextlib import closing

import pytest
from alembic.config import Config

from alembic import command
from app import main
from app.database import session_scope
from app.models import GameTourPreferences
from tests import test_game_tours as legacy

account = legacy.account
tour_store = legacy.tour_store


def test_read_is_private_read_only_and_legacy_completion_does_not_acknowledge(account):
    response = account.client.get("/api/auth/game-guides")
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {"enabled": True, "acknowledged": {"hausdepp": 0}}
    with session_scope() as db:
        assert db.get(GameTourPreferences, account.user_id) is None
    account.client.put("/api/auth/tours", json={"game_type": "hausdepp", "state": "completed"})
    assert account.client.get("/api/auth/game-guides").json()["acknowledged"]["hausdepp"] == 0


def test_acknowledgement_is_idempotent_and_preserves_all_legacy_choices(account):
    account.client.put("/api/auth/tours", json={"enabled": False, "game_type": "hausdepp", "state": "dismissed"})
    before = account.client.get("/api/auth/tours").json()
    for _ in range(2):
        response = account.client.put("/api/auth/game-guides", json={"game_type": "hausdepp"})
        assert response.json() == {"enabled": False, "acknowledged": {"hausdepp": 1}}
    assert account.client.get("/api/auth/game-guides").json()["acknowledged"]["hausdepp"] == 1
    assert account.client.get("/api/auth/tours").json() == before


@pytest.mark.parametrize("headers,status", [
    ({"x-csrf-token": "wrong"}, 403),
    ({"origin": "https://foreign.test"}, 403),
    ({"X-Watten-Expected-Account-Id": "other"}, 409),
])
def test_acknowledgement_rejects_foreign_or_changed_accounts(account, headers, status):
    assert account.client.put("/api/auth/game-guides", headers=headers, json={"game_type": "hausdepp"}).status_code == status
    assert account.client.get("/api/auth/game-guides").json()["acknowledged"]["hausdepp"] == 0


@pytest.mark.parametrize("body", [{"game_type": "zdwa"}, {"game_type": "hausdepp", "revision": 999}])
def test_client_cannot_set_an_arbitrary_guide_revision(account, body):
    assert account.client.put("/api/auth/game-guides", json=body).status_code == 422


def test_migration_preserves_old_tour_choices_and_does_not_erase_acknowledgements(tmp_path):
    path = tmp_path / "guides.sqlite3"
    config = Config(str(main.BASE / "alembic.ini"))
    config.set_main_option("script_location", str(main.BASE / "alembic"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{path}")
    command.upgrade(config, "20261020_0077")
    with closing(sqlite3.connect(path)) as db, db:
        user = legacy.migration_support.TypedCompletedResultsMigrationTest()._insert_user(db)
        db.execute("INSERT INTO game_tour_preferences (user_id,enabled,zdwa_state,zilch_state,hausdepp_state,watten_state) "
                   "VALUES (?,0,'completed','started','dismissed','completed')", (user,))
    command.upgrade(config, "head")
    with closing(sqlite3.connect(path)) as db, db:
        assert db.execute("SELECT enabled,zdwa_state,zilch_state,hausdepp_state,watten_state,hausdepp_guide_revision,watten_guide_revision "
                          "FROM game_tour_preferences").fetchone() == (0, "completed", "started", "dismissed", "completed", 0, 0)
        db.execute("UPDATE game_tour_preferences SET hausdepp_guide_revision=1")
    with pytest.raises(RuntimeError, match="Cannot discard"):
        command.downgrade(config, "20261020_0077")
    with closing(sqlite3.connect(path)) as db, db:
        assert db.execute("SELECT hausdepp_guide_revision FROM game_tour_preferences").fetchone() == (1,)
        db.execute("UPDATE game_tour_preferences SET hausdepp_guide_revision=0")
    command.downgrade(config, "20261020_0077")
    command.upgrade(config, "head")
