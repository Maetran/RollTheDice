"""
RollTheDice – FastAPI backend
---------------------------------

Dieses Modul enthält die Serverlogik für das Multiplayer-Würfelspiel:
- HTTP-Routen (Manifest/Static/Leaderboard)
- WebSocket-Endpunkt für den Spielraum (Join/Rollen/Schreiben/Korrektur)
- Spiel- und Scoreboard-Verwaltung, inkl. Team-Modus (2v2)
- Ergebnisberechnung, Leaderboard-Persistenz und Inaktivitäts-Timeout

Wichtig: Poker-Logik und Korrekturmodus
--------------------------------------
- Während eines Zuges wird getrackt, in welchem Wurf (roll_index) zum ersten
  Mal ein Vierling ("first4oak_roll") aufgetreten ist.
- Bei einem normalen Schreiben von "poker" in den Spalten ⬇︎/free/⬆︎ gelten Punkte
  nur, wenn es sich um den Wurf handelt, in dem der Vierling erstmals erschien,
  oder wenn ein Fünfling vorliegt. In ❗ (Ansage auf poker) sind Punkte in jedem
  Wurf mit 4/5 gleichen erlaubt.
- Im Korrekturmodus werden die beim ursprünglichen Zug gemerkten Würfel sowie
  Meta-Werte (roll_index und first4oak_roll) genutzt, um die Berechtigung zur
  Punktevergabe korrekt zu prüfen.
"""

from __future__ import annotations

import uuid
import random
import json
from collections import Counter
from typing import Dict, Any
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import time  # für monotonic()-Cooldown-Timer

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .rules import compute_overall

# --- Auto-Timeout (Inaktivität) ---
GAME_TIMEOUT = timedelta(hours=1)

def touch(g):
    """Aktualisiert die letzte Aktivität des Spiels.

    Setzt `_last_activity` und `_updated_at` auf jetzt (UTC). Hilft beim
    Timeout-Handling sowie für UI-Informationen (zuletzt aktualisiert).
    """
    g["_last_activity"] = datetime.now(timezone.utc)
    g["_updated_at"] = g["_last_activity"].isoformat()

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
            return True
    except Exception:
        pass
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
    except Exception:
        # Defensive: lieber freigeben als hart failen
        return True

# App zuerst erstellen
app = FastAPI()

# ---------------- Pfade robust auflösen (static/ und data/) ----------------
HERE = Path(__file__).resolve().parent           # .../RollTheDice/app
BASE = HERE.parent                               # .../RollTheDice

# Kandidaten für 'static'
STATIC_CANDIDATES = [
    BASE / "static",         # .../RollTheDice/static  (Repo-Root)
    HERE / "static",         # .../RollTheDice/app/static
    Path.cwd() / "static",   # aktuelles Arbeitsverzeichnis
]
STATIC_DIR = next((p for p in STATIC_CANDIDATES if p.exists()), None)
if not STATIC_DIR:
    raise RuntimeError("Kein 'static' Ordner gefunden. Erwartete Orte: "
                       + ", ".join(str(p) for p in STATIC_CANDIDATES))

# Kandidaten für 'data' (Leaderboard/Stats)
DATA_CANDIDATES = [
    BASE / "data",           # .../RollTheDice/data  (empfohlen)
    HERE / "data",           # .../RollTheDice/app/data
]
DATA_DIR = next((p for p in DATA_CANDIDATES if p.exists()), HERE)
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Dateien relativ zu DATA_DIR
RECENT_FILE  = DATA_DIR / "leaderboard_recent.json"
ALLTIME_FILE = DATA_DIR / "leaderboard_alltime.json"
SHAME_FILE   = DATA_DIR / "leaderboard_shame.json"
LAST_GAMES_FILE = DATA_DIR / "leaderboard_last_games.json"
STATS_FILE   = DATA_DIR / "stats.json"

# Static korrekt mounten – jetzt existiert app
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Manifest (am Root-Pfad) mit korrektem MIME-Type ausliefern
@app.get("/manifest.webmanifest", include_in_schema=False)
def manifest():
    # liegt im Repo-Root neben Dockerfile / README
    return FileResponse(str(BASE / "manifest.webmanifest"), media_type="application/manifest+json")

# Service Worker (Root-Scope) ausliefern
@app.get("/sw.js", include_in_schema=False)
def service_worker():
    return FileResponse(str(STATIC_DIR / "sw.js"), media_type="text/javascript")

# Zentrales Game-Registry + Typalias
GameDict = Dict[str, Any]
games: Dict[str, GameDict] = {}

# -----------------------------
# Schreibbare Felder (Index -> Feldname)
# -----------------------------
WRITABLE_ROWS = [0, 1, 2, 3, 4, 5, 9, 10, 12, 13, 14, 15]
WRITABLE_MAP = {
    0: "1", 1: "2", 2: "3", 3: "4", 4: "5", 5: "6",
    9: "max", 10: "min", 12: "kenter", 13: "full", 14: "poker", 15: "60",
}
KEY_TO_ROW = {v: k for k, v in WRITABLE_MAP.items()}
WRITABLE_CELLS_PER_PLAYER = len(WRITABLE_ROWS) * 4  # 12*4 = 48
WRITABLE_COLS = ("down", "free", "up", "ang")
WRITABLE_FIELDS = set(KEY_TO_ROW.keys())

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
    teams = g.setdefault("_teams", {"A":{"name":"Team A","members":[]}, "B":{"name":"Team B","members":[]}})
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

def _join_block_reason(g: GameDict) -> str | None:
    """Prueft, ob ein neuer Spieler dem Spiel noch beitreten darf."""
    if g.get("_finished") or g.get("_aborted"):
        return "Spiel ist bereits beendet"
    if g.get("_started"):
        return "Spiel ist bereits gestartet"
    if len(g.get("_players", [])) >= int(g.get("_expected", 0) or 0):
        return "Spiel ist bereits voll"
    return None

def _passphrase_from_payload(data: dict) -> str:
    """Liest die Passphrase aus aktuellen und Legacy-Payload-Feldern."""
    return (data.get("pass") or data.get("passphrase") or "").strip()

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
        "_hardcore": False,                 # 1 Wurf, ❗ wie Freireihe, keine Korrektur
        "_expected": expected,
        "_started": False,
        "_finished": False,

        "_started_at": None,
        "_updated_at": datetime.now(timezone.utc).isoformat(),

        "_players": [],                        # [{id,name,ws}]
        "_spectators": [],                     # [{id,name,ws}]
        "_turn": None,                         # {"player_id": ...}
        "_dice": [0, 0, 0, 0, 0],
        "_holds": [False] * 5,
        "_rolls_used": 0,
        "_rolls_max": 3,

        "_scoreboards": {},                    # pid -> {"row,col": score} (Einzel/3P)
        # Team-Boards im 2v2:
        "_team_of": {},                        # pid -> "A"/"B"
        "_teams": {"A":{"name":"Team A","members":[]}, "B":{"name":"Team B","members":[]}},
        "_scoreboards_by_team": {},            # "A"/"B" -> {"row,col": score}

        "_announced_row4": None,               # "1".."6","max","min","kenter","full","poker","60"
        "_correction": {"active": False},      # {"active":True,"player_id":pid,"dice":[...]}

        "_results": None,                      # Ergebnisliste (nur am Ende)
        "_aborted": False,
        "_passphrase": None,
        "_last_activity": datetime.now(timezone.utc),

        "_last_write": {},                     # pid -> (row, col)
        "_last_dice": {},                      # pid -> [d1..d5]
        "_last_meta": {},                      # pid -> {"announced": ...}
    }
    games[gid] = g
    return g

# -----------------------------
# Scoring & Helpers
# -----------------------------

def _counts(dice):
    """Zählt Vorkommen der geworfenen Augenzahlen (0 wird ignoriert).

    Args:
        dice (list): Liste der Würfelwerte (1-6)

    Returns:
        Counter: Zählung der Augenzahlen
    """
    return Counter(d for d in dice if d)

def has_n_of_a_kind(dice, n: int) -> bool:
    """True, wenn die aktuellen Würfel mindestens n gleiche zeigen.

    Args:
        dice (list): Liste der Würfelwerte (1-6)
        n (int): Anzahl der gleichen Würfel

    Returns:
        bool: True, wenn mindestens n gleiche Würfel vorhanden sind
    """
    c = _counts(dice)
    return any(v >= n for v in c.values())

