"""FastAPI application assembly, page routes and thin HTTP adapters."""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote, urlencode

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, PlainTextResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from .active_games import load_active_games, save_active_game
from .api_auth import router as auth_router
from .api_users import router as users_router
from .auth import (
    ensure_bootstrap_admin,
    require_admin,
    require_csrf,
    resolve_session,
    websocket_origin_allowed,
)
from .auth_protection import enforce_game_creation_rate_limit, validate_auth_protection_config
from .database import configure_database, database_schema_ready, upgrade_database
from .game_engine import _progress_for_game
from .game_history import (
    delete_completed_game,
    import_legacy_leaderboards,
)
from .game_results import finalize_and_log_results, remove_deleted_game_from_files
from .game_state import (
    GameDict,
    _format_duration_hm,
    _offline_players,
    _player_connected,
    games,
    multiplayer_pause_reason,
    new_game,
    pause_remaining_seconds,
    sweep_timeouts,
    timeout_seconds,
)
from .game_websocket import serve_game_websocket
from .http_cache import apply_cache_policy, read_static_asset_version
from .leaderboard_service import (
    build_leaderboard,
    game_from_leaderboard,
)
from .leaderboard_storage import LeaderboardFiles

logger = logging.getLogger(__name__)

# ---------------- Pfade robust auflösen (static/ und data/) ----------------
HERE = Path(__file__).resolve().parent  # .../RollTheDice/app
BASE = HERE.parent  # .../RollTheDice

# Kandidaten für 'static'
STATIC_CANDIDATES = [
    BASE / "static",  # .../RollTheDice/static  (Repo-Root)
    HERE / "static",  # .../RollTheDice/app/static
    Path.cwd() / "static",  # aktuelles Arbeitsverzeichnis
]
STATIC_DIR = next((p for p in STATIC_CANDIDATES if p.exists()), None)
if not STATIC_DIR:
    raise RuntimeError("Kein 'static' Ordner gefunden. Erwartete Orte: " + ", ".join(str(p) for p in STATIC_CANDIDATES))

STATIC_ASSET_VERSION = read_static_asset_version(STATIC_DIR)

# Kandidaten für 'data' (Leaderboard/Stats)
DATA_CANDIDATES = [
    BASE / "data",  # .../RollTheDice/data  (empfohlen)
    HERE / "data",  # .../RollTheDice/app/data
]
DATA_DIR = next((p for p in DATA_CANDIDATES if p.exists()), HERE)
DATA_DIR.mkdir(parents=True, exist_ok=True)

LEADERBOARD_FILES = LeaderboardFiles.in_directory(DATA_DIR)

# Neue persistente Benutzer- und Spieldatenbank. Die eigentliche Migration
# läuft beim App-Start, damit reine Logiktests weiterhin ohne Startup-Hook
# ausgeführt werden können.
configure_database(DATA_DIR)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    upgrade_database(BASE)
    validate_auth_protection_config()
    ensure_bootstrap_admin()
    import_legacy_leaderboards(LEADERBOARD_FILES.legacy_paths())
    games.update(load_active_games())
    yield


app = FastAPI(lifespan=lifespan)


app.include_router(auth_router)
app.include_router(users_router)

LEGACY_PAGE_PATHS = {
    "/static/index.html": "/",
    "/static/rules.html": "/regeln",
    "/static/players.html": "/spieler",
    "/static/account.html": "/konto",
    "/static/admin.html": "/admin",
    "/static/offline.html": "/offline",
}


def _legacy_page_target(request: Request) -> str | None:
    """Map old static HTML links to their public page routes."""
    path = request.url.path
    target = LEGACY_PAGE_PATHS.get(path)
    consumed: set[str] = set()
    if path == "/static/room.html":
        game_id = str(request.query_params.get("game_id") or "").strip()
        if not game_id:
            return "/"
        spectator = request.query_params.get("spectator") == "1"
        target = f"/spiel/{quote(game_id, safe='')}" + ("/zuschauen" if spectator else "")
        consumed.update({"game_id", "spectator"})
    elif path == "/static/profile.html":
        username = str(request.query_params.get("user") or "").strip()
        target = f"/spieler/{quote(username, safe='')}" if username else "/spieler"
        consumed.add("user")
    elif path == "/static/game_view.html":
        game_id = str(request.query_params.get("id") or "").strip()
        target = f"/ergebnis/{quote(game_id, safe='')}" if game_id else "/ergebnis"
        consumed.add("id")
    if not target:
        return None
    remaining = [(key, value) for key, value in request.query_params.multi_items() if key not in consumed]
    return f"{target}?{urlencode(remaining)}" if remaining else target


