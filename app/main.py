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
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select

from .achievements import sync_achievements_for_users
from .active_games import load_active_games, save_active_game
from .api_auth import router as auth_router
from .api_users import router as users_router
from .auth import (
    ensure_bootstrap_admin,
    promote_legacy_session_cookie,
    require_admin,
    require_csrf,
    resolve_session,
    validate_session_cookie_config,
    websocket_origin_allowed,
)
from .auth_protection import enforce_game_creation_rate_limit, validate_auth_protection_config
from .database import configure_database, database_schema_ready, session_scope, upgrade_database
from .game_access import can_access_game, can_access_zilch_preview
from .game_history import (
    completed_game_type_for_id,
    delete_completed_game,
    import_legacy_leaderboards,
)
from .game_registry import create_game_state, finalize_completed_game, project_game_progress
from .game_results import remove_deleted_game_from_files
from .game_snapshot import public_player_payload, refresh_game_achievement_ranks
from .game_state import (
    GameDict,
    _format_duration_hm,
    _offline_players,
    _player_connected,
    games,
    multiplayer_pause_reason,
    pause_remaining_seconds,
    sweep_timeouts,
    timeout_seconds,
)
from .game_state import (
    new_game as _new_game,
)
from .game_types import DEFAULT_GAME_TYPE, ZILCH_GAME_TYPE, game_type_from_state, normalize_game_type
from .game_websocket import serve_game_websocket
from .http_cache import apply_cache_policy, read_static_asset_version
from .leaderboard_service import (
    build_leaderboard,
    game_from_leaderboard,
)
from .leaderboard_storage import LeaderboardFiles
from .models import User
from .product_hosts import (
    is_site_host,
    is_zilch_host,
    safe_zilch_path,
    site_origin,
    validate_product_host_config,
    zilch_url,
)
from .security import normalize_username
from .site_seo import robots_document, sitemap_document
from .zilch_achievements import (
    ZilchAchievementError,
    ZilchAchievementSyncError,
    acknowledge_zilch_award,
    get_zilch_achievement_profile,
    pending_zilch_awards,
    recover_deleted_zilch_achievement_sources,
    recover_pending_zilch_achievement_evaluations,
    remove_zilch_result_from_achievements,
)
from .zilch_cpu_strategy import ZilchCpuStrategyError, validate_zilch_cpu_strategy
from .zilch_engine import (
    ZILCH_BANK_MINIMUM,
    ZILCH_CONFIRMATION_MINIMUM,
    ZILCH_DICE_COUNT,
    ZILCH_RULESET_VERSION,
    ZILCH_TARGET_SCORE,
    ZILCH_THIRD_ROLL_MINIMUM,
    ZILCH_ZILCH_STREAK_PENALTY,
)
from .zilch_results import list_zilch_results_for_user, load_zilch_result_for_user
from .zilch_solo_objective import (
    ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
    ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
    validate_zilch_solo_objective_definition,
)
from .zilch_state import (
    ZILCH_CPU_MODE,
    ZILCH_SOLO_MODE,
    configure_zilch_cpu_game,
    configure_zilch_solo_game,
    validate_zilch_hvh_mode,
    zilch_expected_connection_count,
    zilch_expected_participant_count,
    zilch_participants,
    zilch_solo_objective_projection,
)
from .zilch_statistics import (
    ZilchStatisticsInputError,
    get_zilch_leaderboard,
    get_zilch_personal_statistics,
    list_zilch_leaderboard_categories,
)

# Retained as a small backwards-compatible module export for existing focused
# logic tests and integrations that historically imported ``app.main.new_game``.
new_game = _new_game

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
    validate_session_cookie_config()
    validate_product_host_config()
    ensure_bootstrap_admin()
    import_legacy_leaderboards(LEADERBOARD_FILES.legacy_paths())
    games.update(load_active_games())
    _recover_terminal_completed_games()
    # This is deliberately not a historical CompletedGame scan.  It retries
    # only work rows registered by a post-rollout Zilch finalizer after a
    # transient achievement-storage failure.
    try:
        recovery = recover_pending_zilch_achievement_evaluations()
        if recovery.get("failed"):
            logger.warning("Some pending Zilch achievement evaluations remain: %s", recovery["failed"])
        # A result may have been durably written just before shutdown while
        # its award evaluation was still pending.  The first terminal pass
        # above leaves that active terminal in place; this second pass can now
        # complete its idempotent finalizer in the same startup.
        if recovery.get("completed"):
            _recover_terminal_completed_games()
    except ZilchAchievementSyncError:
        logger.exception("Could not recover pending Zilch achievement evaluations")
    # This is a tombstone-only repair pass.  It cannot discover or award a
    # historic result: it merely removes stale private evidence after a
    # completed Zilch result was already administratively deleted.
    try:
        tombstone_recovery = recover_deleted_zilch_achievement_sources()
        if tombstone_recovery.get("failed"):
            logger.warning("Some deleted Zilch achievement sources remain: %s", tombstone_recovery["failed"])
    except ZilchAchievementSyncError:
        logger.exception("Could not recover deleted Zilch achievement sources")
    # CPU tasks are deliberately process-local.  Their eligibility is derived
    # from the recovered authoritative state, never serialized alongside a
    # timer or a fake connection.
    from .zilch_cpu_runner import resume_cpu_games, stop_cpu_runners

    await resume_cpu_games(games, finalize_game=_finalize_and_log_results)
    try:
        yield
    finally:
        await stop_cpu_runners()