def score_field_value(field_key: str, dice) -> int:
    """Client-nahe Punkteberechnung (identisch zur Anzeige/Vorschläge).

    Hinweis: Die serverseitige Autorität liegt bei `rules.score_field` bzw.
    beim Schreib-Handler; hier wird für UI/Suggestions gerechnet.

    Args:
        field_key (str): Schlüssel des Feldes (z.B. "1", "2", ..., "6", "max", "min", ...)
        dice (list): Liste der Würfelwerte (1-6)

    Returns:
        int: Punktzahl für das Feld
    """
    cnt = _counts(dice)
    total = sum(d for d in dice if d)

    if field_key in {"1", "2", "3", "4", "5", "6"}:
        face = int(field_key)
        return cnt.get(face, 0) * face

    if field_key in {"max", "min"}:
        return total

    if field_key == "kenter":
        return 35 if len(cnt.keys()) == 5 else 0

    if field_key == "full":
        if not cnt:
            return 0
        most_face = cnt.most_common(1)[0][0]
        vals = sorted(cnt.values())
        return 40 + 3 * most_face if vals == [2, 3] or vals == [5] else 0

    if field_key == "poker":
        for face, n in cnt.items():
            if n >= 4:  # auch 5 gleiche zählen als Poker
                return 50 + 4 * face
        return 0

    if field_key == "60":
        for face, n in cnt.items():
            if n == 5:
                return 60 + 5 * face
        return 0

    return 0

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
            ("SIXTY", "60",    "60er"),
            ("FULL",  "full",  "Full"),
            ("KENTER","kenter","Kenter"),
            ("MAX",   "max",   "Max"),
            ("MIN",   "min",   "Min"),
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
                out.append({
                    "type": typ,
                    "label": label,
                    "points": points,
                    "eligible": True,
                })

        # Sortierung nach gewünschter Priorität
        order = {"POKER": 0, "SIXTY": 1, "FULL": 2, "KENTER": 3, "MAX": 4, "MIN": 5}
        out.sort(key=lambda x: order.get(x["type"], 99))
        return out
    except Exception:
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
    return sum(
        1
        for row in WRITABLE_ROWS
        for col in WRITABLE_COLS
        if f"{row},{col}" not in (board or {})
    )

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
    return WRITABLE_CELLS_PER_PLAYER - len(sb)

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
    except Exception:
        pass

    return g["_dice"]

def poker_points_allowed(
    dice,
    col: str,
    *,
    roll_index: int,
    first4oak_roll,
    announced_poker: bool = False,
    correction: bool = False,
) -> bool:
    """Prüft, ob ein Pokerwurf in diesem Schreibkontext Punkte geben darf."""
    has4 = has_n_of_a_kind(dice, 4)
    has5 = has_n_of_a_kind(dice, 5)
    if not has4 and not has5:
        return False
    if has5:
        return True
    if col == "ang" and announced_poker:
        return True

    try:
        roll_idx = int(roll_index or 0)
    except Exception:
        roll_idx = 0

    first4_eff = first4oak_roll
    missing_first4 = (not first4_eff) if correction else (first4_eff is None)
    if has4 and missing_first4:
        first4_eff = roll_idx

    try:
        first4_idx = int(first4_eff)
    except Exception:
        return False

    effective_roll_idx = first4_idx if correction else roll_idx
    return bool(has4 and first4_idx and effective_roll_idx == first4_idx)

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

def _serialize_scoreboards(g: GameDict) -> dict:
    """Bereitet Scoreboards für den Snapshot vor (Team/Einzel vereinheitlicht).

    Args:
        g (GameDict): Spielzustand

    Returns:
        dict: Scoreboards als Dictionary
    """
    out = {}
    for pid, board in g["_scoreboards"].items():
        sb = {}
        for k, v in board.items():
            if isinstance(k, str):
                sb[k] = v
        out[pid] = sb
    return out

# -----------------------------
# Snapshot / Broadcast
# -----------------------------

def snapshot(g: GameDict) -> dict:
    """Erzeugt den vollständigen Spiel-Snapshot für den Client.

    Enthält Spieler/Teams, Boards, aktuelle Würfel/Holds, Zugstatus, Ansage,
    Korrekturstatus, Vorschläge und optionale Ergebnisse.

    Args:
        g (GameDict): Spielzustand

    Returns:
        dict: Spiel-Snapshot als Dictionary
    """
    try:
        # --- Poker-Debug (optional via env): zeigt Serverzustand im Client ---
        def _dbg_poker():
            if os.getenv("DEBUG_POKER", "").strip() != "1":
                return None
            cur = g.get("_turn", {}) or {}
            dice = (g.get("_dice") or [])[:]
            has4 = has_n_of_a_kind(dice, 4)
            has5 = has_n_of_a_kind(dice, 5)
            return {
                "roll_index": int(cur.get("roll_index", 0) or 0),
                "first4oak_roll": cur.get("first4oak_roll"),
                "announced": g.get("_announced_row4"),
                "has4": bool(has4),
                "has5": bool(has5),
                "dice": dice,
            }

        # Auto-Timeout prüfen
        check_timeout_and_abort(g)
        # Ergebnisse (falls abgeschlossen) berechnen
        if g["_finished"] and not g.get("_results"):
            g["_results"] = _compute_results_for_snapshot(g)

        # --- Auto-advance roll trigger logic ---
        # Im 1P-Modus und im Hardcore-Modus (alle Modi) wird der erste Wurf automatisch angestoßen,
        # sobald ein neuer Zug beginnt (würfel alle 0, keine Holds, keine Würfe verwendet).
        _auto_single = False
        if (
            (g.get("_expected") == 1 or bool(g.get("_hardcore")))
            and not g.get("_finished")
            and g.get("_turn") is not None
        ):
            # Only if dice are all zero, no holds, and no rolls used
            dice = g.get("_dice", [])
            holds = g.get("_holds", [])
            rolls_used = g.get("_rolls_used", 0)
            if (
                isinstance(dice, list) and all(d == 0 for d in dice)
                and isinstance(holds, list) and all(not h for h in holds)
                and rolls_used == 0
            ):
                # This is the auto-roll trigger condition
                # Set _turn to same player (no-op in effect, but triggers client auto-roll)
                g["_turn"] = dict(g["_turn"])  # make sure to trigger update if needed
                _auto_single = True
        else:
            _auto_single = False

        return {
            "_name": g["_name"],
            "_hardcore": bool(g.get("_hardcore", False)),
            "_players": [{"id": p["id"], "name": p["name"]} for p in g["_players"]],
            "_players_joined": len(g["_players"]),
            "_expected": g["_expected"],
            "_started": g["_started"],
            "_finished": g["_finished"],
            "_started_at": g.get("_started_at"),
            "_updated_at": g.get("_updated_at"),
            "_aborted": g.get("_aborted", False),
            "locked": bool(g.get("_passphrase")),  # neu: passwortgeschütztes Spiel kennzeichnen
            "_turn": g["_turn"],
            "_dice": g["_dice"],
            "_holds": g["_holds"],
            "_rolls_used": g["_rolls_used"],
            "_rolls_max": g["_rolls_max"],
            "_scoreboards": ({} if is_team_mode(g) else _serialize_scoreboards(g)),
            "_announced_row4": g["_announced_row4"],
            "_announced_by": g.get("_announced_by"),            # player-id (Einzel/2/3 Spieler)
            "_announced_board": g.get("_announced_board"),      # board-id: team-id ("A"/"B") in 2v2, sonst player-id
            "_correction": g["_correction"],

            # Team-Infos für 2v2
            "_mode": g.get("_mode"),
            "_teams": (
                [
                  {
                    "id": "A",
                    "name": g.get("_teams", {}).get("A", {}).get("name", "Team A"),
                    # Nur IDs liefern – der Client mappt Namen aus _players
                    "members": g.get("_teams", {}).get("A", {}).get("members", [])
                  },
                  {
                    "id": "B",
                    "name": g.get("_teams", {}).get("B", {}).get("name", "Team B"),
                    "members": g.get("_teams", {}).get("B", {}).get("members", [])
                  }
                ] if is_team_mode(g) else []
            ),
            "_scoreboards_by_team": (g.get("_scoreboards_by_team", {}) if is_team_mode(g) else {}),

            "_results": g.get("_results"),
            "_last_write_public": {
                pid: [int(rc[0]), str(rc[1])] if (isinstance(rc, tuple) and len(rc) == 2) else rc
                for pid, rc in g.get("_last_write", {}).items()
            },
            "_has_last": {pid: bool(g["_last_write"].get(pid)) for pid in g["_scoreboards"].keys()},
            "_auto_single": _auto_single,
            # Serverseitig berechnete Vorschläge für den aktiven Spieler.
            "suggestions": compute_suggestions(g),
            # Optionales Poker-Debugging
            "_dbg_poker": _dbg_poker(),
        }
    except Exception:
        return {}

