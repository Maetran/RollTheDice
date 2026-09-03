"""Focused contracts for the ZDWA/Zilch foundation boundary."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import select
from starlette.requests import Request
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import main
from app.active_games import load_active_games, serializable_game_state
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.game_access import can_access_zilch_preview
from app.game_registry import (
    create_game_state,
    dispatch_gameplay_action,
    join_player_to_game,
    start_game_if_ready,
)
from app.game_snapshot import snapshot
from app.game_state import new_game
from app.game_types import DEFAULT_GAME_TYPE, ZILCH_GAME_TYPE
from app.models import ActiveGame, User
from app.security import utcnow
from app.zilch_state import (
    ZILCH_CPU_MODE,
    ZILCH_CPU_PARTICIPANT,
    ZILCH_DICE_COUNT,
    ZILCH_HUMAN_PARTICIPANT,
    ZILCH_MULTIPLAYER_MODE,
    ZILCH_SOLO_MODE,
    ZILCH_TARGET_SCORE,
    new_zilch_game,
    new_zilch_participant,
)
from tests.support import GameStateTestCase


def request_for(*, cookie: str = "") -> Request:
    headers = [(b"host", b"testserver")]
    if cookie:
        headers.append((b"cookie", cookie.encode("ascii")))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": "http",
            "path": "/",
            "headers": headers,
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 80),
        }
    )


class MultiGameFoundationTestCase(GameStateTestCase):
    def setUp(self):
        super().setUp()
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "multigame.sqlite3"
        self.env_patch = patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.database_path}",
                "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
                "ROLLTHEDICE_TURNSTILE_SECRET": "",
            },
        )
        self.env_patch.start()
        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)

    def tearDown(self):
        self.env_patch.stop()
        configure_database(main.DATA_DIR)
        self.temporary_directory.cleanup()
        super().tearDown()

    def _track(self, game: dict) -> dict:
        self.gids.append(str(game["_id"]))
        return game

    def _identity(self, username: str, *, role: str = "user"):
        create_user(username, f"{username}-secure-password-123", role=role, must_change_password=False)
        return login(request_for(), username, f"{username}-secure-password-123")

    def _promote_mani(self):
        with session_scope() as db:
            user = db.scalar(select(User).where(User.username_normalized == "mani"))
            self.assertIsNotNone(user)
            user.role = "admin"
        return login(request_for(), "Mani", "Mani-secure-password-123")

    def test_legacy_live_state_defaults_to_zdwa_and_new_zdwa_remains_explicit(self):
        game = self._track(new_game("legacy-zdwa", "Legacy", 2))
        old_state = serializable_game_state(game)
        old_state.pop("_game_type")
        with session_scope() as db:
            db.add(
                ActiveGame(
                    game_id="legacy-zdwa-snapshot",
                    state_json=json.dumps(old_state),
                    created_at=utcnow(),
                    updated_at=utcnow(),
                )
            )

        restored = load_active_games()["legacy-zdwa-snapshot"]
        self.assertEqual(game["_game_type"], DEFAULT_GAME_TYPE)
        self.assertEqual(restored["_game_type"], DEFAULT_GAME_TYPE)
        self.assertEqual(snapshot(restored)["_game_type"], DEFAULT_GAME_TYPE)

    def test_existing_zdwa_creation_modes_keep_their_shape(self):
        for mode, expected in (("1", 1), ("2", 2), ("3", 3), ("2v2", 4)):
            with self.subTest(mode=mode):
                request = main.CreateReq.model_validate({"name": f"ZDWA {mode}", "mode": mode})
                self.assertEqual(request.game_type, DEFAULT_GAME_TYPE)
                with patch("app.main.enforce_game_creation_rate_limit"):
                    created = asyncio.run(main.api_games_create(request, request_for()))
                self.gids.append(created["game_id"])
                game = main.games[created["game_id"]]
                self.assertEqual(game["_game_type"], DEFAULT_GAME_TYPE)
                self.assertEqual(game["_expected"], expected)
                self.assertEqual(len(game["_dice"]), 5)

    def test_zilch_accepts_only_one_or_two_players_and_has_two_independent_boards(self):
        for invalid_mode in ("3", "2v2"):
            with self.subTest(mode=invalid_mode):
                with self.assertRaises(ValueError):
                    main.CreateReq.model_validate({"name": "Zilch", "mode": invalid_mode, "game_type": "zilch"})
                with self.assertRaises(ValueError):
                    new_zilch_game("invalid", "Zilch", invalid_mode)

        game = self._track(create_game_state("zilch-snapshot", "Zilch", 2, ZILCH_GAME_TYPE))
        join_player_to_game(game, {"id": "p1", "name": "Mani", "user_id": 1, "ws": None})
        join_player_to_game(game, {"id": "p2", "name": "Guest", "user_id": None, "ws": None})
        start_game_if_ready(game)
        projected = snapshot(game)

        self.assertEqual(projected["_game_type"], ZILCH_GAME_TYPE)
        self.assertEqual(projected["_target_score"], ZILCH_TARGET_SCORE)
        self.assertEqual(projected["_play_mode"], ZILCH_MULTIPLAYER_MODE)
        self.assertEqual(len(projected["_dice"]), ZILCH_DICE_COUNT)
        self.assertEqual(set(projected["_zilch_boards"]), {"p1", "p2"})
        self.assertIsNot(projected["_zilch_boards"]["p1"], projected["_zilch_boards"]["p2"])
        self.assertEqual(projected["_zilch_boards"]["p1"]["total_points"], 0)
        self.assertEqual(projected["_turn"]["player_id"], "p1")
        self.assertEqual(
            [participant["type"] for participant in projected["_participants"]],
            [ZILCH_HUMAN_PARTICIPANT, ZILCH_HUMAN_PARTICIPANT],
        )
        self.assertEqual(projected["_participants"][0]["connection_player_id"], "p1")

        solo = self._track(create_game_state("zilch-solo", "Solo", 1, ZILCH_GAME_TYPE))
        self.assertEqual(solo["_play_mode"], ZILCH_SOLO_MODE)

    def test_cpu_participant_contract_is_transport_independent(self):
        cpu = new_zilch_participant(
            "cpu-1",
            "CPU",
            participant_type=ZILCH_CPU_PARTICIPANT,
            connection_player_id="must-be-cleared",
            user_id=42,
            cpu_strategy="normal",
        )

        self.assertEqual(ZILCH_CPU_MODE, "cpu")
        self.assertEqual(cpu["type"], ZILCH_CPU_PARTICIPANT)
        self.assertEqual(cpu["cpu_strategy"], "normal")
        self.assertIsNone(cpu["connection_player_id"])
        self.assertIsNone(cpu["user_id"])
        with self.assertRaisesRegex(ValueError, "zilch_invalid_cpu_strategy"):
            new_zilch_participant("cpu-2", "CPU", participant_type=ZILCH_CPU_PARTICIPANT)

    def test_preview_access_matrix_uses_admin_role_and_normalized_mani(self):
        normal_identity, _ = self._identity("Normal")
        other_admin, _ = self._identity("OtherAdmin", role="admin")
        mani_without_admin, _ = self._identity("Mani")
        mani_admin, _ = self._promote_mani()

        self.assertFalse(can_access_zilch_preview(None))
        self.assertFalse(can_access_zilch_preview(normal_identity))
        self.assertFalse(can_access_zilch_preview(other_admin))
        self.assertFalse(can_access_zilch_preview(mani_without_admin))
        self.assertTrue(can_access_zilch_preview(mani_admin))

    def test_unapproved_clients_cannot_list_or_read_zilch_games(self):
        game = self._track(create_game_state("hidden-zilch", "Secret Zilch", 1, ZILCH_GAME_TYPE))
        game["_chat_history"] = [{"sender": "Mani", "text": "private zilch chat"}]
        _, normal_token = self._identity("Normal")
        _, other_admin_token = self._identity("OtherAdmin", role="admin")
        _, mani_without_admin_token = self._identity("Mani")

        for label, token in (
            ("anonymous", ""),
            ("normal", normal_token),
            ("other_admin", other_admin_token),
            ("mani_without_admin", mani_without_admin_token),
        ):
            with self.subTest(identity=label):
                listed = asyncio.run(main.api_games(request_for(cookie=f"rollthedice_session={token}"), "zilch"))
                self.assertEqual(listed["games"], [])
                with self.assertRaises(HTTPException) as denied:
                    main.game_info(game["_id"], request_for(cookie=f"rollthedice_session={token}"))
                self.assertEqual(denied.exception.status_code, 404)

        _, mani_admin_token = self._promote_mani()
        approved = asyncio.run(main.api_games(request_for(cookie=f"rollthedice_session={mani_admin_token}"), "zilch"))
        self.assertEqual([item["id"] for item in approved["games"]], [game["_id"]])
        detail = main.game_info(game["_id"], request_for(cookie=f"rollthedice_session={mani_admin_token}"))
        self.assertEqual(detail["game_type"], ZILCH_GAME_TYPE)
        self.assertEqual(detail["id"], game["_id"])

    def test_zilch_creation_and_page_are_server_side_guarded(self):
        request = main.CreateReq.model_validate({"name": "Zilch", "mode": "1", "game_type": "zilch"})
        with patch("app.main.enforce_game_creation_rate_limit"):
            with self.assertRaises(HTTPException) as anonymous:
                asyncio.run(main.api_games_create(request, request_for()))
        self.assertEqual(anonymous.exception.status_code, 401)

        _, other_admin_token = self._identity("OtherAdmin", role="admin")
        with patch("app.main.enforce_game_creation_rate_limit"):
            with self.assertRaises(HTTPException) as denied:
                asyncio.run(
                    main.api_games_create(
                        request,
                        request_for(cookie=f"rollthedice_session={other_admin_token}"),
                    )
                )
        self.assertEqual(denied.exception.status_code, 403)

        _, mani_admin_token = self._identity("Mani", role="admin")
        with patch("app.main.enforce_game_creation_rate_limit"):
            created = asyncio.run(
                main.api_games_create(request, request_for(cookie=f"rollthedice_session={mani_admin_token}"))
            )
        self.gids.append(created["game_id"])
        self.assertEqual(main.games[created["game_id"]]["_game_type"], ZILCH_GAME_TYPE)

        async def page_statuses():
            import httpx

            transport = httpx.ASGITransport(app=main.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                anonymous_page = await client.get("/zilch")
                admin_page = await client.get(
                    "/zilch",
                    cookies={"rollthedice_session": mani_admin_token},
                )
                raw_static_page = await client.get("/static/zilch.html")
            return anonymous_page, admin_page, raw_static_page

        anonymous_page, admin_page, raw_static_page = asyncio.run(page_statuses())
        self.assertEqual(anonymous_page.status_code, 401)
        self.assertEqual(admin_page.status_code, 200)
        self.assertEqual(raw_static_page.status_code, 404)
        self.assertIn('name="robots" content="noindex, nofollow"', admin_page.text)

    def test_websocket_rejects_zilch_before_any_protected_frame(self):
        game = self._track(create_game_state("ws-zilch", "Socket Zilch", 1, ZILCH_GAME_TYPE))
        game["_chat_history"] = [{"sender": "Mani", "text": "protected"}]
        _, mani_token = self._identity("Mani", role="admin")

        with TestClient(main.app) as client:
            with self.assertRaises(WebSocketDisconnect) as denied:
                with client.websocket_connect(f"/ws/{game['_id']}"):
                    pass
            self.assertEqual(denied.exception.code, 1008)

            client.cookies.set("rollthedice_session", mani_token)
            with client.websocket_connect(f"/ws/{game['_id']}") as websocket:
                initial = websocket.receive_json()
                self.assertEqual(initial["game"]["game_type"], ZILCH_GAME_TYPE)
                self.assertNotIn("scoreboard", initial)
                self.assertNotIn("protected", str(initial))
                websocket.send_json({"action": "join_game"})
                self.assertIn("player_id", websocket.receive_json())
                projected = websocket.receive_json()["scoreboard"]
                self.assertEqual(projected["_game_type"], ZILCH_GAME_TYPE)
                self.assertEqual(len(projected["_dice"]), 6)

    def test_gameplay_dispatch_stays_with_its_adapter(self):
        zdwa = self._track(new_game("dispatch-zdwa", "ZDWA", 1))
        zilch = self._track(create_game_state("dispatch-zilch", "Zilch", 1, ZILCH_GAME_TYPE))
        zdwa_session = SimpleNamespace(game=zdwa)
        zilch_session = SimpleNamespace(game=zilch)

        with patch("app.game_ws_gameplay.handle_gameplay_action", new_callable=AsyncMock) as zdwa_handler:
            asyncio.run(dispatch_gameplay_action(zdwa_session, "roll_dice", {}, finalize_game=lambda _game: {}))
            zdwa_handler.assert_awaited_once()

        with patch("app.zilch_gameplay.handle_zilch_gameplay_action", new_callable=AsyncMock) as zilch_handler:
            asyncio.run(dispatch_gameplay_action(zilch_session, "zilch_roll_dice", {}, finalize_game=lambda _game: {}))
            zilch_handler.assert_awaited_once()

        # The state remains independent of ZDWA's scorecard/scoring engine.
        self.assertNotIn("_scoreboards", zilch)
        self.assertEqual(zilch["_dice"], [0] * ZILCH_DICE_COUNT)
