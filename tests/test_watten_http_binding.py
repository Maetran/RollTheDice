"""Native Watten HTTP projections retain the caller's mounted account binding."""

import asyncio

import pytest
from fastapi import HTTPException

from app.auth import logout
from app.watten_http import detail_watten_http
from app.watten_recipe import WattenRecipe, recipe_to_payload
from app.watten_runtime import game_lock
from tests import test_watten_runtime as native
from tests.test_watten_rematch import checkpoints, command, post, source_for

server = native.server


def headers(owner, expected=None):
    identity, cookie = owner
    return {"Cookie": cookie, "Origin": native.LOCAL, "X-CSRF-Token": identity.csrf_token,
            **({"X-Watten-Expected-Account-Id": expected} if expected is not None else {})}


def assert_account_changed(response):
    assert response.status_code == 409
    assert response.json() == {"detail": "watten_account_changed"}
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-robots-tag"] == "noindex, nofollow"


def test_two_real_accounts_cannot_receive_another_viewer_or_reservation_with_an_old_expected_id(server):
    match, owners = source_for()
    first, second = owners
    expected_first, expected_second = str(first[0].user_id), str(second[0].user_id)
    path = f"/api/games/{match.game['_id']}"
    before = checkpoints()
    assert_account_changed(server.get(path, headers=headers(second, expected_first)))
    own = server.get(path, headers=headers(first, expected_first))
    assert own.status_code == 200 and own.json()["room"]["rematch"]["can_create"] is True
    assert server.get(path, headers=headers(first)).status_code == 200  # optional for existing native callers
    assert checkpoints() == before

    created = post(server, match.game, first, command(match.game))
    assert created.status_code == 200, created.text
    target_path = f"/api/games/{created.json()['game_id']}"
    own = server.get(target_path, headers=headers(second, expected_second))
    assert own.status_code == 200 and own.json()["room"]["reservation"]["seat"] == 1
    assert_account_changed(server.get(target_path, headers=headers(second, expected_first)))


def test_list_and_create_also_reject_a_cookie_switch_before_native_mutations(server):
    match, owners = source_for(closed=True)
    expected = str(owners[0][0].user_id)
    before = checkpoints()
    assert_account_changed(server.get("/api/games?game_type=watten", headers=headers(owners[1], expected)))
    recipe = WattenRecipe(2, "normal", False, False, target_points=3)
    response = server.post("/api/games", headers=headers(owners[1], expected),
                           json={"name": "Wrong mounted account", "game_type": "watten", "mode": "2",
                                 "watten_recipe": recipe_to_payload(recipe)})
    assert_account_changed(response)
    assert checkpoints() == before and match.game["_watten"].room.rematch_room_id is None


@pytest.mark.parametrize("expected", ("", "0", "01", "+1", " 1", "1 ", "1, 1", "true", "-1"))
def test_optional_expected_header_is_strict_positive_canonical_ascii(server, expected):
    match, owners = source_for(closed=True)
    assert_account_changed(server.get(f"/api/games/{match.game['_id']}", headers=headers(owners[0], expected)))


def test_duplicate_expected_headers_are_rejected_even_when_both_match(server):
    match, owners = source_for(closed=True)
    identity, cookie = owners[0]
    expected = str(identity.user_id)
    response = server.get(f"/api/games/{match.game['_id']}", headers=[("Cookie", cookie),
                          ("X-Watten-Expected-Account-Id", expected), ("X-Watten-Expected-Account-Id", expected)])
    assert_account_changed(response)


def test_detail_reauthenticates_the_original_cookie_after_its_game_lock_wait(server):
    match, owners = source_for(closed=True)
    identity, cookie = owners[0]
    request = native.request_for(host="localhost:8127", cookie=cookie)
    request.scope["headers"].append((b"x-watten-expected-account-id", str(identity.user_id).encode()))

    async def scenario():
        lock = game_lock(match.game)
        await lock.acquire()
        task = asyncio.create_task(detail_watten_http(request, match.game, None, 0))
        try:
            await asyncio.sleep(0)  # The initial native identity check completes before waiting on this lock.
            assert not task.done()
            logout(cookie.split("=", 1)[1])
        finally:
            lock.release()
        with pytest.raises(HTTPException) as failed:
            await asyncio.wait_for(task, timeout=2)
        assert failed.value.status_code == 401 and failed.value.detail == "authentication_required"

    asyncio.run(scenario())
