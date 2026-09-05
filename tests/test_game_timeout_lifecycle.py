"""Lifecycle guarantees for the shared one-hour active-game deadline."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from app import main
from app.active_games import serializable_game_state
from app.game_snapshot import snapshot
from app.game_state import GAME_TIMEOUT, check_timeout_and_abort, games, sweep_timeouts
from tests.support import GameStateTestCase


class GameTimeoutLifecycleTestCase(GameStateTestCase):
    def test_exactly_one_hour_marks_a_paused_room_terminal(self) -> None:
        game = self.make_game(mode=2, players=[("p1", "Anna"), ("p2", "Ben")])
        now = datetime(2031, 4, 5, 14, 30, tzinfo=timezone.utc)
        game.update(
            {
                # Active games persist this value as ISO text, then may be
                # swept before the ordinary loader has normalized it again.
                "_last_activity": (now - GAME_TIMEOUT).isoformat(),
                "_manual_pause": True,
                "_manual_pause_by": "p1",
                "_manual_pause_by_name": "Anna",
                "_manual_pause_at": (now - GAME_TIMEOUT).isoformat(),
                "_resume_required": True,
            }
        )

        self.assertTrue(check_timeout_and_abort(game, now=now))

        self.assertTrue(game["_finished"])
        self.assertTrue(game["_aborted"])
        self.assertFalse(game["_started"])
        self.assertEqual(game["_abort_reason"], "inactivity_timeout")
        self.assertEqual(game["_finished_at"], now.isoformat())
        self.assertTrue(game["_timeout_abort_pending"])
        self.assertFalse(game["_manual_pause"])
        self.assertIsNone(game["_manual_pause_by"])
        self.assertFalse(game["_resume_required"])

    def test_timeout_snapshot_never_invents_a_scored_zdwa_result(self) -> None:
        game = self.make_game(mode=2, players=[("p1", "Anna"), ("p2", "Ben")])
        now = datetime(2031, 4, 5, 14, 30, tzinfo=timezone.utc)
        game["_last_activity"] = now - GAME_TIMEOUT
        self.assertTrue(check_timeout_and_abort(game, now=now))

        terminal = snapshot(game)

        self.assertTrue(terminal["_aborted"])
        self.assertEqual(terminal["_abort_reason"], "inactivity_timeout")
        self.assertIsNone(terminal["_results"])

    def test_http_style_timeout_stays_pending_until_lifecycle_publishes_once(self) -> None:
        """A prior synchronous snapshot/API sweep must not swallow the final frame."""
        game = self.make_game(mode=1, players=[("p1", "Anna")])
        now = datetime(2031, 4, 5, 14, 30, tzinfo=timezone.utc)
        game["_last_activity"] = now - GAME_TIMEOUT

        # This models the existing synchronous HTTP callers: they detect and
        # persist the abort but discard the list that needs socket publication.
        # The lifecycle pass must still find the pending room afterward.
        sweep_timeouts(now=now)
        self.assertTrue(game["_timeout_abort_pending"])
        self.assertEqual(sweep_timeouts(now=now), [game])

        terminal_snapshot = {"_finished": True, "_aborted": True, "_abort_reason": "inactivity_timeout"}
        with patch("app.main.broadcast", new=AsyncMock()) as broadcast, patch(
            "app.main.snapshot", return_value=terminal_snapshot
        ), patch("app.zilch_cpu_runner.stop_cpu_runner", new=AsyncMock()) as stop_cpu_runner:
            published = asyncio.run(main._sweep_timeout_aborts())

        self.assertEqual(published, 1)
        stop_cpu_runner.assert_awaited_once_with(str(game["_id"]))
        broadcast.assert_awaited_once_with(game, {"scoreboard": terminal_snapshot})
        self.assertFalse(game["_timeout_abort_pending"])
        self.assertNotIn(game["_id"], games)

        # The registry removal makes future sweeps a true no-op instead of a
        # second final broadcast or a route through a stale game object.
        with patch("app.main.broadcast", new=AsyncMock()) as broadcast:
            self.assertEqual(asyncio.run(main._sweep_timeout_aborts()), 0)
        broadcast.assert_not_awaited()

    def test_timeout_publication_delivers_once_then_closes_all_live_room_sockets(self) -> None:
        """A retired room must not leave player or spectator receivers alive."""

        class TimeoutSocket:
            def __init__(self) -> None:
                self.messages: list[dict] = []
                self.close_codes: list[int] = []
                self.events: list[str] = []

            async def send_json(self, message: dict) -> None:
                self.messages.append(message)
                self.events.append("send")

            async def close(self, code: int = 1000) -> None:
                self.close_codes.append(code)
                self.events.append("close")

        game = self.make_game(mode=2, players=[("p1", "Anna"), ("p2", "Ben")])
        first = TimeoutSocket()
        second = TimeoutSocket()
        spectator = TimeoutSocket()
        game["_players"][0]["ws"] = first
        game["_players"][1]["ws"] = second
        game["_spectators"] = [{"id": "s1", "name": "Cleo", "ws": spectator}]
        pending = TimeoutSocket()
        game["_live_sockets"] = [pending]
        self.assertNotIn("_live_sockets", serializable_game_state(game))
        now = datetime(2031, 4, 5, 14, 30, tzinfo=timezone.utc)
        game["_last_activity"] = now - GAME_TIMEOUT
        self.assertTrue(check_timeout_and_abort(game, now=now))

        with patch("app.game_realtime.save_active_game"), patch(
            "app.zilch_cpu_runner.stop_cpu_runner", new=AsyncMock()
        ):
            asyncio.run(main._publish_timeout_abort(game))

        for socket in (first, second, spectator):
            with self.subTest(socket=socket):
                self.assertEqual(len(socket.messages), 1)
                self.assertTrue(socket.messages[0]["scoreboard"]["_aborted"])
                self.assertEqual(socket.events, ["send", "close"])
                self.assertEqual(socket.close_codes, [1000])
        # A socket accepted just before its first role action receives no
        # private board snapshot, but cannot keep a dead room alive either.
        self.assertEqual(pending.messages, [])
        self.assertEqual(pending.events, ["close"])
        self.assertEqual(pending.close_codes, [1000])
        self.assertTrue(all(player["ws"] is None for player in game["_players"]))
        self.assertIsNone(game["_spectators"][0]["ws"])
        self.assertNotIn("_live_sockets", game)
        self.assertNotIn(game["_id"], games)

    def test_periodic_sweeper_stops_cleanly_after_its_initial_pass(self) -> None:
        async def scenario() -> None:
            stop_event = asyncio.Event()

            async def first_pass() -> int:
                stop_event.set()
                return 0

            with patch("app.main._sweep_timeout_aborts", side_effect=first_pass) as sweep:
                await main._run_timeout_sweeper(stop_event, interval_seconds=0)
            sweep.assert_awaited_once()

        asyncio.run(scenario())