@app.middleware("http")
async def response_cache_policy(request: Request, call_next):
    """Redirect legacy pages and apply the shared HTTP cache contract."""
    legacy_target = _legacy_page_target(request)
    if legacy_target:
        response = RedirectResponse(legacy_target, status_code=308)
    else:
        response = await call_next(request)
    apply_cache_policy(request, response, asset_version=STATIC_ASSET_VERSION)
    return response


# Static korrekt mounten – jetzt existiert app
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# Manifest (am Root-Pfad) mit korrektem MIME-Type ausliefern
@app.get("/manifest.webmanifest", include_in_schema=False)
def manifest():
    # liegt im Repo-Root neben Dockerfile / README
    return FileResponse(str(BASE / "manifest.webmanifest"), media_type="application/manifest+json")


@app.get("/manifest-en.webmanifest", include_in_schema=False)
def manifest_en():
    return FileResponse(str(BASE / "manifest-en.webmanifest"), media_type="application/manifest+json")


# Service Worker (Root-Scope) ausliefern
@app.get("/sw.js", include_in_schema=False)
def service_worker():
    return FileResponse(
        str(STATIC_DIR / "sw.js"),
        media_type="text/javascript",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(str(STATIC_DIR / "favicon.png"), media_type="image/png")


@app.get("/robots.txt", include_in_schema=False, response_class=PlainTextResponse)
def robots_txt() -> str:
    """Expose crawler rules and the canonical sitemap location."""
    return "User-agent: *\nAllow: /\nSitemap: https://zockdiewandan.online/sitemap.xml\n"


@app.get("/sitemap.xml", include_in_schema=False)
def sitemap_xml() -> Response:
    """List the stable public pages that are useful in search results."""
    body = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://zockdiewandan.online/</loc></url>
  <url><loc>https://zockdiewandan.online/regeln</loc></url>
  <url><loc>https://zockdiewandan.online/spieler</loc></url>
</urlset>
"""
    return Response(content=body, media_type="application/xml")


def _page(filename: str) -> FileResponse:
    return FileResponse(
        str(STATIC_DIR / filename),
        headers={"Cache-Control": "no-cache, must-revalidate"},
    )


@app.get("/regeln", include_in_schema=False)
def rules_page():
    return _page("rules.html")


@app.get("/spieler", include_in_schema=False)
def players_page():
    return _page("players.html")


@app.get("/spieler/{username}", include_in_schema=False)
def player_profile_page(username: str):
    return _page("profile.html")


@app.get("/konto", include_in_schema=False)
def account_page():
    return _page("account.html")


@app.get("/admin", include_in_schema=False)
def admin_page():
    return _page("admin.html")


@app.get("/spiel/{game_id}", include_in_schema=False)
@app.get("/spiel/{game_id}/zuschauen", include_in_schema=False)
def room_page(game_id: str):
    return _page("room.html")


@app.get("/ergebnis", include_in_schema=False)
@app.get("/ergebnis/{game_id}", include_in_schema=False)
def completed_game_page(game_id: str | None = None):
    return _page("game_view.html")


@app.get("/offline", include_in_schema=False)
def offline_page():
    return _page("offline.html")


@app.get("/api/health", include_in_schema=False)
def health() -> dict[str, str]:
    """Readiness probe: startup and all database migrations must be complete."""
    if not database_schema_ready():
        raise HTTPException(status_code=503, detail="database_not_ready")
    return {"status": "ok", "database": "ready"}


# Seitenweite, anonyme Presence. Mehrere Tabs mit derselben Browser-ID zählen
# als ein Nutzer; ein Heartbeat entfernt abgebrochene Verbindungen zeitnah.
presence_connections: dict[str, int] = {}
websocket_connections_by_address: dict[str, int] = {}


def _positive_int_setting(name: str, default: int) -> int:
    raw_value = os.getenv(name, str(default)).strip()
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a positive integer") from exc
    if value < 1:
        raise RuntimeError(f"{name} must be a positive integer")
    return value


MAX_WEBSOCKETS_PER_ADDRESS = _positive_int_setting("ROLLTHEDICE_MAX_WEBSOCKETS_PER_ADDRESS", 30)
MAX_WEBSOCKETS_GLOBAL = _positive_int_setting("ROLLTHEDICE_MAX_WEBSOCKETS_GLOBAL", 500)


def _websocket_address(websocket: WebSocket) -> str:
    return websocket.client.host if websocket.client else "unknown"


def _reserve_websocket(websocket: WebSocket) -> str | None:
    address = _websocket_address(websocket)
    if sum(websocket_connections_by_address.values()) >= MAX_WEBSOCKETS_GLOBAL:
        return None
    if websocket_connections_by_address.get(address, 0) >= MAX_WEBSOCKETS_PER_ADDRESS:
        return None
    websocket_connections_by_address[address] = websocket_connections_by_address.get(address, 0) + 1
    return address


def _release_websocket(address: str | None) -> None:
    if not address:
        return
    remaining = websocket_connections_by_address.get(address, 1) - 1
    if remaining > 0:
        websocket_connections_by_address[address] = remaining
    else:
        websocket_connections_by_address.pop(address, None)


def online_user_count() -> int:
    return len(presence_connections)


@app.websocket("/ws/presence")
async def presence(websocket: WebSocket) -> None:
    if not websocket_origin_allowed(websocket):
        await websocket.close(code=1008, reason="Origin rejected")
        return
    connection_address = _reserve_websocket(websocket)
    if connection_address is None:
        await websocket.close(code=1013, reason="Too many connections")
        return
    client_id = str(websocket.query_params.get("client_id") or "").strip()[:80]
    if not client_id:
        client_id = uuid.uuid4().hex
    await websocket.accept()
    presence_connections[client_id] = presence_connections.get(client_id, 0) + 1
    try:
        while True:
            await asyncio.wait_for(websocket.receive_text(), timeout=45)
    except (asyncio.TimeoutError, WebSocketDisconnect):
        pass
    finally:
        remaining = presence_connections.get(client_id, 1) - 1
        if remaining > 0:
            presence_connections[client_id] = remaining
        else:
            presence_connections.pop(client_id, None)
        _release_websocket(connection_address)


# -----------------------------
# HTTP API
# -----------------------------


@app.get("/")
def root():
    """Liefer Startseite (Lobby) aus dem Static-Verzeichnis aus."""
    return FileResponse(
        str(STATIC_DIR / "index.html"),
        headers={"Cache-Control": "no-cache, must-revalidate"},
    )


class CreateReq(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    mode: str | int
    passphrase: str | None = Field(default=None, alias="pass", max_length=100)
    hardcore: bool | None = False

    @field_validator("name")
    @classmethod
    def validate_name(_cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("game_name_required")
        return cleaned

    @field_validator("mode")
    @classmethod
    def validate_mode(_cls, value: str | int) -> str:
        cleaned = str(value).strip().lower()
        if cleaned not in {"1", "2", "3", "2v2"}:
            raise ValueError("invalid_game_mode")
        return cleaned

    @field_validator("passphrase")
    @classmethod
    def normalize_passphrase(_cls, value: str | None) -> str | None:
        cleaned = str(value or "").strip()
        return cleaned or None


class DeleteCompletedGameReq(BaseModel):
    reason: str = Field(min_length=10, max_length=500)
    confirmation_game_id: str = Field(min_length=1, max_length=64)


# --- Games API (mit wartenden Spielern) ---
@app.get("/api/games")
async def api_games(request: Request):
    """API: Liste aller Spiele (laufend, wartend, abgeschlossen/abgebrochen)."""
    sweep_timeouts()
    auth_identity = resolve_session(request)
    lst = []
    for gid, g in games.items():
        try:
            joined = len(g["_players"])
            waiting_names = [p.get("name", f"Player {i}") for i, p in enumerate(g["_players"], start=1)]
            offline = _offline_players(g)
            pause_reason = multiplayer_pause_reason(g)
            pause_left = pause_remaining_seconds(g)
            account_player = next(
                (p for p in g.get("_players", []) if auth_identity and p.get("user_id") == auth_identity.user_id),
                None,
            )
            lst.append(
                {
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
                    "connected": {str(p.get("id")): _player_connected(p) for p in g.get("_players", [])},
                    "player_statuses": [
                        {
                            "id": str(p.get("id")),
                            "name": p.get("name", "Player"),
                            "connected": _player_connected(p),
                        }
                        for p in g.get("_players", [])
                    ],
                    "offline": offline,
                    "paused": bool(pause_reason),
                    "pause_reason": pause_reason,
                    "manual_pause": bool(g.get("_manual_pause")),
                    "pause_remaining_seconds": pause_left,
                    "pause_remaining_label": _format_duration_hm(pause_left),
                    "my_player_id": str(account_player.get("id")) if account_player else None,
                    "timeout_seconds": timeout_seconds(),
                    "timeout_label": _format_duration_hm(timeout_seconds()),
                    "started_at": g.get("_started_at"),
                    "updated_at": g.get("_updated_at"),
                    "progress": (
                        _progress_for_game(g)
                        if g.get("_started") and not g.get("_finished") and not g.get("_aborted", False)
                        else []
                    ),
                }
            )
        except (KeyError, TypeError, ValueError):
            logger.warning("Skipping malformed game %s in lobby response", gid, exc_info=True)
            continue
    return {"games": lst, "online_users": online_user_count()}


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
    offline = _offline_players(g)
    pause_reason = multiplayer_pause_reason(g)
    pause_left = pause_remaining_seconds(g)
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
        "connected": {str(p.get("id")): _player_connected(p) for p in g.get("_players", [])},
        "player_statuses": [
            {
                "id": str(p.get("id")),
                "name": p.get("name", "Player"),
                "connected": _player_connected(p),
            }
            for p in g.get("_players", [])
        ],
        "offline": offline,
        "paused": bool(pause_reason),
        "pause_reason": pause_reason,
        "manual_pause": bool(g.get("_manual_pause")),
        "pause_remaining_seconds": pause_left,
        "pause_remaining_label": _format_duration_hm(pause_left),
        "timeout_seconds": timeout_seconds(),
        "timeout_label": _format_duration_hm(timeout_seconds()),
    }


@app.get("/api/leaderboard")
async def get_leaderboard():
    return await build_leaderboard(LEADERBOARD_FILES)


@app.get("/api/game_from_leaderboard/{game_id}")
def api_game_from_leaderboard(game_id: str):
    return game_from_leaderboard(LEADERBOARD_FILES, game_id)


@app.post("/api/games")
async def api_games_create(req: CreateReq, request: Request):
    """API: Neues Spiel anlegen (Name, Modus, optional Passphrase)."""
    enforce_game_creation_rate_limit(request)
    gid = str(uuid.uuid4())[:8]
    g = new_game(gid, req.name, req.mode)
    g["_passphrase"] = req.passphrase or None
    g["_hardcore"] = bool(req.hardcore or False)
    save_active_game(g)
    return {"game_id": gid}


# Brave/Chromium DevTools Ping unterdrücken
@app.get("/.well-known/appspecific/com.chrome.devtools")
async def chrome_devtools_placeholder():
    """Unterdrückt DevTools-WS-Probes von Chrome/Brave mit einfacher 200-Response."""
    return {"ok": True}


# -----------------------------
# Leaderboard/Stats Hilfsfunktionen
# -----------------------------
@app.delete("/api/admin/completed-games/{game_id}")
def admin_delete_completed_game(game_id: str, payload: DeleteCompletedGameReq, request: Request):
    identity = require_admin(request)
    require_csrf(request, identity)
    if payload.confirmation_game_id != game_id:
        raise HTTPException(status_code=400, detail="game_delete_confirmation_mismatch")
    try:
        deleted = delete_completed_game(
            game_id=game_id,
            admin_user_id=identity.user_id,
            reason=payload.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="game_not_found") from exc
    except ValueError as exc:
        detail = str(exc)
        status_code = 409 if detail == "game_already_deleted" else 400
        raise HTTPException(status_code=status_code, detail=detail) from exc
    _remove_deleted_game_from_files(deleted)
    return {
        "ok": True,
        "game_id": deleted["game_id"],
        "affected_user_ids": deleted["affected_user_ids"],
    }


def _remove_deleted_game_from_files(deleted: dict) -> None:
    remove_deleted_game_from_files(LEADERBOARD_FILES, deleted)


def _finalize_and_log_results(g: GameDict):
    return finalize_and_log_results(LEADERBOARD_FILES, g)


# -----------------------------
# WebSocket
# -----------------------------
@app.websocket("/ws/{game_id}")
async def ws_game(websocket: WebSocket, game_id: str) -> None:
    await serve_game_websocket(
        websocket,
        game_id,
        reserve_connection=_reserve_websocket,
        release_connection=_release_websocket,
        finalize_game=_finalize_and_log_results,
    )
