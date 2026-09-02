"""Pure game suggestions, turn validation, rolls and score projections."""

from __future__ import annotations

import logging
import random
from typing import Dict

from .game_scoring import has_n_of_a_kind, poker_points_allowed, score_field_value
from .game_state import (
    KEY_TO_ROW,
    WRITABLE_CELLS_PER_PLAYER,
    WRITABLE_COLS,
    WRITABLE_MAP,
    WRITABLE_ROWS,
    GameDict,
    _board_for_actor,
    _clear_announcement,
    _reset_turn_roll_state,
    board_key_for_actor,
    is_team_mode,
    multiplayer_pause_reason,
)
from .rules import compute_overall

logger = logging.getLogger(__name__)


def compute_suggestions(g: GameDict) -> list[dict]:
    """
    Liefert Vorschlags-Buttons (serverseitig berechnet) für den AKTUELLEN Zug.
    - Punkte identisch zu score_field_value()
    - Nur Kategorien, die JETZT regelkonform geschrieben werden könnten (mind. 1 freie, erlaubte Spalte)
    - Sichtbar für alle Clients (berechnet für den aktiven Spieler)
    """
    try:
        turn = g.get("_turn") or {}
        pid = turn.get("player_id")
        if not pid:
            return []

        dice = g.get("_dice") or [0, 0, 0, 0, 0]
        rolls_used = int(g.get("_rolls_used", 0) or 0)
        # Vor dem ersten Wurf keine Vorschläge anzeigen
        if rolls_used <= 0:
            return []

        # Ziel-Board (Team/Einzel)
        if is_team_mode(g):
            board_id = board_key_for_actor(g, pid)
            board = g.get("_scoreboards_by_team", {}).get(board_id, {}) or {}
        else:
            board = g.get("_scoreboards", {}).get(pid, {}) or {}

        announced = g.get("_announced_row4")
        cols = ["down", "free", "up", "ang"]

        def cell_is_free(row: int, col: str) -> bool:
            return f"{row},{col}" not in board

        def any_col_eligible(row: int, field_key: str, points: int) -> bool:
            """Mindestens eine Spalte ist frei & laut Regeln genau jetzt beschreibbar.
            Poker-Sonderregel: Punkte erlaubt, solange aktuell mindestens 4 gleiche liegen.
            """
            for col in cols:
                if not cell_is_free(row, col):
                    continue
                ok, _why = can_write_now(g, pid, row, col, during_turn_announce=announced)
                if not ok:
                    continue

                # Poker-Sonderfall: Punkte erlaubt, solange JETZT mindestens 4 gleiche (oder 5) liegen – unabhängig von Spalte/Rollindex
                if field_key == "poker" and points > 0:
                    cur = g.get("_turn", {}) or {}
                    if not poker_points_allowed(
                        dice,
                        col,
                        roll_index=int(cur.get("roll_index", 0) or 0),
                        first4oak_roll=cur.get("first4oak_roll"),
                        announced_poker=(announced == "poker"),
                    ):
                        continue

                # Punkte > 0 sind Voraussetzung für Kombis; Schwellen für Max/Min weiter unten
                return True
            return False

        MAPPING = [
            ("POKER", "poker", "Poker"),
            ("SIXTY", "60", "60er"),
            ("FULL", "full", "Full"),
            ("KENTER", "kenter", "Kenter"),
            ("MAX", "max", "Max"),
            ("MIN", "min", "Min"),
        ]

        out = []
        for typ, key, label in MAPPING:
            points = int(score_field_value(key, dice))
            # Schwellwerte für Max/Min anwenden
            if key == "max":
                if points < 25:
                    continue
            elif key == "min":
                if points > 9:
                    continue
            else:
                # Nur sinnvolle Kombis (>0) vorschlagen
                if points <= 0:
                    continue

            row = KEY_TO_ROW.get(key)
            if row is None:
                continue

            if any_col_eligible(row, key, points):
                out.append(
                    {
                        "type": typ,
                        "label": label,
                        "points": points,
                        "eligible": True,
                    }
                )

        # Sortierung nach gewünschter Priorität
        order = {"POKER": 0, "SIXTY": 1, "FULL": 2, "KENTER": 3, "MAX": 4, "MIN": 5}
        out.sort(key=lambda x: order.get(x["type"], 99))
        return out
    except Exception:
        logger.exception("Could not compute suggestions for game %s", g.get("_id"))
        return []


