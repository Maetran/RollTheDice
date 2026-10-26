"""Native private favorite API with strict recipes and shared account binding."""

import json
from copy import deepcopy

import pytest
from sqlalchemy import delete, event, func, select

from app import watten_favorite_pages
from app.database import get_engine, session_scope
from app.game_state import games
from app.models import ActiveGame, FeatureFlag, Session, WattenAchievementGrant, WattenFavorite, WattenMatchCredit
from app.security import utcnow
from app.watten_recipe import WattenRecipe, recipe_to_json, recipe_to_payload
from tests import test_watten_runtime as native

server = native.server
RECIPE = WattenRecipe(4, "ladinisch", True, True, target_points=13, cpu_seats=(1, 2), password_required=True)


@pytest.fixture(autouse=True)
def local_favorites(server, monkeypatch):
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW", "1")


def headers(owner, *, csrf=True):
    identity, cookie = owner
    return {"Cookie": cookie, "Origin": native.LOCAL, "X-Watten-Expected-Account-Id": str(identity.user_id),
            **({"X-CSRF-Token": identity.csrf_token} if csrf else {})}


def assert_private(response):
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-robots-tag"] == "noindex, nofollow"


def test_native_save_reload_apply_delete_is_own_secret_free_and_never_creates_a_game(server):
    own, other = native.account("FavoriteApiOwner"), native.account("FavoriteApiOther")
    assert server.get("/api/watten/favorite", headers=headers(own)).json()["recipe"] is None
    original = recipe_to_payload(RECIPE)
    saved = server.put("/api/watten/favorite", headers=headers(own), json={"recipe": original})
    assert saved.status_code == 200, saved.text
    assert_private(saved)
    assert saved.json() == {"schema_version": 1, "game_type": "watten", "recipe": original}
    assert server.get("/api/watten/favorite?user_id=1", headers=headers(other)).json()["recipe"] is None
    reloaded = server.get("/api/watten/favorite", headers=headers(own))
    assert_private(reloaded)
    assert reloaded.json()["recipe"]["password_required"] is True
    assert reloaded.json()["recipe"]["cpu_seats"] == [1, 2]
    assert '"user_id"' not in reloaded.text and '"passphrase"' not in reloaded.text
    with session_scope() as db:
        assert db.get(WattenFavorite, own[0].user_id).recipe_json == recipe_to_json(RECIPE)
        for model in (ActiveGame, WattenMatchCredit, WattenAchievementGrant):
            assert db.scalar(select(func.count()).select_from(model)) == 0
    assert not games
    for _ in range(2):
        deleted = server.delete("/api/watten/favorite", headers=headers(own))
        assert deleted.status_code == 200
        assert_private(deleted)
        assert deleted.json()["recipe"] is None


def test_get_is_read_only_and_does_not_create_default_favorites(server):
    own = native.account("FavoriteReadOnly")
    statements = []

    def observed(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(get_engine(), "before_cursor_execute", observed)
    try:
        assert server.get("/api/watten/favorite", headers=headers(own)).status_code == 200
    finally:
        event.remove(get_engine(), "before_cursor_execute", observed)
    assert statements and all(sql.lstrip().upper().startswith("SELECT") for sql in statements)
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(WattenFavorite)) == 0


