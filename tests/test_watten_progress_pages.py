"""Real private progress pages, native data, binding and mutation boundaries."""

from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import func, select

from app.database import session_scope
from app.models import User, WattenAchievementGrant, WattenMatchCredit, WattenMatchPresentationAck, WattenProgressState
from app.watten_runtime import persist_watten_game
from tests import test_watten_runtime as native
from tests.test_watten_match_evidence import NativeMatch

server = native.server
PAGES = ("/watten/konto/fortschritt", "/watten/konto/verlauf", "/watten/rangliste")


@pytest.fixture(autouse=True)
def enable_accounts(server, monkeypatch):
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW", "1")


def assert_private(response):
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-robots-tag"] == "noindex, nofollow"


def test_native_progress_pages_protect_identity_and_keep_canonical_return_path(server):
    for path in PAGES:
        response = server.get(path + "?ignored=1", follow_redirects=False)
        assert response.status_code == 303
        assert_private(response)
        assert parse_qs(urlsplit(response.headers["location"]).query) == {"return_to": [path]}
    _identity, cookie = native.account("ProgressPageReader")
    for path, page in zip(PAGES, ("progress", "history", "leaderboard")):
        response = server.get(path, headers={"Cookie": cookie})
        assert response.status_code == 200
        assert_private(response)
        assert f'data-watten-progress-page="{page}"' in response.text
        assert 'type="module" src="/static/watten-progress.js?v=' in response.text
        assert '/static/watten/icons/watten-icon-32.png?v=' in response.text
        assert '/static/shell.js' not in response.text
    for path in ("/static/watten-progress.html", "/static/./watten-progress.html"):
        response = server.get(path, headers={"Cookie": cookie})
        assert response.status_code == 404
        assert 'data-watten-progress-page=' not in response.text


def test_required_password_opens_existing_settings_anchor_only_for_account_pages(server):
    identity, cookie = native.account("ProgressRequiredPassword")
    with session_scope() as db:
        db.get(User, identity.user_id).must_change_password = True
    for path in ("/watten/konto", *PAGES[:2]):
        response = server.get(path, headers={"Cookie": cookie}, follow_redirects=False)
        assert response.status_code == 303
        assert response.headers["location"] == "/watten/konto/einstellungen#passwort"
        assert_private(response)
    assert server.get("/watten/konto/einstellungen", headers={"Cookie": cookie}).status_code == 200
    ranking = server.get("/watten/rangliste", headers={"Cookie": cookie}, follow_redirects=False)
    assert ranking.status_code == 200
    assert 'data-watten-progress-page="leaderboard"' in ranking.text


@pytest.mark.parametrize("flag", ("ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW", "ROLLTHEDICE_WATTEN_GAME_PREVIEW"))
def test_progress_pages_and_apis_require_both_local_preview_flags(server, monkeypatch, flag):
    _identity, cookie = native.account("ProgressGateReader")
    monkeypatch.setenv(flag, "0")
    for path in (*PAGES, "/api/watten/account", "/api/watten/leaderboard", "/api/watten/achievements/feed",
                 "/api/watten/account/matches/0123456789abcdef/presentation"):
        response = server.get(path, headers={"Cookie": cookie}, follow_redirects=False)
        assert response.status_code in {404, 503}
        assert 'data-watten-progress-page=' not in response.text


def test_account_gets_are_own_read_only_and_ack_is_authenticated_csrf_and_generation_bound(server):
    owners = [native.account(f"ProgressReader{index}") for index in range(3)]
    match = NativeMatch(2, target=3)
    match.ready()
    match.finish()
    persist_watten_game(match.game, creating=True)
    identity, cookie = owners[0]
    response = server.get("/api/watten/account", headers={"Cookie": cookie})
    assert response.status_code == 200, response.text
    assert_private(response)
    data = response.json()
    assert data["statistics"]["all_matches"] == 1
    assert data["progress"]["total_xp"] > 0
    assert data["history"]["matches"][0]["game_id"] == match.game["_id"]
    assert '"user_id"' not in response.text and '"bindings"' not in response.text
    stranger = server.get("/api/watten/account?user_id=1", headers={"Cookie": owners[2][1]}).json()
    assert stranger["statistics"]["all_matches"] == 0 and stranger["progress"]["total_xp"] == 0
    with session_scope() as db:
        counts = tuple(db.scalar(select(func.count()).select_from(model))
                       for model in (WattenProgressState, WattenMatchCredit, WattenAchievementGrant))
        before = db.get(WattenProgressState, identity.user_id).acknowledged_sequence
    assert server.get("/api/watten/account?before=broken", headers={"Cookie": cookie}).status_code == 400
    assert server.get("/api/watten/account").status_code == 401
    assert server.get("/api/watten/leaderboard?metric=xp&players=2", headers={"Cookie": cookie}).status_code == 400
    payload = {"generation": data["progress"]["generation"], "through_sequence": data["progress"]["grant_sequence"]}
    headers = {"Cookie": cookie, "Origin": native.LOCAL}
    assert server.post("/api/watten/account/acknowledge", json=payload, headers=headers).status_code == 403
    headers["X-CSRF-Token"] = identity.csrf_token
    assert server.post("/api/watten/account/acknowledge", json={**payload, "generation": True}, headers=headers).status_code == 422
    assert server.post("/api/watten/account/acknowledge", json={**payload, "generation": payload["generation"] + 1}, headers=headers).status_code == 409
    with session_scope() as db:
        assert db.get(WattenProgressState, identity.user_id).acknowledged_sequence == before
        assert tuple(db.scalar(select(func.count()).select_from(model))
                     for model in (WattenProgressState, WattenMatchCredit, WattenAchievementGrant)) == counts
    response = server.post("/api/watten/account/acknowledge", json=payload, headers=headers)
    assert response.status_code == 200
    assert_private(response)
    assert response.json()["acknowledged_sequence"] == payload["through_sequence"]


