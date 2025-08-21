from __future__ import annotations
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ==== Deine Modelle/Regeln (unverändert einbinden) ====
# Erwartet werden die vorhandenen Klassen/Funktionen aus deinem Projekt.
# Nichts davon wird hier verändert.
from app.models import Game, Games, GameMode  # type: ignore
from app.rules import scoreboard_snapshot_for_game  # type: ignore

app = FastAPI(title="RollTheDice")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"]
)
app.mount("/static", StaticFiles(directory="static"), name="static")

# =============================================================================
#                              LEADERBOARD STORAGE
# =============================================================================

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
RECENT_PATH = os.path.join(ROOT_DIR, "leaderboard_recent.json")
ALLTIME_PATH = os.path.join(ROOT_DIR, "leaderboard_alltime.json")
STATS_PATH = os.path.join(ROOT_DIR, "stats.json")

# Sicherstellen, dass Dateien existieren
def _ensure_files():
    if not os.path.exists(RECENT_PATH):
        with open(RECENT_PATH, "w", encoding="utf-8") as f:
            json.dump([], f)
    if not os.path.exists(ALLTIME_PATH):
        with open(ALLTIME_PATH, "w", encoding="utf-8") as f:
            json.dump([], f)
    if not os.path.exists(STATS_PATH):
        with open(STATS_PATH, "w", encoding="utf-8") as f:
            json.dump({"games_played": 0}, f)

_ensure_files()

def _read_json(path: str) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return [] if path.endswith(".json") else {}

def _write_json(path: str, data: Any) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)

def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _seven_days_ago() -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=7)

# in‑memory Guard, damit nicht mehrfach geloggt wird
_LOGGED_GAMES: set[str] = set()

def _compute_totals_for_game(g: Game) -> Dict[int, int]:
    """
    Erwartung: Game liefert Scoresheets; wir schätzen Totals über rules.compute_overall,
    das in scoreboard_snapshot_for_game indirekt steckt.
    Fallback: 0 wenn nicht vorhanden.
    """
    # Wir nutzen das existierende Snapshot-Format, weil es bereits Totals je Spieler/Spalte enthält.
    snap = snapshot(g)
    totals: Dict[int, int] = {}
    sb = snap.get("_scoreboards", {})
    for pid_str, cols in sb.items():
        # cols enthält Werte in Form "ri,col" -> score
        # Wir approximieren Reihentotal aus clientseitiger Logik:
        # Nehmen die vier Spalten-Reihentotale (ri=17) und summieren.
        try:
            pid = int(pid_str)
        except Exception:
            pid = int(pid_str) if isinstance(pid_str, int) else None
        if pid is None:
            continue
        column_keys = ["down", "free", "up", "ang"]
        total_sum = 0
        # Zeile 17 ist "Reihentotal" in unserem Schema
        for col in column_keys:
            key = f"17,{col}"
            v = cols.get(key)
            try:
                total_sum += int(v) if v not in ("", None) else 0
            except Exception:
                total_sum += 0
        totals[pid] = total_sum
    return totals

def _best_and_opponent(g: Game) -> Dict[str, Any] | None:
    totals = _compute_totals_for_game(g)
    if not totals:
        return None
    # Sortiere Spieler nach Total absteigend
    order = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
    if len(order) == 1:
        (pid, pts) = order[0]
        return {
            "winner_pid": pid, "winner_pts": pts,
            "loser_pid": pid, "loser_pts": 0
        }
    (wpid, wpts), (lpid, lpts) = order[0], order[1]
    return {
        "winner_pid": wpid, "winner_pts": wpts,
        "loser_pid": lpid, "loser_pts": lpts
    }

def _game_display_name(g: Game) -> str:
    # Versuch, aus Game einen Namen zu bekommen; Fallback: ID
    try:
        return getattr(g, "name", None) or f"Game {g.game_id}"
    except Exception:
        return f"Game {getattr(g, 'game_id', '?')}"

def _player_name(g: Game, pid: int) -> str:
    try:
        p = g.players.get(pid)
        return p.name if p else f"Player {pid}"
    except Exception:
        return f"Player {pid}"

