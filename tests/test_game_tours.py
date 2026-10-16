"""Private, durable tour choices and offers are separate from playing a game."""

from __future__ import annotations

import os
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from alembic.config import Config
from fastapi import FastAPI
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from starlette.testclient import TestClient

from alembic import command
from app import api_auth, main
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.game_tours import claim_tour_offer
from app.models import GameTourPreferences, User
from tests import test_typed_results_migration as migration_support
from tests.test_user_accounts import request_for

DEFAULTS = {"enabled": True, "games": {"zdwa": "unseen", "zilch": "unseen", "hausdepp": "unseen"}}


@pytest.fixture(scope="module")
def tour_store(tmp_path_factory):
    directory = tmp_path_factory.mktemp("tours")
    with patch.dict(os.environ, {
        "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{directory}/tours.sqlite3",
        "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
    }):
        configure_database(directory)
        upgrade_database(main.BASE)
        application = FastAPI()
        application.include_router(api_auth.router)
        yield application
    configure_database(main.DATA_DIR)


@pytest.fixture
def account(tour_store):
    user = create_user(f"Tour{uuid4().hex[:16]}", "tour-test-password", must_change_password=False)
    identity, token = login(request_for(), user.username, "tour-test-password")
    with TestClient(tour_store) as client:
        client.cookies.set("rollthedice_session", token)
        client.headers["x-csrf-token"] = identity.csrf_token
        yield SimpleNamespace(client=client, user_id=user.id)


def test_get_defaults_is_read_only_and_private(account):
    for _ in range(2):
        response = account.client.get("/api/auth/tours")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert response.json() == DEFAULTS
    with session_scope() as db:
        assert db.get(GameTourPreferences, account.user_id) is None


@pytest.mark.parametrize("method,path,body", [
    ("GET", "/api/auth/tours", None),
    ("PUT", "/api/auth/tours", {"enabled": False}),
    ("POST", "/api/auth/tours/offer", {"game_type": "zdwa"}),
])
def test_tour_endpoints_require_an_account(tour_store, method, path, body):
    with TestClient(tour_store) as client:
        assert client.request(method, path, json=body).status_code == 401


@pytest.mark.parametrize("method,path,body", [
    ("PUT", "/api/auth/tours", {"enabled": False}),
    ("POST", "/api/auth/tours/offer", {"game_type": "zdwa"}),
])
def test_mutations_require_csrf_and_reject_foreign_origin(account, method, path, body):
    account.client.headers.pop("x-csrf-token")
    assert account.client.request(method, path, json=body).status_code == 403
    account.client.headers["x-csrf-token"] = "wrong-token"
    assert account.client.request(method, path, json=body).status_code == 403
    # Origin rejection happens before token comparison; no account choice changes.
    response = account.client.request(method, path, json=body, headers={"origin": "https://elsewhere.test"})
    assert response.status_code == 403
    assert response.json()["detail"] == "origin_rejected"
    assert account.client.get("/api/auth/tours").json() == DEFAULTS


def test_choices_survive_reload_and_other_game_changes(account):
    for game, state in (("zdwa", "dismissed"), ("zilch", "started"), ("hausdepp", "completed")):
        response = account.client.put("/api/auth/tours", json={"game_type": game, "state": state})
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
    assert account.client.get("/api/auth/tours").json() == {
        "enabled": True, "games": {"zdwa": "dismissed", "zilch": "started", "hausdepp": "completed"},
    }
    response = account.client.put("/api/auth/tours", json={"enabled": False})
    assert response.json()["enabled"] is False
    assert response.json()["games"]["hausdepp"] == "completed"
    # Manual replay remains possible when automatic offers are disabled.
    response = account.client.put("/api/auth/tours", json={"game_type": "hausdepp", "state": "started"})
    assert response.json()["games"]["hausdepp"] == "started"
    assert response.json()["enabled"] is False


def test_offer_is_claimed_once_before_display_and_acceptance_is_explicit(account):
    first = account.client.post("/api/auth/tours/offer", json={"game_type": "zdwa"})
    assert first.status_code == 200
    assert first.headers["cache-control"] == "no-store"
    assert first.json() == {"show": True, "enabled": True, "games": {**DEFAULTS["games"], "zdwa": "dismissed"}}
    assert account.client.get("/api/auth/tours").json()["games"]["zdwa"] == "dismissed"
    assert account.client.post("/api/auth/tours/offer", json={"game_type": "zdwa"}).json()["show"] is False
    assert account.client.post("/api/auth/tours/offer", json={"game_type": "zilch"}).json()["show"] is True
    account.client.put("/api/auth/tours", json={"game_type": "zdwa", "state": "started"})
    account.client.put("/api/auth/tours", json={"game_type": "zdwa", "state": "completed"})
    assert account.client.post("/api/auth/tours/offer", json={"game_type": "zdwa"}).json()["show"] is False


