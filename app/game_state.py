"""Live game state, board identity and connection-independent lifecycle helpers."""

from __future__ import annotations

import logging
import math
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from .active_games import delete_active_game, save_active_game

logger = logging.getLogger(__name__)

# --- Auto-Timeout (Inaktivität) ---
GAME_TIMEOUT = timedelta(hours=1)


def touch(g):
    """Aktualisiert die letzte Aktivität des Spiels.

    Setzt `_last_activity` und `_updated_at` auf jetzt (UTC). Hilft beim
    Timeout-Handling sowie für UI-Informationen (zuletzt aktualisiert).
    """
    g["_last_activity"] = datetime.now(timezone.utc)
    g["_updated_at"] = g["_last_activity"].isoformat()


def timeout_seconds() -> int:
    """Liefert den Auto-Timeout in Sekunden."""
    return int(GAME_TIMEOUT.total_seconds())


def _format_duration_hm(seconds: int | float | None) -> str:
    """Formatiert Sekunden als knappe h/min-Angabe."""
    total = max(0, int(math.ceil(float(seconds or 0) / 60.0) * 60))
    hours = total // 3600
    minutes = (total % 3600) // 60
    return f"{hours} h {minutes} min" if hours else f"{minutes} min"


def pause_remaining_seconds(g) -> int:
    """Restzeit bis zum Auto-Timeout auf Basis der letzten Aktivitaet."""
    try:
        last = g.get("_last_activity")
        if not last:
            return timeout_seconds()
        now = datetime.now(timezone.utc)
        return max(0, int((GAME_TIMEOUT - (now - last)).total_seconds()))
    except (TypeError, ValueError):
        return timeout_seconds()


def check_timeout_and_abort(g) -> bool:
    """Prüft Inaktivität und markiert das Spiel ggf. als abgebrochen.

    Rückgabe:
    - True, wenn das Spiel soeben als abgebrochen markiert wurde, sonst False.
    """
    try:
        last = g.get("_last_activity")
        if not last:
            g["_last_activity"] = datetime.now(timezone.utc)
            return False
        if g.get("_finished"):
            return False
        now = datetime.now(timezone.utc)
        if now - last > GAME_TIMEOUT:
            g["_aborted"] = True
            g["_started"] = False
            g["_finished"] = True
            # Keine Ergebnisse loggen, Snapshot zeigt _aborted
            g["_results"] = None
            delete_active_game(str(g.get("_id") or ""))
            return True
    except (TypeError, ValueError, OverflowError):
        logger.warning("Could not evaluate timeout for game %s", g.get("_id"), exc_info=True)
    return False


def sweep_timeouts():
    """Iteriert über alle Spiele und wendet `check_timeout_and_abort` an."""
    for _gid, _g in list(games.items()):
        check_timeout_and_abort(_g)


def roll_cooldown_ok(g: dict, player_id, cooldown_s: float = 0.6) -> bool:
    """Serverseitiger Roll-Cooldown.

    Parameter:
    - g: Game-State Dict
    - player_id: aktueller Spieler
    - cooldown_s: Minimalabstand in Sekunden zwischen zwei `roll_dice` desselben Spielers

    Rückgabe: True = Rollen erlauben, False = Event verwerfen (zu schnell).
    """
    try:
        now = time.monotonic()
        rc = g.setdefault("_roll_cooldown", {})  # { player_id -> last_monotonic }
        last = float(rc.get(player_id, 0.0))
        if (now - last) < float(cooldown_s):
            return False
        rc[player_id] = now
        return True
    except (TypeError, ValueError):
        # Defensive: lieber freigeben als hart failen
        return True


# Zentrales Game-Registry + Typalias
GameDict = Dict[str, Any]
games: Dict[str, GameDict] = {}

