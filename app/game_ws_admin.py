"""Privileged live-game editing actions for game WebSockets."""

from __future__ import annotations

import asyncio
import inspect
import logging
from datetime import datetime, timezone
from typing import Any, Callable

from .game_admin import (
    apply_superadmin_changes,
    apply_superadmin_die_change,
    apply_superadmin_roll,
    complete_superadmin_save,
)
from .game_engine import _is_game_finished
from .game_realtime import broadcast, broadcast_chat
from .game_snapshot import _compute_results_for_snapshot, snapshot
from .game_state import (
    _board_display_name,
    _board_exists,
    _col_label_for_admin,
    _player_name,
    _row_label_for_admin,
    touch,
)
from .game_ws_session import GameSocketSession

logger = logging.getLogger(__name__)

SUPERADMIN_ACTIONS = frozenset(
    {
        "superadmin_activate",
        "superadmin_deactivate",
        "superadmin_save",
        "superadmin_roll_dice",
        "superadmin_set_die",
    }
)

FinalizeGame = Callable[[dict[str, Any]], Any]


async def handle_superadmin_action(
    session: GameSocketSession,
    action: str,
    data: dict[str, Any],
    *,
    finalize_game: FinalizeGame,
) -> None:
    if action == "superadmin_activate":
        await _activate(session, data)
    elif action == "superadmin_deactivate":
        await _deactivate(session)
    elif action == "superadmin_save":
        await _save(session, data, finalize_game=finalize_game)
    elif action == "superadmin_roll_dice":
        await _roll_dice(session)
    elif action == "superadmin_set_die":
        await _set_die(session, data)
    else:
        raise ValueError(f"Unsupported superadmin action: {action}")


async def _send_error(session: GameSocketSession, message: str) -> None:
    await session.websocket.send_json({"error": message})


def _admin_allowed(session: GameSocketSession) -> bool:
    return bool(session.auth_identity and session.auth_identity.is_admin)


async def _activate(session: GameSocketSession, data: dict[str, Any]) -> None:
    g = session.game
    player_id = session.player_id
    if not player_id:
        await _send_error(session, "Nur Spieler koennen Superadmin aktivieren")
        return
    board_id = str(data.get("board_id") or "")
    if not _admin_allowed(session):
        await _send_error(session, "Admin-Berechtigung erforderlich")
        return
    if not g.get("_started") or g.get("_finished") or g.get("_aborted"):
        await _send_error(session, "Spiel ist nicht aktiv")
        return
    if not _board_exists(g, board_id):
        await _send_error(session, "Board nicht gefunden")
        return

    g.setdefault("_superadmins", {})[player_id] = {"board_id": board_id}
    name = _player_name(g, player_id)
    await session.websocket.send_json({"superadmin": {"active": True, "board_id": board_id}})
    touch(g)
    await broadcast_chat(
        g,
        {
            "from_id": None,
            "sender": "System",
            "text": f"Spieler {name} hat den Superadmin-Modus aktiviert.",
            "ts": datetime.now(timezone.utc).isoformat(),
            "kind": "system",
        },
    )
    await broadcast(g, {"scoreboard": snapshot(g)})


async def _deactivate(session: GameSocketSession) -> None:
    if session.player_id:
        session.game.setdefault("_superadmins", {}).pop(session.player_id, None)
    await session.websocket.send_json({"superadmin": {"active": False}})
    touch(session.game)
    await broadcast(session.game, {"scoreboard": snapshot(session.game)})