def test_disabled_offers_do_not_consume_an_unseen_game(account):
    account.client.put("/api/auth/tours", json={"enabled": False})
    response = account.client.post("/api/auth/tours/offer", json={"game_type": "hausdepp"})
    assert response.json() == {"show": False, "enabled": False, "games": DEFAULTS["games"]}
    account.client.put("/api/auth/tours", json={"enabled": True})
    assert account.client.post("/api/auth/tours/offer", json={"game_type": "hausdepp"}).json()["show"] is True


def test_simultaneous_device_claims_only_offer_once_and_preserve_other_games(account):
    def claim(_device):
        with session_scope() as db:
            return claim_tour_offer(db, account.user_id, "zdwa")["show"]

    with ThreadPoolExecutor(max_workers=6) as devices:
        results = list(devices.map(claim, range(6)))
    assert results.count(True) == 1
    assert account.client.get("/api/auth/tours").json()["games"] == {
        "zdwa": "dismissed", "zilch": "unseen", "hausdepp": "unseen",
    }


def test_legacy_gameplay_settings_cannot_reset_tour_choices(account):
    account.client.put("/api/auth/tours", json={"enabled": False, "game_type": "zdwa", "state": "dismissed"})
    response = account.client.put("/api/auth/preferences", json={
        "announce_selection_mode": "table", "auto_write_announced": False, "mobile_row_quick_entry": True,
    })
    assert response.status_code == 200
    assert account.client.get("/api/auth/tours").json() == {
        "enabled": False, "games": {**DEFAULTS["games"], "zdwa": "dismissed"},
    }
    with session_scope() as db:
        assert db.get(User, account.user_id).announce_selection_mode == "table"


@pytest.mark.parametrize("payload", [
    {"game_type": "zdwa"}, {"state": "started"}, {"game_type": "other", "state": "started"},
    {"game_type": "zdwa", "state": "unseen"}, {"user_id": 1, "enabled": False},
    {"enabled": "false"}, {"enabled": None}, {"game_type": None, "state": None},
])
def test_invalid_preferences_never_write(account, payload):
    assert account.client.put("/api/auth/tours", json=payload).status_code == 422
    assert account.client.get("/api/auth/tours").json() == DEFAULTS


def test_offer_rejects_unknown_games_and_account_ids(account):
    for payload in ({"game_type": "other"}, {"game_type": "zdwa", "user_id": 1}):
        assert account.client.post("/api/auth/tours/offer", json=payload).status_code == 422
    assert account.client.get("/api/auth/tours").json() == DEFAULTS


def test_account_choices_do_not_change_another_accounts_preferences(account):
    other = create_user(f"OtherTour{uuid4().hex[:12]}", "other-tour-password", must_change_password=False)
    account.client.put("/api/auth/tours", json={"enabled": False, "game_type": "zdwa", "state": "completed"})
    with session_scope() as db:
        assert db.get(GameTourPreferences, account.user_id).zdwa_state == "completed"
        assert db.get(GameTourPreferences, other.id) is None


def test_database_enforces_states_and_cascades_account_deletion(account):
    account.client.put("/api/auth/tours", json={"enabled": False})
    with pytest.raises(IntegrityError), session_scope() as db:
        db.get(GameTourPreferences, account.user_id).zdwa_state = "unexpected"
        db.flush()
    with session_scope() as db:
        db.execute(delete(User).where(User.id == account.user_id))
    with session_scope() as db:
        assert db.get(GameTourPreferences, account.user_id) is None


def test_migration_preserves_legacy_accounts_sessions_and_history(tmp_path):
    path = tmp_path / "legacy-tour.sqlite3"
    config = Config(str(main.BASE / "alembic.ini"))
    config.set_main_option("script_location", str(main.BASE / "alembic"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{path}")
    command.upgrade(config, "20261016_0059")
    legacy = migration_support.TypedCompletedResultsMigrationTest()
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        user_id = legacy._insert_user(connection)
        legacy._insert_completed_game(connection, game_id="pre-tour-history", game_type="zdwa")
        connection.execute(
            "INSERT INTO sessions (user_id, token_hash, csrf_token, created_at, last_seen_at, expires_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, "a" * 64, "b" * 64, "2026-10-16", "2026-10-16", "2027-10-16"),
        )
        tables = ("users", "sessions", "completed_games")
        before = {table: connection.execute(f"SELECT * FROM {table}").fetchall() for table in tables}
    command.upgrade(config, "head")
    with sqlite3.connect(path) as connection:
        assert {table: connection.execute(f"SELECT * FROM {table}").fetchall() for table in tables} == before
        assert connection.execute("SELECT * FROM game_tour_preferences").fetchall() == []
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("INSERT INTO game_tour_preferences (user_id) VALUES (?)", (user_id,))
        assert connection.execute(
            "SELECT enabled, zdwa_state, zilch_state, hausdepp_state FROM game_tour_preferences"
        ).fetchone() == (1, "unseen", "unseen", "unseen")
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    command.downgrade(config, "20261016_0059")
    with sqlite3.connect(path) as connection:
        assert {table: connection.execute(f"SELECT * FROM {table}").fetchall() for table in tables} == before
    command.upgrade(config, "head")
