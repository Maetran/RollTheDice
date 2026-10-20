"""Real private apex routes never turn deployment capability into a cohort grant."""

import asyncio
from unittest.mock import patch

import pytest
from sqlalchemy import func, select
from starlette.websockets import WebSocketDisconnect

from app import friend_activity, lobby_chat, main, watten_access, watten_cpu_runtime, watten_favorite_pages, web_push
from app.auth import logout
from app.database import session_scope
from app.game_state import games
from app.models import GameTourPreferences, User, WattenFavorite, WattenOpenSeatClaim, WebPushSubscription
from app.ownership import bind_founder, grant_ownership
from app.watten_invitations import accepted_invitation_access, create_invitation, respond_to_invitation
from app.watten_recipe import WattenRecipe, recipe_to_payload
from tests import test_watten_runtime as native
from tests.test_user_accounts import request_for
from tests.test_watten_invitations import setup as invitation_setup
from tests.test_watten_lobby_chat import Socket
from tests.test_watten_push_context import subscription
from tests.test_web_push import TEST_VAPID_PUBLIC_KEY

server = native.server
PRODUCTION = "https://zockdiewandan.online"


@pytest.fixture(autouse=True)
def isolated_channels(monkeypatch):
    monkeypatch.setattr(main, "lobby_chat_hub", lobby_chat.LobbyChatHub())
    monkeypatch.setattr(friend_activity, "friend_activity_hub", friend_activity.FriendActivityHub())
    monkeypatch.setattr(watten_cpu_runtime, "watch_game", lambda _game: None)
    monkeypatch.setenv("ROLLTHEDICE_PASSKEYS_ENABLED", "0")


def headers(owner=None, host="zockdiewandan.online", **extra):
    result = {"Host": host, "Origin": PRODUCTION, "Cookie": owner[1] if owner else ""}
    if owner:
        result.update({"X-CSRF-Token": owner[0].csrf_token, "X-Watten-Expected-Account-Id": str(owner[0].user_id)})
    return {**result, **extra}


def enable(monkeypatch, founder, delegated=None, *, client):
    with session_scope() as db:
        bind_founder(db, founder[0].user_id)
        if delegated:
            grant_ownership(db, delegated[0].user_id, founder[0].user_id)
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", PRODUCTION)
    monkeypatch.setenv("ROLLTHEDICE_ZILCH_ORIGIN", "https://zilch.zockdiewandan.online")
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW", "1")
    client.base_url = PRODUCTION


def roster():
    return [native.account(name, role=role) for name, role in (
        ("PrivateFounder", "admin"), ("PrivateDelegatedOwner", "admin"),
        ("PrivateAdministrator", "admin"), ("PrivateOrdinaryAccount", "user"))]


def new_game(server, owner):
    response = server.post("/api/games", headers=headers(owner), json={"name": "Private Watten",
        "game_type": "watten", "mode": "2", "watten_recipe": recipe_to_payload(WattenRecipe(2, "normal", False, False, cpu_seats=(1,)))})
    assert response.status_code == 200, response.text
    return response.json()["game_id"]


def private_headers(response):
    assert response.headers["cache-control"] == "no-store"
    assert "noindex" in response.headers["x-robots-tag"]


def test_auth_me_and_password_login_capabilities_are_consistent_private_and_request_scoped(server, monkeypatch):
    owners = roster()
    enable(monkeypatch, owners[0], owners[1], client=server)
    for host in ("zockdiewandan.online", "zilch.zockdiewandan.online", "hausdepp.zockdiewandan.online"):
        for index, owner in enumerate([*owners, None]):
            response = server.get("/api/auth/me", headers=headers(owner, host))
            assert response.status_code == 200
            private_headers(response)
            payload = response.json()
            assert payload["game_access"].get("watten_preview") is (True if index == 0 else None)
            if owner:
                assert payload["user"]["game_access"] == payload["game_access"]
    login = server.post("/api/auth/login", headers=headers(), json={
        "username": owners[0][0].username, "password": "runtime-account-password-123"})
    assert login.status_code == 200
    assert login.json()["game_access"]["watten_preview"]
    assert login.json()["user"]["game_access"] == login.json()["game_access"]
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW", "0")
    assert "watten_preview" not in server.get("/api/auth/me", headers=headers(owners[0])).json()["game_access"]