def _clean_recent_and_top10() -> List[Dict[str, Any]]:
    recent: List[Dict[str, Any]] = _read_json(RECENT_PATH) or []
    cutoff = _seven_days_ago()
    def _parse_ts(ts: str) -> datetime:
        try:
            return datetime.fromisoformat(ts)
        except Exception:
            return cutoff - timedelta(days=1)
    recent = [r for r in recent if _parse_ts(r.get("timestamp","")) >= cutoff]
    # Top 10 nach Siegerpunkten (absteigend) – für Anzeige
    recent_sorted = sorted(recent, key=lambda r: r.get("punkte", 0), reverse=True)[:10]
    _write_json(RECENT_PATH, recent)  # abgespeicherter Zustand bleibt "nur letzte 7 Tage (alle)", nicht gekürzt auf 10
    return recent_sorted

def _update_alltime_with(entry: Dict[str, Any]) -> List[Dict[str, Any]]:
    alltime: List[Dict[str, Any]] = _read_json(ALLTIME_PATH) or []
    # Falls Liste <10, einfach einfügen
    if len(alltime) < 10:
        alltime.append(entry)
    else:
        # Prüfe, ob entry besser als schwächster ist
        alltime_sorted = sorted(alltime, key=lambda r: r.get("punkte", 0))
        weakest = alltime_sorted[0]
        if entry.get("punkte", 0) > weakest.get("punkte", 0):
            alltime_sorted[0] = entry
            alltime = alltime_sorted
        else:
            # Nicht gut genug: ignorieren
            pass
    # Nach Punkten desc speichern, auf 10 kürzen
    alltime = sorted(alltime, key=lambda r: r.get("punkte", 0), reverse=True)[:10]
    _write_json(ALLTIME_PATH, alltime)
    return alltime

def _inc_games_played():
    stats = _read_json(STATS_PATH) or {"games_played": 0}
    stats["games_played"] = int(stats.get("games_played", 0)) + 1
    _write_json(STATS_PATH, stats)

def log_result_if_finished(g: Game) -> None:
    """
    Idempotenter Hook: wenn Spiel fertig UND noch nicht geloggt → Leaderboards updaten.
    Diese Funktion darf nach erfolgreichen Schreib-Aktionen aufgerufen werden.
    """
    gid = getattr(g, "game_id", None)
    if not gid:
        return
    key = str(gid)
    if key in _LOGGED_GAMES:
        return

    # Prüfe fertig: wir versuchen, eine robuste Heuristik:
    # Game soll – falls vorhanden – eine is_finished / finished Eigenschaft haben.
    finished = False
    for attr in ("is_finished", "finished", "done"):
        try:
            val = getattr(g, attr)
            finished = bool(val() if callable(val) else val)
            if finished:
                break
        except Exception:
            pass

    if not finished:
        # Fallback: wenn jede Spalte Reihentotal (ri=17) befüllt ist bei allen Spielern
        snap = snapshot(g)
        sb = snap.get("_scoreboards", {})
        if sb:
            finished = True
            for _pid, cols in sb.items():
                # pro Spalte muss 17,<col> vorhanden sein
                for col in ("down", "free", "up", "ang"):
                    if str(cols.get(f"17,{col}", "")) == "":
                        finished = False
                        break
                if not finished:
                    break

    if not finished:
        return

    # winner/loser bestimmen
    who = _best_and_opponent(g)
    if not who:
        return

    winner_pid = who["winner_pid"]
    winner_pts = who["winner_pts"]
    loser_pid  = who["loser_pid"]
    loser_pts  = who["loser_pts"]

    entry = {
        "punkte": int(winner_pts),
        "name": _player_name(g, int(winner_pid)),
        "spielname": _game_display_name(g),
        "gegnername": _player_name(g, int(loser_pid)),
        "gegnerpunkte": int(loser_pts),
        "differenz": int(winner_pts - loser_pts),
        "timestamp": _utcnow_iso()
    }

    # recent aktualisieren (alte entfernen), aber persistiert werden alle der letzten 7 Tage
    recent_all = _read_json(RECENT_PATH) or []
    # vor Aufnahme alten Ballast entfernen
    cutoff = _seven_days_ago()
    def _parse(ts: str) -> datetime:
        try:
            return datetime.fromisoformat(ts)
        except Exception:
            return cutoff - timedelta(days=1)
    recent_all = [r for r in recent_all if _parse(r.get("timestamp","")) >= cutoff]
    recent_all.append(entry)
    _write_json(RECENT_PATH, recent_all)

    # alltime Top‑10 ggf. updaten
    _update_alltime_with(entry)

    # counter +1
    _inc_games_played()

    # merken, dass dieses Spiel geloggt ist
    _LOGGED_GAMES.add(key)

