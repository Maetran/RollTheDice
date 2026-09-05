"""HTTP and socket contracts around the CPU participant boundary.

The CPU runner and pure strategy tests deliberately exercise trusted domain
commands.  These focused integration checks cover the outer seams instead:
request validation, durable creation, and the fact that a second authenticated
preview user cannot occupy a CPU game's only human WebSocket seat.
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
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
from app.game_state import games
from app.game_ws_session import GameSocketSession, handle_session_action
from app.models import ActiveGame
from app.zilch_cpu_runner import cpu_action_is_due, maybe_schedule_cpu_turn, stop_cpu_runners
from app.zilch_state import (
    ZILCH_CPU_MODE,
    configure_zilch_cpu_game,
    join_zilch_player,
    new_zilch_game,
    record_zilch_start_roll,
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
    """Minimal JSON socket used only for shared rejoin/runner integration."""

    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def send_json(self, message: dict) -> None:
        self.messages.append(message)


class ZilchCpuHttpAndSocketTestCase(TestCase):
    """Keep CPU creation and joining behind the normal private API boundary."""

    def setUp(self) -> None:
        self.game_ids: list[str] = []
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "zilch-cpu-integration.sqlite3"
        self.environment = patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.database_path}",
                "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
                "ROLLTHEDICE_TURNSTILE_SECRET": "",
                "ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "previewfriend",
                "ROLLTHEDICE_ZILCH_CPU_DELAY_SECONDS": "0",
            },
        )
        self.environment.start()
        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)

    def tearDown(self) -> None:
        asyncio.run(stop_cpu_runners())
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

    def _create_cpu_game(self, token: str, *, strategy: str = "normal") -> str:
        request = main.CreateReq.model_validate(
            {
                "name": "CPU-Tisch",
                "mode": "2",
                "game_type": "zilch",
                "play_mode": "cpu",
                "cpu_strategy": strategy,
            }
        )
        with patch("app.main.enforce_game_creation_rate_limit"):
            created = asyncio.run(
                main.api_games_create(request, request_for(cookie=f"rollthedice_session={token}"))
            )
        game_id = str(created["game_id"])
        self.game_ids.append(game_id)
        return game_id

    def _started_cpu_turn(self, *, strategy: str = "conservative") -> tuple[dict, str, str]:
        """Build one started CPU turn through the durable state adapter."""
        game_id = f"zilch-cpu-recovery-{len(self.game_ids)}"
        self.game_ids.append(game_id)
        game = new_zilch_game(game_id, "CPU recovery", 2)
        cpu = configure_zilch_cpu_game(game, host_user_id=42, cpu_strategy=strategy)
        human_id = "human-1"
        join_zilch_player(
            game,
            {
                "id": human_id,
                "name": "Mani",
                "user_id": 42,
                "ws": RecordingSocket(),
                "resume_token": "human-resume",
            },
        )
        start_zilch_game(game)
        cpu_id = str(cpu["id"])
        record_zilch_start_roll(game, human_id, 2)
        record_zilch_start_roll(game, cpu_id, 6)
        self.assertTrue(cpu_action_is_due(game))
        return game, human_id, cpu_id

    def test_cpu_create_request_accepts_only_two_seat_known_strategies(self) -> None:
        request = main.CreateReq.model_validate(
            {
                "name": " CPU Runde ",
                "mode": 2,
                "game_type": "zilch",
                "play_mode": "CPU",
                "cpu_strategy": "aggressive",
            }
        )
        self.assertEqual(request.name, "CPU Runde")
        self.assertEqual(request.mode, "2")
        self.assertEqual(request.play_mode, ZILCH_CPU_MODE)
        self.assertEqual(request.cpu_strategy, "aggressive")

        invalid_payloads = (
            {"name": "CPU", "mode": "2", "game_type": "zilch", "play_mode": "cpu"},
            {
                "name": "CPU",
                "mode": "2",
                "game_type": "zilch",
                "play_mode": "cpu",
                "cpu_strategy": "lucky",
            },
            {
                "name": "CPU",
                "mode": "1",
                "game_type": "zilch",
                "play_mode": "cpu",
                "cpu_strategy": "normal",
            },
            {
                "name": "ZDWA",
                "mode": "2",
                "play_mode": "cpu",
                "cpu_strategy": "normal",
            },
            {
                "name": "Menschen",
                "mode": "2",
                "game_type": "zilch",
                "play_mode": "multiplayer",
                "cpu_strategy": "normal",
            },
        )
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                with self.assertRaises(ValidationError):
                    main.CreateReq.model_validate(payload)

    def test_private_cpu_api_creation_persists_a_domain_cpu_not_a_transport_player(self) -> None:
        mani_id, mani_token = self._identity("Mani", role="admin")
        game_id = self._create_cpu_game(mani_token, strategy="conservative")

        game = games[game_id]
        self.assertEqual(game["_play_mode"], ZILCH_CPU_MODE)
        self.assertEqual(game["_expected"], 2)
        self.assertEqual(game["_expected_connections"], 1)
        self.assertEqual(game["_zilch_cpu_host_user_id"], mani_id)
        self.assertEqual(game["_players"], [])
        self.assertEqual(len(game["_participants"]), 1)
        cpu = game["_participants"][0]
        self.assertEqual(cpu["type"], "cpu")
        self.assertEqual(cpu["cpu_strategy"], "conservative")
        self.assertIsNone(cpu["user_id"])
        self.assertIsNone(cpu["connection_player_id"])

        # The active JSON is restart data, so it must keep the CPU as a
        # participant without inventing a WebSocket player or resume token.
        with session_scope() as db:
            stored = db.scalar(select(ActiveGame).where(ActiveGame.game_id == game_id))
            self.assertIsNotNone(stored)
            durable = json.loads(stored.state_json)
        self.assertEqual(durable["_players"], [])
        self.assertEqual(durable["_participants"][0]["type"], "cpu")
        self.assertNotIn("ws", durable["_participants"][0])
        self.assertNotIn("resume_token", durable["_participants"][0])

        lobby = asyncio.run(main.api_games(request_for(cookie=f"rollthedice_session={mani_token}"), "zilch"))
        listed = next(entry for entry in lobby["games"] if entry["id"] == game_id)
        self.assertEqual(listed["play_mode"], ZILCH_CPU_MODE)
        self.assertEqual(listed["participant_count"], 1)
        self.assertEqual(listed["expected_participants"], 2)
        self.assertEqual(listed["expected_connections"], 1)
        self.assertEqual(listed["participants"][0]["participant_type"], "cpu")
        self.assertIsNone(listed["participants"][0]["connected"])
        self.assertTrue(listed["my_cpu_host"])

        details = main.game_info(game_id, request_for(cookie=f"rollthedice_session={mani_token}"))
        self.assertEqual(details["expected_connections"], 1)
        self.assertEqual(details["participants"][0]["cpu_strategy"], "conservative")
        self.assertTrue(details["my_cpu_host"])

    def test_cpu_creation_stays_under_the_existing_private_preview_policy(self) -> None:
        cpu_request = main.CreateReq.model_validate(
            {
                "name": "Privat",
                "mode": "2",
                "game_type": "zilch",
                "play_mode": "cpu",
                "cpu_strategy": "normal",
            }
        )
        with patch("app.main.enforce_game_creation_rate_limit"):
            with self.assertRaises(HTTPException) as anonymous:
                asyncio.run(main.api_games_create(cpu_request, request_for()))
        self.assertEqual(anonymous.exception.status_code, 401)

        _other_id, other_admin_token = self._identity("OtherAdmin", role="admin")
        with patch("app.main.enforce_game_creation_rate_limit"):
            with self.assertRaises(HTTPException) as denied:
                asyncio.run(
                    main.api_games_create(
                        cpu_request,
                        request_for(cookie=f"rollthedice_session={other_admin_token}"),
                    )
                )
        self.assertEqual(denied.exception.status_code, 403)

    def test_second_preview_socket_cannot_join_a_cpu_game_or_create_a_fake_cpu_transport(self) -> None:
        _mani_id, mani_token = self._identity("Mani", role="admin")
        _preview_id, preview_token = self._identity("PreviewFriend")
        game_id = self._create_cpu_game(mani_token)

        with TestClient(main.app) as host_client, TestClient(main.app) as preview_client:
            host_client.cookies.set("rollthedice_session", mani_token)
            preview_client.cookies.set("rollthedice_session", preview_token)

            with host_client.websocket_connect(f"/ws/{game_id}") as host_socket:
                self.assertEqual(host_socket.receive_json()["game"]["game_type"], "zilch")
                host_socket.send_json({"action": "join_game"})
                host_join = host_socket.receive_json()
                host_player_id = host_join["player_id"]
                started = host_socket.receive_json()["scoreboard"]
                self.assertTrue(started["_started"])
                self.assertEqual(started["_expected_connections"], 1)
                self.assertEqual(started["_players_joined"], 1)
                self.assertEqual(started["_participants_joined"], 2)

                with preview_client.websocket_connect(f"/ws/{game_id}") as preview_socket:
                    self.assertEqual(preview_socket.receive_json()["game"]["game_type"], "zilch")
                    preview_socket.send_json({"action": "join_game"})
                    rejected = preview_socket.receive_json()

        self.assertTrue(rejected["fatal"])
        self.assertEqual(rejected["error"], "zilch_cpu_host_required")
        game = games[game_id]
        self.assertEqual([player["id"] for player in game["_players"]], [host_player_id])
        self.assertEqual(len(game["_participants"]), 2)
        cpu = next(participant for participant in game["_participants"] if participant["type"] == "cpu")
        self.assertNotIn(cpu["id"], {player["id"] for player in game["_players"]})
        self.assertIsNone(cpu["connection_player_id"])
        self.assertIsNone(cpu["user_id"])

        # The HTTP lobby/detail projection follows the same participant versus
        # transport distinction after the sole human has joined: two domain
        # seats, one required connection, and the CPU strategy are visible.
        lobby = asyncio.run(main.api_games(request_for(cookie=f"rollthedice_session={mani_token}"), "zilch"))
        listed = next(entry for entry in lobby["games"] if entry["id"] == game_id)
        self.assertEqual(listed["participant_count"], 2)
        self.assertEqual(listed["expected_participants"], 2)
        self.assertEqual(listed["expected_connections"], 1)
        cpu_summary = next(participant for participant in listed["participants"] if participant["is_cpu"])
        self.assertEqual(cpu_summary["cpu_strategy"], "normal")
        self.assertIsNone(cpu_summary["connected"])
        human_summary = next(participant for participant in listed["participants"] if not participant["is_cpu"])
        self.assertEqual(human_summary["username"], "Mani")
        self.assertEqual(human_summary["zilch_achievement_rank"]["key"], "newbie")

        details = main.game_info(game_id, request_for(cookie=f"rollthedice_session={mani_token}"))
        self.assertEqual(details["participant_count"], 2)
        self.assertEqual(details["expected_connections"], 1)
        human_details = next(participant for participant in details["participants"] if not participant["is_cpu"])
        self.assertEqual(human_details["zilch_achievement_rank"]["key"], "newbie")

    def test_cpu_rechecks_pause_after_thinking_before_consuming_any_rng_value(self) -> None:
        """A human disconnect during CPU think time must cancel that move."""
        game, _human_id, cpu_id = self._started_cpu_turn()
        rng_calls: list[tuple[int, int]] = []

        def forbidden_rng(lower: int, upper: int) -> int:
            rng_calls.append((lower, upper))
            return 1

        async def scenario() -> None:
            task = maybe_schedule_cpu_turn(game, delay_seconds=0.02, randint_fn=forbidden_rng)
            self.assertIsNotNone(task)
            # Let the runner enter its non-blocking think delay, then make
            # the shared multiplayer coordinator report the human as offline.
            await asyncio.sleep(0)
            game["_players"][0]["ws"] = None
            game["_resume_required"] = True
            await task

        asyncio.run(scenario())
        self.assertEqual(rng_calls, [])
        self.assertEqual(game["_turn"]["player_id"], cpu_id)
        self.assertEqual(game["_zilch_boards"][cpu_id]["rounds"], [])

    def test_recovered_cpu_turn_waits_for_human_rejoin_then_reuses_one_runner(self) -> None:
        """Recovery keeps a real human pause, then starts exactly one CPU task."""
        game, human_id, cpu_id = self._started_cpu_turn()
        save_active_game(game)
        restored = load_active_games()[str(game["_id"])]
        games[str(game["_id"])] = restored

        self.assertTrue(restored["_resume_required"])
        self.assertFalse(cpu_action_is_due(restored))
        socket = RecordingSocket()
        session = GameSocketSession(websocket=socket, game=restored, auth_identity=None)
        rolls = iter([5, 5, 5, 2, 3, 4])

        async def scenario() -> None:
            with patch("app.zilch_cpu_runner.cpu_action_delay_seconds", return_value=0), patch(
                "app.zilch_cpu_runner.fair_zilch_randint",
                new=lambda _lower, _upper: next(rolls),
            ):
                should_close = await handle_session_action(
                    session,
                    "rejoin_game",
                    {"player_id": human_id, "resume_token": "human-resume"},
                )
                self.assertFalse(should_close)
                first = maybe_schedule_cpu_turn(restored)
                second = maybe_schedule_cpu_turn(restored)
                self.assertIsNotNone(first)
                self.assertIs(first, second)
                await first

        asyncio.run(scenario())
        cpu_board = restored["_zilch_boards"][cpu_id]
        self.assertEqual(cpu_board["total_points"], 500)
        self.assertEqual([round_entry["event"] for round_entry in cpu_board["rounds"]], ["bank"])
        self.assertEqual(restored["_turn"]["player_id"], human_id)