async def broadcast(g: GameDict, msg: Dict[str, Any]) -> None:
    """Sendet eine JSON-Nachricht an alle aktiven Spieler- und Zuschauer-Sockets.

    Args:
        g (GameDict): Spielzustand
        msg (Dict[str, Any]): Nachricht als Dictionary
    """
    recipients = list(g.get("_players", [])) + list(g.get("_spectators", []))
    for p in recipients:
        ws = p.get("ws")
        if not ws:
            continue
        try:
            await ws.send_json(msg)
        except Exception:
            pass

async def _close_ws_with_error(websocket: WebSocket, error: str, *, fatal: bool = False, code: int = 1008) -> None:
    """Sendet einen Fehler und schliesst danach den WebSocket."""
    try:
        payload = {"error": error}
        if fatal:
            payload["fatal"] = True
        await websocket.send_json(payload)
    except Exception:
        pass
    await websocket.close(code=code)

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

# -----------------------------
# HTTP API
# -----------------------------

@app.get("/")
def root():
    """Liefer Startseite (Lobby) aus dem Static-Verzeichnis aus."""
    return FileResponse(str(STATIC_DIR / "index.html"))

class CreateReq(BaseModel):
    name: str
    mode: str | int
    owner: str | None = None
    passphrase: str | None = Field(default=None, alias="pass")
    hardcore: bool | None = False

def game_list_payload() -> list[dict]:
    """Hilfsfunktion: erzeugt die JSON-Payload für die Spielübersicht (Lobby).

    Returns:
        list[dict]: Liste der Spiele als Dictionary
    """
    out = []
    for gid, g in games.items():
        out.append({
            "id": gid,
            "name": g["_name"],
            "mode": g["_mode"],
            "hardcore": bool(g.get("_hardcore", False)),
            "expected": g["_expected"],
            "joined": len(g["_players"]),
            "started": g["_started"],
            "finished": g["_finished"],
            "locked": bool(g.get("_passphrase")),
        })
    return out

# --- Games API (mit wartenden Spielern) ---
@app.get("/api/games")
async def api_games():
    """API: Liste aller Spiele (laufend, wartend, abgeschlossen/abgebrochen)."""
    sweep_timeouts()
    lst = []
    for gid, g in games.items():
        try:
            joined = len(g["_players"])
            waiting_names = [p.get("name", f"Player {i}") for i, p in enumerate(g["_players"], start=1)]
            lst.append({
                "id": gid,
                "name": g["_name"],
                "mode": g["_mode"],
                "hardcore": bool(g.get("_hardcore", False)),
                "players": joined,
                "expected": g["_expected"],
                "started": g["_started"],
                "finished": g["_finished"],
                "aborted": g.get("_aborted", False),
                "locked": bool(g.get("_passphrase")),  # <— neu
                "waiting": waiting_names,
                "started_at": g.get("_started_at"),
                "updated_at": g.get("_updated_at"),
                "progress": (_progress_for_game(g) if g.get("_started") and not g.get("_finished") and not g.get("_aborted", False) else []),
            })
        except Exception:
            continue
    return {"games": lst}

@app.get("/api/games/{game_id}")
def game_info(game_id: str, passphrase: str | None = Query(default=None, alias="pass"), check: int = Query(default=0)):
    """API: Detailinfos zu einem Spiel inkl. Fortschritt/Player-Status."""
    sweep_timeouts()
    g = games.get(game_id)
    if not g:
        return {"exists": False}

    # Preflight: falls ?check=1 angegeben ist, Passwort hart pruefen und frueh beenden
    if check == 1:
        if g.get("_passphrase"):
            # Bei gesperrtem Spiel: fehlendes ODER falsches Passwort => 403
            if not passphrase or passphrase != g["_passphrase"]:
                raise HTTPException(status_code=403, detail="wrong_passphrase")
        # OK -> kurzer Erfolg, Client prueft nur .ok
        return {"ok": True, "exists": True}

    # optional: Passphrase validieren, falls mitgegeben
    if g.get("_passphrase") and passphrase is not None:
        if passphrase != g["_passphrase"]:
            raise HTTPException(status_code=403, detail="wrong_passphrase")
    return {
        "exists": True,
        "id": game_id,
        "name": g["_name"],
        "mode": g["_mode"],
        "hardcore": bool(g.get("_hardcore", False)),
        "players": len(g["_players"]),
        "expected": g["_expected"],
        "started": g["_started"],
        "finished": g["_finished"],
        "aborted": g.get("_aborted", False),
        "locked": bool(g.get("_passphrase")),
        "waiting": [p.get("name", "Player") for p in g["_players"]],
    }

def _read_json_file(path: Path, default):
    """Liest JSON-Daten defensiv und liefert bei fehlender/defekter Datei default."""
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return default
    return default