# =============================================================================
#                              HILFSFUNKTIONEN
# =============================================================================

def snapshot(g: Game) -> Dict[str, Any]:
    """
    Baut das JSON zusammen, das die Clients erwarten.
    Wir nutzen deine bestehende Helper-Funktion aus rules.py,
    und ergänzen Metadaten (_players, _turn etc.), sofern Game sie anbietet.
    """
    try:
        base = scoreboard_snapshot_for_game(g.players, g.scores)  # type: ignore
    except Exception:
        base = {}

    # Scoreboard-Format für Frontend (kompatibel zu deinem aktuellen Stand)
    out: Dict[str, Any] = {
        "_scoreboards": {},
        "_players": [],
        "_name": getattr(g, "name", f"Game {getattr(g, 'game_id', '')}"),
        "_rolls_used": getattr(g, "rolls_used", 0),
        "_rolls_max": getattr(g, "rolls_max", 3),
        "_turn": {"player_id": getattr(g, "turn_player_id", None)},
        "_dice": getattr(g, "dice", [0,0,0,0,0]),
        "_holds": getattr(g, "holds", [False]*5),
        "_announced_row4": getattr(g, "announced_row4", None),
        "_correction": getattr(g, "correction", {"active": False}),
        "_has_last": getattr(g, "has_last", {})
    }

    # Spielerliste
    try:
        for pid, p in g.players.items():
            out["_players"].append({"id": pid, "name": p.name})
    except Exception:
        pass

    # Score-Werte in "ri,col" → value transformieren
    try:
        # base[pid] = { player, rows:{1:...,2:...}, subtotals:{row1:..., overall:...}}
        for pid, pack in base.items():
            scmap: Dict[str, Any] = {}
            rows = pack.get("rows", {})
            # wir übernehmen nur die bereits geschriebenen Felder 1..17
            for idx_row in (0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17):
                row = rows.get(idx_row, {}) or rows.get(str(idx_row), {}) or {}
                # Spaltennamen (down/free/up/ang) sind in deinem Modell rowX keys ("1","2",..., "60" Mapping). Hier erwarten wir schon berechnete Zahlen.
                # Wir gehen davon aus, dass dein Game intern Keys "down","free","up","ang" schreibt, wenn persistiert.
                for col in ("down","free","up","ang"):
                    key = f"{idx_row},{col}"
                    if col in row:
                        scmap[key] = row[col]
            out["_scoreboards"][str(pid)] = scmap
    except Exception:
        pass

    return out

# =============================================================================
#                              HTTP ROUTES (bestehend + neu)
# =============================================================================

class CreateGameReq(BaseModel):
    name: str
    mode: int  # 2, 3 oder 22 (2v2)

@app.get("/", response_class=HTMLResponse)
def root():
    return FileResponse("static/index.html")

@app.get("/api/games")
def api_games():
    lst = []
    for gid, g in Games.all().items():  # type: ignore
        try:
            cap = g.capacity
            cnt = len(g.players)
            started = getattr(g, "started", False)
            mode = getattr(g, "mode", getattr(g, "game_mode", None))
            lst.append({
                "id": gid,
                "name": getattr(g, "name", f"Game {gid}"),
                "mode": mode,
                "players": cnt,
                "capacity": cap,
                "started": started
            })
        except Exception:
            continue
    return {"games": lst}

@app.post("/api/games")
def create_game(req: CreateGameReq):
    # Modus-Mapping an dein Game
    mode = req.mode
    if mode not in (2,3,22):
        raise HTTPException(400, "ungueltiger Modus")
    g = Games.create(name=req.name, mode=mode)  # type: ignore
    return {"id": g.game_id}

@app.get("/api/games/{game_id}")
def game_info(game_id: str):
    g = Games.get(game_id)  # type: ignore
    if not g:
        raise HTTPException(404, "Game nicht gefunden")
    cap = getattr(g, "capacity", 2)
    cnt = len(getattr(g, "players", {}))
    return {
        "id": getattr(g, "game_id", game_id),
        "name": getattr(g, "name", f"Game {game_id}"),
        "players": cnt,
        "capacity": cap,
        "started": getattr(g, "started", False),
        "mode": getattr(g, "mode", getattr(g, "game_mode", None))
    }

# ===== Leaderboard API (NEU) =====

