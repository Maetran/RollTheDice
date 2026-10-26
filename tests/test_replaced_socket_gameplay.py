"""A device takeover revokes queued commands, not already accepted results."""

from __future__ import annotations

import asyncio
from copy import deepcopy

import pytest
from fastapi import WebSocketDisconnect

from app.game_registry import create_game_state, join_player_to_game, start_game_if_ready
from app.game_state import WRITABLE_COLS, WRITABLE_ROWS, games
from app.game_websocket import MessageRateLimiter, _receive_messages
from app.game_ws_session import GameSocketSession
from app.zilch_state import current_zilch_turn, record_zilch_start_roll


class QueuedSocket:
    """A frame may already be queued when another device takes the seat."""

    def __init__(self, *frames):
        self.cookies = {}
        self.frames = list(frames)
        self.messages = []
        self.close_codes = []

    async def receive_json(self):
        if self.frames:
            return self.frames.pop(0)
        raise WebSocketDisconnect()

    async def send_json(self, message):
        self.messages.append(deepcopy(message))

    async def close(self, code=1000):
        self.close_codes.append(code)


@pytest.fixture
def game_factory(monkeypatch):
    # Exercise real dispatch, rules and fan-out without touching a database.
    monkeypatch.setenv("ROLLTHEDICE_ZILCH_ACCESS_MODE", "public")
    monkeypatch.setattr("app.game_state.save_active_game", lambda _game, *, creating=False: None)
    monkeypatch.setattr("app.zilch_state.save_active_game", lambda _game, *, creating=False: None)
    monkeypatch.setattr("app.game_realtime.save_active_game", lambda _game, *, creating=False: None)
    monkeypatch.setattr("app.game_engine.random.randint", lambda _low, _high: 1)
    monkeypatch.setattr("app.zilch_gameplay.fair_zilch_randint", lambda _low, _high: 1)
    created = []

    def create(game_type, *, count=2):
        game_id = f"replaced-socket-{game_type}-{len(created)}"
        created.append(game_id)
        game = create_game_state(game_id, "Device takeover", count, game_type)
        for index in range(count):
            join_player_to_game(game, {
                "id": f"p{index + 1}", "name": f"Player {index + 1}", "ws": QueuedSocket(),
            })
        start_game_if_ready(game)
        if game_type == "zilch":
            for index in range(count):
                record_zilch_start_roll(game, f"p{index + 1}", 6 - index)
        return game

    yield create
    for game_id in created:
        games.pop(game_id, None)


def receive_queued_frame(game, socket, *, finalize_game=lambda _game: None):
    session = GameSocketSession(websocket=socket, game=game, auth_identity=None, player_id="p1")

    async def receive():
        try:
            await _receive_messages(session, limiter=MessageRateLimiter(), finalize_game=finalize_game)
        except WebSocketDisconnect:
            pass

    asyncio.run(receive())


@pytest.mark.parametrize("game_type", ("zdwa", "zilch"))
@pytest.mark.parametrize("replaced", (False, True), ids=("current-device", "replaced-device"))
def test_only_current_device_can_roll_after_seat_takeover(game_factory, game_type, replaced):
    game = game_factory(game_type)
    command = {"action": "zilch_roll_dice" if game_type == "zilch" else "roll_dice"}
    if game_type == "zilch":
        turn = current_zilch_turn(game)
        command.update(turn_id=turn.turn_id, version=turn.version)
    requesting_socket = QueuedSocket(command)
    current_socket = QueuedSocket() if replaced else requesting_socket
    game["_players"][0]["ws"] = current_socket
    before = deepcopy({key: game.get(key) for key in (
        "_dice", "_holds", "_rolls_used", "_turn", "_zilch_turn_state", "_last_activity", "_roll_cooldown",
    )})

    receive_queued_frame(game, requesting_socket)

    assert game["_players"][0]["ws"] is current_socket
    if replaced:
        after = {key: game.get(key) for key in before}
        assert after == before, "A queued frame from the replaced device changed the live turn"
        assert not current_socket.messages, "The revoked command was broadcast to the new device"
        assert requesting_socket.messages[-1]["error_code"] == "session_replaced"
        assert requesting_socket.close_codes == [1000]
    else:
        assert game["_dice"] == [1] * (6 if game_type == "zilch" else 5)
        assert game["_rolls_used"] == 1
        assert current_socket.messages[-1]["scoreboard"]["_dice"] == game["_dice"]