def test_match_presentation_acknowledges_only_own_current_match_and_keeps_older_unseen(server):
    owners = [native.account(f"PresentationReader{index}") for index in range(3)]
    matches = []
    for game_id in ("1111111111111111", "2222222222222222"):
        match = NativeMatch(2, target=3, game_id=game_id)
        match.ready()
        match.finish()
        persist_watten_game(match.game, creating=True)
        matches.append(match)
    identity, cookie = owners[0]
    headers = {"Cookie": cookie, "X-Watten-Expected-Account-Id": str(identity.user_id)}
    path = "/api/watten/account/matches/2222222222222222/presentation"
    response = server.get(path, headers=headers)
    assert response.status_code == 200, response.text
    assert_private(response)
    current = response.json()
    assert current["credit"]["xp"] == 10 and current["credit"]["outcome"] in {"won", "lost"}
    assert current["through_sequence"] > 0 and current["game_id"] == "2222222222222222"
    assert set(current) == {"schema_version", "game_type", "status", "game_id", "generation",
                            "through_sequence", "credit", "achievements", "title"}
    assert server.get(path, headers={"Cookie": owners[2][1]}).status_code == 404
    assert server.get(path, headers={**headers, "X-Watten-Expected-Account-Id": str(owners[1][0].user_id)}).status_code == 409
    assert server.get("/api/watten/achievements/feed", headers=headers).json()["coverage"] == {"complete": True}
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(WattenMatchPresentationAck)) == 0
        assert db.get(WattenProgressState, identity.user_id).acknowledged_sequence == 0
    payload = {"generation": current["generation"], "through_sequence": current["through_sequence"]}
    assert server.post(path + "/acknowledge", json=payload, headers=headers).status_code == 403
    headers.update({"Origin": native.LOCAL, "X-CSRF-Token": identity.csrf_token})
    stranger_identity, stranger_cookie = owners[2]
    assert server.post(path + "/acknowledge", json=payload, headers={"Cookie": stranger_cookie,
                       "Origin": native.LOCAL, "X-CSRF-Token": stranger_identity.csrf_token}).status_code == 404
    assert server.post(path + "/acknowledge", json={**payload, "through_sequence": True}, headers=headers).status_code == 422
    assert server.post(path + "/acknowledge", json=payload, headers=headers).status_code == 200
    assert server.post(path + "/acknowledge", json=payload, headers=headers).status_code == 200
    assert server.get(path, headers=headers).json()["through_sequence"] == 0
    account = server.get("/api/watten/account", headers=headers).json()
    assert {item["game_id"] for item in account["progress"]["pending"]["credits"]} == {"1111111111111111"}
    assert all(item["source_game_id"] != "2222222222222222" for item in account["progress"]["pending"]["achievements"])
    with session_scope() as db:
        assert db.get(WattenProgressState, identity.user_id).acknowledged_sequence == 0
        assert db.scalar(select(func.count()).select_from(WattenMatchPresentationAck)) == 1


def test_progress_expected_account_guard_rejects_cookie_switch_before_reads_and_acks(server):
    first, second = [native.account(name) for name in ("ExpectedFirst", "ExpectedSecond")]
    expected = str(first[0].user_id)
    for url in ("/api/watten/account", "/api/watten/leaderboard", "/api/watten/achievements/feed"):
        response = server.get(url, headers={"Cookie": second[1], "X-Watten-Expected-Account-Id": expected})
        assert response.status_code == 409
        assert response.json()["detail"] == "watten_account_changed"
        assert_private(response)
    response = server.post("/api/watten/account/acknowledge", json={"generation": 1, "through_sequence": 0},
                           headers={"Cookie": second[1], "X-Watten-Expected-Account-Id": expected,
                                    "Origin": native.LOCAL, "X-CSRF-Token": second[0].csrf_token})
    assert response.status_code == 409
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(WattenProgressState)) == 0


def test_older_owned_result_without_credit_has_no_reward_panel_and_never_gets_backfilled(server, monkeypatch):
    from app import watten_completion

    owner, _opponent = native.account("OlderPresentation"), native.account("OlderOpponent")
    match = NativeMatch(2, target=3, game_id="3333333333333333")
    match.ready()
    match.finish()
    with monkeypatch.context() as patch:
        patch.setattr(watten_completion, "store_completion_progress", lambda *_args: None)
        persist_watten_game(match.game, creating=True)
    response = server.get("/api/watten/account/matches/3333333333333333/presentation", headers={"Cookie": owner[1]})
    assert response.status_code == 200, response.text
    assert response.json()["credit"] is None and response.json()["achievements"] == []
    assert response.json()["through_sequence"] == 0
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(WattenMatchCredit)) == 0
        assert db.scalar(select(func.count()).select_from(WattenProgressState)) == 0
