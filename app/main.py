from __future__ import annotations

import uuid
import random
import json
from collections import Counter
from typing import Dict, Any
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .rules import compute_overall

# --- Auto-Timeout (Inaktivität) ---
GAME_TIMEOUT = timedelta(minutes=10)

def touch(g):
    """Aktualisiert die letzte Aktivität des Spiels."""
    g["_last_activity"] = datetime.now(timezone.utc)

def check_timeout_and_abort(g) -> bool:
    """Falls ein Spiel zu lange inaktiv ist, als abgebrochen markieren.
    Gibt True zurück, wenn ein Statuswechsel zu Abgebrochen stattgefunden hat."""
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
    for _gid, _g in list(games.items()):
        check_timeout_and_abort(_g)

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
STATS_FILE   = DATA_DIR / "stats.json"

# Static korrekt mounten – jetzt existiert app
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

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

# --- Team-Mode Helpers (2v2: Spieler 1&3 = Team A, 2&4 = Team B) ---

def is_team_mode(g: GameDict) -> bool:
    m = str(g.get("_mode"))
    return m.lower() == "2v2"

def assign_team_for_join(g: GameDict, player_id: str):
    """Zuweisung in Join-Reihenfolge: 1->A, 2->B, 3->A, 4->B."""
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
    """Welche Scoreboard-ID wird beschrieben? Team-ID (2v2) oder pid (2/3 Spieler)."""
    if is_team_mode(g):
        team = g.get("_team_of", {}).get(pid)
        return team or "A"
    return pid