app = FastAPI(lifespan=lifespan)


app.include_router(auth_router)
app.include_router(users_router)

LEGACY_PAGE_PATHS = {
    "/static/index.html": "/",
    "/static/rules.html": "/regeln",
    "/static/players.html": "/spieler",
    "/static/ranks.html": "/rangabzeichen",
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
    zilch_host = is_zilch_host(request)
    if zilch_host and (request.url.path == "/zilch" or request.url.path.startswith("/zilch/")):
        clean_path = request.url.path.removeprefix("/zilch") or "/"
        candidate = clean_path + (f"?{request.url.query}" if request.url.query else "")
        target = safe_zilch_path(candidate)
        response = RedirectResponse(
            target,
            status_code=308,
            headers={
                "Cache-Control": "no-store",
                "X-Robots-Tag": "noindex, nofollow",
            },
        )
        return response
    # ``zilch.html`` is an implementation artifact used by the protected
    # routes below.  Unlike public static assets, it must never become a
    # second, unauthenticated page entry point through the static mount.
    if request.url.path in {"/static/zilch.html", "/static/zilch-login.html"}:
        headers = {"Cache-Control": "no-store"}
        if zilch_host:
            headers["X-Robots-Tag"] = "noindex, nofollow"
        return Response(status_code=404, headers=headers)
    legacy_target = _legacy_page_target(request)
    if legacy_target:
        response = RedirectResponse(legacy_target, status_code=308)
    else:
        response = await call_next(request)
    apply_cache_policy(request, response, asset_version=STATIC_ASSET_VERSION)
    if zilch_host:
        response.headers["X-Robots-Tag"] = "noindex, nofollow"
    return response


# Static korrekt mounten – jetzt existiert app
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# Manifest (am Root-Pfad) mit korrektem MIME-Type ausliefern
@app.get("/manifest.webmanifest", include_in_schema=False)
def manifest(request: Request):
    if is_zilch_host(request):
        return Response(status_code=404, headers={"Cache-Control": "no-store"})
    # liegt im Repo-Root neben Dockerfile / README
    return FileResponse(str(BASE / "manifest.webmanifest"), media_type="application/manifest+json")


@app.get("/manifest-en.webmanifest", include_in_schema=False)
def manifest_en(request: Request):
    if is_zilch_host(request):
        return Response(status_code=404, headers={"Cache-Control": "no-store"})
    return FileResponse(str(BASE / "manifest-en.webmanifest"), media_type="application/manifest+json")


# Service Worker (Root-Scope) ausliefern
@app.get("/sw.js", include_in_schema=False)
def service_worker(request: Request):
    if is_zilch_host(request):
        return Response(status_code=404, headers={"Cache-Control": "no-store"})
    return FileResponse(
        str(STATIC_DIR / "sw.js"),
        media_type="text/javascript",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(str(STATIC_DIR / "favicon.png"), media_type="image/png")


@app.get("/robots.txt", include_in_schema=False, response_class=PlainTextResponse)
def robots_txt(request: Request) -> str:
    """Expose crawler rules and the canonical sitemap location."""
    if is_zilch_host(request):
        return "User-agent: *\nDisallow: /\n"
    return robots_document()


@app.get("/sitemap.xml", include_in_schema=False)
def sitemap_xml(request: Request) -> Response:
    """List the stable public pages that are useful in search results."""
    if is_zilch_host(request):
        return Response(status_code=404, headers={"Cache-Control": "no-store"})
    return Response(content=sitemap_document(), media_type="application/xml")


def _page(filename: str) -> FileResponse:
    return FileResponse(
        str(STATIC_DIR / filename),
        headers={"Cache-Control": "no-cache, must-revalidate"},
    )


@app.get("/regeln", include_in_schema=False)
def rules_page(request: Request):
    if is_zilch_host(request):
        return _serve_zilch_shell(request)
    return _page("rules.html")


@app.get("/spieler", include_in_schema=False)
def players_page(request: Request):
    if is_zilch_host(request):
        return _serve_zilch_shell(request)
    return _page("players.html")


@app.get("/spieler/{username}", include_in_schema=False)
def player_profile_page(username: str, request: Request):
    if is_zilch_host(request):
        return _serve_zilch_shell(request)
    return _page("profile.html")


@app.get("/rangabzeichen", include_in_schema=False)
def achievement_rank_legend_page(request: Request):
    """Serve the public explanation of achievement rank badges."""
    if is_zilch_host(request):
        return RedirectResponse("/erfolge", status_code=308)
    return _page("ranks.html")


@app.get("/konto", include_in_schema=False)
def account_page(request: Request):
    if is_zilch_host(request):
        return _serve_zilch_shell(request)
    return _page("account.html")


@app.get("/admin", include_in_schema=False)
def admin_page(request: Request):
    if is_zilch_host(request):
        return RedirectResponse(f"{site_origin()}/admin", status_code=308)
    return _page("admin.html")


@app.get("/spiel/{game_id}", include_in_schema=False)
@app.get("/spiel/{game_id}/zuschauen", include_in_schema=False)
def room_page(game_id: str, request: Request):
    # A known Zilch game never mounts the ZDWA room.  The dedicated page has a
    # second server-side check, while the 404 here avoids revealing it to an
    # unauthorized caller who guessed an ID.
    game = games.get(game_id)
    if is_zilch_host(request):
        return zilch_room_page(game_id, request)
    if game and game_type_from_state(game) == ZILCH_GAME_TYPE:
        if not can_access_game(resolve_session(request), game):
            raise HTTPException(status_code=404, detail="game_not_found")
        return RedirectResponse(f"/zilch/spiel/{quote(game_id, safe='')}", status_code=307)
    return _page("room.html")


def _require_zilch_preview(request: Request):
    """Resolve the session once and enforce the central Zilch preview policy."""
    identity = resolve_session(request)
    if not identity:
        raise HTTPException(status_code=401, detail="authentication_required")
    if not can_access_zilch_preview(identity):
        raise HTTPException(status_code=403, detail="zilch_preview_required")
    return identity


def _clean_zilch_request_path(request: Request) -> str:
    path = request.url.path
    if path == "/zilch" or path.startswith("/zilch/"):
        path = path.removeprefix("/zilch") or "/"
    if request.url.query:
        path = f"{path}?{request.url.query}"
    return safe_zilch_path(path)


def _zilch_handoff_url(request: Request) -> str:
    query = urlencode({"app": "zilch", "path": _clean_zilch_request_path(request)})
    return f"{site_origin()}/auth/continue?{query}"


def _resolve_zilch_access(request: Request):
    identity = resolve_session(request)
    if not identity:
        if is_zilch_host(request):
            return None, RedirectResponse(_zilch_handoff_url(request), status_code=303)
        raise HTTPException(status_code=401, detail="authentication_required")
    if not can_access_zilch_preview(identity):
        if is_zilch_host(request):
            return None, RedirectResponse(f"{site_origin()}/zilch/anmelden", status_code=303)
        raise HTTPException(status_code=403, detail="zilch_preview_required")
    return identity, None


def _serve_zilch_shell(request: Request):
    """Serve Zilch or move a new subdomain visitor through the apex login handoff."""
    _identity, redirect = _resolve_zilch_access(request)
    if redirect:
        return redirect
    return _page("zilch.html")


@app.get("/zilch", include_in_schema=False)
def zilch_preview_page(request: Request):
    """Serve the internal, noindex Zilch shell only to the preview identity."""
    return _serve_zilch_shell(request)


@app.get("/zilch/anmelden", include_in_schema=False)
def zilch_login_page():
    """Provide a direct, noindex account entry before the protected Zilch shell.

    This is intentionally public: a future Zilch subdomain needs a place to
    establish the shared account session. Access to the game itself remains
    enforced by ``_require_zilch_preview`` after sign-in.
    """
    return _page("zilch-login.html")


@app.get("/zilch/spiel/{game_id}", include_in_schema=False)
def zilch_room_page(game_id: str, request: Request):
    """Serve a Zilch room only after both policy and type checks pass."""
    identity, redirect = _resolve_zilch_access(request)
    if redirect:
        return redirect
    game = games.get(game_id)
    if not game or game_type_from_state(game) != ZILCH_GAME_TYPE or not can_access_game(identity, game):
        raise HTTPException(status_code=404, detail="game_not_found")
    return _page("zilch.html")


@app.get("/zilch/ergebnis/{game_id}", include_in_schema=False)
def zilch_result_page(game_id: str, request: Request):
    """Serve the noindex Zilch shell for one participant-owned result."""
    identity, redirect = _resolve_zilch_access(request)
    if redirect:
        return redirect
    if load_zilch_result_for_user(game_id, identity.user_id) is None:
        # Do not distinguish an unknown ID, a ZDWA ID, or a malformed private
        # Zilch payload at this route.
        raise HTTPException(status_code=404, detail="result_not_found")
    return _page("zilch.html")


@app.get("/zilch/historie", include_in_schema=False)
def zilch_history_page(request: Request):
    """Serve the private, noindex Zilch shell for the history view."""
    return _serve_zilch_shell(request)


@app.get("/zilch/statistiken", include_in_schema=False)
def zilch_statistics_page(request: Request):
    """Serve the private, noindex Zilch shell for personal statistics."""
    return _serve_zilch_shell(request)


@app.get("/zilch/bestenlisten", include_in_schema=False)
def zilch_leaderboards_page(request: Request):
    """Serve the private, noindex Zilch shell for Zilch leaderboards."""
    return _serve_zilch_shell(request)


@app.get("/zilch/erfolge", include_in_schema=False)
def zilch_achievements_page(request: Request):
    """Serve the private noindex Zilch award collection."""
    return _serve_zilch_shell(request)


@app.get("/zilch/konto", include_in_schema=False)
def zilch_account_page(request: Request):
    """Serve the private Zilch account, including its separate awards."""
    return _serve_zilch_shell(request)


@app.get("/zilch/spieler/{username}", include_in_schema=False)
def zilch_player_achievements_page(username: str, request: Request):
    """Serve a private Zilch-context award profile, never the public ZDWA one."""
    return _serve_zilch_shell(request)


@app.get("/zilch/regeln", include_in_schema=False)
def zilch_rules_page(request: Request):
    """Serve the private, noindex Zilch shell for the rules view."""
    return _serve_zilch_shell(request)


@app.get("/anmelden", include_in_schema=False)
def zilch_subdomain_login_page(request: Request, return_to: str = Query(default="/")):
    if not is_zilch_host(request):
        raise HTTPException(status_code=404, detail="not_found")
    query = urlencode({"app": "zilch", "path": safe_zilch_path(return_to)})
    return RedirectResponse(f"{site_origin()}/auth/continue?{query}", status_code=303)


@app.get("/historie", include_in_schema=False)
def zilch_subdomain_history_page(request: Request):
    if not is_zilch_host(request):
        raise HTTPException(status_code=404, detail="not_found")
    return _serve_zilch_shell(request)


@app.get("/statistiken", include_in_schema=False)
def zilch_subdomain_statistics_page(request: Request):
    if not is_zilch_host(request):
        raise HTTPException(status_code=404, detail="not_found")
    return _serve_zilch_shell(request)


@app.get("/bestenlisten", include_in_schema=False)
def zilch_subdomain_leaderboards_page(request: Request):
    if not is_zilch_host(request):
        raise HTTPException(status_code=404, detail="not_found")
    return _serve_zilch_shell(request)


@app.get("/erfolge", include_in_schema=False)
def zilch_subdomain_achievements_page(request: Request):
    if not is_zilch_host(request):
        raise HTTPException(status_code=404, detail="not_found")
    return _serve_zilch_shell(request)


@app.get("/auth/continue", include_in_schema=False)
def continue_to_product(request: Request, app_name: str = Query(alias="app"), path: str = Query(default="/")):
    """Promote an apex login and continue only to a fixed, allowlisted product URL."""
    if not is_site_host(request) or app_name != "zilch":
        raise HTTPException(status_code=404, detail="product_not_found")
    private_headers = {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
    }
    destination_path = safe_zilch_path(path)
    identity = resolve_session(request)
    if not identity:
        return_path = f"/auth/continue?{urlencode({'app': 'zilch', 'path': destination_path})}"
        login_url = f"{site_origin()}/zilch/anmelden?{urlencode({'return_to': return_path})}"
        return RedirectResponse(login_url, status_code=303, headers=private_headers)
    if not can_access_zilch_preview(identity):
        return RedirectResponse(
            f"{site_origin()}/zilch/anmelden",
            status_code=303,
            headers=private_headers,
        )
    response = RedirectResponse(
        zilch_url(destination_path),
        status_code=303,
        headers=private_headers,
    )
    promote_legacy_session_cookie(response, request)
    return response


@app.get("/ergebnis", include_in_schema=False)
@app.get("/ergebnis/{game_id}", include_in_schema=False)
def completed_game_page(request: Request, game_id: str | None = None):
    # A stored Zilch game must never mount the fixed ZDWA replay renderer.
    # The public route gives no indication that a private result exists.
    if is_zilch_host(request):
        if not game_id:
            raise HTTPException(status_code=404, detail="result_not_found")
        return zilch_result_page(game_id, request)
    if game_id and completed_game_type_for_id(game_id) == ZILCH_GAME_TYPE:
        identity = resolve_session(request)
        if (
            not can_access_zilch_preview(identity)
            or load_zilch_result_for_user(game_id, identity.user_id) is None
        ):
            raise HTTPException(status_code=404, detail="result_not_found")
        return RedirectResponse(f"/zilch/ergebnis/{quote(game_id, safe='')}", status_code=307)
    return _page("game_view.html")


@app.get("/offline", include_in_schema=False)
def offline_page(request: Request):
    if is_zilch_host(request):
        return Response(status_code=404, headers={"Cache-Control": "no-store"})
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


def _lobby_current_player(game: GameDict) -> tuple[str | None, str | None]:
    """Return a safe, presentation-only current-player hint for game lists."""
    raw_turn = game.get("_turn")
    if not isinstance(raw_turn, dict):
        return None, None
    raw_player_id = raw_turn.get("player_id")
    player_id = str(raw_player_id).strip() if raw_player_id is not None else ""
    if not player_id:
        return None, None
    player = next(
        (candidate for candidate in zilch_participants(game) if str(candidate.get("id") or "") == player_id),
        None,
    )
    if not isinstance(player, dict):
        return None, None
    return player_id, str(player.get("name") or "Player")


def _zilch_lobby_final_round(game: GameDict) -> dict[str, object] | None:
    """Project only the non-scoring final-round state useful in a Zilch lobby."""
    raw_final_round = game.get("_zilch_final_round")
    if not isinstance(raw_final_round, dict):
        return None
    player_ids = {str(player.get("id") or "") for player in zilch_participants(game)}
    raw_triggered_by = str(raw_final_round.get("triggered_by") or "")
    triggered_by = raw_triggered_by if raw_triggered_by in player_ids else None
    raw_pending = raw_final_round.get("pending_player_ids")
    pending_player_ids = (
        [str(player_id) for player_id in raw_pending if str(player_id) in player_ids]
        if isinstance(raw_pending, list)
        else []
    )
    if triggered_by is None and not pending_player_ids:
        return None
    return {
        "triggered_by": triggered_by,
        "pending_player_ids": pending_player_ids,
    }


def _zilch_lobby_participants(game: GameDict) -> list[dict[str, object]]:
    """Project durable Zilch seats without turning a CPU into a connection."""
    connections = {
        str(player.get("id") or ""): player
        for player in game.get("_players", [])
        if isinstance(player, dict) and str(player.get("id") or "")
    }
    result: list[dict[str, object]] = []
    for participant in zilch_participants(game):
        participant_id = str(participant.get("id") or "")
        if not participant_id:
            continue
        is_cpu = participant.get("type") == "cpu"
        connection = connections.get(str(participant.get("connection_player_id") or participant_id))
        result.append(
            {
                "id": participant_id,
                "name": str(participant.get("name") or "Player"),
                "participant_type": participant.get("type"),
                "cpu_strategy": participant.get("cpu_strategy"),
                "user_id": participant.get("user_id"),
                "is_cpu": is_cpu,
                "connected": None if is_cpu else bool(connection and _player_connected(connection)),
            }
        )
    return result


def _zilch_cpu_strategy(game: GameDict) -> str | None:
    """Return the persisted CPU strategy for a Zilch lobby projection."""
    cpu = next((participant for participant in zilch_participants(game) if participant.get("type") == "cpu"), None)
    strategy = cpu.get("cpu_strategy") if isinstance(cpu, dict) else None
    return strategy if isinstance(strategy, str) else None


def _is_zilch_cpu_host(game: GameDict, user_id: object) -> bool:
    """Identify the one account allowed to occupy a pre-created CPU seat."""
    return (
        game.get("_play_mode") == ZILCH_CPU_MODE
        and type(user_id) is int
        and type(game.get("_zilch_cpu_host_user_id")) is int
        and game["_zilch_cpu_host_user_id"] == user_id
    )


def _is_zilch_solo_host(game: GameDict, user_id: object) -> bool:
    """Identify the one account allowed to take a configured Solo seat."""
    return (
        game.get("_play_mode") == ZILCH_SOLO_MODE
        and type(user_id) is int
        and type(game.get("_zilch_solo_host_user_id")) is int
        and game["_zilch_solo_host_user_id"] == user_id
    )


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
def root(request: Request):
    """Liefer Startseite (Lobby) aus dem Static-Verzeichnis aus."""
    if is_zilch_host(request):
        return _serve_zilch_shell(request)
    return FileResponse(
        str(STATIC_DIR / "index.html"),
        headers={"Cache-Control": "no-cache, must-revalidate"},
    )


class CreateReq(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    mode: str | int
    game_type: str = Field(default=DEFAULT_GAME_TYPE, max_length=16)
    passphrase: str | None = Field(default=None, alias="pass", max_length=100)
    hardcore: bool | None = False
    play_mode: str | None = Field(default=None, max_length=16)
    cpu_strategy: str | None = Field(default=None, max_length=32)

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

    @field_validator("game_type")
    @classmethod
    def validate_game_type(_cls, value: str) -> str:
        try:
            return normalize_game_type(value)
        except ValueError as exc:
            raise ValueError("invalid_game_type") from exc

    @field_validator("passphrase")
    @classmethod
    def normalize_passphrase(_cls, value: str | None) -> str | None:
        cleaned = str(value or "").strip()
        return cleaned or None

    @field_validator("play_mode")
    @classmethod
    def normalize_play_mode(_cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = str(value).strip().lower()
        if cleaned not in {"multiplayer", "cpu", "solo"}:
            raise ValueError("zilch_invalid_play_mode")
        return cleaned

    @model_validator(mode="after")
    def validate_game_specific_options(self):
        if self.game_type == ZILCH_GAME_TYPE:
            if self.hardcore:
                raise ValueError("zilch_hardcore_not_supported")
            self.play_mode = self.play_mode or "multiplayer"
            if self.play_mode == ZILCH_SOLO_MODE:
                if self.mode != "1":
                    raise ValueError("zilch_solo_requires_one_player")
                if self.cpu_strategy is not None:
                    raise ValueError("zilch_cpu_strategy_not_allowed")
                if self.passphrase is not None:
                    raise ValueError("zilch_solo_roomcode_not_supported")
            else:
                try:
                    validate_zilch_hvh_mode(self.mode)
                except ValueError as exc:
                    raise ValueError(str(exc)) from exc
            if self.play_mode == ZILCH_CPU_MODE:
                try:
                    self.cpu_strategy = validate_zilch_cpu_strategy(self.cpu_strategy)
                except ZilchCpuStrategyError as exc:
                    raise ValueError(exc.code) from exc
            elif self.play_mode != ZILCH_SOLO_MODE and self.cpu_strategy is not None:
                raise ValueError("zilch_cpu_strategy_not_allowed")
        elif self.play_mode is not None or self.cpu_strategy is not None:
            raise ValueError("game_play_mode_not_supported")
        return self


class DeleteCompletedGameReq(BaseModel):
    reason: str = Field(min_length=10, max_length=500)
    confirmation_game_id: str = Field(min_length=1, max_length=64)


# --- Games API (mit wartenden Spielern) ---
@app.get("/api/games")
async def api_games(request: Request, game_type: str = Query(default=DEFAULT_GAME_TYPE)):
    """API: Liste aller Spiele (laufend, wartend, abgeschlossen/abgebrochen)."""
    sweep_timeouts()
    auth_identity = resolve_session(request)
    try:
        requested_game_type = normalize_game_type(game_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="invalid_game_type") from exc
    # Returning an empty list is deliberate: an unauthorized request cannot
    # distinguish an inaccessible Zilch lobby from one with no games.
    if requested_game_type == ZILCH_GAME_TYPE and not can_access_zilch_preview(auth_identity):
        return {"games": [], "online_users": online_user_count()}
    lst = []
    for gid, g in games.items():
        try:
            # A final live object can remain in memory just long enough to
            # finish its connected socket broadcast. Its durable result now
            # belongs to private history, not the active-game lobby.
            if g.get("_completion_persisted"):
                continue
            if game_type_from_state(g) != requested_game_type:
                continue
            if not can_access_game(auth_identity, g):
                continue
            refresh_game_achievement_ranks(g)
            joined = len(g["_players"])
            waiting_names = [p.get("name", f"Player {i}") for i, p in enumerate(g["_players"], start=1)]
            offline = _offline_players(g)
            pause_reason = multiplayer_pause_reason(g)
            pause_left = pause_remaining_seconds(g)
            account_player = next(
                (p for p in g.get("_players", []) if auth_identity and p.get("user_id") == auth_identity.user_id),
                None,
            )
            entry = {
                "id": gid,
                "game_type": requested_game_type,
                "name": g["_name"],
                "mode": g["_mode"],
                "hardcore": bool(g.get("_hardcore", False)),
                "players": joined,
                "expected": g["_expected"],
                "started": g["_started"],
                "finished": g["_finished"],
                "aborted": g.get("_aborted", False),
                "locked": bool(g.get("_passphrase")),
                "waiting": waiting_names,
                "connected": {str(p.get("id")): _player_connected(p) for p in g.get("_players", [])},
                "player_statuses": [
                    public_player_payload(p, connected=_player_connected(p)) for p in g.get("_players", [])
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
                    project_game_progress(g)
                    if g.get("_started") and not g.get("_finished") and not g.get("_aborted", False)
                    else []
                ),
            }
            if requested_game_type == ZILCH_GAME_TYPE:
                current_player_id, current_player_name = _lobby_current_player(g)
                entry["current_player_id"] = current_player_id
                entry["current_player_name"] = current_player_name
                entry["final_round"] = _zilch_lobby_final_round(g)
                entry["play_mode"] = g.get("_play_mode", "multiplayer")
                entry["participants"] = _zilch_lobby_participants(g)
                entry["participant_count"] = len(entry["participants"])
                entry["expected_participants"] = zilch_expected_participant_count(g)
                entry["expected_connections"] = zilch_expected_connection_count(g)
                entry["cpu_strategy"] = _zilch_cpu_strategy(g)
                entry["my_cpu_host"] = _is_zilch_cpu_host(g, auth_identity.user_id if auth_identity else None)
                solo = zilch_solo_objective_projection(g)
                entry["solo_objective"] = solo
                entry["solo_metrics"] = dict(solo.get("metrics") or {}) if isinstance(solo, dict) else None
                entry["my_solo_host"] = _is_zilch_solo_host(g, auth_identity.user_id if auth_identity else None)
            lst.append(entry)
        except (KeyError, TypeError, ValueError):
            logger.warning("Skipping malformed game %s in lobby response", gid, exc_info=True)
            continue
    return {"games": lst, "online_users": online_user_count()}


@app.get("/api/games/{game_id}")
def game_info(
    game_id: str,
    request: Request,
    passphrase: str | None = Query(default=None, alias="pass"),
    check: int = Query(default=0),
):
    """API: Detailinfos zu einem Spiel inkl. Fortschritt/Player-Status."""
    sweep_timeouts()
    g = games.get(game_id)
    if not g:
        return {"exists": False}
    auth_identity = resolve_session(request)
    if not can_access_game(auth_identity, g):
        raise HTTPException(status_code=404, detail="game_not_found")

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
    refresh_game_achievement_ranks(g)
    offline = _offline_players(g)
    pause_reason = multiplayer_pause_reason(g)
    pause_left = pause_remaining_seconds(g)
    result = {
        "exists": True,
        "id": game_id,
        "game_type": game_type_from_state(g),
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
            public_player_payload(p, connected=_player_connected(p))
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
        "progress": (
            project_game_progress(g)
            if g.get("_started") and not g.get("_finished") and not g.get("_aborted", False)
            else []
        ),
    }
    if game_type_from_state(g) == ZILCH_GAME_TYPE:
        current_player_id, current_player_name = _lobby_current_player(g)
        solo_projection = zilch_solo_objective_projection(g)
        result.update(
            {
                "play_mode": g.get("_play_mode", "multiplayer"),
                "participants": _zilch_lobby_participants(g),
                "participant_count": len(zilch_participants(g)),
                "expected_participants": zilch_expected_participant_count(g),
                "expected_connections": zilch_expected_connection_count(g),
                "cpu_strategy": _zilch_cpu_strategy(g),
                "my_cpu_host": _is_zilch_cpu_host(g, auth_identity.user_id if auth_identity else None),
                "my_solo_host": _is_zilch_solo_host(g, auth_identity.user_id if auth_identity else None),
                "solo_objective": solo_projection,
                "solo_metrics": dict(solo_projection.get("metrics") or {}) if isinstance(solo_projection, dict) else None,
                "current_player_id": current_player_id,
                "current_player_name": current_player_name,
                "final_round": _zilch_lobby_final_round(g),
            }
        )
    return result


@app.get("/api/leaderboard")
async def get_leaderboard():
    return await build_leaderboard(LEADERBOARD_FILES)


@app.get("/api/game_from_leaderboard/{game_id}")
def api_game_from_leaderboard(game_id: str):
    return game_from_leaderboard(LEADERBOARD_FILES, game_id)


@app.get("/api/zilch/results")
def api_zilch_results(request: Request):
    """Return only the authenticated preview user's own private history."""
    identity = _require_zilch_preview(request)
    return {"results": list_zilch_results_for_user(identity.user_id)}


@app.get("/api/zilch/results/{game_id}")
def api_zilch_result(game_id: str, request: Request):
    """Read the caller's known-version Zilch result without ZDWA projection."""
    identity = _require_zilch_preview(request)
    result = load_zilch_result_for_user(game_id, identity.user_id)
    if result is None:
        raise HTTPException(status_code=404, detail="result_not_found")
    return {"result": result}


@app.get("/api/zilch/statistics")
def api_zilch_statistics(request: Request) -> dict[str, object]:
    """Return only the authenticated preview user's Zilch-only statistics."""
    identity = _require_zilch_preview(request)
    # The user relation is intentionally never a client parameter.  Zilch
    # statistics are private account data, not a public profile projection.
    return get_zilch_personal_statistics(identity.user_id)


@app.get("/api/zilch/leaderboards/categories")
def api_zilch_leaderboard_categories(request: Request) -> dict[str, object]:
    """Expose only safe metadata for the currently implemented private tables."""
    _require_zilch_preview(request)
    return {"version": 1, "categories": list_zilch_leaderboard_categories()}


@app.get("/api/zilch/leaderboards")
def api_zilch_leaderboards(
    request: Request,
    category: str = Query("solo_sprint", max_length=48),
    strategy: str | None = Query(None, max_length=32),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1),
) -> dict[str, object]:
    """Read one bounded, server-calculated private Zilch leaderboard."""
    identity = _require_zilch_preview(request)
    try:
        return get_zilch_leaderboard(
            category,
            strategy=strategy,
            offset=offset,
            limit=limit,
            current_user_id=identity.user_id,
        )
    except ZilchStatisticsInputError as exc:
        raise HTTPException(status_code=400, detail=exc.code) from exc


def _safe_zilch_achievement_profile(user_id: int) -> dict[str, object]:
    """Return an award-only projection without leaking a database user ID."""
    profile = get_zilch_achievement_profile(user_id)
    player = profile.get("player") if isinstance(profile, dict) else None
    if isinstance(player, dict) and player.get("username"):
        profile = {**profile, "player": {"username": str(player["username"])}}
    return profile


def _zilch_achievement_http_error(exc: ZilchAchievementError | ZilchAchievementSyncError) -> HTTPException:
    """Keep private award errors compact without disclosing source evidence."""
    code = getattr(exc, "code", "zilch_achievement_unavailable")
    if code in {
        "zilch_achievement_user_not_found",
        "zilch_achievement_unknown_key",
        "zilch_achievement_not_unlocked",
        "zilch_achievement_delivery_missing",
    }:
        return HTTPException(status_code=404, detail="zilch_achievement_not_found")
    return HTTPException(status_code=503, detail="zilch_achievements_unavailable")


@app.get("/api/zilch/achievements")
def api_zilch_achievements(request: Request) -> dict[str, object]:
    """Return only the current preview account's private Zilch awards."""
    identity = _require_zilch_preview(request)
    try:
        return _safe_zilch_achievement_profile(identity.user_id)
    except (ZilchAchievementError, ZilchAchievementSyncError) as exc:
        raise _zilch_achievement_http_error(exc) from exc


@app.get("/api/zilch/players/{username}/achievements")
def api_zilch_player_achievements(username: str, request: Request) -> dict[str, object]:
    """Read another active account's awards only inside the preview product."""
    _require_zilch_preview(request)
    normalized_username = normalize_username(username)
    if not normalized_username:
        raise HTTPException(status_code=404, detail="zilch_achievement_not_found")
    with session_scope() as db:
        user_id = db.scalar(
            select(User.id).where(
                User.username_normalized == normalized_username,
                User.is_active.is_(True),
            )
        )
    if user_id is None:
        raise HTTPException(status_code=404, detail="zilch_achievement_not_found")
    try:
        return _safe_zilch_achievement_profile(int(user_id))
    except (ZilchAchievementError, ZilchAchievementSyncError) as exc:
        raise _zilch_achievement_http_error(exc) from exc


@app.get("/api/zilch/achievements/pending")
def api_zilch_pending_achievements(request: Request) -> dict[str, object]:
    """Read the caller's reload-safe, not-yet-acknowledged award queue."""
    identity = _require_zilch_preview(request)
    try:
        return pending_zilch_awards(identity.user_id)
    except (ZilchAchievementError, ZilchAchievementSyncError) as exc:
        raise _zilch_achievement_http_error(exc) from exc


@app.post("/api/zilch/achievements/{achievement_key}/acknowledge")
def api_acknowledge_zilch_achievement(achievement_key: str, request: Request) -> dict[str, object]:
    """Acknowledge a presentation only; it can never grant an award."""
    identity = _require_zilch_preview(request)
    require_csrf(request, identity)
    try:
        acknowledgement = acknowledge_zilch_award(identity.user_id, achievement_key)
    except (ZilchAchievementError, ZilchAchievementSyncError) as exc:
        raise _zilch_achievement_http_error(exc) from exc
    return {"ok": True, **acknowledgement}


@app.get("/api/zilch/rules")
def api_zilch_rules(request: Request) -> dict[str, object]:
    """Return the small authoritative rules projection used by the private UI."""
    _require_zilch_preview(request)
    solo_definition = validate_zilch_solo_objective_definition(
        ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
        ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
    )
    return {
        "ruleset": ZILCH_RULESET_VERSION,
        "dice_count": ZILCH_DICE_COUNT,
        "target_score": ZILCH_TARGET_SCORE,
        "bank_minimum": ZILCH_BANK_MINIMUM,
        "third_roll_minimum": ZILCH_THIRD_ROLL_MINIMUM,
        "confirmation_minimum": ZILCH_CONFIRMATION_MINIMUM,
        "third_zilch_penalty": ZILCH_ZILCH_STREAK_PENALTY,
        "solo_objective": solo_definition.payload(),
        "scoring": {
            "single_one": 100,
            "single_five": 50,
            "three_ones": 1_000,
            "straight": 2_000,
            "three_pairs": 500,
            "nothing_bonus": 500,
        },
    }


@app.post("/api/games")
async def api_games_create(req: CreateReq, request: Request):
    """API: Neues Spiel anlegen (Name, Modus, optional Passphrase)."""
    identity = None
    if req.game_type == ZILCH_GAME_TYPE:
        identity = _require_zilch_preview(request)
    enforce_game_creation_rate_limit(request)
    gid = str(uuid.uuid4())[:8]
    g = create_game_state(gid, req.name, req.mode, req.game_type)
    if req.game_type == ZILCH_GAME_TYPE and req.play_mode == ZILCH_CPU_MODE:
        # The creator is the only human seat.  The CPU is a durable domain
        # participant and receives neither account data nor a socket record.
        configure_zilch_cpu_game(
            g,
            host_user_id=identity.user_id,
            cpu_strategy=req.cpu_strategy,
        )
    elif req.game_type == ZILCH_GAME_TYPE and req.play_mode == ZILCH_SOLO_MODE:
        # The host is the only durable human seat. The Objective is fixed by
        # the server; no browser parameter can tune target or ranking.
        configure_zilch_solo_game(g, host_user_id=identity.user_id)
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
    stored_type = completed_game_type_for_id(game_id)
    if stored_type == ZILCH_GAME_TYPE and not can_access_zilch_preview(identity):
        # A general application administrator is not automatically a member
        # of the deliberately narrow Zilch preview cohort.
        raise HTTPException(status_code=404, detail="game_not_found")
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
    if deleted["game_type"] == DEFAULT_GAME_TYPE:
        _remove_deleted_game_from_files(deleted)
        sync_achievements_for_users(set(deleted["affected_user_ids"]))
    elif deleted["game_type"] == ZILCH_GAME_TYPE:
        # The isolated service removes source evidence and recomputes only
        # these private Zilch awards.  It never touches ZDWA achievement
        # marks, titles, JSON aggregates, or public profile projections.
        try:
            remove_zilch_result_from_achievements(
                deleted["game_id"],
                user_ids=deleted["affected_user_ids"],
            )
        except ZilchAchievementSyncError:
            # The typed result and tombstone are already durable.  Do not
            # pretend that deletion failed or leak a server error after that
            # fact; the bounded startup tombstone pass will retry the only
            # still-pending private cleanup.
            logger.exception("Queued Zilch achievement cleanup after deleting %s", deleted["game_id"])
            deleted["achievement_cleanup_pending"] = True
    return {
        "ok": True,
        "game_id": deleted["game_id"],
        "affected_user_ids": deleted["affected_user_ids"],
        "achievement_cleanup_pending": bool(deleted.get("achievement_cleanup_pending", False)),
    }


def _remove_deleted_game_from_files(deleted: dict) -> None:
    remove_deleted_game_from_files(LEADERBOARD_FILES, deleted)


def _finalize_and_log_results(g: GameDict):
    return finalize_completed_game(g, files=LEADERBOARD_FILES)


def _recover_terminal_completed_games() -> None:
    """Retry durable finalization after a restart without inventing state.

    Terminal snapshots are retained by ``active_games`` until their typed
    finalizer succeeds.  Malformed legacy Zilch terminals intentionally stay
    in storage for inspection rather than being deleted or coerced into ZDWA.
    """
    for game_id, game in list(games.items()):
        if not game.get("_finished") or game.get("_aborted") or game.get("_completion_persisted"):
            continue
        try:
            completion = _finalize_and_log_results(game)
        except Exception:
            logger.exception("Could not recover terminal game %s", game_id)
            continue
        if (
            isinstance(completion, dict)
            and completion.get("result_persisted")
            and not completion.get("achievement_sync_pending")
        ):
            game["_final_completion"] = completion
            games.pop(game_id, None)


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