def test_auth_response_computes_capability_once_even_if_another_lookup_would_fail(server, monkeypatch):
    owner = native.account("SingleDecisionFounder", role="admin")
    enable(monkeypatch, owner, client=server)
    original = watten_access.watten_founder_account_id
    for login in (False, True):
        calls = []

        def first_only(db, **kwargs):
            from sqlalchemy.exc import SQLAlchemyError

            calls.append(True)
            if len(calls) > 1:
                raise SQLAlchemyError("a second independent decision would fail closed")
            return original(db, **kwargs)

        with patch.object(watten_access, "watten_founder_account_id", first_only):
            response = (server.post("/api/auth/login", headers=headers(), json={
                "username": owner[0].username, "password": "runtime-account-password-123"}) if login
                else server.get("/api/auth/me", headers=headers(owner)))
        assert response.status_code == 200
        assert len(calls) == 1
        assert response.json()["user"]["game_access"] == response.json()["game_access"]
        assert response.json()["game_access"]["watten_preview"]


def test_only_founder_has_native_http_and_private_html_without_install_metadata(server, monkeypatch):
    owners = roster()
    enable(monkeypatch, owners[0], owners[1], client=server)
    game_id = new_game(server, owners[0])
    for path in ("/watten", "/watten/regeln", f"/watten/spiel/{game_id}",
                 "/watten/konto/fortschritt", "/watten/konto/verlauf", "/watten/rangliste"):
        response = server.get(path, headers=headers(owners[0]))
        assert response.status_code == 200, response.text
        private_headers(response)
        assert 'rel="manifest"' not in response.text
        assert 'data-watten-pwa-preview="true"' not in response.text
        for owner in [*owners[1:], None]:
            denied = server.get(path, headers=headers(owner))
            assert denied.status_code in {404, 503}
            private_headers(denied)
    for owner in owners[1:]:
        assert server.get("/api/games?game_type=watten", headers=headers(owner)).status_code == 404
        assert server.get(f"/api/games/{game_id}", headers=headers(owner)).status_code == 404
        assert server.get("/api/watten/account", headers=headers(owner)).status_code == 404
        assert server.get("/api/watten/leaderboard", headers=headers(owner)).status_code == 404
        assert server.get("/api/watten/favorite", headers=headers(owner)).status_code == 404
    assert server.get("/api/watten/account", headers=headers(owners[0])).status_code == 200
    shared = server.get("/watten/konto/einstellungen", headers=headers(owners[0]), follow_redirects=False)
    assert shared.status_code == 303 and shared.headers["location"] == "/konto"
    private_headers(shared)
    head = server.head("/watten", headers=headers(owners[0]))
    assert head.content == b""
    private_headers(head)


def test_fixed_watten_origin_installation_signup_and_mail_stay_closed_even_for_founder(server, monkeypatch):
    owner = native.account("NoProductionInstall", role="admin")
    enable(monkeypatch, owner, client=server)
    for path in ("/watten-manifest.webmanifest", "/watten-manifest-en.webmanifest", "/watten-sw.js",
                 "/static/watten-sw.js", "/static/watten-game.html"):
        response = server.get(path, headers=headers(owner))
        assert response.status_code in {404, 503}
        private_headers(response)
    icon = server.get("/static/watten/icons/watten-icon-192.png", headers=headers(owner))
    assert icon.status_code == 200  # The private founder header may display its game icon.
    private_headers(icon)
    assert server.get("/static/watten/icons/watten-icon-192.png", headers=headers()).status_code in {404, 503}
    assert server.get("/watten/anmelden", headers=headers(owner)).status_code == 503
    assert server.get("/passwort-vergessen?app=watten", headers=headers(owner)).status_code == 503
    assert server.post("/api/auth/register", headers=headers(owner), json={"username": "NoPrivateSignup",
        "password": "long-password-for-negative-test", "account_app": "watten"}).status_code == 503
    fixed = headers(owner, "watten.zockdiewandan.online")
    assert server.get("/watten", headers=fixed).status_code == 503
    assert server.get("/robots.txt", headers=fixed).text == "User-agent: *\nDisallow: /\n"
    assert server.get("/sitemap.xml", headers=fixed).status_code == 404