def new_game(gid: str, name: str, mode) -> GameDict:
    if isinstance(mode, str) and mode.isdigit():
        mode = int(mode)
    expected = 4 if str(mode).lower() == "2v2" else int(mode)
    if str(mode).lower() == "2v2":
        # explizit Teams & Team-Scoreboards anlegen (optional)
        pass  # (dein Einfügeblock würde hier stehen)
    g: GameDict = {
        "_id": gid,
        "_name": name,
        "_mode": str(mode),
        "_expected": expected,
        "_started": False,
        "_finished": False,

        "_players": [],                        # [{id,name,ws}]
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
    return Counter(d for d in dice if d)

def has_n_of_a_kind(dice, n: int) -> bool:
    c = _counts(dice)
    return any(v >= n for v in c.values())

def score_field_value(field_key: str, dice) -> int:
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

def _filled_rows_for(g: GameDict, pid: str, col: str) -> set[int]:
    if is_team_mode(g):
        team = board_key_for_actor(g, pid)
        board = g.get("_scoreboards_by_team", {}).get(team, {})
    else:
        board = g["_scoreboards"].get(pid, {})
    out = set()
    for k in board.keys():
        if isinstance(k, str) and "," in k:
            r_str, c = k.split(",", 1)
            r = int(r_str)
            if c == col:
                out.add(r)
    return out

def _next_required_row(col: str, filled: set[int]) -> int | None:
    order = WRITABLE_ROWS if col == "down" else list(reversed(WRITABLE_ROWS))
    for r in order:
        if r not in filled:
            return r
    return None

def _remaining_cells_for(g: GameDict, pid: str) -> int:
    """Verbleibende Zellen für 'letzter Wurf' – im Team-Modus zählt das gemeinsame Blatt."""
    if is_team_mode(g):
        team = board_key_for_actor(g, pid)
        sb = g.get("_scoreboards_by_team", {}).get(team, {}) or {}
    else:
        sb = g["_scoreboards"].get(pid, {}) or {}
    return WRITABLE_CELLS_PER_PLAYER - len(sb)

def _is_last_turn_for(g: GameDict, pid: str) -> bool:
    return _remaining_cells_for(g, pid) == 1

def _set_roll_cap_for_current_turn(g: GameDict):
    """Setzt _rolls_max je nach 'letzter Wurf' auf 5, sonst 3."""
    cur = g.get("_turn", {}) or {}
    pid = cur.get("player_id")
    g["_rolls_max"] = 5 if (pid and _is_last_turn_for(g, pid)) else 3

def can_write_now(g: GameDict, pid: str, row: int, col: str, *, during_turn_announce: str | None) -> tuple[bool, str]:
    if row not in WRITABLE_ROWS:
        return False, "Dieses Feld ist nicht beschreibbar"

    field_key = WRITABLE_MAP[row]

    if col == "free":
        return True, ""

    if col == "ang":
        # Ausnahme: im letzten Zug darf ohne Ansage in ❗ geschrieben werden
        if _is_last_turn_for(g, pid):
            return True, ""
        # NEU: direkt nach dem 1. Wurf darf ohne Dropdown-Ansage in ❗ geschrieben werden
        # (solange das Ziel-Feld noch leer ist; das prüfen wir im Schreibpfad ohnehin)
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

def _serialize_scoreboards(g: GameDict) -> Dict[str, Dict[str, int]]:
    out: Dict[str, Dict[str, int]] = {}
    for pid, board in g["_scoreboards"].items():
        sb: Dict[str, int] = {}
        for k, v in board.items():
            if isinstance(k, str):
                sb[k] = v
        out[pid] = sb
    return out

# -----------------------------
# Snapshot / Broadcast
# -----------------------------

def snapshot(g: GameDict) -> Dict[str, Any]:
    # Auto-Timeout prüfen
    check_timeout_and_abort(g)
    # Ergebnisse (falls abgeschlossen) berechnen
    if g["_finished"] and not g.get("_results"):
        g["_results"] = _compute_results_for_snapshot(g)

    # --- Auto-advance single-player turn logic ---
    _auto_single = False
    if (
        g.get("_expected") == 1
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
        "_players": [{"id": p["id"], "name": p["name"]} for p in g["_players"]],
        "_players_joined": len(g["_players"]),
        "_expected": g["_expected"],
        "_started": g["_started"],
        "_finished": g["_finished"],
        "_aborted": g.get("_aborted", False),
        "locked": bool(g.get("_passphrase")),  # neu: passwortgeschütztes Spiel kennzeichnen
        "_turn": g["_turn"],
        "_dice": g["_dice"],
        "_holds": g["_holds"],
        "_rolls_used": g["_rolls_used"],
        "_rolls_max": g["_rolls_max"],
        "_scoreboards": ({} if is_team_mode(g) else _serialize_scoreboards(g)),
        "_announced_row4": g["_announced_row4"],
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
    }

async def broadcast(g: GameDict, msg: Dict[str, Any]) -> None:
    for p in g["_players"]:
        ws = p.get("ws")
        if not ws:
            continue
        try:
            await ws.send_json(msg)
        except Exception:
            pass

def next_turn(g: GameDict, current_pid: str | None) -> str | None:
    ids = [p["id"] for p in g["_players"]]
    if not ids:
        return None
    if current_pid in ids:
        i = (ids.index(current_pid) + 1) % len(ids)
        return ids[i]
    return ids[0]

# -----------------------------
# HTTP API
# -----------------------------

@app.get("/")
async def root():
    return FileResponse(str(STATIC_DIR / "index.html"))

class CreateReq(BaseModel):
    name: str
    mode: str | int
    owner: str | None = None
    passphrase: str | None = Field(default=None, alias="pass")

def game_list_payload() -> list[dict]:
    out = []
    for gid, g in games.items():
        out.append({
            "id": gid,
            "name": g["_name"],
            "mode": g["_mode"],
            "expected": g["_expected"],
            "joined": len(g["_players"]),
            "started": g["_started"],
            "finished": g["_finished"],
            "locked": bool(g.get("_passphrase")),
        })
    return out

# --- Games API (mit wartenden Spielern) ---
@app.get("/api/games")
def api_games():
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
                "players": joined,
                "expected": g["_expected"],
                "started": g["_started"],
                "finished": g["_finished"],
                "aborted": g.get("_aborted", False),
                "locked": bool(g.get("_passphrase")),  # <— neu
                "waiting": waiting_names,
            })
        except Exception:
            continue
    return {"games": lst}

@app.get("/api/games/{game_id}")
def game_info(game_id: str, passphrase: str | None = Query(default=None, alias="pass")):
    sweep_timeouts()
    g = games.get(game_id)
    # optional: Passphrase validieren, falls mitgegeben
    if g and (g.get("_passphrase") or "") and (passphrase is not None):
        if passphrase != (g.get("_passphrase") or ""):
            raise HTTPException(status_code=403, detail="wrong_passphrase")
    if not g:
        return {"exists": False}
    return {
        "exists": True,
        "id": game_id,
        "name": g["_name"],
        "mode": g["_mode"],
        "players": len(g["_players"]),
        "expected": g["_expected"],
        "started": g["_started"],
        "finished": g["_finished"],
        "aborted": g.get("_aborted", False),
        "locked": bool(g.get("_passphrase")),  # <— neu: Flag für Passphrase
        "waiting": [p.get("name", "Player") for p in g["_players"]],
    }

