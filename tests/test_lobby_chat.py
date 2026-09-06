"""Contracts for the audience-scoped, three-day shared lobby chat."""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import func, select
from starlette.requests import Request
from starlette.responses import Response
from starlette.testclient import TestClient

from app import main
from app.api_auth import (
    AdminUserUpdateRequest,
    LobbyChatPreferenceRequest,
    admin_update_user,
    auth_me,
    auth_update_lobby_chat_preference,
)
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.lobby_chat import (
    LobbyChatHub,
    load_lobby_chat_history,
    purge_expired_lobby_chat_messages,
    record_lobby_chat_event,
)
from app.models import LobbyChatMessage, LobbyChatMessageRecipient, User
from app.security import utcnow


def request_for(*, cookie: str = "", csrf: str = "") -> Request:
    headers = [(b"host", b"testserver")]
    if cookie:
        headers.append((b"cookie", cookie.encode("ascii")))
    if csrf:
        headers.append((b"x-csrf-token", csrf.encode("ascii")))
    return Request(
        {
            "type": "http",
            "method": "PUT",
            "scheme": "http",
            "path": "/api/auth/preferences/lobby-chat",
            "headers": headers,
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 80),
        }
    )


class LobbyChatTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        database_path = Path(self.temporary_directory.name) / "lobby-chat.sqlite3"
        self.env_patch = patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{database_path}",
                "ROLLTHEDICE_COOKIE_DOMAIN": "",
                "ROLLTHEDICE_COOKIE_SECURE": "0",
                "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
                "ROLLTHEDICE_TURNSTILE_SECRET": "",
            },
        )
        self.env_patch.start()
        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)
        self.previous_hub = main.lobby_chat_hub
        main.lobby_chat_hub = LobbyChatHub()

    def tearDown(self) -> None:
        main.lobby_chat_hub = self.previous_hub
        self.env_patch.stop()
        configure_database(main.DATA_DIR)
        self.temporary_directory.cleanup()

    def test_chat_history_has_a_fixed_account_audience_and_presence_events(self) -> None:
        create_user("Zed", "a-secure-password-123", must_change_password=False)
        create_user("Zilla", "another-secure-password-123", must_change_password=False)
        create_user("LatePlayer", "third-secure-password-123", must_change_password=False)
        _, zed_token = login(request_for(), "Zed", "a-secure-password-123")
        _, zilla_token = login(request_for(), "Zilla", "another-secure-password-123")
        _, late_token = login(request_for(), "LatePlayer", "third-secure-password-123")

        with (
            TestClient(main.app) as zed_client,
            TestClient(main.app) as zilla_client,
            TestClient(main.app) as late_client,
            TestClient(main.app) as guest_client,
        ):
            zed_client.cookies.set("rollthedice_session", zed_token)
            zilla_client.cookies.set("rollthedice_session", zilla_token)
            late_client.cookies.set("rollthedice_session", late_token)
            with zed_client.websocket_connect("/ws/lobby-chat?context=zdwa") as zed_socket:
                with zilla_client.websocket_connect("/ws/lobby-chat?context=zilch") as zilla_socket:
                    zilla_connected_for_zed = zed_socket.receive_json()
                    self.assertEqual(zilla_connected_for_zed["lobby_chat"]["sender"], "Zilla")
                    self.assertEqual(zilla_connected_for_zed["lobby_chat"]["kind"], "presence")
                    self.assertEqual(zilla_connected_for_zed["lobby_chat"]["game_type"], "zilch")

                    zed_socket.send_json({"action": "lobby_chat_message", "text": "Hallo aus ZDWA"})
                    own = zed_socket.receive_json()["lobby_chat"]
                    received = zilla_socket.receive_json()["lobby_chat"]
                    self.assertEqual(own, received)
                    self.assertEqual(received["kind"], "message")
                    self.assertEqual(received["sender"], "Zed")
                    self.assertEqual(received["game_type"], "zdwa")
                    self.assertEqual(received["text"], "Hallo aus ZDWA")

            # The same authenticated account receives its authorized history
            # after reconnecting. It never triggers a popup client-side because
            # the transport marks replay frames explicitly as history.
            with zed_client.websocket_connect("/ws/lobby-chat?context=zdwa") as reconnected_zed:
                history = [reconnected_zed.receive_json() for _ in range(2)]
                self.assertTrue(all(frame["lobby_chat_history"] for frame in history))
                self.assertEqual([frame["lobby_chat"]["kind"] for frame in history], ["presence", "message"])
                self.assertEqual(history[-1]["lobby_chat"]["text"], "Hallo aus ZDWA")

                # This account was authenticated but was not connected while
                # the previous events were sent, so it receives no protected
                # history. Its arrival is announced only to Zed.
                with late_client.websocket_connect("/ws/lobby-chat?context=zilch") as late_socket:
                    late_connected_for_zed = reconnected_zed.receive_json()
                    self.assertEqual(late_connected_for_zed["lobby_chat"]["kind"], "presence")
                    self.assertEqual(late_connected_for_zed["lobby_chat"]["sender"], "LatePlayer")
                    # A probe would receive replay frames first if this account
                    # had been part of the earlier audience.
                    late_socket.send_json({"action": "probe"})
                    self.assertEqual(late_socket.receive_json(), {"error": "lobby_chat_action_unknown"})
                    reconnected_zed.send_json({"action": "lobby_chat_message", "text": "Willkommen"})
                    self.assertEqual(reconnected_zed.receive_json()["lobby_chat"]["text"], "Willkommen")
                    self.assertEqual(late_socket.receive_json()["lobby_chat"]["text"], "Willkommen")

            # Anonymous sockets are never added to an event audience and cannot
            # write to the channel either.
            with guest_client.websocket_connect("/ws/lobby-chat?context=zdwa") as guest_socket:
                guest_socket.send_json({"action": "lobby_chat_message", "text": "Ich darf nicht schreiben"})
                self.assertEqual(guest_socket.receive_json(), {"error": "authentication_required"})

        with session_scope() as db:
            zed = db.scalar(select(User).where(User.username == "Zed"))
            zilla = db.scalar(select(User).where(User.username == "Zilla"))
            late = db.scalar(select(User).where(User.username == "LatePlayer"))
            message = db.scalar(
                select(LobbyChatMessage).where(
                    LobbyChatMessage.kind == "message",
                    LobbyChatMessage.text == "Hallo aus ZDWA",
                )
            )
            self.assertIsNotNone(zed)
            self.assertIsNotNone(zilla)
            self.assertIsNotNone(late)
            self.assertIsNotNone(message)
            recipients = set(
                db.scalars(
                    select(LobbyChatMessageRecipient.user_id).where(
                        LobbyChatMessageRecipient.message_id == message.id
                    )
                )
            )
            self.assertEqual(recipients, {zed.id, zilla.id})
            self.assertNotIn(late.id, recipients)

    def test_expired_history_is_permanently_deleted(self) -> None:
        create_user("HistoryPlayer", "a-secure-password-123", must_change_password=False)
        identity, _ = login(request_for(), "HistoryPlayer", "a-secure-password-123")
        now = utcnow()
        expired = record_lobby_chat_event(
            kind="message",
            sender=identity,
            game_type="zdwa",
            recipient_user_ids={identity.user_id},
            text="Vergangen",
            now=now - timedelta(days=3, seconds=1),
        )
        current = record_lobby_chat_event(
            kind="message",
            sender=identity,
            game_type="zilch",
            recipient_user_ids={identity.user_id},
            text="Aktuell",
            now=now,
        )
        self.assertIsNotNone(expired)
        self.assertIsNotNone(current)

        self.assertEqual(purge_expired_lobby_chat_messages(now=now), 1)
        history = load_lobby_chat_history(identity.user_id, now=now)
        self.assertEqual([frame["lobby_chat"]["text"] for frame in history], ["Aktuell"])
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(LobbyChatMessage)), 1)
            self.assertEqual(db.scalar(select(func.count()).select_from(LobbyChatMessageRecipient)), 1)

    def test_lobby_chat_preferences_default_to_enabled_and_can_disable_the_channel(self) -> None:
        create_user("PopupPlayer", "a-secure-password-123", must_change_password=False)
        identity, raw_token = login(request_for(), "PopupPlayer", "a-secure-password-123")
        request = request_for(
            cookie=f"rollthedice_session={raw_token}",
            csrf=identity.csrf_token,
        )

        before = auth_me(request_for(cookie=f"rollthedice_session={raw_token}"), Response())
        self.assertTrue(before["user"]["preferences"]["lobby_chat_popups"])
        self.assertTrue(before["user"]["preferences"]["lobby_chat_enabled"])

        result = auth_update_lobby_chat_preference(
            LobbyChatPreferenceRequest(lobby_chat_popups=False, lobby_chat_enabled=False),
            request,
        )
        self.assertEqual(result, {"lobby_chat_popups": False, "lobby_chat_enabled": False})
        after = auth_me(request_for(cookie=f"rollthedice_session={raw_token}"), Response())
        self.assertFalse(after["user"]["preferences"]["lobby_chat_popups"])
        self.assertFalse(after["user"]["preferences"]["lobby_chat_enabled"])
        with session_scope() as db:
            user = db.scalar(select(User).where(User.username == "PopupPlayer"))
            self.assertIsNotNone(user)
            self.assertFalse(user.lobby_chat_popups)
            self.assertFalse(user.lobby_chat_enabled)

    def test_mute_keeps_read_access_while_exclusion_blocks_chat_access(self) -> None:
        muted = create_user("MutedPlayer", "a-secure-password-123", must_change_password=False)
        excluded = create_user("ExcludedPlayer", "another-secure-password-123", must_change_password=False)
        create_user("ChatObserver", "third-secure-password-123", must_change_password=False)
        with session_scope() as db:
            db.get(User, muted.id).lobby_chat_muted = True
            db.get(User, excluded.id).lobby_chat_excluded = True

        _, muted_token = login(request_for(), "MutedPlayer", "a-secure-password-123")
        _, excluded_token = login(request_for(), "ExcludedPlayer", "another-secure-password-123")
        _, observer_token = login(request_for(), "ChatObserver", "third-secure-password-123")
        with (
            TestClient(main.app) as muted_client,
            TestClient(main.app) as excluded_client,
            TestClient(main.app) as observer_client,
        ):
            muted_client.cookies.set("rollthedice_session", muted_token)
            excluded_client.cookies.set("rollthedice_session", excluded_token)
            observer_client.cookies.set("rollthedice_session", observer_token)
            with observer_client.websocket_connect("/ws/lobby-chat?context=zdwa") as observer_socket:
                with muted_client.websocket_connect("/ws/lobby-chat?context=zilch") as muted_socket:
                    self.assertEqual(observer_socket.receive_json()["lobby_chat"]["sender"], "MutedPlayer")
                    muted_socket.send_json({"action": "lobby_chat_message", "text": "Ich schreibe nicht"})
                    self.assertEqual(muted_socket.receive_json(), {"error": "lobby_chat_muted"})
                    observer_socket.send_json({"action": "lobby_chat_message", "text": "Du kannst das lesen"})
                    self.assertEqual(observer_socket.receive_json()["lobby_chat"]["text"], "Du kannst das lesen")
                    self.assertEqual(muted_socket.receive_json()["lobby_chat"]["text"], "Du kannst das lesen")
                with excluded_client.websocket_connect("/ws/lobby-chat?context=zdwa") as excluded_socket:
                    self.assertEqual(excluded_socket.receive_json(), {"error": "lobby_chat_excluded"})
                    excluded_socket.send_json({"action": "lobby_chat_message", "text": "Nicht sichtbar"})
                    self.assertEqual(excluded_socket.receive_json(), {"error": "lobby_chat_excluded"})

    def test_admin_can_mute_and_exclude_a_player(self) -> None:
        create_user("ChatAdmin", "admin-password-123", role="admin", must_change_password=False)
        player = create_user("Moderated", "a-secure-password-123", must_change_password=False)
        admin_identity, admin_token = login(request_for(), "ChatAdmin", "admin-password-123")
        player_identity, player_token = login(request_for(), "Moderated", "a-secure-password-123")
        admin_request = request_for(
            cookie=f"rollthedice_session={admin_token}",
            csrf=admin_identity.csrf_token,
        )

        muted = admin_update_user(
            player.id,
            AdminUserUpdateRequest(lobby_chat_muted=True),
            admin_request,
        )
        excluded = admin_update_user(
            player.id,
            AdminUserUpdateRequest(lobby_chat_excluded=True),
            admin_request,
        )
        self.assertTrue(muted["user"]["lobby_chat_muted"])
        self.assertTrue(excluded["user"]["lobby_chat_excluded"])
        payload = auth_me(request_for(cookie=f"rollthedice_session={player_token}"), Response())
        self.assertTrue(payload["user"]["preferences"]["lobby_chat_muted"])
        self.assertTrue(payload["user"]["preferences"]["lobby_chat_excluded"])

    def test_rate_limit_is_shared_by_an_account_across_tabs_and_reconnects(self) -> None:
        hub = LobbyChatHub()
        self.assertEqual([hub.allow_message(42) for _ in range(5)], [True] * 5)
        self.assertFalse(hub.allow_message(42))
        self.assertTrue(hub.allow_message(43))
