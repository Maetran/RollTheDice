from __future__ import annotations

import uuid
import random
from collections import Counter
from typing import Dict, Any

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# WICHTIG: keine Imports aus app.models / .models mehr!
# Wir benutzen ein einziges In-Memory-Registry:
GameDict = Dict[str, Any]
games: Dict[str, GameDict] = {}

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

# Schreibbare Zeilen-Indices (entsprechend Tabelle)
WRITABLE_ROWS = [0, 1, 2, 3, 4, 5, 9, 10, 12, 13, 14, 15]
WRITABLE_MAP = {
    0: "1", 1: "2", 2: "3", 3: "4", 4: "5", 5: "6",
    9: "max", 10: "min", 12: "kenter", 13: "full", 14: "poker", 15: "60",
}
KEY_TO_ROW = {v: k for k, v in WRITABLE_MAP.items()}


def new_game(gid: str, name: str, mode) -> GameDict:
    if isinstance(mode, str) and mode.isdigit():
        mode = int(mode)
    expected = 4 if mode == "2v2" else int(mode)
    g: GameDict = {
        "_id": gid,
        "_name": name,
        "_mode": mode,
        "_expected": expected,
        "_started": False,
        "_finished": False,

        "_players": [],
        "_turn": None,
        "_dice": [0, 0, 0, 0, 0],
        "_holds": [False] * 5,
        "_rolls_used": 0,
        "_rolls_max": 3,

        "_scoreboards": {},
        "_announced_row4": None,
        "_correction": {"active": False},

        "_results": None,

        "_last_write": {},
        "_last_dice": {},
        "_last_meta": {},
    }
    games[gid] = g
    return g


def _counts(dice):
    return Counter(d for d in dice if d)


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
            if n == 4:
                return 50 + 4 * face
        return 0

    if field_key == "60":
        for face, n in cnt.items():
            if n == 5:
                return 60 + 5 * face
        return 0

    return 0


def _filled_rows_for(g: GameDict, pid: str, col: str) -> set[int]:
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


def can_write_now(g: GameDict, pid: str, row: int, col: str, *, during_turn_announce: str | None) -> tuple[bool, str]:
    if row not in WRITABLE_ROWS:
        return False, "Dieses Feld ist nicht beschreibbar"

    field_key = WRITABLE_MAP[row]

    if col == "free":
        return True, ""

    if col == "ang":
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


def snapshot(g: GameDict) -> Dict[str, Any]:
    return {
        "_name": g["_name"],
        "_players": [{"id": p["id"], "name": p["name"]} for p in g["_players"]],
        "_players_joined": len(g["_players"]),
        "_expected": g["_expected"],
        "_started": g["_started"],
        "_finished": g["_finished"],
        "_turn": g["_turn"],
        "_dice": g["_dice"],
        "_holds": g["_holds"],
        "_rolls_used": g["_rolls_used"],
        "_rolls_max": g["_rolls_max"],
        "_scoreboards": _serialize_scoreboards(g),
        "_announced_row4": g["_announced_row4"],
        "_correction": g["_correction"],
        "_results": g.get("_results"),
        "_has_last": {pid: bool(g["_last_write"].get(pid)) for pid in g["_scoreboards"].keys()},
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


@app.get("/")
async def root():
    return FileResponse("static/index.html")


class CreateReq(BaseModel):
    name: str
    mode: str | int
    owner: str | None = None


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
        })
    return out


# --- Games API (kompatibel + 'waiting') ---
@app.get("/api/games")
def api_games():
    lst = []
    for gid, g in games.items():
        try:
            joined = len(g["_players"])
            waiting_names = [p.get("name", f"Player {i}") for i, p in enumerate(g["_players"], start=1)]
            lst.append({
                "id": gid,
                "name": g["_name"],
                "mode": g["_mode"],
                "players": joined,              # ALT (Kompatibilität)
                "expected": g["_expected"],     # ALT (Kompatibilität)
                "started": g["_started"],
                "finished": g["_finished"],
                "waiting": waiting_names,       # NEU
            })
        except Exception:
            continue
    return {"games": lst}