# -----------------------------
# Schreibbare Felder (Index -> Feldname)
# -----------------------------
WRITABLE_ROWS = [0, 1, 2, 3, 4, 5, 9, 10, 12, 13, 14, 15]
WRITABLE_MAP = {
    0: "1",
    1: "2",
    2: "3",
    3: "4",
    4: "5",
    5: "6",
    9: "max",
    10: "min",
    12: "kenter",
    13: "full",
    14: "poker",
    15: "60",
}
KEY_TO_ROW = {v: k for k, v in WRITABLE_MAP.items()}
WRITABLE_CELLS_PER_PLAYER = len(WRITABLE_ROWS) * 4  # 12*4 = 48
WRITABLE_COLS = ("down", "free", "up", "ang")
WRITABLE_FIELDS = set(KEY_TO_ROW.keys())
CHAT_HISTORY_LIMIT = 300
SUPERADMIN_BLOCKED_ACTIONS = {
    "set_hold",
    "roll_dice",
    "announce_row4",
    "unannounce_row4",
    "write_field",
    "request_correction",
    "cancel_correction",
    "write_field_correction",
}
MULTIPLAYER_PAUSE_BLOCKED_ACTIONS = {
    "set_hold",
    "roll_dice",
    "announce_row4",
    "unannounce_row4",
    "write_field",
    "request_correction",
    "cancel_correction",
    "write_field_correction",
    "superadmin_activate",
    "superadmin_save",
}

# --- Team-Mode Helpers (2v2: Spieler 1&3 = Team A, 2&4 = Team B) ---


def is_team_mode(g: GameDict) -> bool:
    """True, wenn das Spiel im 2v2-Team-Modus läuft."""
    m = str(g.get("_mode"))
    return m.lower() == "2v2"


def assign_team_for_join(g: GameDict, player_id: str):
    """Weist einem beitretenden Spieler ein Team zu (1/3 → A, 2/4 → B).

    Legt Teams und Team-Scoreboards an, falls noch nicht vorhanden.
    """
    order = [p["id"] for p in g["_players"]]
    idx = order.index(player_id) if player_id in order else len(order)
    team = "A" if idx % 2 == 0 else "B"
    g.setdefault("_team_of", {})[player_id] = team
    teams = g.setdefault("_teams", {"A": {"name": "Team A", "members": []}, "B": {"name": "Team B", "members": []}})
    if player_id not in teams[team]["members"]:
        teams[team]["members"].append(player_id)
    # Team-Scoreboard anlegen
    g.setdefault("_scoreboards_by_team", {}).setdefault(team, {})


def board_key_for_actor(g: GameDict, pid: str) -> str:
    """Liefert die Ziel-Scoreboard-ID für einen Akteur.

    Im 2v2 wird die Team-ID ("A"/"B") verwendet, sonst die Player-ID.
    """
    if is_team_mode(g):
        team = g.get("_team_of", {}).get(pid)
        return team or "A"
    return pid


def _board_for_actor(g: GameDict, pid: str) -> dict:
    """Liefert das Scoreboard, in das dieser Spieler schreiben würde."""
    if is_team_mode(g):
        team = board_key_for_actor(g, pid)
        return g.get("_scoreboards_by_team", {}).get(team, {}) or {}
    return g.get("_scoreboards", {}).get(pid, {}) or {}


def _ensure_board_for_actor(g: GameDict, pid: str) -> dict:
    """Liefert das beschreibbare Zielboard und legt es bei Bedarf an."""
    if is_team_mode(g):
        team = board_key_for_actor(g, pid)
        return g.setdefault("_scoreboards_by_team", {}).setdefault(team, {})
    return g.setdefault("_scoreboards", {}).setdefault(pid, {})


def _board_for_id(g: GameDict, board_id: str) -> dict:
    """Liefert ein Board per Player- oder Team-ID."""
    bid = str(board_id or "")
    if is_team_mode(g):
        return g.get("_scoreboards_by_team", {}).get(bid, {}) or {}
    return g.get("_scoreboards", {}).get(bid, {}) or {}


def _ensure_board_for_id(g: GameDict, board_id: str) -> dict:
    """Liefert ein beschreibbares Board per Player- oder Team-ID."""
    bid = str(board_id or "")
    if is_team_mode(g):
        return g.setdefault("_scoreboards_by_team", {}).setdefault(bid, {})
    return g.setdefault("_scoreboards", {}).setdefault(bid, {})