def _filled_rows_for(g: GameDict, pid: str, col: str) -> set[int]:
    """Liefert Indizes der bereits befüllten Reihen für eine Spalte (down/free/up/ang).

    Args:
        g (GameDict): Spielzustand
        pid (str): Spieler-ID
        col (str): Spaltenname (down, free, up, ang)

    Returns:
        set[int]: Indizes der befüllten Reihen
    """
    board = _board_for_actor(g, pid)
    return _filled_rows_in_board(board, col)


def _filled_rows_in_board(board: dict, col: str) -> set[int]:
    """Liefert befüllte Schreibzeilen einer Spalte aus einem Scoreboard-Dict."""
    out = set()
    for k in (board or {}).keys():
        if isinstance(k, str) and "," in k:
            r_str, c = k.split(",", 1)
            try:
                r = int(r_str)
            except ValueError:
                continue
            if c == col and r in WRITABLE_ROWS:
                out.add(r)
    return out


def _is_col_full(board: dict, col: str) -> bool:
    """True, wenn alle beschreibbaren Felder einer Spalte belegt sind."""
    return all(f"{row},{col}" in (board or {}) for row in WRITABLE_ROWS)


def _empty_count_in_col(board: dict, col: str) -> int:
    """Zaehlt freie beschreibbare Felder in einer Spalte."""
    return sum(1 for row in WRITABLE_ROWS if f"{row},{col}" not in (board or {}))


def _open_writable_count(board: dict) -> int:
    """Zaehlt alle freien beschreibbaren Felder eines Boards."""
    return sum(1 for row in WRITABLE_ROWS for col in WRITABLE_COLS if f"{row},{col}" not in (board or {}))


def _must_announce_after_first(g: GameDict, pid: str) -> bool:
    """Serverseitiger Guard fuer die Ansagepflicht vor weiterem Wuerfeln."""
    if bool(g.get("_hardcore")):
        return False
    board = _board_for_actor(g, pid)
    regular_cols_full = all(_is_col_full(board, col) for col in ("down", "free", "up"))
    free_ang = _empty_count_in_col(board, "ang")
    open_all = _open_writable_count(board)
    return bool(regular_cols_full and free_ang >= 2 and open_all != 1)


def _parse_write_target(data: dict) -> tuple[int, str, str]:
    """Validiert Zeile/Spalte aus einer Write-Payload und liefert row, col, field_key."""
    try:
        row = int(data["row"])
    except Exception as exc:
        raise ValueError("Ungültige Zeile") from exc

    col = data.get("field")
    if col not in WRITABLE_COLS:
        raise ValueError("Ungültige Spalte")

    fld = WRITABLE_MAP.get(row)
    if fld is None:
        raise ValueError("Dieses Feld ist nicht beschreibbar")

    return row, col, fld


def _next_required_row(col: str, filled: set[int]) -> int | None:
    """Nächste erforderliche Reihe in Abhängigkeit der Spalte (down => aufwärts, up => abwärts).

    Args:
        col (str): Spaltenname (down, free, up, ang)
        filled (set[int]): Indizes der befüllten Reihen

    Returns:
        int | None: Index der nächsten erforderlichen Reihe oder None, wenn alle Reihen befüllt sind
    """
    order = WRITABLE_ROWS if col == "down" else list(reversed(WRITABLE_ROWS))
    for r in order:
        if r not in filled:
            return r
    return None


def _remaining_cells_for(g: GameDict, pid: str) -> int:
    """Verbleibende Zellen für 'letzter Wurf' – im Team-Modus zählt das gemeinsame Blatt.

    Args:
        g (GameDict): Spielzustand
        pid (str): Spieler-ID

    Returns:
        int: Anzahl der verbleibenden Zellen
    """
    if is_team_mode(g):
        team = board_key_for_actor(g, pid)
        sb = g.get("_scoreboards_by_team", {}).get(team, {}) or {}
    else:
        sb = g["_scoreboards"].get(pid, {}) or {}
    return _open_writable_count(sb)