def test_actual_websocket_rejects_other_accounts_before_accept_and_rechecks_revoked_founder(server, monkeypatch):
    owners = roster()
    enable(monkeypatch, owners[0], owners[1], client=server)
    game_id = new_game(server, owners[0])
    for owner in [*owners[1:], None]:
        with pytest.raises(WebSocketDisconnect) as error:
            with server.websocket_connect(f"wss://zockdiewandan.online/ws/{game_id}", headers=headers(owner)):
                pass
        assert error.value.code == 1008
    with server.websocket_connect(f"wss://zockdiewandan.online/ws/{game_id}", headers=headers(owners[0])) as socket:
        hello = socket.receive_json()
        socket.send_json({"action": "join_game", "revision": hello["room_revision"],
                          "expected_account_id": owners[0][0].user_id})
        native.receive(socket, "player_id")
        native.receive(socket, "scoreboard")
        socket.send_json(native.room_command(game_id, "watten_take_seat", "private-founder-seat", seat=0, team=None))
        native.receive(socket, "watten_command")
        unavailable = server.post(f"/api/games/{game_id}/notify-open-seat", headers=headers(owners[0]),
                                  json={"revision": games[game_id]["_watten"].room.revision})
        assert unavailable.status_code == 503 and unavailable.json()["detail"] == "watten_push_unavailable"
        with session_scope() as db:
            assert db.scalar(select(func.count()).select_from(WattenOpenSeatClaim)) == 0
        logout(owners[0][1].split("=", 1)[1])
        socket.send_json({"action": "get_state"})
        assert socket.receive_json()["fatal"]


def test_actual_host_and_flag_matrix_never_open_native_apis_through_discovery_or_forwarding(server, monkeypatch):
    owner = native.account("HostBoundFounder", role="admin")
    enable(monkeypatch, owner, client=server)
    game_id = new_game(server, owner)
    for host in ("zilch.zockdiewandan.online", "hausdepp.zockdiewandan.online", "zockdiewandan.online.",
                 "zockdiewandan.online:444", "evil.invalid", "zockdiewandan.online,evil.invalid"):
        response = server.get(f"/api/games/{game_id}", headers=headers(owner, host, **{"X-Forwarded-Host": "zockdiewandan.online"}))
        assert response.status_code == 404
        private_headers(response)
    duplicate = list(headers(owner).items()) + [("Host", "zockdiewandan.online")]
    assert server.get(f"/api/games/{game_id}", headers=duplicate).status_code == 404
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW", "0")
    assert server.get(f"/api/games/{game_id}", headers=headers(owner)).status_code == 404
    blocked = server.get("/watten", headers=headers(owner))
    assert blocked.status_code == 503
    private_headers(blocked)


def test_tour_json_and_stored_only_devices_use_account_authority_not_the_production_flag(server, monkeypatch):
    owners = roster()
    enable(monkeypatch, owners[0], owners[1], client=server)
    monkeypatch.setenv("ROLLTHEDICE_WEB_PUSH_VAPID_PUBLIC_KEY", TEST_VAPID_PUBLIC_KEY)
    monkeypatch.setenv("ROLLTHEDICE_WEB_PUSH_VAPID_PRIVATE_KEY", "isolated-test-only")
    monkeypatch.setenv("ROLLTHEDICE_WEB_PUSH_VAPID_SUBJECT", "mailto:isolated@example.com")
    for index, owner in enumerate(owners):
        tours = server.get("/api/auth/tours", headers=headers(owner)).json()["games"]
        assert ("watten" in tours) is (index == 0)
        if index:
            assert server.post("/api/auth/tours/offer", headers=headers(owner), json={"game_type": "watten"}).status_code == 404
            assert server.put("/api/web-push/subscription", headers=headers(owner), json=subscription().model_dump()).status_code == 404
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(GameTourPreferences)) == 0
        assert db.scalar(select(func.count()).select_from(WebPushSubscription)) == 0
    assert server.post("/api/auth/tours/offer", headers=headers(owners[0]), json={"game_type": "watten"}).json()["show"]
    response = server.put("/api/web-push/subscription", headers=headers(owners[0]), json=subscription().model_dump())
    assert response.status_code == 200, response.text
    assert not response.json()["game_invites_enabled"]
    assert "watten" not in web_push.PUSH_DELIVERY_CONTEXTS
    with pytest.raises(ValueError, match="context_unavailable"):
        web_push.save_web_push_subscription(user_id=owners[1][0].user_id, payload=subscription(suffix="forged"),
            product_context="watten", connection=request_for(host="zockdiewandan.online", origin=PRODUCTION))


