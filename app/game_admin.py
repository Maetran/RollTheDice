"""Validated Superadmin mutations for an active game."""

from __future__ import annotations

import random
from datetime import datetime, timezone

from .game_engine import _set_roll_cap_for_current_turn
from .game_scoring import has_n_of_a_kind
from .game_state import (
    SUPERADMIN_BLOCKED_ACTIONS,
    WRITABLE_COLS,
    WRITABLE_MAP,
    GameDict,
    _board_exists,
    _clear_announcement,
    _ensure_board_for_id,
    _player_name,
    _reset_turn_roll_state,
    board_key_for_actor,
)


def apply_superadmin_changes(g: GameDict, player_id: str, board_id: str, changes: list[dict]) -> list[dict]:
    """Validiert und schreibt einen Superadmin-Batch.

    Erlaubte Modi:
    - Bestehende Felder auf nichtnegative Ganzzahlen ändern.
    - Gefüllte Felder löschen und gleich viele bisher leere Felder beschreiben.
    """
    if not _board_exists(g, board_id):
        raise ValueError("Board nicht gefunden")
    if not isinstance(changes, list) or not changes:
        raise ValueError("Keine Änderungen vorhanden")
    if len(changes) > 24:
        raise ValueError("Zu viele Änderungen auf einmal")

    board = _ensure_board_for_id(g, board_id)
    normalized = []
    seen_keys = set()

    for item in changes:
        if not isinstance(item, dict):
            raise ValueError("Ungültige Änderung")
        try:
            row = int(item.get("row"))
        except Exception as exc:
            raise ValueError("Ungültige Zeile") from exc
        col = str(item.get("field") or "")
        if row not in WRITABLE_MAP or col not in WRITABLE_COLS:
            raise ValueError("Dieses Feld ist nicht editierbar")
        key = f"{row},{col}"
        if key in seen_keys:
            raise ValueError("Doppelte Änderung für dasselbe Feld")
        seen_keys.add(key)

        raw_value = item.get("value")
        delete = bool(item.get("delete")) or raw_value is None or raw_value == ""
        value = None
        if not delete:
            try:
                value = int(raw_value)
            except Exception as exc:
                raise ValueError("Ungültiger Wert") from exc
            if value < 0 or value > 9999:
                raise ValueError("Wert ausserhalb des erlaubten Bereichs")
        normalized.append({"row": row, "field": col, "key": key, "delete": delete, "value": value})

    deletes = [c for c in normalized if c["delete"]]
    writes = [c for c in normalized if not c["delete"]]

    if deletes:
        empty_writes = [c for c in writes if c["key"] not in board]
        existing_writes = [c for c in writes if c["key"] in board]
        if existing_writes:
            raise ValueError("Beim Löschen dürfen nur leere Felder neu beschrieben werden")
        if len(deletes) != len(empty_writes):
            raise ValueError("Jede Löschung braucht genau ein neu beschriebenes leeres Feld")
        for c in deletes:
            if c["key"] not in board:
                raise ValueError("Nur gefüllte Felder können gelöscht werden")
    else:
        for c in writes:
            if c["key"] not in board:
                raise ValueError("Leere Felder dürfen nur zusammen mit einer Löschung beschrieben werden")

    now = datetime.now(timezone.utc).isoformat()
    applied = []
    edit_bucket = g.setdefault("_admin_edits", {}).setdefault(str(board_id), {})

    for c in deletes:
        old_raw = board.get(c["key"])
        old_value = int(old_raw) if isinstance(old_raw, (int, float)) else 0
        board.pop(c["key"], None)
        meta = {
            "row": c["row"],
            "field": c["field"],
            "old": old_value,
            "new": None,
            "by": player_id,
            "by_name": _player_name(g, player_id),
            "ts": now,
        }
        edit_bucket[c["key"]] = meta
        applied.append(meta)

    for c in writes:
        old_raw = board.get(c["key"])
        old_value = int(old_raw) if isinstance(old_raw, (int, float)) else None
        board[c["key"]] = int(c["value"])
        meta = {
            "row": c["row"],
            "field": c["field"],
            "old": old_value,
            "new": int(c["value"]),
            "by": player_id,
            "by_name": _player_name(g, player_id),
            "ts": now,
        }
        edit_bucket[c["key"]] = meta
        applied.append(meta)

    return applied


def superadmin_edit_active(g: GameDict) -> bool:
    """True, solange mindestens ein Superadmin-Editmodus aktiv ist."""
    return bool(g.get("_superadmins"))


def action_blocked_by_superadmin(g: GameDict, action: str | None) -> bool:
    """True, wenn eine Spielaktion während Superadmin-Edit pausiert werden muss."""
    return superadmin_edit_active(g) and str(action or "") in SUPERADMIN_BLOCKED_ACTIONS


def _ensure_turn_after_superadmin(g: GameDict, fallback_player_id: str | None = None) -> str | None:
    """Bewahrt einen gültigen Zug oder stellt ihn nach einem Admin-Edit wieder her.

    Ein bestehender gültiger Zug inklusive Würfeln, Holds und Wurfzähler bleibt
    unverändert. Nur ein fehlender oder auf einen unbekannten Spieler zeigender
    Zug wird defensiv neu initialisiert.
    """
    if not g.get("_started") or g.get("_finished") or g.get("_aborted"):
        return None

    player_ids = [str(p.get("id")) for p in g.get("_players", []) if p.get("id") is not None]
    if not player_ids:
        g["_turn"] = None
        return None

    turn = g.get("_turn")
    current_id = str(turn.get("player_id")) if isinstance(turn, dict) and turn.get("player_id") is not None else ""
    if current_id in player_ids:
        turn.setdefault("roll_index", int(g.get("_rolls_used", 0) or 0))
        turn.setdefault("first4oak_roll", None)
        _set_roll_cap_for_current_turn(g)
        return current_id

    fallback = str(fallback_player_id) if fallback_player_id is not None else ""
    restored_id = fallback if fallback in player_ids else player_ids[0]
    _reset_turn_roll_state(g)
    _clear_announcement(g)
    g["_turn"] = {
        "player_id": restored_id,
        "roll_index": 0,
        "first4oak_roll": None,
    }
    _set_roll_cap_for_current_turn(g)
    return restored_id