@app.get("/api/leaderboard")
def get_leaderboard():
    recent_top = _clean_recent_and_top10()
    alltime = _read_json(ALLTIME_PATH) or []
    stats = _read_json(STATS_PATH) or {"games_played": 0}
    # alltime bereits nach Punkten sortieren
    alltime = sorted(alltime, key=lambda r: r.get("punkte", 0), reverse=True)[:10]
    return {
        "recent": recent_top,
        "alltime": alltime,
        "games_played": int(stats.get("games_played", 0))
    }

# =============================================================================
#                              WEBSOCKET (bestehend)
# =============================================================================

# pro Spiel offene Verbindungen
WS_CLIENTS: Dict[str, List[WebSocket]] = {}

async def ws_broadcast(game_id: str, payload: Dict[str, Any]):
    cls = WS_CLIENTS.get(game_id, [])
    dead = []
    for ws in cls:
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        try:
            await ws.close()
        except Exception:
            pass
        try:
            cls.remove(ws)
        except Exception:
            pass

@app.websocket("/ws/{game_id}")
async def ws_game(websocket: WebSocket, game_id: str):
    await websocket.accept()
    g = Games.get(game_id)  # type: ignore
    if not g:
        await websocket.close(code=1008)
        return
    WS_CLIENTS.setdefault(game_id, []).append(websocket)

    # On connect: schicke initialen Snapshot
    await websocket.send_json({"scoreboard": snapshot(g)})

    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action")

            # ---- Spieler‑Join/Rejoin (belasse deine bestehende Logik im Game) ----
            if action == "join_game":
                name = data.get("name") or "Gast"
                pid = g.join(name)  # type: ignore
                await websocket.send_json({"player_id": pid})
                await ws_broadcast(game_id, {"scoreboard": snapshot(g)})
                continue

            if action == "rejoin_game":
                # du kannst hier deine bestehende Rejoin-Logik verwenden
                await websocket.send_json({"ok": True})
                await websocket.send_json({"scoreboard": snapshot(g)})
                continue

            # ---- Spiel-Aktionen (rufen direkt die Game-Methoden auf) ----
            if action == "set_hold":
                holds = data.get("holds") or []
                g.set_holds(holds)  # type: ignore
                await ws_broadcast(game_id, {"scoreboard": snapshot(g)})
                continue

            if action == "roll_dice":
                g.roll()  # type: ignore
                await ws_broadcast(game_id, {"scoreboard": snapshot(g)})
                continue

            if action == "announce_row4":
                field = data.get("field")
                g.announce_row4(field)  # type: ignore
                await ws_broadcast(game_id, {"scoreboard": snapshot(g)})
                continue

            if action == "write_field":
                row = int(data.get("row"))
                field = data.get("field")
                strike = bool(data.get("strike", False))
                g.write_field(row=row, field=field, strike=strike)  # type: ignore
                # >>> LOG HOOK: Sobald ein Schreiben erfolgreich war, prüfen ob Spielende und ggf. loggen
                log_result_if_finished(g)
                await ws_broadcast(game_id, {"scoreboard": snapshot(g)})
                continue

            if action == "request_correction":
                g.request_correction()  # type: ignore
                await ws_broadcast(game_id, {"scoreboard": snapshot(g)})
                continue

            if action == "cancel_correction":
                g.cancel_correction()  # type: ignore
                await ws_broadcast(game_id, {"scoreboard": snapshot(g)})
                continue

            if action == "write_field_correction":
                row = int(data.get("row"))
                field = data.get("field")
                strike = bool(data.get("strike", False))
                g.write_field_correction(row=row, field=field, strike=strike)  # type: ignore
                # >>> LOG HOOK: auch nach Korrektur prüfen (falls letzte Lücke gefüllt wurde)
                log_result_if_finished(g)
                await ws_broadcast(game_id, {"scoreboard": snapshot(g)})
                continue

            # unbekannte Aktion -> ignoriere freundlich
            await websocket.send_json({"error": "unknown action"})

    except WebSocketDisconnect:
        pass
    finally:
        # Cleanup
        try:
            WS_CLIENTS.get(game_id, []).remove(websocket)
        except Exception:
            pass

# =============================================================================
#                           LEGACY STATIC (optional)
# =============================================================================

@app.get("/static/index.html", include_in_schema=False)
def _legacy_index():
    return FileResponse("static/index.html")

@app.get("/static/room.html", include_in_schema=False)
def _legacy_room():
    return FileResponse("static/room.html")