def test_accepted_invitation_and_reservation_are_not_founder_access_grants_including_retired_recovery(server, monkeypatch):
    _source, target, owners = invitation_setup(server)
    # Bind the already existing actual host. Invite recipients keep their
    # genuine local password grant/reservation, which must not widen the cohort.
    with session_scope() as db:
        # Founder binding requires the independently assigned administrator role.
        db.get(User, owners[0][0].user_id).role = "admin"
    invite = create_invitation(target["_id"], owners[0][0].user_id, "p2")
    respond_to_invitation(invite["id"], owners[1][0].user_id, "accepted")
    enable(monkeypatch, owners[0], client=server)
    assert accepted_invitation_access(target, owners[1][0].user_id)
    for retired in (False, True):
        if retired:
            games.clear()
        assert server.get(f"/api/games/{target['_id']}?check=1", headers=headers(owners[1])).status_code == 404
        assert server.get("/api/watten/account/invitations", headers=headers(owners[1])).status_code == 404
    assert target["_id"] not in games


def test_legacy_chat_live_and_history_hide_watten_from_other_accounts_and_recheck_each_send(server, monkeypatch):
    owners = roster()
    enable(monkeypatch, owners[0], owners[1], client=server)
    hub = lobby_chat.LobbyChatHub()
    sockets = [Socket(owner, host="zockdiewandan.online") for owner in [owners[0], owners[0], *owners[1:]]]
    audience = {owner[0].user_id for owner in owners}
    for socket, owner in zip(sockets, [owners[0], owners[0], *owners[1:]], strict=True):
        hub.connect(socket, owner[0].user_id, context="zdwa")
    assert hub.eligible_user_ids(lobby_chat.resolve_session, watten_event=True) == {owners[0][0].user_id}
    payload = lobby_chat.record_lobby_chat_event(kind="message", sender=owners[0][0], game_type="watten",
        text="Private founder preview", recipient_user_ids=audience)
    for socket, owner in zip(sockets, [owners[0], owners[0], *owners[1:]], strict=True):
        asyncio.run(lobby_chat._send_authorized_history(socket, owner[0].user_id, context="zdwa"))
    assert all(socket.messages for socket in sockets[:2])
    assert all(not socket.messages for socket in sockets[2:])
    for socket in sockets:
        socket.messages.clear()

    async def revoke():
        logout(owners[0][1].split("=", 1)[1])

    sockets[0].before_send = revoke
    asyncio.run(hub.broadcast(payload, recipient_user_ids=audience, resolve_identity=lobby_chat.resolve_session))
    assert sockets[0].messages and all(not socket.messages for socket in sockets[1:])


def test_fresh_auth_after_favorite_body_prevents_revoked_owner_write(server, monkeypatch):
    owner = native.account("BodyRevokedFounder", role="admin")
    enable(monkeypatch, owner, client=server)
    original = watten_favorite_pages._body

    async def revoked(request):
        result = await original(request)
        logout(owner[1].split("=", 1)[1])
        return result

    with patch.object(watten_favorite_pages, "_body", revoked):
        response = server.put("/api/watten/favorite", headers=headers(owner),
                              json={"recipe": recipe_to_payload(WattenRecipe(2, "normal", False, False))})
    assert response.status_code == 401
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(WattenFavorite)) == 0
        assert db.scalar(select(func.count()).select_from(WattenOpenSeatClaim)) == 0


def test_monitoring_never_adds_watten_for_delegated_dashboard_audiences(server, monkeypatch):
    owners = roster()
    with session_scope() as db:
        for owner in owners:
            db.get(User, owner[0].user_id).analytics_access = True
    enable(monkeypatch, owners[0], owners[1], client=server)
    for index, owner in enumerate(owners):
        response = server.get("/api/admin/analytics?game=all", headers=headers(owner))
        assert response.status_code == 200
        assert ("watten" in response.json()["available_games"]) is (index == 0)
        native = server.get("/api/admin/analytics?game=watten", headers=headers(owner))
        assert native.status_code == (200 if index == 0 else 403)