def _board_exists(g: GameDict, board_id: str) -> bool:
    """Prüft, ob eine Board-ID in diesem Spiel existiert."""
    bid = str(board_id or "")
    if is_team_mode(g):
        return bid in (g.get("_scoreboards_by_team", {}) or {})
    return bid in (g.get("_scoreboards", {}) or {})


def _board_display_name(g: GameDict, board_id: str) -> str:
    """Menschenlesbarer Boardname für Admin- und Chatmeldungen."""
    bid = str(board_id or "")
    if is_team_mode(g):
        return (g.get("_teams", {}).get(bid, {}) or {}).get("name") or f"Team {bid}"
    return next((p.get("name", "Player") for p in g.get("_players", []) if str(p.get("id")) == bid), bid or "Board")


def _player_name(g: GameDict, pid: str | None) -> str:
    """Liefert den Namen eines Spielers anhand der ID."""
    if not pid:
        return "Spieler"
    return next((p.get("name", "Player") for p in g.get("_players", []) if str(p.get("id")) == str(pid)), "Spieler")


def _row_label_for_admin(row: int) -> str:
    """Kurzlabel einer schreibbaren Zeile für Adminmeldungen."""
    return {
        0: "1",
        1: "2",
        2: "3",
        3: "4",
        4: "5",
        5: "6",
        9: "+",
        10: "-",
        12: "K",
        13: "F",
        14: "P",
        15: "60",
    }.get(int(row), str(row))


def _col_label_for_admin(col: str) -> str:
    """Kurzlabel einer Spalte für Adminmeldungen."""
    return {
        "down": "⬇︎",
        "free": "／",
        "up": "⬆︎",
        "ang": "❗",
    }.get(str(col), str(col))


def _clear_announcement(g: GameDict) -> None:
    """Setzt alle Ansage-Metadaten zurueck."""
    g["_announced_row4"] = None
    g["_announced_by"] = None
    g["_announced_board"] = None


def _reset_turn_roll_state(g: GameDict) -> None:
    """Setzt Wuerfel, Holds und Wurfzaehler fuer den naechsten Zug zurueck."""
    g["_dice"] = [0, 0, 0, 0, 0]
    g["_holds"] = [False] * 5
    g["_rolls_used"] = 0


def _clear_correction(g: GameDict) -> None:
    """Beendet den Korrekturmodus und entfernt die angezeigten Korrekturwuerfel."""
    g["_correction"] = {"active": False}
    g["_dice"] = [0, 0, 0, 0, 0]


def correction_disabled_reason(g: GameDict) -> str | None:
    """Return the shared reason why correction actions are unavailable."""
    if bool(g.get("_hardcore")):
        return "Korrekturmodus ist im Hardcore-Modus deaktiviert"
    if int(g.get("_expected", 0) or 0) == 1:
        return "Korrekturmodus ist im 1‑Spieler‑Modus deaktiviert"
    return None


def _join_block_reason(g: GameDict) -> str | None:
    """Prueft, ob ein neuer Spieler dem Spiel noch beitreten darf."""
    if g.get("_finished") or g.get("_aborted"):
        return "Spiel ist bereits beendet"
    if g.get("_started"):
        return "Spiel ist bereits gestartet"
    if len(g.get("_players", [])) >= int(g.get("_expected", 0) or 0):
        return "Spiel ist bereits voll"
    return None


def _player_connected(p: dict) -> bool:
    """True, wenn fuer den Spieler aktuell ein WebSocket registriert ist."""
    return p.get("ws") is not None


def _offline_players(g: GameDict) -> list[dict]:
    """Liefert getrennte Spieler fuer laufende Multiplayer-Spiele."""
    if int(g.get("_expected", 0) or 0) <= 1:
        return []
    if not g.get("_started") or g.get("_finished") or g.get("_aborted"):
        return []
    if not g.get("_resume_required") and not any(_player_connected(p) for p in g.get("_players", [])):
        return []
    return [
        {
            "id": str(p.get("id")),
            "name": p.get("name", "Player"),
            **({"user_id": p["user_id"]} if p.get("user_id") is not None else {}),
            **({"achievement_rank": p["achievement_rank"]} if isinstance(p.get("achievement_rank"), dict) else {}),
        }
        for p in g.get("_players", [])
        if not _player_connected(p)
    ]