@pytest.mark.parametrize("action", ("roll_dice", "pause_game"))
def test_takeover_during_async_lock_cleanup_revokes_pending_frame(game_factory, monkeypatch, action):
    game = game_factory("zdwa")
    old_socket = QueuedSocket({"action": action})
    new_socket = QueuedSocket()
    game["_players"][0]["ws"] = old_socket
    before = deepcopy({key: game.get(key) for key in (
        "_dice", "_holds", "_rolls_used", "_turn", "_last_activity", "_roll_cooldown",
        "_manual_pause", "_manual_pause_by", "_manual_pause_by_name", "_manual_pause_at",
    )})
    cleanups = []

    async def cleanup_with_device_takeover(cleaned_game):
        assert cleaned_game is game
        assert game["_players"][0]["ws"] is old_socket
        cleanups.append(cleaned_game)
        await asyncio.sleep(0)
        game["_players"][0]["ws"] = new_socket

    monkeypatch.setattr("app.game_websocket.release_revoked_superadmin_locks", cleanup_with_device_takeover)

    receive_queued_frame(game, old_socket)

    assert cleanups == [game]
    assert {key: game.get(key) for key in before} == before
    assert old_socket.messages[-1]["error_code"] == "session_replaced"
    assert old_socket.close_codes == [1000]
    assert game["_players"][0]["ws"] is new_socket
    assert not new_socket.messages
    assert not new_socket.close_codes


def test_retired_room_does_not_report_a_device_takeover(game_factory):
    game = game_factory("zdwa")
    socket = QueuedSocket({"action": "roll_dice"})
    game["_players"][0]["ws"] = None
    game["_aborted"] = True
    before = deepcopy({key: game.get(key) for key in ("_dice", "_rolls_used", "_last_activity")})

    receive_queued_frame(game, socket)

    assert socket.close_codes == [1000]
    assert not socket.messages
    assert {key: game.get(key) for key in before} == before


def test_terminal_write_accepted_before_takeover_still_replies_to_both_devices(game_factory):
    game = game_factory("zdwa", count=1)
    game["_scoreboards"]["p1"] = {f"{row},{column}": 0 for row in WRITABLE_ROWS for column in WRITABLE_COLS}
    del game["_scoreboards"]["p1"]["15,down"]
    old_socket = QueuedSocket({"action": "write_field", "row": 15, "field": "down", "strike": True})
    new_socket = QueuedSocket()
    game["_players"][0]["ws"] = old_socket
    finalized = []
    completion = {"achievement_unlocks": {"p1": [{"key": "accepted-before-takeover"}]}}

    def finalize_after_takeover(finished_game):
        finalized.append(finished_game)
        # The write has already been accepted and its terminal board published.
        assert old_socket.messages[-1]["scoreboard"]["_finished"]
        game["_players"][0]["ws"] = new_socket
        return completion

    receive_queued_frame(game, old_socket, finalize_game=finalize_after_takeover)

    assert finalized == [game]
    assert game["_scoreboards"]["p1"]["15,down"] == 0
    assert game["_players"][0]["ws"] is new_socket
    for socket in (old_socket, new_socket):
        assert socket.messages[-1]["scoreboard"]["_finished"]
        assert socket.messages[-1]["finalization_pending"] is False
        assert socket.messages[-1]["achievement_unlocks"] == completion["achievement_unlocks"]