@app.get("/api/leaderboard")
async def get_leaderboard():
    def read_json(path: Path, default):
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                return default
        return default

    return {
        "recent": read_json(RECENT_FILE, []),
        "alltime": read_json(ALLTIME_FILE, []),
        "stats": read_json(STATS_FILE, {"games_played": 0}),
    }

@app.post("/api/games")
async def api_games_create(req: CreateReq):
    gid = str(uuid.uuid4())[:8]
    g = new_game(gid, req.name, req.mode)
    g["_passphrase"] = (req.passphrase or None)
    return {"game_id": gid}
# Legacy-Endpoints
@app.get("/games")
async def legacy_list():
    return game_list_payload()

@app.post("/create_game")
async def legacy_create_game(mode: str, name: str, passphrase: str = ""):
    gid = str(uuid.uuid4())[:8]
    g = new_game(gid, name, mode)
    g["_passphrase"] = (passphrase or None)
    return {"id": gid}

# Brave/Chromium DevTools Ping unterdrücken
@app.get("/.well-known/appspecific/com.chrome.devtools.json")
async def chrome_devtools_placeholder():
    return {}

# -----------------------------
# Leaderboard/Stats Hilfsfunktionen
# -----------------------------
def _rows_from_scoreboard(sb: Dict[str, int]) -> Dict[int, Dict[str, int]]:
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
    totals: Dict[str,int] = {}
    if is_team_mode(g):
        # Team-Boards
        for team_id, board in g.get("_scoreboards_by_team", {}).items():
            rows = _rows_from_scoreboard(board)
            ov = compute_overall(rows)
            totals[team_id] = int(ov["overall"]["overall_total"])
    else:
        # Spieler-Boards
        for p in g["_players"]:
            pid = p["id"]
            sb = g["_scoreboards"].get(pid, {})
            rows = _rows_from_scoreboard(sb)
            ov = compute_overall(rows)
            totals[pid] = int(ov["overall"]["overall_total"])
    return totals

def _is_game_finished(g: GameDict) -> bool:
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
    data = []
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            data = []
    new_data = mutate_fn(data)
    path.write_text(json.dumps(new_data, ensure_ascii=False, indent=2), encoding="utf-8")