def multiplayer_pause_reason(g: GameDict) -> str | None:
    """Liefert den aktiven Pausegrund fuer manuelle und Reconnect-Pausen."""
    if g.get("_manual_pause"):
        by = g.get("_manual_pause_by_name")
        prefix = f"{by} hat das Spiel pausiert." if by else "Spiel pausiert."
        return f"{prefix} Wiederaufnahme innerhalb von {_format_duration_hm(pause_remaining_seconds(g))} möglich."

    missing = _offline_players(g)
    if not missing:
        return None
    names = ", ".join(p.get("name", "Player") for p in missing)
    return f"Spiel pausiert, bis alle Spieler wieder verbunden sind. Es fehlen: {names}"


def _passphrase_from_payload(data: dict) -> str:
    """Liest die Passphrase aus aktuellen und Legacy-Payload-Feldern."""
    value = data.get("pass") or data.get("passphrase") or ""
    return value.strip() if isinstance(value, str) else ""


def _passphrase_matches(g: GameDict, data: dict) -> bool:
    """True, wenn keine Passphrase gesetzt ist oder die Payload passt."""
    expected_pass = g.get("_passphrase") or ""
    return (not expected_pass) or _passphrase_from_payload(data) == expected_pass


def new_game(gid: str, name: str, mode) -> GameDict:
    if isinstance(mode, str) and mode.isdigit():
        mode = int(mode)
    expected = 4 if str(mode).lower() == "2v2" else int(mode)
    g: GameDict = {
        "_id": gid,
        "_name": name,
        "_mode": str(mode),
        "_hardcore": False,  # 1 Wurf, ❗ wie Freireihe, keine Korrektur
        "_expected": expected,
        "_started": False,
        "_finished": False,
        "_started_at": None,
        "_updated_at": datetime.now(timezone.utc).isoformat(),
        "_players": [],  # Dauerhafte Identität plus flüchtige `ws`-Verbindung
        "_spectators": [],  # Prozesslokal; Zuschauer werden nicht wiederhergestellt
        "_turn": None,  # {"player_id": ...}
        "_dice": [0, 0, 0, 0, 0],
        "_holds": [False] * 5,
        "_rolls_used": 0,
        "_rolls_max": 3,
        "_scoreboards": {},  # pid -> {"row,col": score} (Einzel/3P)
        # Team-Boards im 2v2:
        "_team_of": {},  # pid -> "A"/"B"
        "_teams": {"A": {"name": "Team A", "members": []}, "B": {"name": "Team B", "members": []}},
        "_scoreboards_by_team": {},  # "A"/"B" -> {"row,col": score}
        "_announced_row4": None,  # "1".."6","max","min","kenter","full","poker","60"
        "_correction": {"active": False},  # {"active":True,"player_id":pid,"dice":[...]}
        "_results": None,  # Ergebnisliste (nur am Ende)
        "_aborted": False,
        "_passphrase": None,
        "_last_activity": datetime.now(timezone.utc),
        "_last_write": {},  # pid -> (row, col)
        "_last_dice": {},  # pid -> [d1..d5]
        "_last_meta": {},  # pid -> {"announced": ...}
        "_chat_history": [],  # gespeicherte Chat-/Systemmeldungen
        "_superadmins": {},  # pid -> {"board_id": ...}
        "_admin_edits": {},  # board_id -> {"row,col": meta}
        "_admin_dice_edits": [],  # Audit der losgeloesten Superadmin-Wuerfeleingriffe
        "_resume_required": False,  # True, sobald ein laufendes Multiplayer-Spiel Verbindungen verloren hat
        "_manual_pause": False,  # explizit vom Spieler pausiert statt abgebrochen
        "_manual_pause_by": None,
        "_manual_pause_by_name": None,
        "_manual_pause_at": None,
    }
    games[gid] = g
    save_active_game(g)
    return g
