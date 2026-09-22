"""Public contact badges follow current accounts and cannot grant authority."""

import asyncio
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app import main
from app.api_users import public_player_profile
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.game_realtime import append_chat_history
from app.game_snapshot import snapshot_zdwa
from app.game_ws_social import handle_social_action
from app.lobby_chat import load_lobby_chat_history, record_lobby_chat_event
from app.models import User
from app.public_roles import active_admin_user_ids, hydrate_admin_status
from app.zilch_snapshot import snapshot_zilch
from app.zilch_state import join_zilch_player, new_zilch_game
from tests.test_lobby_chat import request_for


@pytest.fixture
def accounts(tmp_path):
    previous_games = dict(main.games)
    with patch.dict(os.environ, {
        "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{tmp_path / 'roles.sqlite3'}",
        "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
    }):
        configure_database(tmp_path)
        upgrade_database(main.BASE)
        admin = create_user("ContactAdmin", "secure-role-password", role="admin", must_change_password=False)
        player = create_user("RegularPlayer", "secure-role-password", must_change_password=False)
        try:
            yield admin, player
        finally:
            main.games.clear()
            main.games.update(previous_games)
    configure_database(main.DATA_DIR)


def demote(user_id):
    with session_scope() as db:
        db.get(User, user_id).role = "user"


def test_current_roles_override_stale_flags_and_never_mark_guests_or_cpu(accounts):
    admin, player = accounts
    identities = [
        {"user_id": admin.id}, {"user_id": admin.id},
        {"user_id": player.id, "is_admin": True, "role": "admin"},
        {"name": "ContactAdmin", "is_admin": True},
        {"user_id": admin.id, "type": "cpu"},
    ]
    assert active_admin_user_ids([admin.id, player.id, str(admin.id), True]) == {admin.id}
    hydrate_admin_status(identities)
    assert [item["is_admin"] for item in identities] == [True, True, False, False, False]
    demote(admin.id)
    hydrate_admin_status(identities)
    assert not any(item["is_admin"] for item in identities)
    with session_scope() as db:
        account = db.get(User, admin.id)
        account.role, account.is_active = "admin", False
    assert active_admin_user_ids([admin.id]) == set()


def test_both_game_snapshots_refresh_player_and_chat_contact_flags(accounts):
    admin, player = accounts
    zdwa = main.new_game("role-zdwa", "Role test", 2)
    zdwa["_players"] = [{"id": "a", "name": admin.username, "user_id": admin.id, "ws": None}]
    zdwa["_chat_history"] = [{"sender": admin.username, "user_id": admin.id, "text": "Help"}]
    zilch = new_zilch_game("role-zilch", "Role test", 2)
    join_zilch_player(zilch, {"id": "a", "name": admin.username, "user_id": admin.id, "ws": None})
    join_zilch_player(zilch, {"id": "b", "name": player.username, "user_id": player.id, "ws": None})
    zilch["_chat_history"] = [{"sender": admin.username, "user_id": admin.id, "text": "Help"}]
    for game, renderer in [(zdwa, snapshot_zdwa), (zilch, snapshot_zilch)]:
        payload = renderer(game)
        assert payload["_players"][0]["is_admin"] is True
        assert payload["_chat_history"][0]["is_admin"] is True
        if game is zilch:
            assert payload["_participants"][0]["is_admin"] is True
            assert payload["_participants"][1]["is_admin"] is False
        for key in ("_players", "_participants", "_chat_history"):
            assert all("is_admin" not in item for item in game.get(key, []))
    demote(admin.id)
    for game, renderer in [(zdwa, snapshot_zdwa), (zilch, snapshot_zilch)]:
        payload = renderer(game)
        assert payload["_players"][0]["is_admin"] is False
        assert payload["_chat_history"][0]["is_admin"] is False
        if game is zilch:
            assert payload["_participants"][0]["is_admin"] is False


def test_lobby_projects_roles_for_both_games_without_trusting_old_flags(accounts):
    admin, _ = accounts
    zdwa = main.new_game("lobby-role-zdwa", "Role test", 2)
    zdwa["_players"] = [{"id": "a", "name": admin.username, "user_id": admin.id, "ws": None}]
    zilch = new_zilch_game("lobby-role-zilch", "Role test", 2)
    join_zilch_player(zilch, {"id": "a", "name": admin.username, "user_id": admin.id, "ws": None})
    with patch("app.main.can_access_game", return_value=True), patch("app.main.can_access_zilch_preview", return_value=True):
        for game_type in ["zdwa", "zilch"]:
            payload = asyncio.run(main.api_games(request_for(), game_type=game_type))
            entry = next(game for game in payload["games"] if game["id"] == f"lobby-role-{game_type}")
            assert entry["player_statuses"][0]["is_admin"] is True
            if game_type == "zilch":
                assert entry["participants"][0]["is_admin"] is True
        demote(admin.id)
        assert main.game_info("lobby-role-zdwa", request_for(), passphrase=None, check=0)["player_statuses"][0]["is_admin"] is False


def test_live_chat_and_reactions_take_roles_from_current_accounts(accounts):
    admin, player = accounts
    for user, expected in [(admin, True), (player, False)]:
        session = SimpleNamespace(player_id="p", spectator_id=None, game={"_players": [
            {"id": "p", "name": user.username, "user_id": user.id, "is_admin": True},
        ]})
        with patch("app.game_ws_social.broadcast_chat", new_callable=AsyncMock) as chat:
            asyncio.run(handle_social_action(session, "chat_message", {"text": "Help", "is_admin": True, "role": "admin"}))
            payload = chat.call_args.args[1]
            assert payload["is_admin"] is expected
            assert append_chat_history({}, payload)["is_admin"] is expected
        with patch("app.game_ws_social.broadcast", new_callable=AsyncMock) as reaction:
            asyncio.run(handle_social_action(session, "send_emoji", {"emoji": "👍", "is_admin": True}))
            assert reaction.call_args.args[1]["emoji"]["is_admin"] is expected


def test_profiles_and_lobby_chat_history_use_current_roles(accounts):
    admin, player = accounts
    identity, _ = login(request_for(), admin.username, "secure-role-password")
    event = record_lobby_chat_event(kind="message", sender=identity, game_type="zdwa", recipient_user_ids={player.id}, text="Hello")
    assert event["lobby_chat"]["is_admin"] is True
    assert public_player_profile(admin.username)["player"]["is_admin"] is True
    assert main._safe_zilch_achievement_profile(admin.id, public=True)["player"]["is_admin"] is True
    demote(admin.id)
    assert load_lobby_chat_history(player.id)[0]["lobby_chat"]["is_admin"] is False
    assert public_player_profile(admin.username)["player"]["is_admin"] is False
    assert main._safe_zilch_achievement_profile(admin.id, public=True)["player"]["is_admin"] is False
