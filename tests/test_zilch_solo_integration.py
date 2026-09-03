"""Outer-boundary contracts for the private, one-human Zilch Solo sprint.

The pure Objective and result tests deliberately stay below these seams.  This
module covers the parts most likely to accidentally regress back into the
two-human/CPU room assumptions: private HTTP creation, one-seat transport,
the no-opening-roll lifecycle, versioned abandonment, and restart-safe time
accounting.
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from starlette.requests import Request
from starlette.testclient import TestClient

from app import main
from app.active_games import load_active_games, save_active_game
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.game_state import games, new_game
from app.game_types import DEFAULT_GAME_TYPE
from app.game_ws_session import GameSocketSession, disconnect_session, handle_session_action
from app.models import ActiveGame
from app.zilch_cpu_runner import cpu_action_is_due
from app.zilch_gameplay import handle_zilch_gameplay_action
from app.zilch_snapshot import snapshot_zilch
from app.zilch_state import (
    ZILCH_MULTIPLAYER_MODE,
    ZILCH_SOLO_MODE,
    configure_zilch_cpu_game,
    configure_zilch_solo_game,
    current_zilch_turn,
    join_zilch_player,
    new_zilch_game,
    start_zilch_game,
)


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


class RecordingSocket:
    """Enough of the WebSocket transport to exercise the shared edge path."""

    def __init__(self) -> None:
        self.messages: list[dict] = []
        self.closed: list[int] = []

    async def send_json(self, message: dict) -> None:
        self.messages.append(message)

    async def close(self, code: int = 1000) -> None:
        self.closed.append(code)


class ZilchSoloIntegrationTestCase(TestCase):
    """Keep the Solo product boundary private and distinct from other modes."""

    def setUp(self) -> None:
        self.game_ids: list[str] = []
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "zilch-solo-integration.sqlite3"
        self.environment = patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.database_path}",
                "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
                "ROLLTHEDICE_TURNSTILE_SECRET": "",
                "ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "previewfriend",
            },
        )
        self.environment.start()
        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)

    def tearDown(self) -> None:
        for game_id in self.game_ids:
            games.pop(game_id, None)
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.temporary_directory.cleanup()

    @staticmethod
    def _identity(username: str, *, role: str = "user") -> tuple[int, str]:
        password = f"{username}-secure-password-123"
        user = create_user(username, password, role=role, must_change_password=False)
        _identity, token = login(request_for(), username, password)
        return user.id, token

    def _create_solo_game(self, token: str) -> str:
        request = main.CreateReq.model_validate(
            {
                "name": "Solo Sprint",
                "mode": "1",
                "game_type": "zilch",
                "play_mode": "solo",
            }
        )
        with patch("app.main.enforce_game_creation_rate_limit"):
            created = asyncio.run(
                main.api_games_create(request, request_for(cookie=f"rollthedice_session={token}"))
            )
        game_id = str(created["game_id"])
        self.game_ids.append(game_id)
        return game_id

    def _started_solo_game(self, *, host_user_id: int = 41) -> tuple[dict, str, RecordingSocket]:
        game_id = f"zilch-solo-direct-{len(self.game_ids)}"
        self.game_ids.append(game_id)
        game = new_zilch_game(game_id, "Solo Sprint", "1")
        configure_zilch_solo_game(game, host_user_id=host_user_id)
        socket = RecordingSocket()
        player_id = "solo-human"
        join_zilch_player(
            game,
            {
                "id": player_id,
                "name": "Mani",
                "user_id": host_user_id,
                "ws": socket,
                "resume_token": "solo-resume-token",
            },
        )
        start_zilch_game(game)
        return game, player_id, socket

    @staticmethod
    def _error_code(socket: RecordingSocket) -> str:
        return str(socket.messages[-1]["zilch_error"]["code"])

    def test_solo_creation_is_private_fixed_and_durably_one_human_without_cpu(self) -> None:
        mani_id, mani_token = self._identity("Mani", role="admin")
        game_id = self._create_solo_game(mani_token)
        game = games[game_id]

        self.assertEqual(game["_play_mode"], ZILCH_SOLO_MODE)
        self.assertEqual(game["_mode"], "1")
        self.assertEqual(game["_expected"], 1)
        self.assertEqual(game["_expected_connections"], 1)
        self.assertEqual(game["_zilch_solo_host_user_id"], mani_id)
        self.assertEqual(game["_players"], [])
        self.assertEqual(game["_participants"], [])
        self.assertIsNone(game["_zilch_cpu_participant_id"])
        self.assertEqual(game["_zilch_solo_objective"]["id"], "reach_10000_fewest_turns")
        self.assertEqual(game["_zilch_solo_objective"]["version"], 1)
        self.assertEqual(game["_zilch_solo_objective"]["parameters"], {})

        with session_scope() as db:
            stored = db.scalar(select(ActiveGame).where(ActiveGame.game_id == game_id))
            self.assertIsNotNone(stored)
            durable = json.loads(stored.state_json)
        self.assertEqual(durable["_play_mode"], ZILCH_SOLO_MODE)
        self.assertEqual(durable["_participants"], [])
        self.assertEqual(durable["_expected_connections"], 1)
        self.assertNotIn("ws", durable["_players"])

        lobby = asyncio.run(main.api_games(request_for(cookie=f"rollthedice_session={mani_token}"), "zilch"))
        listed = next(entry for entry in lobby["games"] if entry["id"] == game_id)
        self.assertTrue(listed["my_solo_host"])
        self.assertEqual(listed["participant_count"], 0)
        self.assertEqual(listed["expected_participants"], 1)
        self.assertEqual(listed["expected_connections"], 1)
        self.assertEqual(listed["solo_objective"]["progress"]["target_score"], 10_000)
        self.assertEqual(listed["solo_metrics"]["remaining_points"], 10_000)

        details = main.game_info(game_id, request_for(cookie=f"rollthedice_session={mani_token}"))
        self.assertTrue(details["my_solo_host"])
        self.assertEqual(details["play_mode"], ZILCH_SOLO_MODE)
        self.assertEqual(details["solo_objective"]["primary_metric"], "turns")

    def test_solo_request_validation_and_preview_policy_cannot_be_relaxed_by_payload(self) -> None:
        request = main.CreateReq.model_validate(
            {
                "name": " Solo Sprint ",
                "mode": 1,
                "game_type": "zilch",
                "play_mode": "SOLO",
            }
        )
        self.assertEqual(request.name, "Solo Sprint")
        self.assertEqual(request.mode, "1")
        self.assertEqual(request.play_mode, ZILCH_SOLO_MODE)

        invalid_payloads = (
            {"name": "Solo", "mode": "2", "game_type": "zilch", "play_mode": "solo"},
            {
                "name": "Solo",
                "mode": "1",
                "game_type": "zilch",
                "play_mode": "solo",
                "cpu_strategy": "normal",
            },
            {
                "name": "Solo",
                "mode": "1",
                "game_type": "zilch",
                "play_mode": "solo",
                "pass": "not-a-solo-room",
            },
            {"name": "ZDWA", "mode": "1", "play_mode": "solo"},
        )
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                with self.assertRaises(ValidationError):
                    main.CreateReq.model_validate(payload)

        solo_request = main.CreateReq.model_validate(
            {"name": "Private Solo", "mode": "1", "game_type": "zilch", "play_mode": "solo"}
        )
        with patch("app.main.enforce_game_creation_rate_limit"):
            with self.assertRaises(HTTPException) as anonymous:
                asyncio.run(main.api_games_create(solo_request, request_for()))
        self.assertEqual(anonymous.exception.status_code, 401)

        _other_id, other_admin_token = self._identity("OtherAdmin", role="admin")
        with patch("app.main.enforce_game_creation_rate_limit"):
            with self.assertRaises(HTTPException) as denied:
                asyncio.run(
                    main.api_games_create(
                        solo_request,
                        request_for(cookie=f"rollthedice_session={other_admin_token}"),
                    )
                )
        self.assertEqual(denied.exception.status_code, 403)

    def test_only_the_authenticated_solo_host_can_join_and_it_starts_directly_without_opening_roll(self) -> None:
        _mani_id, mani_token = self._identity("Mani", role="admin")
        _preview_id, preview_token = self._identity("PreviewFriend")
        game_id = self._create_solo_game(mani_token)

        with TestClient(main.app) as host_client, TestClient(main.app) as preview_client:
            host_client.cookies.set("rollthedice_session", mani_token)
            preview_client.cookies.set("rollthedice_session", preview_token)
            with host_client.websocket_connect(f"/ws/{game_id}") as host_socket:
                self.assertEqual(host_socket.receive_json()["game"]["game_type"], "zilch")
                host_socket.send_json({"action": "join_game"})
                joined = host_socket.receive_json()
                started = host_socket.receive_json()["scoreboard"]
                player_id = joined["player_id"]

                self.assertTrue(started["_started"])
                self.assertIsNone(started["_zilch_start_roll"])
                self.assertEqual(started["_turn"]["player_id"], player_id)
                self.assertEqual(started["_turn"]["turn_id"], 1)
                self.assertEqual(started["_play_mode"], ZILCH_SOLO_MODE)
                self.assertEqual(started["_players_joined"], 1)
                self.assertEqual(started["_participants_joined"], 1)
                self.assertEqual(started["_expected_connections"], 1)
                self.assertEqual(started["_expected_participants"], 1)
                self.assertEqual(len(started["_zilch_boards"]), 1)
                self.assertTrue(started["_zilch_can_abandon"])
                self.assertEqual(started["_zilch_solo_objective"]["metrics"]["turns"], 1)

                with preview_client.websocket_connect(f"/ws/{game_id}") as preview_socket:
                    self.assertEqual(preview_socket.receive_json()["game"]["game_type"], "zilch")
                    preview_socket.send_json({"action": "join_game"})
                    rejected = preview_socket.receive_json()

        self.assertTrue(rejected["fatal"])
        self.assertEqual(rejected["error"], "zilch_solo_host_required")
        game = games[game_id]
        self.assertEqual(len(game["_players"]), 1)
        self.assertEqual(len(game["_participants"]), 1)
        self.assertFalse(any(participant["type"] == "cpu" for participant in game["_participants"]))

    def test_abandonment_requires_current_host_turn_and_explicit_confirmation(self) -> None:
        game, player_id, socket = self._started_solo_game()
        session = GameSocketSession(websocket=socket, game=game, auth_identity=None, player_id=player_id)
        turn = current_zilch_turn(game)

        asyncio.run(
            handle_zilch_gameplay_action(
                session,
                "zilch_abandon_solo",
                {"turn_id": turn.turn_id, "version": turn.version, "confirmed": False},
            )
        )
        self.assertEqual(self._error_code(socket), "zilch_solo_abandon_confirmation_required")
        self.assertFalse(game["_finished"])

        asyncio.run(
            handle_zilch_gameplay_action(
                session,
                "zilch_abandon_solo",
                {"turn_id": turn.turn_id + 1, "version": turn.version, "confirmed": True},
            )
        )
        self.assertEqual(self._error_code(socket), "zilch_stale_turn")
        self.assertFalse(game["_finished"])

        intruder_socket = RecordingSocket()
        intruder = GameSocketSession(websocket=intruder_socket, game=game, auth_identity=None, player_id="intruder")
        asyncio.run(
            handle_zilch_gameplay_action(
                intruder,
                "zilch_abandon_solo",
                {"turn_id": turn.turn_id, "version": turn.version, "confirmed": True},
            )
        )
        self.assertEqual(self._error_code(intruder_socket), "zilch_cpu_action_not_allowed")
        self.assertFalse(game["_finished"])

        asyncio.run(
            handle_zilch_gameplay_action(
                session,
                "zilch_abandon_solo",
                {"turn_id": turn.turn_id, "version": turn.version, "confirmed": True},
            )
        )
        self.assertTrue(game["_finished"])
        self.assertEqual(game["_zilch_outcome"]["status"], "abandoned")
        self.assertEqual(game["_zilch_solo_objective"]["outcome"], "abandoned")
        terminal = socket.messages[-1]["scoreboard"]
        self.assertEqual(terminal["_zilch_last_event"]["type"], "solo_abandoned")
        self.assertEqual(terminal["_zilch_outcome"]["status"], "abandoned")

        asyncio.run(
            handle_zilch_gameplay_action(
                session,
                "zilch_abandon_solo",
                {"turn_id": turn.turn_id, "version": turn.version, "confirmed": True},
            )
        )
        self.assertEqual(self._error_code(socket), "zilch_game_finished")

    def test_solo_rejoin_and_restart_pause_time_without_creating_a_cpu_runner(self) -> None:
        game, player_id, socket = self._started_solo_game()
        base = datetime(2030, 1, 1, tzinfo=timezone.utc)
        game["_zilch_solo_active_since"] = base.isoformat()
        session = GameSocketSession(websocket=socket, game=game, auth_identity=None, player_id=player_id)

        with patch("app.zilch_state._utcnow", return_value=base + timedelta(seconds=20)):
            asyncio.run(disconnect_session(session))
        self.assertIsNone(game["_zilch_solo_active_since"])
        self.assertEqual(game["_zilch_solo_objective"]["progress"]["active_duration_seconds"], 20)
        self.assertTrue(game["_resume_required"])

        resumed_socket = RecordingSocket()
        resumed = GameSocketSession(websocket=resumed_socket, game=game, auth_identity=None)
        with patch("app.zilch_state._utcnow", return_value=base + timedelta(seconds=300)):
            should_close = asyncio.run(
                handle_session_action(
                    resumed,
                    "rejoin_game",
                    {"player_id": player_id, "resume_token": "solo-resume-token"},
                )
            )
        self.assertFalse(should_close)
        self.assertEqual(game["_zilch_solo_objective"]["progress"]["active_duration_seconds"], 20)
        self.assertEqual(game["_zilch_solo_paused_at"], None)
        self.assertEqual(game["_zilch_solo_active_since"], (base + timedelta(seconds=300)).isoformat())

        save_active_game(game)
        restored = load_active_games()[str(game["_id"])]
        games[str(game["_id"])] = restored
        self.assertEqual(restored["_play_mode"], ZILCH_SOLO_MODE)
        self.assertEqual(restored["_zilch_solo_objective"]["progress"]["active_duration_seconds"], 20)
        self.assertIsNone(restored["_zilch_solo_active_since"])
        self.assertTrue(restored["_resume_required"])
        self.assertFalse(cpu_action_is_due(restored))

        recovered_socket = RecordingSocket()
        recovered = GameSocketSession(websocket=recovered_socket, game=restored, auth_identity=None)
        with patch("app.zilch_state._utcnow", return_value=base + timedelta(seconds=600)):
            should_close = asyncio.run(
                handle_session_action(
                    recovered,
                    "rejoin_game",
                    {"player_id": player_id, "resume_token": "solo-resume-token"},
                )
            )
        self.assertFalse(should_close)
        self.assertEqual(restored["_zilch_solo_objective"]["progress"]["active_duration_seconds"], 20)
        self.assertEqual(restored["_zilch_solo_active_since"], (base + timedelta(seconds=600)).isoformat())

    def test_solo_addition_keeps_competitive_and_zdwa_defaults_intact(self) -> None:
        zdwa = new_game("zdwa-stays-zdwa", "ZDWA", "1")
        self.game_ids.append("zdwa-stays-zdwa")
        self.assertEqual(zdwa["_game_type"], DEFAULT_GAME_TYPE)

        multiplayer = new_zilch_game("zilch-hvh-stays-hvh", "Humans", "2")
        self.game_ids.append("zilch-hvh-stays-hvh")
        for index in (1, 2):
            join_zilch_player(
                multiplayer,
                {"id": f"h{index}", "name": f"Human {index}", "user_id": index, "ws": RecordingSocket()},
            )
        start_zilch_game(multiplayer)
        self.assertEqual(multiplayer["_play_mode"], ZILCH_MULTIPLAYER_MODE)
        self.assertEqual(multiplayer["_zilch_start_roll"]["phase"], "awaiting_rolls")
        self.assertIsNone(multiplayer["_turn"])

        cpu = new_zilch_game("zilch-cpu-stays-cpu", "CPU", "2")
        self.game_ids.append("zilch-cpu-stays-cpu")
        configure_zilch_cpu_game(cpu, host_user_id=8, cpu_strategy="normal")
        self.assertEqual(cpu["_play_mode"], "cpu")
        self.assertEqual(cpu["_expected"], 2)
        self.assertEqual(cpu["_expected_connections"], 1)
        self.assertEqual(cpu["_participants"][0]["type"], "cpu")
        self.assertFalse(cpu_action_is_due(cpu))

        self.assertIsNone(snapshot_zilch(multiplayer)["_zilch_solo_objective"])