def _mutate_stats(incr_games=False):
    stats = {"games_played": 0}
    if STATS_FILE.exists():
        try:
            stats = json.loads(STATS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    if incr_games:
        stats["games_played"] = int(stats.get("games_played", 0)) + 1
    STATS_FILE.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")

def _finalize_and_log_results(g: GameDict):
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

    entries_for_recent = []
    entries_for_alltime = []

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
        entries_for_recent.append(rec)
        entries_for_alltime.append(rec)
    else:
        ordered = sorted(players, key=lambda p: totals.get(p["id"], 0), reverse=True)
        if not ordered:
            return
        winner = ordered[0]
        winner_pts = totals.get(winner["id"], 0)
        if len(ordered) >= 2:
            second = ordered[1]
            opp_name = second["name"]
            opp_pts = totals.get(second["id"], 0)
            diff = winner_pts - opp_pts
        else:
            opp_name = "-"
            opp_pts = 0
            diff = winner_pts
        rec = {
            "ts": entry_time,
            "points": winner_pts,
            "name": winner["name"],
            "gamename": game_name,
            "opponent": opp_name,
            "opp_points": opp_pts,
            "diff": diff
        }
        entries_for_recent.append(rec)
        entries_for_alltime.append(rec)

    def mutate_recent(data):
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        kept = []
        for x in data:
            try:
                ts = datetime.fromisoformat(x.get("ts"))
            except Exception:
                continue
            if ts >= cutoff:
                kept.append(x)
        kept.extend(entries_for_recent)
        kept.sort(key=lambda x: int(x.get("points", 0)), reverse=True)
        return kept[:10]

    def mutate_alltime(data):
        arr = list(data) if isinstance(data, list) else []
        arr.extend(entries_for_alltime)
        arr.sort(key=lambda x: int(x.get("points", 0)), reverse=True)
        return arr[:10]

    _append_json(RECENT_FILE, mutate_recent)
    _append_json(ALLTIME_FILE, mutate_alltime)
    _mutate_stats(incr_games=True)

def _compute_results_for_snapshot(g: GameDict):
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
        await websocket.send_json({"error": "Game nicht gefunden"})
        await websocket.close()
        return

    g = games[game_id]
    player_id: str | None = None

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

            if act == "join_game":
                # Passphrase validieren (falls gesetzt) – bei Fehler Socket sofort schließen
                provided_pass = (data.get("pass") or data.get("passphrase") or "").strip()
                expected_pass = (g.get("_passphrase") or "")
                if expected_pass and provided_pass != expected_pass:
                    try:
                        await websocket.send_json({"error": "Falsche Passphrase"})
                    except Exception:
                        pass
                    await websocket.close(code=1008)
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
                    g["_turn"] = {"player_id": g["_players"][0]["id"], "roll_index": 0, "first4oak_roll": None}
                    _set_roll_cap_for_current_turn(g)
                await websocket.send_json({"player_id": player_id})
                touch(g)
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "rejoin_game":
                player_id = data.get("player_id")
                for p in g["_players"]:
                    if p["id"] == player_id:
                        p["ws"] = websocket
                await websocket.send_json({"player_id": player_id})
                touch(g)
                await websocket.send_json({"scoreboard": snapshot(g)})

            elif act == "set_hold":
                g["_holds"] = list(data.get("holds", [False] * 5))[:5]
                touch(g)
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "roll_dice":
                if not g["_turn"] or g["_turn"]["player_id"] != player_id:
                    await websocket.send_json({"error": "Nicht an der Reihe"})
                    continue
                if g["_correction"]["active"]:
                    await websocket.send_json({"error": "Während Korrektur nicht erlaubt"})
                    continue
                if g["_rolls_used"] >= g["_rolls_max"]:
                    await websocket.send_json({"error": "Keine Würfe mehr"})
                    continue
                dice = g["_dice"][:] if g["_dice"] else [0] * 5
                for i in range(5):
                    if not g["_holds"][i]:
                        dice[i] = random.randint(1, 6)
                g["_dice"] = dice
                g["_rolls_used"] += 1

                # --- Poker-Regel Tracking: roll_index & "first4oak_roll" ---
                try:
                    # turn-hilfswerte initialisieren falls alt Spielstand
                    cur = g.setdefault("_turn", {})
                    if "roll_index" not in cur:
                        cur["roll_index"] = 0
                    if "first4oak_roll" not in cur:
                        cur["first4oak_roll"] = None
                    # aktuellen Wurf zählen
                    cur["roll_index"] = int(cur.get("roll_index", 0)) + 1
                    # erster 4er-Gleiche in diesem Zug merken (nur einmal)
                    if cur.get("first4oak_roll") is None and has_n_of_a_kind(g["_dice"], 4):
                        cur["first4oak_roll"] = cur["roll_index"]
                except Exception:
                    pass

                touch(g)
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "announce_row4":
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
                if field not in {"1","2","3","4","5","6","max","min","kenter","full","poker","60"}:
                    await websocket.send_json({"error": "Ungültiges Ansage-Feld"})
                    continue

                # Feld in ❗ schon befüllt?
                row_for_field = KEY_TO_ROW.get(field)
                # prüfen gegen Zielboard (Team/Spieler)
                if is_team_mode(g):
                    board = g.get("_scoreboards_by_team", {}).get(board_key_for_actor(g, player_id), {})
                else:
                    board = g["_scoreboards"].get(player_id, {})
                if row_for_field is not None and f"{row_for_field},ang" in board:
                    await websocket.send_json({"error": f"Ansage nicht möglich: Feld {field} in ❗ bereits befüllt"})
                    continue

                g["_announced_row4"] = field
                touch(g)
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "unannounce_row4":
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
                    row = int(data["row"])
                except Exception:
                    await websocket.send_json({"error": "Ungültige Zeile"})
                    continue
                col = data.get("field")
                if col not in {"down", "free", "up", "ang"}:
                    await websocket.send_json({"error": "Ungültige Spalte"})
                    continue

                fld = WRITABLE_MAP.get(row)
                if fld is None:
                    await websocket.send_json({"error": "Dieses Feld ist nicht beschreibbar"})
                    continue

                ok, why = can_write_now(g, player_id, row, col, during_turn_announce=g["_announced_row4"])
                if not ok:
                    await websocket.send_json({"error": why})
                    continue

                key = f"{row},{col}"
                # Ziel-Board...
                if is_team_mode(g):
                    board = g.setdefault("_scoreboards_by_team", {}).setdefault(board_key_for_actor(g, player_id), {})
                else:
                    board = g.setdefault("_scoreboards", {}).setdefault(player_id, {})

                if key in board:
                    await websocket.send_json({"error": "Dieses Feld ist bereits befüllt"})
                    continue

                # --- Poker-Regel: "poker" nur sofort im Wurf, in dem 4er erreicht wurde; 5er immer ok ---
                if fld == "poker":
                    cur = g.get("_turn", {}) or {}
                    roll_idx = int(cur.get("roll_index", 0) or 0)
                    first4 = cur.get("first4oak_roll")
                    dice_now = g["_dice"] or [0, 0, 0, 0, 0]
                    has4 = has_n_of_a_kind(dice_now, 4)
                    has5 = has_n_of_a_kind(dice_now, 5)
                    if not (has5 or (has4 and first4 and roll_idx == int(first4))):
                        await websocket.send_json({
                            "error": "Poker darf nur im Wurf geschrieben werden, in dem 4 gleiche erreicht wurden (oder bei 5 gleichen)."
                        })
                        continue

                value = score_field_value(fld, g["_dice"] or [0, 0, 0, 0, 0])
                board[key] = value

                g["_last_write"][player_id] = (row, col)
                g["_last_dice"][player_id] = (g["_dice"] or [0, 0, 0, 0, 0])[:]
                cur = g.get("_turn", {}) or {}
                g["_last_meta"][player_id] = {
                    "announced": g["_announced_row4"],
                    "roll_index": int(cur.get("roll_index", 0) or 0),
                    "first4oak_roll": cur.get("first4oak_roll"),
                }
                # Turn Ende
                g["_dice"] = [0, 0, 0, 0, 0]
                g["_holds"] = [False] * 5
                g["_rolls_used"] = 0
                g["_announced_row4"] = None
                g["_turn"] = {"player_id": next_turn(g, player_id), "roll_index": 0, "first4oak_roll": None}
                _set_roll_cap_for_current_turn(g)

                # Spielende?
                if _is_game_finished(g):
                    g["_started"] = False
                    g["_finished"] = True
                    _finalize_and_log_results(g)

                touch(g)
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "request_correction":
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

                # Bisher: nur erlaubt, wenn NICHT du dran bist.
                # Jetzt: im 1P-Mode auch erlaubt, wenn du dran bist – aber nur bevor erneut gewürfelt wurde.
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
                g["_correction"] = {"active": False}
                g["_dice"] = [0, 0, 0, 0, 0]
                touch(g)
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "write_field_correction":
                # --- Preconditions ---
                corr = g["_correction"]
                if not corr.get("active") or corr.get("player_id") != player_id:
                    await websocket.send_json({"error": "Keine Korrektur aktiv"})
                    continue

                # Zielzeile/-spalte aus dem Request
                try:
                    row = int(data["row"])
                except Exception:
                    await websocket.send_json({"error": "Ungültige Zeile"})
                    continue
                col = data.get("field")
                if col not in {"down", "free", "up", "ang"}:
                    await websocket.send_json({"error": "Ungültige Spalte"})
                    continue

                fld = WRITABLE_MAP.get(row)
                if fld is None:
                    await websocket.send_json({"error": "Dieses Feld ist nicht beschreibbar"})
                    continue

                # Es darf nur der letzte Eintrag dieses Spielers korrigiert werden
                last = g["_last_write"].get(player_id)
                if not last:
                    await websocket.send_json({"error": "Kein letzter Eintrag vorhanden"})
                    continue
                old_row, old_col = last

                # Würfel für die Neubewertung sind die gemerkten Korrekturwürfel
                dice_for_eval = (corr.get("dice") or g.get("_dice") or [0, 0, 0, 0, 0])[:]

                # --- Altes Zielboard (Team/Spieler) bestimmen und alten Eintrag entfernen ---
                if is_team_mode(g):
                    old_board = g.setdefault("_scoreboards_by_team", {}).setdefault(
                        board_key_for_actor(g, player_id), {}
                    )
                else:
                    old_board = g.setdefault("_scoreboards", {}).setdefault(player_id, {})

                old_key = f"{old_row},{old_col}"
                old_board.pop(old_key, None)

                # --- Neues Zielboard (Team/Spieler) bestimmen ---
                if is_team_mode(g):
                    new_board = g.setdefault("_scoreboards_by_team", {}).setdefault(
                        board_key_for_actor(g, player_id), {}
                    )
                else:
                    new_board = g.setdefault("_scoreboards", {}).setdefault(player_id, {})

                new_key = f"{row},{col}"
                # --- Reihenfolge-Checks wie im normalen Modus (nur für down/up) ---
                # Sonderfall: Wenn der Spieler im Korrekturmodus im *gleichen* Feld bleibt,
                # darf er das auch dann, wenn 'next_row' streng genommen anders wäre.
                if col in {"down", "up"}:
                    filled = _filled_rows_for(g, player_id, col)
                    next_row = _next_required_row(col, filled)
                    if next_row is None:
                        await websocket.send_json({"error": "Reihe bereits voll"})
                        continue
                    if row != next_row and not (row == old_row and col == old_col):
                        await websocket.send_json({"error": f"In dieser Reihe ist als Nächstes Zeile {next_row} erlaubt"})
                        continue
                if new_key in new_board:
                    await websocket.send_json({"error": "Ziel-Feld bereits befüllt"})
                    continue

                # Punkte neu berechnen und schreiben
                # --- Poker-Regel auch in Korrektur ---
                if fld == "poker":
                    corr_roll_idx = int((corr.get("roll_index") or 0))
                    first4 = corr.get("first4oak_roll")
                    has4 = has_n_of_a_kind(dice_for_eval, 4)
                    has5 = has_n_of_a_kind(dice_for_eval, 5)
                    if not (has5 or (has4 and first4 and corr_roll_idx == int(first4))):
                        await websocket.send_json({
                            "error": "Poker darf nur im Wurf geschrieben werden, in dem 4 gleiche erreicht wurden (oder bei 5 gleichen)."
                        })
                        continue

                val = score_field_value(fld, dice_for_eval)
                new_board[new_key] = val
                g["_last_write"][player_id] = (row, col)

                # Korrektur beenden, Würfel zurücksetzen und broadcasten
                g["_correction"] = {"active": False}
                g["_dice"] = [0, 0, 0, 0, 0]
                touch(g)
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "send_emoji":
                # Quick-Reaction-Emoji an alle senden (ephemer, keine Persistenz)
                if not player_id:
                    await websocket.send_json({"error": "Nicht beigetreten"})
                    continue

                emoji = str(data.get("emoji") or "").strip()
                if not emoji:
                    await websocket.send_json({"error": "Kein Emoji"})
                    continue

                sender_name = next((p.get("name", "Gast") for p in g["_players"] if p.get("id") == player_id), "Gast")
                payload = {
                    "emoji": {
                        "from_id": player_id,
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
                try:
                    sender = next((p.get("name", "Player") for p in g["_players"] if p.get("id") == player_id), "Player")
                except Exception:
                    sender = "Player"
                # Sanfte Längenbegrenzung
                if len(txt) > 400:
                    txt = txt[:400]
                # Broadcast ohne Persistenz
                await broadcast(g, {"chat": {"sender": sender, "text": txt}})
                touch(g)

            elif act == "end_game":
                # Spiel als abgebrochen markieren (kein Leaderboard-Eintrag, kein Completed-Game)
                g["_aborted"] = True
                # keine Ergebnisse loggen
                g["_results"] = None
                g["_started"] = False
                g["_finished"] = True  # clientseitig für sauberes Beenden/Redirect verwendet
                touch(g)
                await broadcast(g, {"scoreboard": snapshot(g)})

            else:
                await websocket.send_json({"error": f"Unbekannte Aktion: {act}"})

    except WebSocketDisconnect:
        # Spieler trennt Verbindung: WS-Referenz entfernen (Rejoin möglich)
        if game_id in games and player_id:
            g = games[game_id]
            for p in g["_players"]:
                if p.get("id") == player_id:
                    p["ws"] = None

# -----------------------------
# Run
# -----------------------------
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)