async def _save(
    session: GameSocketSession,
    data: dict[str, Any],
    *,
    finalize_game: FinalizeGame,
) -> None:
    g = session.game
    player_id = session.player_id
    if not player_id or player_id not in g.get("_superadmins", {}):
        await _send_error(session, "Superadmin-Modus nicht aktiv")
        return
    if not g.get("_started") or g.get("_finished") or g.get("_aborted"):
        g.setdefault("_superadmins", {}).pop(player_id, None)
        await _send_error(session, "Spiel ist nicht aktiv")
        return

    board_id = str(data.get("board_id") or g.get("_superadmins", {}).get(player_id, {}).get("board_id") or "")
    was_finished = bool(g.get("_finished"))
    try:
        changes = apply_superadmin_changes(g, player_id, board_id, data.get("changes") or [])
    except ValueError as exc:
        await _send_error(session, str(exc))
        return

    board_name = _board_display_name(g, board_id)
    for change in changes:
        row_label = _row_label_for_admin(change["row"])
        column_label = _col_label_for_admin(change["field"])
        old_label = "leer" if change.get("old") is None else str(change.get("old"))
        new_label = "leer" if change.get("new") is None else str(change.get("new"))
        await broadcast_chat(
            g,
            {
                "from_id": None,
                "sender": "System",
                "text": (
                    f"Superadmin: {board_name}, Feld {row_label} / Reihe {column_label} "
                    f"von {old_label} auf {new_label} geändert."
                ),
                "ts": change["ts"],
                "kind": "system",
            },
        )

    completion: dict[str, Any] = {}
    if _is_game_finished(g):
        g["_started"] = False
        g["_finished"] = True
        if not was_finished:
            # Store the finished board before the synchronous result work so a
            # database failure/restart cannot lose a superadmin-completed game.
            g["_finalization_pending"] = True
            touch(g)
            await broadcast(
                g,
                {
                    "scoreboard": snapshot(g),
                    "finalization_pending": True,
                },
            )
            try:
                result = await asyncio.to_thread(finalize_game, g)
                if inspect.isawaitable(result):
                    result = await result
                completion = result if isinstance(result, dict) else {}
            except Exception:
                logger.exception("Could not finalize superadmin-completed game %s", g.get("_id"))
                completion = {"result_persisted": False, "persistence_error": "result_persistence_failed"}
            g["_final_completion"] = completion
            # Keep the historic injected-finalizer seam compatible while the
            # typed production finalizer explicitly reports a failed write.
            # The marker stops the follow-up broadcast from recreating an
            # ActiveGame only after a confirmed completed result exists.
            if (
                completion
                and completion.get("result_persisted", True)
                and not completion.get("achievement_sync_pending")
            ):
                g["_completion_persisted"] = True
            g["_finalization_pending"] = False
        else:
            g["_results"] = _compute_results_for_snapshot(g)
    else:
        g["_results"] = None
        complete_superadmin_save(g, player_id)
    if g.get("_finished"):
        g.setdefault("_superadmins", {}).pop(player_id, None)
    touch(g)
    await session.websocket.send_json({"superadmin": {"saved": True, "active": False, "board_id": board_id}})
    await broadcast(
        g,
        {
            "scoreboard": snapshot(g),
            "finalization_pending": bool(g.get("_finalization_pending")),
            "achievement_unlocks": completion.get("achievement_unlocks", {}),
            "achievement_rank_ups": completion.get("achievement_rank_ups", {}),
        },
    )


async def _roll_dice(session: GameSocketSession) -> None:
    if not _admin_allowed(session):
        await _send_error(session, "Admin-Berechtigung erforderlich")
        return
    if not session.player_id:
        await _send_error(session, "Nur Spieler koennen Würfel bearbeiten")
        return
    try:
        edit = apply_superadmin_roll(session.game, session.player_id)
    except ValueError as exc:
        await _send_error(session, str(exc))
        return

    changed = ", ".join(str(index + 1) for index in edit["changed_indices"]) or "keine"
    await broadcast_chat(
        session.game,
        {
            "from_id": None,
            "sender": "System",
            "text": f"Superadmin: Zusatzwurf ausgeführt (freie Würfel: {changed}).",
            "ts": edit["ts"],
            "kind": "system",
        },
    )
    touch(session.game)
    await session.websocket.send_json({"superadmin": {"dice_rolled": True, "changed_indices": edit["changed_indices"]}})
    await broadcast(session.game, {"scoreboard": snapshot(session.game)})


async def _set_die(session: GameSocketSession, data: dict[str, Any]) -> None:
    if not _admin_allowed(session):
        await _send_error(session, "Admin-Berechtigung erforderlich")
        return
    if not session.player_id:
        await _send_error(session, "Nur Spieler koennen Würfel bearbeiten")
        return
    try:
        edit = apply_superadmin_die_change(
            session.game,
            session.player_id,
            data.get("index"),
            data.get("value"),
        )
    except ValueError as exc:
        await _send_error(session, str(exc))
        return

    await broadcast_chat(
        session.game,
        {
            "from_id": None,
            "sender": "System",
            "text": (f"Superadmin: Würfel {edit['index'] + 1} von {edit['old']} auf {edit['new']} gedreht."),
            "ts": edit["ts"],
            "kind": "system",
        },
    )
    touch(session.game)
    await session.websocket.send_json({"superadmin": {"die_set": True}})
    await broadcast(session.game, {"scoreboard": snapshot(session.game)})