def test_protected_favorite_needs_a_fresh_password_and_preserves_cpu_wishes_without_starting(server):
    own = native.account("FavoriteProtectedCreation")
    # This journey verifies fresh table passwords for a released ruleset;
    # feature admission itself has dedicated internal/off/public tests.
    with session_scope() as db:
        db.add(FeatureFlag(key="watten.critical", status="public", beta=False, version=1, updated_at=utcnow()))
    assert server.put("/api/watten/favorite", headers=headers(own),
                      json={"recipe": recipe_to_payload(RECIPE)}).status_code == 200
    favorite = server.get("/api/watten/favorite", headers=headers(own)).json()["recipe"]
    creation = {"name": "Explicit favorite creation", "game_type": "watten", "mode": "4", "watten_recipe": favorite}
    rejected = server.post("/api/games", headers=headers(own), json=creation)
    assert rejected.status_code == 422
    assert not games
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(ActiveGame)) == 0

    created = server.post("/api/games", headers=headers(own), json={**creation, "pass": "new-table-secret"})
    assert created.status_code == 200, created.text
    game = games[created.json()["game_id"]]
    assert game["_watten"].engine is None and game["_started"] is False
    assert game["_watten"].room.recipe == RECIPE
    assert tuple(cpu.seat for cpu in game["_watten"].room.cpus) == (1, 2)
    assert "new-table-secret" not in server.get("/api/watten/favorite", headers=headers(own)).text

    # Explicitly turning protection off is the other valid creation path.
    unprotected = {**favorite, "password_required": False}
    created = server.post("/api/games", headers=headers(own),
                          json={**creation, "watten_recipe": unprotected})
    assert created.status_code == 200, created.text
    game = games[created.json()["game_id"]]
    assert game["_watten"].engine is None and game["_started"] is False
    assert game["_watten"].room.recipe.password_required is False


def test_delete_rejects_an_unexpected_body_without_deleting_the_own_favorite(server):
    own = native.account("FavoriteDeleteBody")
    assert server.put("/api/watten/favorite", headers=headers(own),
                      json={"recipe": recipe_to_payload(RECIPE)}).status_code == 200
    rejected = server.request("DELETE", "/api/watten/favorite", headers=headers(own), json={"user_id": own[0].user_id})
    assert rejected.status_code == 422
    assert rejected.json()["detail"] == "watten_favorite_invalid_request"
    assert_private(rejected)
    assert server.get("/api/watten/favorite", headers=headers(own)).json()["recipe"] == recipe_to_payload(RECIPE)


@pytest.mark.parametrize("method", ("PUT", "DELETE"))
def test_session_revoked_during_body_read_cannot_mutate_any_favorite(server, monkeypatch, method):
    own, other = native.account("FavoriteRevokedOwner"), native.account("FavoriteRevokedOther")
    other_recipe = WattenRecipe(2, "normal", False, False, target_points=7)
    for owner, recipe in ((own, RECIPE), (other, other_recipe)):
        assert server.put("/api/watten/favorite", headers=headers(owner),
                          json={"recipe": recipe_to_payload(recipe)}).status_code == 200
    actual_body = watten_favorite_pages._body

    async def revoke_after_body(request):
        body = await actual_body(request)
        with session_scope() as db:
            removed = db.execute(delete(Session).where(Session.user_id == own[0].user_id))
            assert removed.rowcount == 1
        return body

    monkeypatch.setattr(watten_favorite_pages, "_body", revoke_after_body)
    body = {"recipe": {**recipe_to_payload(RECIPE), "target_points": 21}}
    rejected = server.request(method, "/api/watten/favorite", headers=headers(own),
                              **({"json": body} if method == "PUT" else {}))
    assert rejected.status_code == 401
    assert rejected.json()["detail"] == "authentication_required"
    assert_private(rejected)
    with session_scope() as db:
        assert db.get(WattenFavorite, own[0].user_id).recipe_json == recipe_to_json(RECIPE)
        assert db.get(WattenFavorite, other[0].user_id).recipe_json == recipe_to_json(other_recipe)
        assert db.scalar(select(func.count()).select_from(Session).where(Session.user_id == own[0].user_id)) == 0
        assert db.scalar(select(func.count()).select_from(Session).where(Session.user_id == other[0].user_id)) == 1
    assert server.get("/api/watten/favorite", headers=headers(other)).json()["recipe"] == recipe_to_payload(other_recipe)


@pytest.mark.parametrize("flag", ("ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW", "ROLLTHEDICE_WATTEN_GAME_PREVIEW"))
def test_each_preview_flag_closes_every_favorite_endpoint(server, monkeypatch, flag):
    own = native.account("FavoriteFlagGate")
    monkeypatch.setenv(flag, "0")
    for method in ("get", "put", "delete"):
        response = server.request(method, "/api/watten/favorite", headers=headers(own),
                                  **({"json": {"recipe": recipe_to_payload(RECIPE)}} if method == "put" else {}))
        assert response.status_code == 404
        assert_private(response)