@app.get("/api/games/{game_id}")
def game_info(game_id: str):
    g = games.get(game_id)
    if not g:
        return {"exists": False}
    return {
        "exists": True,
        "id": game_id,
        "name": g["_name"],
        "mode": g["_mode"],
        "players": len(g["_players"]),     # ALT
        "expected": g["_expected"],        # ALT
        "started": g["_started"],
        "finished": g["_finished"],
        "waiting": [p.get("name", "Player") for p in g["_players"]],  # NEU
    }


# Leaderboard + Stats
import json
from pathlib import Path
DATA_DIR = Path(__file__).parent


@app.get("/api/leaderboard")
async def get_leaderboard():
    recent_file = DATA_DIR / "leaderboard_recent.json"
    alltime_file = DATA_DIR / "leaderboard_alltime.json"
    stats_file = DATA_DIR / "stats.json"

    def read_json(path, default):
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        return default

    return {
        "recent": read_json(recent_file, []),
        "alltime": read_json(alltime_file, []),
        "stats": read_json(stats_file, {"games_played": 0}),
    }


# Spiel erstellen (neue API, die dein Frontend nutzt)
@app.post("/api/games")
async def api_games_create(req: CreateReq):
    gid = str(uuid.uuid4())[:8]
    new_game(gid, req.name, req.mode)
    return {"game_id": gid}


# Legacy-Endpoints (bleiben erhalten, aber auch auf 'games' dict!)
@app.get("/games")
async def legacy_list():
    return game_list_payload()


@app.post("/create_game")
async def legacy_create_game(mode: str, name: str):
    gid = str(uuid.uuid4())[:8]
    new_game(gid, name, mode)
    return {"id": gid}


# Brave/Chromium DevTools Ping unterdrücken
@app.get("/.well-known/appspecific/com.chrome.devtools.json")
async def chrome_devtools_placeholder():
    return {}