def _write_json_if_changed(path: Path, original_data, new_data) -> None:
    """Schreibt JSON nur, wenn sich der Inhalt tatsächlich geändert hat."""
    try:
        if json.dumps(original_data, sort_keys=True) != json.dumps(new_data, sort_keys=True):
            path.write_text(json.dumps(new_data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass

def _parse_ts(s: str) -> datetime | None:
    """Robustes ISO-8601-Parsing, naive Zeitstempel werden als UTC interpretiert."""
    if not isinstance(s, str) or not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None

def _entry_ts(entry: dict) -> datetime | None:
    """Liefert den besten verfügbaren Abschlusszeitpunkt eines Leaderboard-Eintrags."""
    if not isinstance(entry, dict):
        return None
    return _parse_ts(entry.get("ts")) or _parse_ts(entry.get("finished_at"))

def _entry_has_points(entry: dict) -> bool:
    try:
        _ = int(entry.get("points", 0))
        return True
    except Exception:
        return False

def _valid_entry_since(entry: dict, cutoff: datetime | None = None) -> bool:
    if not isinstance(entry, dict) or not _entry_has_points(entry):
        return False
    ts = _entry_ts(entry)
    if ts is None:
        return False
    return cutoff is None or ts >= cutoff

def _as_dual_lists(raw):
    if isinstance(raw, dict):
        return list(raw.get("normal", []) or []), list(raw.get("hc", []) or [])
    return list(raw or []), []

def _as_shame_lists(raw):
    if isinstance(raw, dict):
        return list(raw.get("recent", []) or []), list(raw.get("alltime", []) or [])
    return [], list(raw or [])

def _average_bucket(games: int = 0, points_total: int = 0, trend: str = "same") -> dict:
    games = max(0, int(games or 0))
    points_total = int(points_total or 0)
    avg = round(points_total / games, 1) if games else 0.0
    if trend not in {"up", "down", "same"}:
        trend = "same"
    return {"games": games, "points_total": points_total, "average_points": avg, "trend": trend}

def _empty_average_points() -> dict:
    return {"normal": _average_bucket(), "hc": _average_bucket()}

def _stats_with_average_points(stats: dict) -> dict:
    if not isinstance(stats, dict):
        stats = {"games_played": 0}
    stats = dict(stats)
    stats["games_played"] = int(stats.get("games_played", 0) or 0)

    avg = stats.get("average_points")
    if not isinstance(avg, dict) or not all(isinstance(avg.get(k), dict) for k in ("normal", "hc")):
        stats["average_points"] = _empty_average_points()
        return stats

    normalized = {}
    for key in ("normal", "hc"):
        bucket = avg.get(key) or {}
        normalized[key] = _average_bucket(
            bucket.get("games", 0),
            bucket.get("points_total", 0),
            bucket.get("trend", "same"),
        )
    stats["average_points"] = normalized
    return stats

@app.get("/api/leaderboard")
async def get_leaderboard():
    """API: Liefert aktuelles Leaderboard (recent + alltime) und Basis-Stats."""
    # Rohdaten lesen (neues Schema: {normal:[...], hc:[...]}, aber alte Liste weiterhin unterstützen)
    recent_raw  = _read_json_file(RECENT_FILE, {"normal": [], "hc": []})
    alltime_raw = _read_json_file(ALLTIME_FILE, {"normal": [], "hc": []})
    shame_raw   = _read_json_file(SHAME_FILE, {"recent": [], "alltime": []})
    last_raw    = _read_json_file(LAST_GAMES_FILE, [])
    stats_raw   = _read_json_file(STATS_FILE, {"games_played": 0})
    stats_f = _stats_with_average_points(stats_raw)

    # --- Cleanup "recent": nur letzte 7 Tage, sortiert, Top-10 ---
    now_utc = datetime.now(timezone.utc)
    recent_cutoff = now_utc - timedelta(days=7)
    shame_cutoff = now_utc - timedelta(days=10)

    recent_norm, recent_hc = _as_dual_lists(recent_raw)
    alltime_norm, alltime_hc = _as_dual_lists(alltime_raw)
    shame_recent, shame_alltime = _as_shame_lists(shame_raw)

    def process_recent(lst):
        out = [e for e in (lst or []) if _valid_entry_since(e, recent_cutoff)]
        out.sort(key=lambda x: int(x.get("points", 0)), reverse=True)
        return out[:10]

    def process_shame_recent(lst):
        out = [e for e in (lst or []) if _valid_entry_since(e, shame_cutoff) and not bool(e.get("hardcore"))]
        out.sort(key=lambda x: int(x.get("points", 0)))
        return out[:10]

    def process_shame_alltime(lst):
        out = [e for e in (lst or []) if _valid_entry_since(e) and not bool(e.get("hardcore"))]
        out.sort(key=lambda x: int(x.get("points", 0)))
        return out[:10]

    def process_last_games(lst):
        out = [e for e in (lst or []) if _valid_entry_since(e)]
        out.sort(key=lambda x: _entry_ts(x) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return out[:10]

    recent_norm_f = process_recent(recent_norm)
    recent_hc_f   = process_recent(recent_hc)
    shame_recent_f = process_shame_recent(shame_recent)
    shame_alltime_f = process_shame_alltime(shame_alltime)
    last_games_f = process_last_games(last_raw if isinstance(last_raw, list) else [])

    # Optional: Datei aktualisieren, falls sich etwas geändert hat (idempotent)
    _write_json_if_changed(RECENT_FILE, recent_raw or {}, {"normal": recent_norm_f, "hc": recent_hc_f})

    # Alltime: falls Legacy-Format, jetzt in Bucket-Format persistieren (Migration)
    _write_json_if_changed(ALLTIME_FILE, alltime_raw or {}, {"normal": alltime_norm, "hc": alltime_hc})
    _write_json_if_changed(SHAME_FILE, shame_raw or {}, {"recent": shame_recent_f, "alltime": shame_alltime_f})
    _write_json_if_changed(LAST_GAMES_FILE, last_raw or [], last_games_f)
    _write_json_if_changed(STATS_FILE, stats_raw or {}, stats_f)

    return {
        "recent": {"normal": recent_norm_f, "hc": recent_hc_f},
        "alltime": {"normal": alltime_norm or [], "hc": alltime_hc or []},
        "shame": {"recent": shame_recent_f, "alltime": shame_alltime_f},
        "last_games": last_games_f,
        "stats": stats_f
    }

@app.get("/api/leaderboard/game/{game_id}")
@app.get("/api/game_from_leaderboard/{game_id}")
def api_game_from_leaderboard(game_id: str):
    """API: Read-Only Snapshot eines abgeschlossenen Spiels aus Leaderboard-Dateien."""
    # Laden der Dateien (recent/alltime) – unterstützt altes (Liste) und neues (Bucket) Format
    def _read_list(path: Path):
        try:
            if not path.exists():
                return []
            data = json.loads(path.read_text(encoding="utf-8"))
            # neu: {"normal": [...], "hc": [...]} ⇒ beide Buckets zusammenführen
            if isinstance(data, dict):
                out = []
                for k in ("normal", "hc", "recent", "alltime", "games"):
                    arr = data.get(k)
                    if isinstance(arr, list):
                        out.extend(arr)
                return out
            # legacy: direkte Liste
            if isinstance(data, list):
                return data
        except Exception:
            return []
        return []

    def _project(entry: dict) -> dict | None:
        # Muss zur game_id passen und Snapshot-Felder enthalten
        if not isinstance(entry, dict):
            return None
        if str(entry.get("game_id", "")) != str(game_id):
            return None
        players = entry.get("players")
        scoreboards = entry.get("scoreboards")
        if not players or not isinstance(players, list):
            return None
        if not scoreboards or not isinstance(scoreboards, dict):
            return None
        # Response minimal & stabil halten
        return {
            "game_id": entry.get("game_id"),
            "gamename": entry.get("gamename") or entry.get("name") or "",
            "finished_at": entry.get("finished_at") or entry.get("ts"),
            "mode": entry.get("mode"),
            "hardcore": bool(entry.get("hardcore", False)),
            "players": players,
            "scoreboards": scoreboards,
        }

    # Reihenfolge: Top-Listen zuerst, danach Zusatzlisten mit eigenen Dateien.
    for path in (RECENT_FILE, ALLTIME_FILE, SHAME_FILE, LAST_GAMES_FILE):
        entries = _read_list(path)
        for e in entries:
            proj = _project(e)
            if proj is not None:
                return proj

    # Nicht gefunden oder Eintrag ohne Snapshot-Felder
    raise HTTPException(status_code=404, detail="not_found")

@app.post("/api/games")
async def api_games_create(req: CreateReq):
    """API: Neues Spiel anlegen (Name, Modus, optional Passphrase)."""
    gid = str(uuid.uuid4())[:8]
    g = new_game(gid, req.name, req.mode)
    g["_passphrase"] = (req.passphrase or None)
    g["_hardcore"] = bool(req.hardcore or False)
    return {"game_id": gid}

# Legacy-Endpoints
@app.get("/games")
async def legacy_list():
    """Legacy-Endpoint: einfache Spielauflistung (Kompatibilität)."""
    return game_list_payload()

@app.post("/create_game")
async def legacy_create_game(mode: str, name: str, passphrase: str = ""):
    """Legacy-Endpoint: Spiel anlegen (URL-Schema alt, mit pass-Query)."""
    gid = str(uuid.uuid4())[:8]
    g = new_game(gid, name, mode)
    g["_passphrase"] = (passphrase or None)
    return {"id": gid}

# Brave/Chromium DevTools Ping unterdrücken
@app.get("/.well-known/appspecific/com.chrome.devtools")
async def chrome_devtools_placeholder():
    """Unterdrückt DevTools-WS-Probes von Chrome/Brave mit einfacher 200-Response."""
    return {"ok": True}

# -----------------------------
# Leaderboard/Stats Hilfsfunktionen
# -----------------------------
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
        field_key = WRITABLE_MAP.get(r)
        if not field_key:
            continue
        target = rows[1 if col == "down" else 2 if col == "free" else 3 if col == "up" else 4]
        target.setdefault(field_key, int(v))
    return rows

def _compute_final_totals(g: GameDict) -> Dict[str,int]:
    """Berechnet die Endpunktzahlen für ein Spiel.

    Args:
        g (GameDict): Spielzustand

    Returns:
        Dict[str,int]: Endpunktzahlen als Dictionary
    """
    totals: Dict[str,int] = {}
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
            out.append({
                "id": tid,
                "name": team.get("name", f"Team {tid}"),
                "members": members,
                "filled": min(len(board), WRITABLE_CELLS_PER_PLAYER),
                "of": WRITABLE_CELLS_PER_PLAYER,
                "points": int(totals.get(tid, 0)),
            })
        return out

    out = []
    for p in g.get("_players", []):
        pid = p.get("id")
        board = g.get("_scoreboards", {}).get(pid, {}) or {}
        out.append({
            "id": pid,
            "name": p.get("name", "Player"),
            "members": [],
            "filled": min(len(board), WRITABLE_CELLS_PER_PLAYER),
            "of": WRITABLE_CELLS_PER_PLAYER,
            "points": int(totals.get(pid, 0)),
        })
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
        # beide Teams müssen voll sein (48 Einträge je Team)
        return all(len(boards.get(team_id, {})) >= WRITABLE_CELLS_PER_PLAYER for team_id in ("A","B"))
    # Einzel/3P: jeder Spieler voll
    for p in g["_players"]:
        pid = p["id"]
        if WRITABLE_CELLS_PER_PLAYER - len(g["_scoreboards"].get(pid, {})) != 0:
            return False
    return True

def _append_json(path: Path, mutate_fn):
    """Fügt Daten zu einer JSON-Datei hinzu.

    Args:
        path (Path): Pfad zur JSON-Datei
        mutate_fn: Funktion, die die Daten modifiziert
    """
    data = []
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            data = []
    new_data = mutate_fn(data)
    path.write_text(json.dumps(new_data, ensure_ascii=False, indent=2), encoding="utf-8")

def _mutate_stats(incr_games=False, *, average_points: int | None = None, hardcore: bool = False):
    """Aktualisiert die Statistik-Daten.

    Args:
        incr_games (bool): Ob die Anzahl der Spiele inkrementiert werden soll
    """
    stats = {"games_played": 0}
    if STATS_FILE.exists():
        try:
            stats = json.loads(STATS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    stats = _stats_with_average_points(stats)
    if incr_games:
        stats["games_played"] = int(stats.get("games_played", 0)) + 1
    if average_points is not None:
        bucket_key = "hc" if hardcore else "normal"
        bucket = stats.setdefault("average_points", _empty_average_points()).get(bucket_key, {})
        previous_average = float(bucket.get("average_points", 0) or 0)
        games_count = int(bucket.get("games", 0) or 0) + 1
        points_total = int(bucket.get("points_total", 0) or 0) + int(average_points)
        updated_bucket = _average_bucket(games_count, points_total)
        new_average = float(updated_bucket["average_points"])
        if new_average > previous_average:
            updated_bucket["trend"] = "up"
        elif new_average < previous_average:
            updated_bucket["trend"] = "down"
        else:
            updated_bucket["trend"] = "same"
        stats["average_points"][bucket_key] = updated_bucket
    STATS_FILE.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")

def _build_leaderboard_snapshot_fields(g: GameDict) -> dict:
    """Liefert die Zusatzfelder für den Leaderboard-Eintrag.

    Args:
        g (GameDict): Spielzustand

    Returns:
        dict: Zusatzfelder als Dictionary
    """
    try:
        finished_at = datetime.now(timezone.utc).isoformat()
        mode = str(g.get("_mode", "")).lower()

        # players array (immer Spieler – bei 2v2 inkl. team)
        players = []
        team_of = g.get("_team_of", {}) if is_team_mode(g) else {}
        for p in g.get("_players", []):
            pid = p.get("id")
            players.append({
                "id": pid,
                "name": p.get("name", "Player"),
                "team": (team_of.get(pid) if is_team_mode(g) else None)
            })

        scoreboards: dict[str, dict] = {}

        if is_team_mode(g):
            # 2v2: Boards pro Team
            boards_by_team = g.get("_scoreboards_by_team", {}) or {}
            for tid, sb in boards_by_team.items():
                reihen_dict = _rows_from_scoreboard(sb)  # {1:{...},2:{...},3:{...},4:{...}}
                # Reihen sauber in Arrayform bringen (immer 1..4; fehlende leere Dicts)
                reihen = []
                for idx in (1, 2, 3, 4):
                    rows_map = reihen_dict.get(idx, {}) or {}
                    # Nur die echten Schreibfelder exportieren (robust gegen Fremdkeys)
                    clean_rows = {k: int(v) for k, v in rows_map.items()
                                  if k in {"1","2","3","4","5","6","max","min","kenter","full","poker","60"}
                                  and isinstance(v, (int, float))}
                    reihen.append({"index": idx, "rows": clean_rows})
                scoreboards[str(tid)] = {"reihen": reihen}
        else:
            # Einzel/3P: Boards pro Spieler
            for p in g.get("_players", []):
                pid = p.get("id")
                sb = g.get("_scoreboards", {}).get(pid, {}) or {}
                reihen_dict = _rows_from_scoreboard(sb)
                reihen = []
                for idx in (1, 2, 3, 4):
                    rows_map = reihen_dict.get(idx, {}) or {}
                    clean_rows = {k: int(v) for k, v in rows_map.items()
                                  if k in {"1","2","3","4","5","6","max","min","kenter","full","poker","60"}
                                  and isinstance(v, (int, float))}
                    reihen.append({"index": idx, "rows": clean_rows})
                scoreboards[str(pid)] = {"reihen": reihen}

        return {
            "game_id": str(g.get("_id") or ""),
            "finished_at": finished_at,
            "mode": mode,
            "hardcore": bool(g.get("_hardcore", False)),
            "players": players,
            "scoreboards": scoreboards
        }
    except Exception:
        # Defensive: falls beim Snapshot etwas schiefgeht, Eintrag nicht blockieren
        return {
            "game_id": str(g.get("_id") or ""),
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "mode": str(g.get("_mode", "")).lower(),
            "players": [],
            "scoreboards": {}
        }

def _finalize_and_log_results(g: GameDict):
    """Finalisiert und loggt die Ergebnisse eines Spiels.

    Args:
        g (GameDict): Spielzustand
    """
    totals = _compute_final_totals(g)
    mode = str(g["_mode"]).lower()
    players = g["_players"]

    def _name(pid):
        for pp in players:
            if pp["id"] == pid:
                return pp.get("name", "Player")
        return "Player"

    entry_time = datetime.now(timezone.utc).isoformat()
    game_name = g["_name"]
    snapshot_fields = _build_leaderboard_snapshot_fields(g)

    entries_for_recent = []
    entries_for_alltime = []
    entries_for_shame = []
    entries_for_last_games = []
    winner_points_for_average = 0

    if mode == "2v2":
        teams = g.get("_teams", {})
        mA = teams.get("A", {}).get("members", []) or []
        mB = teams.get("B", {}).get("members", []) or []

        # Teamtotale aus Team-Boards holen (keys: "A","B")
        teamA_total = int(totals.get("A", 0))
        teamB_total = int(totals.get("B", 0))
        winner_team = "A" if teamA_total >= teamB_total else "B"
        wt_total = teamA_total if winner_team == "A" else teamB_total
        lt_total = teamB_total if winner_team == "A" else teamA_total
        diff = wt_total - lt_total
        winner_points_for_average = wt_total

        def _name(pid):
            for pp in players:
                if pp["id"] == pid:
                    return pp.get("name", "Player")
            return str(pid)

        winners = ", ".join(_name(pid) for pid in (mA if winner_team == "A" else mB))
        losers  = ", ".join(_name(pid) for pid in (mB if winner_team == "A" else mA))
        rec = {
            "ts": entry_time,
            "points": wt_total,
            "name": winners,
            "gamename": game_name,
            "opponent": losers,
            "opp_points": lt_total,
            "diff": diff
        }
        # Snapshot-Felder direkt an den Eintrag hängen
        rec.update(snapshot_fields)

        shame_rec = {
            "ts": entry_time,
            "points": lt_total,
            "name": losers,
            "gamename": game_name,
            "opponent": winners,
            "opp_points": wt_total,
            "diff": diff
        }
        shame_rec.update(snapshot_fields)

        entries_for_recent.append(rec)
        entries_for_alltime.append(dict(rec))  # eigene Kopie
        entries_for_shame.append(shame_rec)
        entries_for_last_games.append(dict(rec))
    else:
        ordered = sorted(players, key=lambda p: totals.get(p["id"], 0), reverse=True)
        if not ordered:
            return
        winner = ordered[0]
        winner_pts = totals.get(winner["id"], 0)
        winner_points_for_average = int(winner_pts)
        if len(ordered) >= 2:
            second = ordered[1]
            opp_name = second["name"]
            opp_pts = totals.get(second["id"], 0)
            diff = winner_pts - opp_pts
        else:
            opp_name = "-"
            opp_pts = 0
            diff = winner_pts
        worst = ordered[-1]
        worst_pts = totals.get(worst["id"], 0)
        shame_opp_name = winner["name"] if len(ordered) >= 2 else "-"
        shame_opp_pts = winner_pts if len(ordered) >= 2 else 0
        shame_diff = shame_opp_pts - worst_pts if len(ordered) >= 2 else worst_pts
        rec = {
            "ts": entry_time,
            "points": winner_pts,
            "name": winner["name"],
            "gamename": game_name,
            "opponent": opp_name,
            "opp_points": opp_pts,
            "diff": diff
        }
        # Snapshot-Felder direkt an den Eintrag hängen
        rec.update(snapshot_fields)

        shame_rec = {
            "ts": entry_time,
            "points": worst_pts,
            "name": worst["name"],
            "gamename": game_name,
            "opponent": shame_opp_name,
            "opp_points": shame_opp_pts,
            "diff": shame_diff
        }
        shame_rec.update(snapshot_fields)

        entries_for_recent.append(rec)
        entries_for_alltime.append(dict(rec))  # eigene Kopie
        entries_for_shame.append(shame_rec)
        entries_for_last_games.append(dict(rec))

    # Einträge dem passenden Bucket (normal/hc) zuordnen
    is_hc = bool(g.get("_hardcore", False))

    def mutate_recent(data):
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        # Daten zu dualer Struktur wandeln
        if not isinstance(data, dict):
            data = {"normal": list(data or []), "hc": []}
        for k in ("normal", "hc"):
            if not isinstance(data.get(k), list):
                data[k] = []
        bucket = "hc" if is_hc else "normal"
        # alte behalten (nur innerhalb der letzten 7 Tage)
        def keep_recent(lst):
            kept = []
            for x in (lst or []):
                try:
                    ts = datetime.fromisoformat(x.get("ts"))
                except Exception:
                    continue
                if ts >= cutoff:
                    kept.append(x)
            return kept
        data[bucket] = keep_recent(data[bucket]) + entries_for_recent
        # sortieren & cap 10
        data[bucket].sort(key=lambda x: int(x.get("points", 0)), reverse=True)
        data[bucket] = data[bucket][:10]
        return data

    def mutate_alltime(data):
        if not isinstance(data, dict):
            data = {"normal": list(data or []), "hc": []}
        for k in ("normal", "hc"):
            if not isinstance(data.get(k), list):
                data[k] = []
        bucket = "hc" if is_hc else "normal"
        data[bucket] = (list(data[bucket]) + entries_for_alltime)
        data[bucket].sort(key=lambda x: int(x.get("points", 0)), reverse=True)
        data[bucket] = data[bucket][:10]
        return data

    def mutate_shame(data):
        if not isinstance(data, dict):
            data = {"recent": [], "alltime": list(data or [])}
        for k in ("recent", "alltime"):
            if not isinstance(data.get(k), list):
                data[k] = []
        if is_hc:
            return data

        cutoff = datetime.now(timezone.utc) - timedelta(days=10)
        kept_recent = [x for x in data["recent"] if _valid_entry_since(x, cutoff) and not bool(x.get("hardcore"))]
        data["recent"] = kept_recent + entries_for_shame
        data["recent"].sort(key=lambda x: int(x.get("points", 0)))
        data["recent"] = data["recent"][:10]

        data["alltime"] = [x for x in data["alltime"] if _valid_entry_since(x) and not bool(x.get("hardcore"))]
        data["alltime"] = data["alltime"] + entries_for_shame
        data["alltime"].sort(key=lambda x: int(x.get("points", 0)))
        data["alltime"] = data["alltime"][:10]
        return data

    def mutate_last_games(data):
        if not isinstance(data, list):
            data = []
        data = [x for x in data if _valid_entry_since(x)] + entries_for_last_games
        data.sort(key=lambda x: _entry_ts(x) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return data[:10]

    _append_json(RECENT_FILE, mutate_recent)
    _append_json(ALLTIME_FILE, mutate_alltime)
    if not is_hc:
        _append_json(SHAME_FILE, mutate_shame)
    _append_json(LAST_GAMES_FILE, mutate_last_games)
    _mutate_stats(
        incr_games=True,
        average_points=winner_points_for_average,
        hardcore=is_hc,
    )

def _compute_results_for_snapshot(g: GameDict):
    """Berechnet die Ergebnisse für den Snapshot eines Spiels.

    Args:
        g (GameDict): Spielzustand

    Returns:
        list[dict]: Ergebnisse als Liste von Dictionaries
    """
    totals = _compute_final_totals(g)
    res = []
    if is_team_mode(g):
        # Teams im Snapshot anzeigen
        for tid in ("A","B"):
            res.append({"player": g.get("_teams", {}).get(tid, {}).get("name", f"Team {tid}"),
                        "total": int(totals.get(tid, 0))})
        res.sort(key=lambda x: x["total"], reverse=True)
        return res
    # Einzel/3P
    for p in g["_players"]:
        pid = p["id"]
        res.append({"player": p.get("name", "Player"), "total": int(totals.get(pid, 0))})
    res.sort(key=lambda x: x["total"], reverse=True)
    return res

# -----------------------------
# WebSocket
# -----------------------------
@app.websocket("/ws/{game_id}")
async def ws_game(websocket: WebSocket, game_id: str):
    await websocket.accept()
    if game_id not in games:
        await _close_ws_with_error(websocket, "Game nicht gefunden", fatal=True, code=1000)
        return

    g = games[game_id]
    player_id: str | None = None
    spectator_id: str | None = None   # NEU
    is_spectator: bool = False        # NEU

    # Direkt initialen Snapshot senden
    await websocket.send_json({"scoreboard": snapshot(g)})

    try:
        while True:
            data = await websocket.receive_json()
            act = data.get("action")

            # Vor jeder Aktion Timeout prüfen
            if check_timeout_and_abort(g):
                await broadcast(g, {"scoreboard": snapshot(g)})
                continue

            # Zuschauer dürfen nur passive Aktionen senden.
            if is_spectator and act not in {"send_emoji", "chat_message", "rejoin_game"}:
                await websocket.send_json({"error": "Nur fuer Spieler"})
                continue

            if act == "join_game":
                # Passphrase validieren (falls gesetzt) – bei Fehler Socket sofort schließen
                if not _passphrase_matches(g, data):
                    await _close_ws_with_error(websocket, "Falsche Passphrase")
                    break

                blocked_reason = _join_block_reason(g)
                if blocked_reason:
                    await _close_ws_with_error(websocket, blocked_reason, fatal=True)
                    break

                player_id = str(uuid.uuid4())[:6]
                player = {"id": player_id, "name": data.get("name") or "Gast", "ws": websocket}
                g["_players"].append(player)
                g["_scoreboards"][player_id] = {}
                # 2v2: Spieler dem Team zuordnen (1&3 -> A, 2&4 -> B)
                if is_team_mode(g):
                    assign_team_for_join(g, player_id)
                if len(g["_players"]) == g["_expected"] and not g["_started"]:
                    g["_started"] = True
                    g["_started_at"] = datetime.now(timezone.utc).isoformat()
                    g["_turn"] = {"player_id": g["_players"][0]["id"], "roll_index": 0, "first4oak_roll": None}
                    _set_roll_cap_for_current_turn(g)

                await websocket.send_json({"player_id": player_id})
                touch(g)
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "spectate_game":
                # Passphrase pruefen (gleiches Verhalten wie bei join_game)
                if not _passphrase_matches(g, data):
                    await _close_ws_with_error(websocket, "Falsche Passphrase")
                    break

                # Spectator registrieren (zaehlt nicht als Spieler)
                spectator_id = str(uuid.uuid4())[:6]
                is_spectator = True
                spec = {"id": spectator_id, "name": data.get("name") or "Gast", "ws": websocket}
                g.setdefault("_spectators", []).append(spec)

                # Spectator-Antwort + Info an Spieler
                await websocket.send_json({"spectator_id": spectator_id, "spectator": True})
                touch(g)
                try:
                    await broadcast(g, {"spectator": {"event": "joined", "name": spec["name"]}})
                except Exception:
                    pass
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "rejoin_game":
                player_id = data.get("player_id")
                for p in g.get("_players", []):
                    if p.get("id") == player_id:
                        p["ws"] = websocket
                        break
                await websocket.send_json({"player_id": player_id})
                touch(g)
                await websocket.send_json({"scoreboard": snapshot(g)})

            elif act == "set_hold":
                if not g["_turn"] or g["_turn"]["player_id"] != player_id:
                    await websocket.send_json({"error": "Nicht an der Reihe"})
                    continue
                if g["_correction"]["active"]:
                    await websocket.send_json({"error": "Während Korrektur nicht erlaubt"})
                    continue
                g["_holds"] = list(data.get("holds", [False] * 5))[:5]
                touch(g)
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "roll_dice":
                ok, why = can_roll_now(g, player_id)
                if not ok:
                    await websocket.send_json({"error": why})
                    continue
                # Server-Cooldown: Double-Click-/Spam-Guard (standard 600 ms)
                # Schluckt zu schnelle Folgerolls laut monotonic()-Timer pro Spieler.
                if not roll_cooldown_ok(g, player_id, cooldown_s=0.6):
                    # optional: leise ignorieren; UX bleibt smooth
                    continue
                apply_roll(g)

                touch(g)
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "announce_row4":
                # Hardcore: keine Ansage – ❗ verhält sich wie Freireihe
                if bool(g.get("_hardcore")):
                    await websocket.send_json({"error": "Ansage ist im Hardcore-Modus deaktiviert"})
                    continue
                # nur direkt nach Wurf 1; Änderung erlaubt (Um-Ansage)
                if not (g["_turn"] and g["_turn"]["player_id"] == player_id):
                    await websocket.send_json({"error": "Nicht an der Reihe"})
                    continue
                if g["_correction"]["active"]:
                    await websocket.send_json({"error": "Während Korrektur nicht erlaubt"})
                    continue
                if g["_rolls_used"] != 1:
                    await websocket.send_json({"error": "Ansage (oder Änderung) nur direkt nach Wurf 1"})
                    continue

                field = data.get("field")
                if field not in WRITABLE_FIELDS:
                    await websocket.send_json({"error": "Ungültiges Ansage-Feld"})
                    continue

                # Feld in ❗ schon befüllt?
                row_for_field = KEY_TO_ROW.get(field)
                # prüfen gegen Zielboard (Team/Spieler)
                board = _board_for_actor(g, player_id)
                if row_for_field is not None and f"{row_for_field},ang" in board:
                    await websocket.send_json({"error": f"Ansage nicht möglich: Feld {field} in ❗ bereits befüllt"})
                    continue

                g["_announced_row4"] = field
                g["_announced_by"] = player_id
                g["_announced_board"] = board_key_for_actor(g, player_id) if is_team_mode(g) else player_id
                touch(g)
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "unannounce_row4":
                # Hardcore: keine Ansage – ❗ verhält sich wie Freireihe
                if bool(g.get("_hardcore")):
                    await websocket.send_json({"error": "Ansage ist im Hardcore-Modus deaktiviert"})
                    continue
                # Ansage im ersten Wurf zurückziehen
                if not (g["_turn"] and g["_turn"]["player_id"] == player_id):
                    await websocket.send_json({"error": "Nicht an der Reihe"})
                    continue
                if g["_correction"]["active"]:
                    await websocket.send_json({"error": "Während Korrektur nicht erlaubt"})
                    continue
                # Nur direkt nach Wurf 1
                if g.get("_rolls_used", 0) != 1:
                    await websocket.send_json({"error": "Ansage nur direkt nach Wurf 1 zurückziehbar"})
                    continue
                if not g.get("_announced_row4"):
                    await websocket.send_json({"error": "Keine Ansage aktiv"})
                    continue

                g["_announced_row4"] = None
                g["_announced_by"] = None
                g["_announced_board"] = None
                touch(g)
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "write_field":
                if not (g["_turn"] and g["_turn"]["player_id"] == player_id):
                    await websocket.send_json({"error": "Nicht an der Reihe"})
                    continue
                if g["_correction"]["active"]:
                    await websocket.send_json({"error": "Während Korrektur nicht erlaubt"})
                    continue

                try:
                    row, col, fld = _parse_write_target(data)
                except ValueError as exc:
                    await websocket.send_json({"error": str(exc)})
                    continue
                strike = bool(data.get("strike"))

                ok, why = can_write_now(g, player_id, row, col, during_turn_announce=g["_announced_row4"])
                if not ok:
                    await websocket.send_json({"error": why})
                    continue

                key = f"{row},{col}"
                # Ziel-Board...
                board = _ensure_board_for_actor(g, player_id)

                if key in board:
                    await websocket.send_json({"error": "Dieses Feld ist bereits befüllt"})
                    continue

                if fld == "poker":
                    # Punkte-Logik:
                    # ⬇︎／／⬆︎: nur im Wurf des ersten Vierlings ODER bei 5 gleichen
                    # ❗+Ansage "poker": in jedem Wurf mit 4/5 gleichen
                    cur = g.get("_turn", {}) or {}
                    allowed_points = poker_points_allowed(
                        g.get("_dice") or [0, 0, 0, 0, 0],
                        col,
                        roll_index=int(cur.get("roll_index", 0) or 0),
                        first4oak_roll=cur.get("first4oak_roll"),
                        announced_poker=(g.get("_announced_row4") == "poker"),
                    )

                    # Wenn Punkte möglich wären, sie aber laut Regel jetzt nicht erlaubt sind,
                    # wird stillschweigend gestrichen (0 geschrieben).
                    prospective = score_field_value("poker", g.get("_dice") or [0, 0, 0, 0, 0])
                    if prospective > 0 and not allowed_points:
                        # Nach dem Zocken sind Poker-Punkte nicht zulässig; stilles Streichen (0) erlauben.
                        strike = True
                        # Kein continue; unten wird wegen strike = True der Wert 0 geschrieben.

                    # (keine weitere ❗-Sonderbehandlung hier; ob ❗ überhaupt beschreibbar ist,
                    #  entscheidet bereits can_write_now(...).)

                value = 0 if strike else score_field_value(fld, g["_dice"] or [0, 0, 0, 0, 0])
                board[key] = value

                g["_last_write"][player_id] = (row, col, g["_rolls_used"])
                g["_last_dice"][player_id] = (g["_dice"] or [0, 0, 0, 0, 0])[:]
                cur = g.get("_turn", {}) or {}
                g["_last_meta"][player_id] = {
                    "announced": g["_announced_row4"],
                    "roll_index": int(cur.get("roll_index", 0) or 0),
                    "first4oak_roll": cur.get("first4oak_roll"),
                }
                _begin_next_turn(g, player_id)
                # Spielende?
                if _is_game_finished(g):
                    g["_started"] = False
                    g["_finished"] = True
                    _finalize_and_log_results(g)

                touch(g)
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "request_correction":
                # Hardcore: Korrektur generell deaktiviert
                if bool(g.get("_hardcore")):
                    await websocket.send_json({"error": "Korrekturmodus ist im Hardcore-Modus deaktiviert"})
                    continue
                # 1P-Modus: Korrektur deaktiviert
                if int(g.get("_expected", 0) or 0) == 1:
                    await websocket.send_json({"error": "Korrekturmodus ist im 1‑Spieler‑Modus deaktiviert"})
                    continue
                if g["_correction"]["active"]:
                    continue
                if player_id not in g["_last_write"]:
                    await websocket.send_json({"error": "Kein letzter Eintrag vorhanden"})
                    continue
                meta = g.get("_last_meta", {}).get(player_id, {})
                if meta.get("announced"):
                    await websocket.send_json({"error": "Korrektur nicht erlaubt (Ansage-Zug)"})
                    continue

                is_single = (not is_team_mode(g)) and int(g.get("_expected", 0) or 0) == 1

                if not g.get("_turn"):
                    await websocket.send_json({"error": "Korrektur nur direkt nach deinem Zug"})
                    continue
                if (g["_turn"]["player_id"] == player_id) and (not is_single):
                    await websocket.send_json({"error": "Korrektur nur direkt nach deinem Zug"})
                    continue

                if g.get("_rolls_used", 0) > 0:
                    await websocket.send_json({"error": "Korrektur nicht möglich: Es wurde bereits weiter gewürfelt"})
                    continue

                last_dice = g["_last_dice"].get(player_id, [])
                if not last_dice:
                    await websocket.send_json({"error": "Kein letzter Wurf vorhanden"})
                    continue

                meta = g["_last_meta"].get(player_id, {}) if isinstance(g.get("_last_meta"), dict) else {}
                g["_correction"] = {
                    "active": True,
                    "player_id": player_id,
                    "dice": last_dice[:],
                    "roll_index": int(meta.get("roll_index", 0) or 0),
                    "first4oak_roll": meta.get("first4oak_roll"),
                }
                g["_dice"] = last_dice[:]
                touch(g)
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "cancel_correction":
                if bool(g.get("_hardcore")):
                    await websocket.send_json({"error": "Korrekturmodus ist im Hardcore-Modus deaktiviert"})
                    continue
                if int(g.get("_expected", 0) or 0) == 1:
                    await websocket.send_json({"error": "Korrekturmodus ist im 1‑Spieler‑Modus deaktiviert"})
                    continue
                _clear_correction(g)
                touch(g)
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "write_field_correction":
                if bool(g.get("_hardcore")):
                    await websocket.send_json({"error": "Korrekturmodus ist im Hardcore-Modus deaktiviert"})
                    continue
                if int(g.get("_expected", 0) or 0) == 1:
                    await websocket.send_json({"error": "Korrekturmodus ist im 1‑Spieler‑Modus deaktiviert"})
                    continue
                # --- Preconditions ---
                corr = g["_correction"]
                if not corr.get("active") or corr.get("player_id") != player_id:
                    await websocket.send_json({"error": "Keine Korrektur aktiv"})
                    continue

                try:
                    row, col, fld = _parse_write_target(data)
                except ValueError as exc:
                    await websocket.send_json({"error": str(exc)})
                    continue
                strike = bool(data.get("strike"))

                # Es darf nur der letzte Eintrag dieses Spielers korrigiert werden
                last = g["_last_write"].get(player_id)
                if not last:
                    await websocket.send_json({"error": "Kein letzter Eintrag vorhanden"})
                    continue
                old_row, old_col, old_rolls_used = last

                # Würfel für die Neubewertung sind die gemerkten Korrekturwürfel
                dice_for_eval = (corr.get("dice") or g.get("_dice") or [0, 0, 0, 0, 0])[:]

                # --- Zielboard (Team/Spieler) bestimmen ---
                new_board = _ensure_board_for_actor(g, player_id)

                old_key = f"{old_row},{old_col}"
                new_key = f"{row},{col}"
                board_after_removing_old = dict(new_board)
                board_after_removing_old.pop(old_key, None)

                # --- Reihenfolge-Checks wie im normalen Modus (nur für down/up) ---
                # Sonderfall: Wenn der Spieler im Korrekturmodus im *gleichen* Feld bleibt,
                # darf er das auch dann, wenn 'next_row' streng genommen anders wäre.
                if col in {"down", "up"}:
                    filled = _filled_rows_in_board(board_after_removing_old, col)
                    next_row = _next_required_row(col, filled)
                    if next_row is None:
                        await websocket.send_json({"error": "Reihe bereits voll"})
                        continue
                    if row != next_row and not (row == old_row and col == old_col):
                        await websocket.send_json({"error": f"In dieser Reihe ist als Nächstes Zeile {next_row} erlaubt"})
                        continue
                if new_key in board_after_removing_old:
                    await websocket.send_json({"error": "Ziel-Feld bereits befüllt"})
                    continue

                # Punkte neu berechnen und schreiben
                # --- Poker-Regel auch in Korrektur ---
                if fld == "poker":
                    # Bewertung in der Korrektur basiert auf den GEMERKTEN Würfeln *und*
                    # den beim ursprünglichen Zug gemerkten Meta-Werten (roll_index/first4oak_roll).
                    dice_now = dice_for_eval[:]
                    prospective = score_field_value("poker", dice_now)

                    if prospective > 0:
                        allowed_points = poker_points_allowed(
                            dice_now,
                            col,
                            roll_index=int((g.get("_correction") or {}).get("roll_index", 0) or 0),
                            first4oak_roll=(g.get("_correction") or {}).get("first4oak_roll"),
                            announced_poker=(g.get("_announced_row4") == "poker"),
                            correction=True,
                        )

                        if not allowed_points:
                            # Korrektur: Nach dem Zocken sind Poker-Punkte nicht zulässig; stilles Streichen (0) erlauben.
                            strike = True
                            # Kein continue; unten wird wegen strike = True der Wert 0 geschrieben.

                val = 0 if strike else score_field_value(fld, dice_for_eval)
                new_board.pop(old_key, None)
                new_board[new_key] = val
                g["_last_write"][player_id] = (row, col, old_rolls_used)

                # Korrektur beenden, Würfel zurücksetzen und broadcasten
                _clear_correction(g)
                touch(g)
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "send_emoji":
                # Quick-Reaction-Emoji an alle senden (ephemer, keine Persistenz)
                emoji = str(data.get("emoji") or "").strip()
                if not emoji:
                    await websocket.send_json({"error": "Kein Emoji"})
                    continue

                if player_id:
                    sender_name = next((p.get("name", "Gast") for p in g.get("_players", []) if p.get("id") == player_id), "Gast")
                    from_id = player_id
                elif spectator_id:
                    sender_name = next((s.get("name", "Gast") for s in g.get("_spectators", []) if s.get("id") == spectator_id), "Gast")
                    from_id = f"S-{spectator_id}"
                else:
                    await websocket.send_json({"error": "Nicht beigetreten"})
                    continue

                payload = {
                    "emoji": {
                        "from_id": from_id,
                        "from": sender_name,
                        "emoji": emoji,
                        "ts": datetime.now(timezone.utc).isoformat()
                    }
                }
                touch(g)
                await broadcast(g, payload)

            elif act == "chat_message":
                # Einfache Chat-Weiterleitung an alle
                txt = str(data.get("text") or "").strip()
                if not txt:
                    continue
                # Absendername auflösen
                if player_id:
                    sender = next((p.get("name", "Player") for p in g.get("_players", []) if p.get("id") == player_id), "Player")
                    from_id = player_id
                elif spectator_id:
                    sender = next((s.get("name", "Zuschauer") for s in g.get("_spectators", []) if s.get("id") == spectator_id), "Zuschauer")
                    from_id = f"S-{spectator_id}"
                else:
                    sender = "Player"
                    from_id = None
                # Sanfte Längenbegrenzung
                if len(txt) > 400:
                    txt = txt[:400]
                # Broadcast ohne Persistenz
                await broadcast(g, {
                    "chat": {
                        "from_id": from_id,
                        "sender": sender,
                        "text": txt,
                        "ts": datetime.now(timezone.utc).isoformat(),
                    }
                })
                touch(g)

            elif act == "end_game":
                # Optional: Initiator-Name aus Payload oder aus Registry ableiten
                by_name = (data.get("by") or "").strip()
                if not by_name:
                    try:
                        by_name = next(
                            (p.get("name", "Player") for p in g.get("_players", []) if p.get("id") == player_id),
                            "") or "Player"
                    except Exception:
                        by_name = "Player"
                # Zuerst eine Notice an alle, dann Snapshot mit Abbruchstatus
                try:
                    await broadcast(g, {"notice": {"type": "ended", "by": by_name}})
                except Exception:
                    pass
                # Spiel als abgebrochen markieren (kein Leaderboard-Eintrag, kein Completed-Game)
                g["_aborted"] = True
                g["_results"] = None
                g["_started"] = False
                g["_finished"] = True  # clientseitig für sauberes Beenden/Redirect
                touch(g)
                await broadcast(g, {"scoreboard": snapshot(g)})

            else:
                await websocket.send_json({"error": f"Unbekannte Aktion: {act}"})

    except WebSocketDisconnect:
        # Verbindung trennt: WS-Referenz entfernen (Rejoin moeglich)
        if game_id in games:
            g = games[game_id]
            correction_cancelled = False
            if player_id:
                for p in g.get("_players", []):
                    if p.get("id") == player_id:
                        p["ws"] = None
                        break
                if (
                    g.get("_correction", {}).get("active")
                    and g.get("_correction", {}).get("player_id") == player_id
                ):
                    _clear_correction(g)
                    touch(g)
                    correction_cancelled = True
            elif spectator_id:
                # Zuschauer austragen und allen Bescheid geben
                specs = g.get("_spectators", [])
                left_name = None
                for i, s in enumerate(list(specs)):
                    if s.get("id") == spectator_id:
                        left_name = s.get("name")
                        specs.pop(i)  # komplett entfernen
                        break
                try:
                    if left_name:
                        await broadcast(g, {"spectator": {"event": "left", "name": left_name}})
                except Exception:
                    pass
            if correction_cancelled:
                try:
                    await broadcast(g, {"scoreboard": snapshot(g)})
                except Exception:
                    pass

# -----------------------------
# Run
# -----------------------------
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