def complete_superadmin_save(g: GameDict, player_id: str) -> str | None:
    """Beendet den speichernden Admin-Edit und garantiert einen aktiven Zug."""
    g.setdefault("_superadmins", {}).pop(player_id, None)
    return _ensure_turn_after_superadmin(g, player_id)


def _validate_superadmin_dice_edit(g: GameDict, player_id: str) -> str:
    """Validiert den losgeloesten Wuerfeleingriff eines aktiven Superadmins."""
    admin = g.get("_superadmins", {}).get(player_id)
    if not admin:
        raise ValueError("Superadmin-Modus nicht aktiv")
    if not g.get("_started") or g.get("_finished") or g.get("_aborted"):
        raise ValueError("Spiel ist nicht aktiv")
    if g.get("_correction", {}).get("active"):
        raise ValueError("Während Korrektur nicht erlaubt")

    turn = g.get("_turn") or {}
    turn_player_id = str(turn.get("player_id") or "")
    if not turn_player_id:
        raise ValueError("Kein aktiver Zug")
    target_board_id = str(admin.get("board_id") or "")
    if target_board_id != str(board_key_for_actor(g, turn_player_id)):
        raise ValueError("Würfel können nur beim aktuell aktiven Spieler bearbeitet werden")
    if int(g.get("_rolls_used", 0) or 0) < 1:
        raise ValueError("Würfel können erst nach dem ersten regulären Wurf bearbeitet werden")
    return turn_player_id


def _reconcile_four_kind_after_admin_dice_edit(g: GameDict) -> None:
    """Haelt die vom aktuellen Wurf abgeleitete Poker-Metainfo konsistent."""
    turn = g.get("_turn")
    if not isinstance(turn, dict):
        return
    roll_index = int(turn.get("roll_index", g.get("_rolls_used", 0)) or 0)
    first_four_kind = turn.get("first4oak_roll")
    if has_n_of_a_kind(g.get("_dice") or [], 4):
        if first_four_kind is None:
            turn["first4oak_roll"] = roll_index
    elif first_four_kind == roll_index:
        # Der Superadmin hat die aktuelle Wurf-Wahrheit geaendert. Ein Vierling
        # aus einem frueheren Wurf bleibt dagegen absichtlich gespeichert.
        turn["first4oak_roll"] = None


def _record_superadmin_dice_edit(g: GameDict, meta: dict) -> dict:
    history = g.setdefault("_admin_dice_edits", [])
    history.append(meta)
    if len(history) > 100:
        del history[:-100]
    return meta


def apply_superadmin_roll(g: GameDict, player_id: str, *, randint_fn=None) -> dict:
    """Wuerfelt nur freie Wuerfel, ohne irgendeinen Wurf-/Ablaufzaehler zu aendern."""
    _validate_superadmin_dice_edit(g, player_id)
    rng = randint_fn or random.randint
    old_dice = list(g.get("_dice") or [0] * 5)[:5]
    old_dice += [0] * (5 - len(old_dice))
    holds = list(g.get("_holds") or [False] * 5)[:5]
    holds += [False] * (5 - len(holds))
    new_dice = old_dice[:]
    changed_indices = []
    for index in range(5):
        if not holds[index]:
            new_dice[index] = rng(1, 6)
            changed_indices.append(index)
    g["_dice"] = new_dice
    _reconcile_four_kind_after_admin_dice_edit(g)
    return _record_superadmin_dice_edit(
        g,
        {
            "type": "roll",
            "old": old_dice,
            "new": new_dice[:],
            "changed_indices": changed_indices,
            "by": player_id,
            "by_name": _player_name(g, player_id),
            "ts": datetime.now(timezone.utc).isoformat(),
        },
    )


def apply_superadmin_die_change(g: GameDict, player_id: str, die_index: int, value: int) -> dict:
    """Setzt einen einzelnen Wuerfel unmittelbar auf eine neue Augenzahl."""
    _validate_superadmin_dice_edit(g, player_id)
    try:
        index = int(die_index)
        face = int(value)
    except Exception as exc:
        raise ValueError("Ungültiger Würfelwert") from exc
    if index < 0 or index >= 5:
        raise ValueError("Ungültiger Würfel")
    if face < 1 or face > 6:
        raise ValueError("Würfelwert muss zwischen 1 und 6 liegen")

    dice = list(g.get("_dice") or [0] * 5)[:5]
    dice += [0] * (5 - len(dice))
    old_value = dice[index]
    dice[index] = face
    g["_dice"] = dice
    _reconcile_four_kind_after_admin_dice_edit(g)
    return _record_superadmin_dice_edit(
        g,
        {
            "type": "set",
            "index": index,
            "old": old_value,
            "new": face,
            "by": player_id,
            "by_name": _player_name(g, player_id),
            "ts": datetime.now(timezone.utc).isoformat(),
        },
    )