def _is_last_turn_for(g: GameDict, pid: str) -> bool:
    """True, wenn auf dem Ziel-Board nur noch eine beschreibbare Zelle frei ist.

    Args:
        g (GameDict): Spielzustand
        pid (str): Spieler-ID

    Returns:
        bool: True, wenn nur noch eine Zelle frei ist
    """
    return _remaining_cells_for(g, pid) == 1


def _set_roll_cap_for_current_turn(g: GameDict):
    """Setzt _rolls_max je nach 'letzter Wurf' auf 5, sonst 3."""
    # Hardcore überschreibt immer auf 1 Wurf pro Zug
    if bool(g.get("_hardcore")):
        g["_rolls_max"] = 1
        return
    cur = g.get("_turn", {}) or {}
    pid = cur.get("player_id")
    g["_rolls_max"] = 5 if (pid and _is_last_turn_for(g, pid)) else 3


def can_roll_now(g: GameDict, pid: str | None) -> tuple[bool, str]:
    """Validiert, ob ein Spieler im aktuellen Zustand würfeln darf."""
    if g.get("_finished") or g.get("_aborted"):
        return False, "Spiel ist bereits beendet"
    if not g.get("_started"):
        return False, "Spiel ist noch nicht gestartet"
    paused = multiplayer_pause_reason(g)
    if paused:
        return False, paused
    if not g.get("_turn") or g["_turn"].get("player_id") != pid:
        return False, "Nicht an der Reihe"
    if g.get("_correction", {}).get("active"):
        return False, "Während Korrektur nicht erlaubt"
    if int(g.get("_rolls_used", 0) or 0) >= int(g.get("_rolls_max", 3)):
        return False, "Keine Würfe mehr"
    if (
        not bool(g.get("_hardcore"))
        and not g.get("_announced_row4")
        and int(g.get("_rolls_used", 0) or 0) >= 1
        and _must_announce_after_first(g, str(pid))
    ):
        return False, "Bitte zuerst ein ❗-Feld ansagen, bevor weiter gewürfelt wird"
    return True, ""


def apply_roll(g: GameDict, *, randint_fn=None) -> list[int]:
    """Wendet einen Wurf auf den Spielzustand an und pflegt die Roll-Metadaten."""
    rng = randint_fn or random.randint
    dice = g["_dice"][:] if g.get("_dice") else [0] * 5
    holds = list(g.get("_holds", [False] * 5))[:5]
    if len(holds) < 5:
        holds += [False] * (5 - len(holds))

    for i in range(5):
        if not holds[i]:
            dice[i] = rng(1, 6)
    g["_dice"] = dice
    g["_rolls_used"] = int(g.get("_rolls_used", 0) or 0) + 1

    try:
        cur = g.setdefault("_turn", {})
        if "roll_index" not in cur:
            cur["roll_index"] = 0
        if "first4oak_roll" not in cur:
            cur["first4oak_roll"] = None
        cur["roll_index"] = int(cur.get("roll_index", 0) or 0) + 1
        if cur.get("first4oak_roll") is None and has_n_of_a_kind(g["_dice"], 4):
            cur["first4oak_roll"] = cur["roll_index"]
    except (AttributeError, TypeError, ValueError):
        logger.warning("Could not update roll metadata for game %s", g.get("_id"), exc_info=True)

    return g["_dice"]