# --- WebSocket ---
@app.websocket("/ws/{game_id}")
async def ws_game(websocket: WebSocket, game_id: str):
    await websocket.accept()
    if game_id not in games:
        await websocket.send_json({"error": "Game nicht gefunden"})
        await websocket.close()
        return

    g = games[game_id]
    player_id: str | None = None

    # Initialen Snapshot sofort schicken (damit UI immer etwas hat)
    await websocket.send_json({"scoreboard": snapshot(g)})

    try:
        while True:
            data = await websocket.receive_json()
            act = data.get("action")

            if act == "join_game":
                player_id = str(uuid.uuid4())[:6]
                player = {"id": player_id, "name": data.get("name") or "Gast", "ws": websocket}
                g["_players"].append(player)
                g["_scoreboards"][player_id] = {}
                if len(g["_players"]) == g["_expected"] and not g["_started"]:
                    g["_started"] = True
                    g["_turn"] = {"player_id": g["_players"][0]["id"]}
                await websocket.send_json({"player_id": player_id})
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "rejoin_game":
                player_id = data.get("player_id")
                for p in g["_players"]:
                    if p["id"] == player_id:
                        p["ws"] = websocket
                await websocket.send_json({"player_id": player_id})
                await websocket.send_json({"scoreboard": snapshot(g)})

            elif act == "set_hold":
                g["_holds"] = list(data.get("holds", [False] * 5))[:5]
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
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "announce_row4":
                # Ansage ODER Um-Ansage: nur direkt nach Wurf 1
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

                # Feld in ❗ bereits befüllt? Dann blocken (sonst Deadlock)
                row_for_field = KEY_TO_ROW.get(field)
                board = g["_scoreboards"].get(player_id, {})
                if row_for_field is not None and f"{row_for_field},ang" in board:
                    await websocket.send_json({"error": f"Ansage nicht möglich: Feld {field} in ❗ bereits befüllt"})
                    continue

                g["_announced_row4"] = field
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
                if key in g["_scoreboards"].get(player_id, {}):
                    await websocket.send_json({"error": "Dieses Feld ist bereits befüllt"})
                    continue

                value = score_field_value(fld, g["_dice"] or [0, 0, 0, 0, 0])
                g["_scoreboards"][player_id][key] = value

                g["_last_write"][player_id] = (row, col)
                g["_last_dice"][player_id] = (g["_dice"] or [0, 0, 0, 0, 0])[:]
                g["_last_meta"][player_id] = {"announced": g["_announced_row4"]}

                g["_dice"] = [0, 0, 0, 0, 0]
                g["_holds"] = [False] * 5
                g["_rolls_used"] = 0
                g["_announced_row4"] = None
                g["_turn"] = {"player_id": next_turn(g, player_id)}
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "request_correction":
                if g["_correction"]["active"]:
                    continue
                if player_id not in g["_last_write"]:
                    await websocket.send_json({"error": "Kein letzter Eintrag vorhanden"})
                    continue
                meta = g["_last_meta"].get(player_id, {})
                if meta.get("announced"):
                    await websocket.send_json({"error": "Korrektur nicht erlaubt (Ansage-Zug)"})
                    continue
                if not g["_turn"] or g["_turn"]["player_id"] == player_id:
                    await websocket.send_json({"error": "Korrektur nur direkt nach deinem Zug"})
                    continue
                if g["_rolls_used"] > 0:
                    await websocket.send_json({"error": "Korrektur nicht möglich: Gegner hat bereits gewürfelt"})
                    continue

                last_dice = g["_last_dice"].get(player_id, [])
                if not last_dice:
                    await websocket.send_json({"error": "Kein letzter Wurf vorhanden"})
                    continue

                g["_correction"] = {"active": True, "player_id": player_id, "dice": last_dice[:]}
                g["_dice"] = last_dice[:]
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "cancel_correction":
                g["_correction"] = {"active": False}
                g["_dice"] = [0, 0, 0, 0, 0]
                await broadcast(g, {"scoreboard": snapshot(g)})

            elif act == "write_field_correction":
                # Nur erlaubt, wenn Korrektur aktiv ist und du der Anforderer bist
                corr = g["_correction"]
                if not corr.get("active") or corr.get("player_id") != player_id:
                    await websocket.send_json({"error": "Keine Korrektur aktiv"})
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

                # alten Eintrag (der korrigiert werden soll) entfernen
                last = g["_last_write"].get(player_id)
                if not last:
                    await websocket.send_json({"error": "Kein letzter Eintrag vorhanden"})
                    continue
                old_row, old_col = last
                old_key = f"{old_row},{old_col}"
                g["_scoreboards"].setdefault(player_id, {}).pop(old_key, None)

                # neuen Wert aus den Korrekturwürfeln berechnen und schreiben
                dice_for_eval = (g["_correction"].get("dice") or g["_dice"] or [0, 0, 0, 0, 0])[:]
                new_key = f"{row},{col}"
                if new_key in g["_scoreboards"].setdefault(player_id, {}):
                    await websocket.send_json({"error": "Ziel-Feld bereits befüllt"})
                    continue

                val = score_field_value(fld, dice_for_eval)
                g["_scoreboards"][player_id][new_key] = val
                g["_last_write"][player_id] = (row, col)

                # Korrektur beenden und Wurf zurücksetzen
                g["_correction"] = {"active": False}
                g["_dice"] = [0, 0, 0, 0, 0]
                await broadcast(g, {"scoreboard": snapshot(g)})

            else:
                # Unbekannte Aktion ignorieren
                await websocket.send_json({"error": f"Unbekannte Aktion: {act}"})

    except WebSocketDisconnect:
        # Spieler trennt Verbindung: WS-Referenz entfernen, Spiel bleibt bestehen
        if game_id in games and player_id:
            g = games[game_id]
            for p in g["_players"]:
                if p.get("id") == player_id:
                    p["ws"] = None
        # Kein Broadcast nötig; Rejoin ist möglich


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)