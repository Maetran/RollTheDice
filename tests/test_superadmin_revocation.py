"""Privileged live edits cannot outlive the account or session that enabled them."""

import asyncio
import os
from unittest.mock import patch

import pytest
from fastapi import WebSocketDisconnect
from sqlalchemy import delete

from app import main
from app.auth import LEGACY_SESSION_COOKIE, create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.game_websocket import MessageRateLimiter, _receive_messages
from app.game_ws_admin import handle_superadmin_action, release_revoked_superadmin_locks
from app.game_ws_session import GameSocketSession
from app.models import Session, User
from tests.support import GameStateTestCase
from tests.test_game_websocket import RecordingSocket
from tests.test_user_accounts import request_for


class AccountSocket(RecordingSocket):
    def __init__(self, token="", actions=()):
        super().__init__()
        self.cookies = {LEGACY_SESSION_COOKIE: token}
        self.actions = iter(actions)

    async def receive_json(self):
        try:
            return next(self.actions)
        except StopIteration as exc:
            raise WebSocketDisconnect() from exc


@pytest.fixture
def editor(tmp_path):
    with patch.dict(os.environ, {
        "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{tmp_path / 'revocation.sqlite3'}",
        "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
    }):
        configure_database(tmp_path)
        upgrade_database(main.BASE)
        user = create_user("LiveEditor", "editor-password-123", role="admin", must_change_password=False)
        identity, token = login(request_for(), user.username, "editor-password-123")
        socket = AccountSocket(token)
        state = GameStateTestCase()
        state.setUp()
        game = state.make_game(players=[("editor", user.username), ("other", "Other")])
        game["_players"][0].update(user_id=user.id, ws=socket)
        game["_players"][1]["ws"] = AccountSocket()
        game["_scoreboards"]["editor"]["0,down"] = 3
        game["_dice"] = [1, 2, 3, 4, 5]
        game["_rolls_used"] = 1
        session = GameSocketSession(websocket=socket, game=game, auth_identity=identity, player_id="editor")
        asyncio.run(handle_superadmin_action(session, "superadmin_activate", {"board_id": "editor"}, finalize_game=lambda _: None))
        assert game["_superadmins"]["editor"]["user_id"] == user.id
        try:
            yield session, user.id
        finally:
            state.tearDown()
    configure_database(main.DATA_DIR)


def revoke(user_id, mode):
    with session_scope() as db:
        if mode == "session":
            db.execute(delete(Session).where(Session.user_id == user_id))
        elif mode == "role":
            db.get(User, user_id).role = "user"
        else:
            db.get(User, user_id).is_active = False


@pytest.mark.parametrize("mode", ["role", "inactive", "session"])
@pytest.mark.parametrize("action,payload", [
    ("superadmin_activate", {"board_id": "editor"}),
    ("superadmin_save", {"board_id": "editor", "changes": [{"row": 0, "field": "down", "value": 99}]}),
    ("superadmin_roll_dice", {}),
    ("superadmin_set_die", {"index": 0, "value": 6}),
])
def test_revoked_editor_cannot_activate_save_or_change_dice(editor, mode, action, payload):
    session, user_id = editor
    revoke(user_id, mode)
    asyncio.run(handle_superadmin_action(session, action, payload, finalize_game=lambda _: None))
    assert session.game["_superadmins"] == {}
    assert session.game["_scoreboards"]["editor"]["0,down"] == 3
    assert session.game["_dice"] == [1, 2, 3, 4, 5]
    assert session.websocket.messages[-1] == {"error": "Admin-Berechtigung erforderlich"}


def test_an_idle_revoked_editor_does_not_block_another_players_next_roll(editor):
    session, user_id = editor
    revoke(user_id, "role")
    game = session.game
    game["_turn"] = {"player_id": "other", "roll_index": 0}
    game["_rolls_used"] = 0
    other = AccountSocket(actions=[{"action": "roll_dice"}])
    game["_players"][1]["ws"] = other
    other_session = GameSocketSession(websocket=other, game=game, auth_identity=None, player_id="other")
    with pytest.raises(WebSocketDisconnect):
        asyncio.run(_receive_messages(other_session, limiter=MessageRateLimiter(), finalize_game=lambda _: None))
    assert game["_superadmins"] == {}
    assert game["_rolls_used"] == 1
    assert {"superadmin": {"active": False}} in session.websocket.messages
    assert not any("Superadmin-Edit" in message.get("error", "") for message in other.messages)


def test_current_admin_keeps_the_edit_lock_and_can_save(editor):
    session, _ = editor
    asyncio.run(release_revoked_superadmin_locks(session.game))
    assert "editor" in session.game["_superadmins"]
    asyncio.run(handle_superadmin_action(session, "superadmin_save", {
        "board_id": "editor", "changes": [{"row": 0, "field": "down", "value": 7}],
    }, finalize_game=lambda _: None))
    assert session.game["_scoreboards"]["editor"]["0,down"] == 7
    assert session.game["_superadmins"] == {}


def test_background_sweep_releases_idle_edit_lock_without_any_client_message(editor):
    session, user_id = editor
    revoke(user_id, "session")

    async def sweep_once():
        stop = asyncio.Event()

        async def mark_completed():
            stop.set()

        with patch("app.main._sweep_timeout_aborts", side_effect=mark_completed):
            await main._run_timeout_sweeper(stop)

    asyncio.run(sweep_once())
    assert session.game["_superadmins"] == {}
    assert {"superadmin": {"active": False}} in session.websocket.messages
    assert session.websocket.messages[-1]["scoreboard"]["_superadmin_active"] is False