def can_write_now(g: GameDict, pid: str, row: int, col: str, *, during_turn_announce: str | None) -> tuple[bool, str]:
    """Validiert, ob der Spieler JETZT in die angegebene Zelle schreiben darf.

    Prüft u. a. Ansage-Regel (❗), Reihenfolge-Constraints (down/up), letztes Feld,
    sowie 2v2-Teamziele. Rückgabe: (ok, begründung)

    Args:
        g (GameDict): Spielzustand
        pid (str): Spieler-ID
        row (int): Reihe
        col (str): Spalte
        during_turn_announce (str | None): Aktuelle Ansage (optional)

    Returns:
        tuple[bool, str]: (ok, begründung)
    """
    if g.get("_finished") or g.get("_aborted"):
        return False, "Spiel ist bereits beendet"
    if not g.get("_started"):
        return False, "Spiel ist noch nicht gestartet"
    paused = multiplayer_pause_reason(g)
    if paused:
        return False, paused
    if row not in WRITABLE_ROWS:
        return False, "Dieses Feld ist nicht beschreibbar"

    field_key = WRITABLE_MAP[row]

    # Ausnahme: Letztes freies Feld -> Ansage-Check ignorieren (Deadlock vermeiden)
    if _remaining_cells_for(g, pid) == 1:
        return True, ""

    # Hardcore: ❗ verhält sich exakt wie Freireihe (keine Ansagepflicht, keine Reihenfolge-Constraints)
    if bool(g.get("_hardcore")):
        if col in ("free", "ang"):
            return True, ""
        # für down/up gelten weiterhin die üblichen Reihenfolgen
        # (kein Ansage-Mechanismus in Hardcore)
    else:
        # Global: Wenn eine Ansage aktiv ist, darf in diesem Zug nur im ❗-Feld
        # GENAU dieses angesagte Feld beschrieben/gestrichen werden.
        if during_turn_announce and not _is_last_turn_for(g, pid):
            if col != "ang":
                return False, f"Ansage aktiv: Nur ❗-Spalte {during_turn_announce} erlaubt"
            if during_turn_announce != field_key:
                return False, f"Angesagt ist {during_turn_announce}, nicht {field_key}"
            # passt: ❗ + korrektes Feld -> erlaubt (Punkte oder 0 gemäss aktuellem Wurf)
            return True, ""

    if col == "free":
        return True, ""

    if col == "ang":
        if bool(g.get("_hardcore")):
            # In Hardcore ist ❗ identisch zur Freireihe
            return True, ""
        # Ausnahme: im letzten Zug darf ohne Ansage in ❗ geschrieben werden
        if _is_last_turn_for(g, pid):
            return True, ""
        # Direkt nach dem 1. Wurf darf ohne aktive Ansage in ❗ geschrieben werden.
        if g.get("_rolls_used", 0) == 1:
            return True, ""
        if not during_turn_announce:
            return False, "Keine Ansage aktiv"
        if during_turn_announce != field_key:
            return False, f"Angesagt ist {during_turn_announce}, nicht {field_key}"
        return True, ""

    if col in ("down", "up"):
        filled = _filled_rows_for(g, pid, col)
        next_row = _next_required_row(col, filled)
        if next_row is None:
            return False, "Reihe bereits voll"
        if row != next_row:
            return False, f"In dieser Reihe ist als Nächstes Zeile {next_row} erlaubt"
        return True, ""

    return False, "Unbekannte Spalte"


def next_turn(g: GameDict, current_pid: str | None) -> str | None:
    """Liefert die ID des nächsten Spielers in der Reihenfolge (Ring).

    Args:
        g (GameDict): Spielzustand
        current_pid (str | None): ID des aktuellen Spielers

    Returns:
        str | None: ID des nächsten Spielers oder None, wenn keine Spieler vorhanden sind
    """
    ids = [p["id"] for p in g["_players"]]
    if not ids:
        return None
    if current_pid in ids:
        i = (ids.index(current_pid) + 1) % len(ids)
        return ids[i]
    return ids[0]


def _begin_next_turn(g: GameDict, current_pid: str | None) -> None:
    """Schliesst den aktuellen Zug ab und initialisiert den naechsten Zug."""
    _reset_turn_roll_state(g)
    _clear_announcement(g)
    g["_turn"] = {
        "player_id": next_turn(g, current_pid),
        "roll_index": 0,
        "first4oak_roll": None,
    }
    _set_roll_cap_for_current_turn(g)