def test_production_ambiguous_host_auth_csrf_and_expected_account_are_fail_closed(server, monkeypatch):
    own, other = native.account("FavoriteGateOwner"), native.account("FavoriteGateOther")
    recipe = {"recipe": recipe_to_payload(RECIPE)}
    assert server.get("/api/watten/favorite").status_code == 401
    assert server.put("/api/watten/favorite", json=recipe, headers=headers(own, csrf=False)).status_code == 403
    assert server.delete("/api/watten/favorite", headers=headers(own, csrf=False)).status_code == 403
    wrong = {**headers(other), "X-Watten-Expected-Account-Id": str(own[0].user_id)}
    for method in ("get", "put", "delete"):
        response = server.request(method, "/api/watten/favorite", headers=wrong,
                                  **({"json": recipe} if method == "put" else {}))
        assert response.status_code == 409 and response.json()["detail"] == "watten_account_changed"
        assert_private(response)
    assert server.get("https://watten.zockdiewandan.online/api/watten/favorite", headers=headers(own)).status_code == 503
    duplicate_host = [("Cookie", own[1]), ("Host", "localhost:8127"), ("Host", "other.invalid")]
    assert server.get("/api/watten/favorite", headers=duplicate_host).status_code == 404
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", "https://zockdiewandan.online")
    assert server.get("/api/watten/favorite", headers=headers(own)).status_code == 404
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(WattenFavorite)) == 0


@pytest.mark.parametrize("damage", ("unknown_version", "ruleset", "secret", "extra_body", "missing", "boolean_int", "all_cpu"))
def test_invalid_recipe_payloads_never_overwrite_a_valid_saved_favorite(server, damage):
    own = native.account("FavoriteStrictPayload")
    original = recipe_to_payload(RECIPE)
    assert server.put("/api/watten/favorite", headers=headers(own), json={"recipe": original}).status_code == 200
    body = {"recipe": deepcopy(original)}
    if damage == "unknown_version":
        body["recipe"]["schema_version"] = 2
    elif damage == "ruleset":
        body["recipe"]["ruleset_version"] = 2
    elif damage == "secret":
        body["recipe"]["passphrase"] = "must-not-be-reflected-or-stored"
    elif damage == "extra_body":
        body["user_id"] = own[0].user_id
    elif damage == "missing":
        body["recipe"].pop("password_required")
    elif damage == "boolean_int":
        body["recipe"]["target_points"] = True
    else:
        body["recipe"]["cpu_seats"] = [0, 1, 2, 3]
    response = server.put("/api/watten/favorite", headers=headers(own), json=body)
    assert response.status_code == 422
    assert_private(response)
    assert "must-not-be-reflected-or-stored" not in response.text
    assert server.get("/api/watten/favorite", headers=headers(own)).json()["recipe"] == original


@pytest.mark.parametrize("raw", ("{", '{"recipe":NaN}', '{"recipe":{},"recipe":{}}', '{"recipe":{"kind":"watten_recipe","kind":"other"}}', "x" * 65537))
def test_duplicate_nonfinite_malformed_and_oversized_json_are_rejected_without_writes(server, raw):
    own = native.account("FavoriteStrictJson")
    response = server.put("/api/watten/favorite", headers={**headers(own), "Content-Type": "application/json"}, content=raw)
    assert response.status_code == 422
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(WattenFavorite)) == 0


def test_corrupt_storage_returns_503_without_repair_default_or_secret_output(server):
    own = native.account("FavoriteCorruptStore")
    stored = json.dumps({"schema_version": 99, "password": "private-corruption"})
    with session_scope() as db:
        db.add(WattenFavorite(user_id=own[0].user_id, recipe_json=stored))
    response = server.get("/api/watten/favorite", headers=headers(own))
    assert response.status_code == 503
    assert_private(response)
    assert "private-corruption" not in response.text
    with session_scope() as db:
        assert db.get(WattenFavorite, own[0].user_id).recipe_json == stored
