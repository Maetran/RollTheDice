"""Locally gated native tour choices never change legacy preferences or play."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing

import pytest
from alembic.config import Config
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from alembic import command
from app import api_auth, main
from app.database import session_scope
from app.game_tours import claim_tour_offer
from app.models import GameTourPreferences, User
from tests import test_watten_runtime as native
from tests.test_typed_results_migration import TypedCompletedResultsMigrationTest

server = native.server


def headers(owner):
    return {"Cookie": owner[1], "X-CSRF-Token": owner[0].csrf_token, "Origin": native.LOCAL,
            "X-Watten-Expected-Account-Id": str(owner[0].user_id)}


def test_native_read_is_private_read_only_and_explicit_choice_survives_reload(server, monkeypatch):
    owner, other = native.account("TourNative"), native.account("TourOther")
    for _ in range(2):
        response = server.get("/api/auth/tours", headers=headers(owner))
        assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
        assert response.json()["games"]["watten"] == "unseen"
    with session_scope() as db:
        assert db.get(GameTourPreferences, owner[0].user_id) is None
    first = server.post("/api/auth/tours/offer", headers=headers(owner), json={"game_type": "watten"})
    assert first.status_code == 200 and first.json()["show"] and first.json()["games"]["watten"] == "dismissed"
    assert not server.post("/api/auth/tours/offer", headers=headers(owner), json={"game_type": "watten"}).json()["show"]
    for state in ("started", "completed"):
        assert server.put("/api/auth/tours", headers=headers(owner), json={"game_type": "watten", "state": state}).json()["games"]["watten"] == state
    assert server.get("/api/auth/tours", headers=headers(owner)).json()["games"]["watten"] == "completed"
    assert server.get("/api/auth/tours", headers=headers(other)).json()["games"]["watten"] == "unseen"
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", "0")
    assert server.get("/api/auth/tours", headers=headers(owner)).json() == {
        "enabled": True, "games": {"zdwa": "unseen", "zilch": "unseen", "hausdepp": "unseen"}}


def test_disabled_offer_is_not_consumed_and_atomic_claim_is_once_across_sessions(server):
    owner = native.account("TourAtomic")
    server.put("/api/auth/tours", headers=headers(owner), json={"enabled": False})
    response = server.post("/api/auth/tours/offer", headers=headers(owner), json={"game_type": "watten"}).json()
    assert not response["show"] and response["games"]["watten"] == "unseen"
    server.put("/api/auth/tours", headers=headers(owner), json={"enabled": True})

    def claim(_index):
        with session_scope() as db:
            return claim_tour_offer(db, owner[0].user_id, "watten", include_watten=True)["show"]

    with ThreadPoolExecutor(max_workers=4) as executor:
        assert list(executor.map(claim, range(4))).count(True) == 1
    with session_scope() as db:
        assert db.get(GameTourPreferences, owner[0].user_id).watten_state == "dismissed"
        assert list(db.scalars(select(GameTourPreferences.zdwa_state))) == ["unseen"]


@pytest.mark.parametrize("body,path,method", [
    ({"game_type": "watten"}, "/api/auth/tours/offer", "post"),
    ({"game_type": "watten", "state": "completed"}, "/api/auth/tours", "put"),
])
def test_closed_product_rejects_before_auth_or_tour_storage(server, monkeypatch, body, path, method):
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", "0")
    monkeypatch.setattr(api_auth, "require_user", lambda *_args: pytest.fail("closed native tour resolved account"))
    response = getattr(server, method)(path, json=body)
    assert response.status_code == 404 and response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("expected", ("other", "01", "-1", "0"))
def test_expected_account_and_csrf_prevent_foreign_or_unintended_choices(server, expected):
    owner = native.account("TourBound")
    wrong = {**headers(owner), "X-Watten-Expected-Account-Id": expected}
    assert server.post("/api/auth/tours/offer", headers=wrong, json={"game_type": "watten"}).status_code == 409
    assert server.get("/api/auth/tours", headers=wrong).status_code == 409
    assert server.put("/api/auth/tours", headers={**headers(owner), "X-CSRF-Token": "wrong"},
                      json={"game_type": "watten", "state": "started"}).status_code == 403
    with session_scope() as db:
        assert db.get(GameTourPreferences, owner[0].user_id) is None


def test_actual_two_account_binding_duplicates_and_database_state_constraint(server):
    owner, other = native.account("TourA"), native.account("TourB")
    assert server.put("/api/auth/tours", headers={**headers(other),
        "X-Watten-Expected-Account-Id": str(owner[0].user_id)}, json={"game_type": "watten", "state": "completed"}).status_code == 409
    duplicate = list(headers(owner).items()) + [("X-Watten-Expected-Account-Id", str(owner[0].user_id))]
    assert server.get("/api/auth/tours", headers=duplicate).status_code == 409
    with session_scope() as db:
        with pytest.raises(ValueError, match="unavailable"):
            claim_tour_offer(db, owner[0].user_id, "watten")
        assert db.get(GameTourPreferences, owner[0].user_id) is None
    server.put("/api/auth/tours", headers=headers(owner), json={"game_type": "watten", "state": "started"})
    with pytest.raises(IntegrityError), session_scope() as db:
        db.get(GameTourPreferences, owner[0].user_id).watten_state = "forged"
        db.flush()
    with session_scope() as db:
        db.delete(db.get(User, owner[0].user_id))
    with session_scope() as db:
        assert db.get(GameTourPreferences, owner[0].user_id) is None


def test_migration_preserves_existing_choices_and_refuses_destructive_downgrade(tmp_path):
    path = tmp_path / "watten-tours.sqlite3"
    config = Config(str(main.BASE / "alembic.ini"))
    config.set_main_option("script_location", str(main.BASE / "alembic"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{path}")
    command.upgrade(config, "20261018_0070")
    with closing(sqlite3.connect(path)) as db, db:
        user = TypedCompletedResultsMigrationTest()._insert_user(db)
        db.execute("INSERT INTO game_tour_preferences (user_id,enabled,zdwa_state,zilch_state,hausdepp_state) "
                   "VALUES (?,0,'completed','started','dismissed')", (user,))
        users = db.execute("SELECT * FROM users").fetchall()
    command.upgrade(config, "head")
    with closing(sqlite3.connect(path)) as db, db:
        assert db.execute("SELECT * FROM users").fetchall() == users
        assert db.execute("SELECT enabled,zdwa_state,zilch_state,hausdepp_state,watten_state FROM game_tour_preferences").fetchone() == (0, "completed", "started", "dismissed", "unseen")
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE game_tour_preferences SET watten_state='forged'")
        db.execute("UPDATE game_tour_preferences SET watten_state='completed'")
    with pytest.raises(RuntimeError, match="Cannot discard"):
        command.downgrade(config, "20261018_0070")
    with closing(sqlite3.connect(path)) as db, db:
        assert db.execute("SELECT watten_state FROM game_tour_preferences").fetchone() == ("completed",)
        db.execute("UPDATE game_tour_preferences SET watten_state='unseen'")
    command.downgrade(config, "20261018_0070")
    with closing(sqlite3.connect(path)) as db, db:
        assert db.execute("SELECT enabled,zdwa_state,zilch_state,hausdepp_state FROM game_tour_preferences").fetchone() == (0, "completed", "started", "dismissed")
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    command.upgrade(config, "head")
