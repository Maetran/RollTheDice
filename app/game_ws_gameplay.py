"""Turn, scoring and correction actions for game WebSockets."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from .game_engine import (
    _begin_next_turn,
    _filled_rows_in_board,
    _is_game_finished,
    _next_required_row,
    _parse_write_target,
    apply_roll,
    can_roll_now,
    can_write_now,
)
from .game_realtime import broadcast
from .game_scoring import poker_points_allowed, score_field_value
from .game_snapshot import snapshot
from .game_state import (
    KEY_TO_ROW,
    WRITABLE_FIELDS,
    _board_for_actor,
    _clear_correction,
    _ensure_board_for_actor,
    board_key_for_actor,
    correction_disabled_reason,
    is_team_mode,
    roll_cooldown_ok,
    touch,
)
from .game_ws_session import GameSocketSession

GAMEPLAY_ACTIONS = frozenset(
    {
        "set_hold",
        "roll_dice",
        "announce_row4",
        "unannounce_row4",
        "write_field",
        "request_correction",
        "cancel_correction",
        "write_field_correction",
    }
)

FinalizeGame = Callable[[dict[str, Any]], Any]
ActionHandler = Callable[[GameSocketSession, dict[str, Any]], Awaitable[None]]


async def handle_gameplay_action(
    session: GameSocketSession,
    action: str,
    data: dict[str, Any],
    *,
    finalize_game: FinalizeGame,
) -> None:
    """Dispatch one validated gameplay action."""
    handlers: dict[str, ActionHandler] = {
        "set_hold": _set_hold,
        "roll_dice": _roll_dice,
        "announce_row4": _announce_row4,
        "unannounce_row4": _unannounce_row4,
        "request_correction": _request_correction,
        "cancel_correction": _cancel_correction,
        "write_field_correction": _write_field_correction,
    }
    if action == "write_field":
        await _write_field(session, data, finalize_game=finalize_game)
        return
    handler = handlers.get(action)
    if handler is None:
        raise ValueError(f"Unsupported gameplay action: {action}")
    await handler(session, data)


async def _send_error(session: GameSocketSession, message: str) -> None:
    await session.websocket.send_json({"error": message})


async def _publish_scoreboard(session: GameSocketSession) -> None:
    touch(session.game)
    await broadcast(session.game, {"scoreboard": snapshot(session.game)})


async def _set_hold(session: GameSocketSession, data: dict[str, Any]) -> None:
    g = session.game
    if not g["_turn"] or g["_turn"]["player_id"] != session.player_id:
        await _send_error(session, "Nicht an der Reihe")
        return
    if g["_correction"]["active"]:
        await _send_error(session, "Während Korrektur nicht erlaubt")
        return
    if bool(g.get("_hardcore")):
        await _send_error(session, "Halten ist im Hardcore-Modus deaktiviert")
        return
    if int(g.get("_rolls_used", 0) or 0) < 1:
        await _send_error(session, "Erst würfeln")
        return
    holds = data.get("holds")
    if not isinstance(holds, list) or len(holds) != 5 or any(type(value) is not bool for value in holds):
        await _send_error(session, "Ungültige Würfelauswahl")
        return
    g["_holds"] = holds[:]
    await _publish_scoreboard(session)


async def _roll_dice(session: GameSocketSession, _data: dict[str, Any]) -> None:
    g = session.game
    ok, reason = can_roll_now(g, session.player_id)
    if not ok:
        await _send_error(session, reason)
        return
    if not roll_cooldown_ok(g, session.player_id, cooldown_s=0.6):
        return
    apply_roll(g)
    await _publish_scoreboard(session)


async def _announce_row4(session: GameSocketSession, data: dict[str, Any]) -> None:
    g = session.game
    player_id = session.player_id
    if bool(g.get("_hardcore")):
        await _send_error(session, "Ansage ist im Hardcore-Modus deaktiviert")
        return
    if not (g["_turn"] and g["_turn"]["player_id"] == player_id):
        await _send_error(session, "Nicht an der Reihe")
        return
    if g["_correction"]["active"]:
        await _send_error(session, "Während Korrektur nicht erlaubt")
        return
    if g["_rolls_used"] != 1:
        await _send_error(session, "Ansage (oder Änderung) nur direkt nach Wurf 1")
        return

    field = data.get("field")
    if field not in WRITABLE_FIELDS:
        await _send_error(session, "Ungültiges Ansage-Feld")
        return
    row_for_field = KEY_TO_ROW.get(field)
    board = _board_for_actor(g, player_id)
    if row_for_field is not None and f"{row_for_field},ang" in board:
        await _send_error(session, f"Ansage nicht möglich: Feld {field} in ❗ bereits befüllt")
        return

    g["_announced_row4"] = field
    g["_announced_by"] = player_id
    g["_announced_board"] = board_key_for_actor(g, player_id) if is_team_mode(g) else player_id
    await _publish_scoreboard(session)


async def _unannounce_row4(session: GameSocketSession, _data: dict[str, Any]) -> None:
    g = session.game
    player_id = session.player_id
    if bool(g.get("_hardcore")):
        await _send_error(session, "Ansage ist im Hardcore-Modus deaktiviert")
        return
    if not (g["_turn"] and g["_turn"]["player_id"] == player_id):
        await _send_error(session, "Nicht an der Reihe")
        return
    if g["_correction"]["active"]:
        await _send_error(session, "Während Korrektur nicht erlaubt")
        return
    if g.get("_rolls_used", 0) != 1:
        await _send_error(session, "Ansage nur direkt nach Wurf 1 zurückziehbar")
        return
    if not g.get("_announced_row4"):
        await _send_error(session, "Keine Ansage aktiv")
        return

    g["_announced_row4"] = None
    g["_announced_by"] = None
    g["_announced_board"] = None
    await _publish_scoreboard(session)


async def _write_field(
    session: GameSocketSession,
    data: dict[str, Any],
    *,
    finalize_game: FinalizeGame,
) -> None:
    g = session.game
    player_id = session.player_id
    if not (g["_turn"] and g["_turn"]["player_id"] == player_id):
        await _send_error(session, "Nicht an der Reihe")
        return
    if g["_correction"]["active"]:
        await _send_error(session, "Während Korrektur nicht erlaubt")
        return
    if int(g.get("_rolls_used", 0) or 0) < 1:
        await _send_error(session, "Erst würfeln")
        return
    try:
        row, column, field = _parse_write_target(data)
    except ValueError as exc:
        await _send_error(session, str(exc))
        return
    strike = bool(data.get("strike"))

    ok, reason = can_write_now(
        g,
        player_id,
        row,
        column,
        during_turn_announce=g["_announced_row4"],
    )
    if not ok:
        await _send_error(session, reason)
        return

    key = f"{row},{column}"
    board = _ensure_board_for_actor(g, player_id)
    if key in board:
        await _send_error(session, "Dieses Feld ist bereits befüllt")
        return

    dice = g.get("_dice") or [0, 0, 0, 0, 0]
    if field == "poker":
        turn = g.get("_turn", {}) or {}
        allowed_points = poker_points_allowed(
            dice,
            column,
            roll_index=int(turn.get("roll_index", 0) or 0),
            first4oak_roll=turn.get("first4oak_roll"),
            announced_poker=(g.get("_announced_row4") == "poker"),
        )
        if score_field_value("poker", dice) > 0 and not allowed_points:
            strike = True

    value = 0 if strike else score_field_value(field, dice)
    board[key] = value
    g["_last_write"][player_id] = (row, column, g["_rolls_used"])
    g["_last_dice"][player_id] = dice[:]
    turn = g.get("_turn", {}) or {}
    g["_last_meta"][player_id] = {
        "announced": g["_announced_row4"],
        "roll_index": int(turn.get("roll_index", 0) or 0),
        "first4oak_roll": turn.get("first4oak_roll"),
    }
    _begin_next_turn(g, player_id)
    if _is_game_finished(g):
        g["_started"] = False
        g["_finished"] = True
        finalize_game(g)

    touch(g)
    await broadcast(
        g,
        {
            "scoreboard": snapshot(g),
            "score_event": {"field": field, "points": value, "player_id": player_id},
        },
    )


async def _request_correction(session: GameSocketSession, _data: dict[str, Any]) -> None:
    g = session.game
    player_id = session.player_id
    if reason := correction_disabled_reason(g):
        await _send_error(session, reason)
        return
    if g["_correction"]["active"]:
        return
    if player_id not in g["_last_write"]:
        await _send_error(session, "Kein letzter Eintrag vorhanden")
        return
    meta = g.get("_last_meta", {}).get(player_id, {})
    if meta.get("announced"):
        await _send_error(session, "Korrektur nicht erlaubt (Ansage-Zug)")
        return
    if not g.get("_turn") or g["_turn"]["player_id"] == player_id:
        await _send_error(session, "Korrektur nur direkt nach deinem Zug")
        return
    if g.get("_rolls_used", 0) > 0:
        await _send_error(session, "Korrektur nicht möglich: Es wurde bereits weiter gewürfelt")
        return

    last_dice = g["_last_dice"].get(player_id, [])
    if not last_dice:
        await _send_error(session, "Kein letzter Wurf vorhanden")
        return
    meta = g["_last_meta"].get(player_id, {}) if isinstance(g.get("_last_meta"), dict) else {}
    g["_correction"] = {
        "active": True,
        "player_id": player_id,
        "dice": last_dice[:],
        "roll_index": int(meta.get("roll_index", 0) or 0),
        "first4oak_roll": meta.get("first4oak_roll"),
    }
    g["_dice"] = last_dice[:]
    await _publish_scoreboard(session)


async def _cancel_correction(session: GameSocketSession, _data: dict[str, Any]) -> None:
    if reason := correction_disabled_reason(session.game):
        await _send_error(session, reason)
        return
    correction = session.game.get("_correction", {})
    if not correction.get("active") or correction.get("player_id") != session.player_id:
        await _send_error(session, "Keine Korrektur aktiv")
        return
    _clear_correction(session.game)
    await _publish_scoreboard(session)


async def _write_field_correction(session: GameSocketSession, data: dict[str, Any]) -> None:
    g = session.game
    player_id = session.player_id
    if reason := correction_disabled_reason(g):
        await _send_error(session, reason)
        return
    correction = g["_correction"]
    if not correction.get("active") or correction.get("player_id") != player_id:
        await _send_error(session, "Keine Korrektur aktiv")
        return
    try:
        row, column, field = _parse_write_target(data)
    except ValueError as exc:
        await _send_error(session, str(exc))
        return
    strike = bool(data.get("strike"))

    last_write = g["_last_write"].get(player_id)
    if not last_write:
        await _send_error(session, "Kein letzter Eintrag vorhanden")
        return
    old_row, old_column, old_rolls_used = last_write
    dice = (correction.get("dice") or g.get("_dice") or [0, 0, 0, 0, 0])[:]
    board = _ensure_board_for_actor(g, player_id)
    old_key = f"{old_row},{old_column}"
    new_key = f"{row},{column}"
    board_without_old = dict(board)
    board_without_old.pop(old_key, None)

    if column in {"down", "up"}:
        next_row = _next_required_row(column, _filled_rows_in_board(board_without_old, column))
        if next_row is None:
            await _send_error(session, "Reihe bereits voll")
            return
        if row != next_row and not (row == old_row and column == old_column):
            await _send_error(session, f"In dieser Reihe ist als Nächstes Zeile {next_row} erlaubt")
            return
    if new_key in board_without_old:
        await _send_error(session, "Ziel-Feld bereits befüllt")
        return

    if field == "poker" and score_field_value("poker", dice) > 0:
        allowed_points = poker_points_allowed(
            dice,
            column,
            roll_index=int(correction.get("roll_index", 0) or 0),
            first4oak_roll=correction.get("first4oak_roll"),
            announced_poker=(g.get("_announced_row4") == "poker"),
            correction=True,
        )
        if not allowed_points:
            strike = True

    value = 0 if strike else score_field_value(field, dice)
    board.pop(old_key, None)
    board[new_key] = value
    g["_last_write"][player_id] = (row, column, old_rolls_used)
    _clear_correction(g)
    touch(g)
    await broadcast(
        g,
        {
            "scoreboard": snapshot(g),
            "score_event": {"field": field, "points": value, "player_id": player_id},
        },
    )