def _rows_from_scoreboard(sb: Dict[str, int]) -> Dict[int, Dict[str, int]]:
    """Liefert die Reihen eines Scoreboards als Dictionary.

    Args:
        sb (Dict[str, int]): Scoreboard als Dictionary

    Returns:
        Dict[int, Dict[str, int]]: Reihen des Scoreboards als Dictionary
    """
    rows = {1: {}, 2: {}, 3: {}, 4: {}}
    for k, v in (sb or {}).items():
        if not isinstance(k, str) or "," not in k:
            continue
        r_str, col = k.split(",", 1)
        try:
            r = int(r_str)
        except ValueError:
            continue
        if col not in WRITABLE_COLS:
            continue
        field_key = WRITABLE_MAP.get(r)
        if not field_key:
            continue
        try:
            value = int(v)
        except (TypeError, ValueError):
            continue
        target = rows[1 if col == "down" else 2 if col == "free" else 3 if col == "up" else 4]
        target.setdefault(field_key, value)
    return rows


def _compute_final_totals(g: GameDict) -> Dict[str, int]:
    """Berechnet die Endpunktzahlen für ein Spiel.

    Args:
        g (GameDict): Spielzustand

    Returns:
        Dict[str,int]: Endpunktzahlen als Dictionary
    """
    totals: Dict[str, int] = {}
    if is_team_mode(g):
        # Team-Boards
        for team_id, board in g.get("_scoreboards_by_team", {}).items():
            rows = _rows_from_scoreboard(board)
            ov = compute_overall(rows, hardcore=bool(g.get("_hardcore", False)))
            totals[team_id] = int(ov["overall"]["overall_total"]) if rows else 0
    else:
        # Spieler-Boards
        for p in g["_players"]:
            pid = p["id"]
            sb = g.get("_scoreboards", {}).get(pid, {}) or {}
            rows = _rows_from_scoreboard(sb)
            ov = compute_overall(rows, hardcore=bool(g.get("_hardcore", False)))
            totals[pid] = int(ov["overall"]["overall_total"]) if rows else 0
    return totals


def _progress_for_game(g: GameDict) -> list[dict]:
    """Liefert kompakten Fortschritt fuer die Lobby-Liste laufender Spiele."""
    totals = _compute_final_totals(g)
    if is_team_mode(g):
        players_by_id = {p.get("id"): p.get("name", "Player") for p in g.get("_players", [])}
        out = []
        for tid in ("A", "B"):
            team = g.get("_teams", {}).get(tid, {}) or {}
            members = [players_by_id.get(pid, str(pid)) for pid in team.get("members", [])]
            board = g.get("_scoreboards_by_team", {}).get(tid, {}) or {}
            filled = WRITABLE_CELLS_PER_PLAYER - _open_writable_count(board)
            out.append(
                {
                    "id": tid,
                    "name": team.get("name", f"Team {tid}"),
                    "members": members,
                    "filled": filled,
                    "of": WRITABLE_CELLS_PER_PLAYER,
                    "points": int(totals.get(tid, 0)),
                }
            )
        return out

    out = []
    for p in g.get("_players", []):
        pid = p.get("id")
        board = g.get("_scoreboards", {}).get(pid, {}) or {}
        filled = WRITABLE_CELLS_PER_PLAYER - _open_writable_count(board)
        out.append(
            {
                "id": pid,
                "name": p.get("name", "Player"),
                "members": [],
                "filled": filled,
                "of": WRITABLE_CELLS_PER_PLAYER,
                "points": int(totals.get(pid, 0)),
            }
        )
    return out


def _is_game_finished(g: GameDict) -> bool:
    """Prüft, ob ein Spiel beendet ist.

    Args:
        g (GameDict): Spielzustand

    Returns:
        bool: True, wenn das Spiel beendet ist
    """
    if not g["_players"]:
        return False
    if is_team_mode(g):
        boards = g.get("_scoreboards_by_team", {})
        # Beide Teams müssen alle 48 tatsächlich beschreibbaren Zellen füllen.
        return all(_open_writable_count(boards.get(team_id, {})) == 0 for team_id in ("A", "B"))
    # Einzel/3P: jeder Spieler voll
    for p in g["_players"]:
        pid = p["id"]
        if _open_writable_count(g["_scoreboards"].get(pid, {})) != 0:
            return False
    return True
