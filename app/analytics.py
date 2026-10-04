"""Small, bounded first-party telemetry with no account or network identifiers.

Collection is best effort: request handlers only enqueue sanitized records; a
single worker owns short SQLite writes. A tab session is an anonymous visit,
never a unique person. Game completion figures come from durable server results.
"""
from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import logging
import os
import queue
import re
import resource
import shutil
import sys
import time
from collections import OrderedDict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, case, cast, delete, func, insert, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Mapped, Session, mapped_column

from .database import get_engine, session_scope
from .models import ActiveGame, Base, CompletedGame, GameParticipant
from .security import as_utc, utcnow

logger = logging.getLogger(__name__)
RETENTION_DAYS = 90
MAX_BODY_BYTES = 32768
MAX_BATCH_EVENTS = 20
MAX_STORED_EVENTS = 200_000
MAX_QUEUE_BATCHES = 300
LIVE_WINDOW_SECONDS = 120
SESSION_RE = re.compile(r"^[a-f0-9]{32,64}$")
ID_RE = re.compile(r"^[a-f0-9]{16,64}$")
ACTIONS = frozenset({
    "navigate", "create_game", "join_game", "watch_game", "start_game", "roll_dice", "score", "bank",
    "hold_dice", "offline_start", "offline_finish", "open_rules", "open_statistics", "open_history",
    "open_leaderboard", "open_achievements", "open_account", "open_players", "game_invite", "game_restart",
    "game_leave", "login", "register", "logout", "settings_save", "theme_change", "language_change",
    "mode_solo", "mode_duo", "mode_trio", "mode_team", "mode_normal", "mode_hardcore", "mode_computer",
    "mode_multiplayer", "mode_offline", "game_created", "open_settings",
})
PAGES = frozenset({
    "/", "/spiel", "/zuschauen", "/ergebnis", "/regeln", "/spieler", "/rangabzeichen", "/bestenlisten",
    "/historie", "/statistiken", "/erfolge", "/offline-spielen", "/offline", "/konto",
})
MODES = frozenset({"online", "offline", "solo", "duo", "trio", "team", "tournament", "cpu", "multiplayer", "normal", "hardcore", "unknown"})


class AnalyticsSession(Base):
    __tablename__ = "analytics_sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    device: Mapped[str] = mapped_column(String(16), nullable=False)
    referrer: Mapped[str] = mapped_column(String(200), nullable=False)
    country: Mapped[str] = mapped_column(String(2), nullable=False)
    __table_args__ = (Index("ix_analytics_sessions_last_seen", "last_seen_at"),)


class AnalyticsEvent(Base):
    __tablename__ = "analytics_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dedupe_key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    session_id: Mapped[str | None] = mapped_column(
        ForeignKey("analytics_sessions.id", ondelete="CASCADE"), nullable=True
    )
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    event_type: Mapped[str] = mapped_column(String(16), nullable=False)
    page: Mapped[str] = mapped_column(String(32), nullable=False)
    game: Mapped[str] = mapped_column(String(8), nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    active_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    source: Mapped[str] = mapped_column(String(8), nullable=False, default="client")
    __table_args__ = (
        Index("ix_analytics_events_received", "received_at"),
        Index("ix_analytics_events_game_received", "game", "received_at"),
        Index("ix_analytics_events_session_received", "session_id", "received_at"),
    )


_queue: queue.Queue | None = None
_worker: asyncio.Task | None = None
_stop: asyncio.Event | None = None
_dropped = 0
_rate: OrderedDict[str, tuple[float, int]] = OrderedDict()
_global_rate = (0.0, 0)
_started = time.monotonic()
_runtime_provider: Callable[[], dict] | None = None
_cpu_previous: tuple[int, int] | None = None
_cpu_percent: float | None = None
_server_cache: tuple[float, dict] | None = None


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("ascii")).hexdigest()


def normalize_page(value: object, game: str = "zdwa") -> str | None:
    """Map only product pages; dynamic names, room IDs and token paths vanish."""
    if not isinstance(value, str) or len(value) > 512 or not value.startswith("/"):
        return None
    path = value.split("?", 1)[0].split("#", 1)[0].rstrip("/") or "/"
    if path.startswith("/zdwa/"):
        path = path[5:]
    zilch = path == "/zilch" or path.startswith("/zilch/") or game == "zilch"
    if path == "/zilch":
        path = "/"
    elif path.startswith("/zilch/"):
        path = path[6:]
    if path.startswith("/spiel/"):
        path = "/zuschauen" if path.endswith("/zuschauen") else "/spiel"
    elif path.startswith("/ergebnis/"):
        path = "/ergebnis"
    elif path.startswith("/spieler/"):
        path = "/spieler"
    if path not in PAGES:
        return None
    return ("/zilch" + ("" if path == "/" else path)) if zilch else path


def normalize_referrer(value: object) -> str:
    """Keep a public DNS hostname only, dropping paths, credentials and queries."""
    if not isinstance(value, str) or not value:
        return "direct"
    if len(value) > 2048:
        return "other"
    try:
        host = (urlsplit(value if "://" in value else "//" + value).hostname or "").lower().rstrip(".")
    except ValueError:
        return "other"
    if host == "zockdiewandan.online" or host.endswith(".zockdiewandan.online"):
        return "internal"
    try:
        ipaddress.ip_address(host)
        return "other"
    except ValueError:
        pass
    if len(host) > 200 or "." not in host or host.endswith((".local", ".internal", ".lan", ".localhost")):
        return "other"
    if any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in host.split(".")):
        return "other"
    return host


def normalize_batch(payload: object, *, country: str = "ZZ", now: datetime | None = None) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("analytics_invalid_payload")
    sid = payload.get("session_id")
    events = payload.get("events")
    if not isinstance(sid, str) or not SESSION_RE.fullmatch(sid):
        raise ValueError("analytics_invalid_session")
    if not isinstance(events, list) or not 1 <= len(events) <= MAX_BATCH_EVENTS:
        raise ValueError("analytics_invalid_batch")
    session_hash = _digest(sid)
    received = now or utcnow()
    normalized = []
    for event in events:
        if not isinstance(event, dict):
            continue
        event_id, page_id = event.get("id"), event.get("page_id")
        if not isinstance(event_id, str) or not ID_RE.fullmatch(event_id):
            continue
        if not isinstance(page_id, str) or not ID_RE.fullmatch(page_id):
            continue
        kind = event.get("type", event.get("event_type"))
        if kind not in {"page_view", "engagement", "action"}:
            continue
        game = event.get("game")
        if game not in {"zdwa", "zilch", "site"}:
            continue
        page = normalize_page(event.get("page"), game)
        if page is None:
            continue
        # A forged page/game mismatch cannot move Zilch traffic into ZDWA.
        game = "zilch" if page.startswith("/zilch") else game
        action = event.get("action", "") if kind == "action" else ""
        if kind == "action" and (not isinstance(action, str) or action not in ACTIONS):
            continue
        duration = event.get("active_ms", event.get("duration_ms", 0)) if kind == "engagement" else 0
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not 0 <= duration <= 60000:
            continue
        if kind == "engagement" and duration == 0:
            continue
        mode = event.get("mode", "unknown")
        if not isinstance(mode, str) or mode not in MODES:
            mode = "unknown"
        identity = f"{sid}:{page_id}:{page}:view" if kind == "page_view" else f"{sid}:{event_id}"
        normalized.append({"dedupe_key": _digest(identity), "session_id": session_hash, "received_at": received,
                           "event_type": kind, "page": page, "game": game, "action": action,
                           "active_ms": int(duration), "mode": mode, "source": "client"})
    device = payload.get("device")
    country = country.upper() if isinstance(country, str) and re.fullmatch(r"[A-Za-z]{2}", country) else "ZZ"
    return {"session": {"id": session_hash, "first_seen_at": received, "last_seen_at": received,
                        "device": device if device in {"desktop", "tablet", "mobile"} else "unknown",
                        "referrer": normalize_referrer(payload.get("referrer")), "country": country},
            "events": normalized}


def _rate_allowed(key: str, count: int) -> bool:
    global _global_rate
    clock = time.monotonic()
    minute, total = _global_rate
    if clock - minute >= 60:
        minute, total = clock, 0
    start, used = _rate.pop(key, (clock, 0))
    if clock - start >= 60:
        start, used = clock, 0
    allowed = used + count <= 120 and total + count <= 6000
    _rate[key] = (start, used + count if allowed else used)
    _global_rate = (minute, total + count if allowed else total)
    while len(_rate) > 4000:
        _rate.popitem(last=False)
    return allowed


def enqueue_batch(batch: dict) -> bool:
    global _dropped
    if not batch["events"]:
        return True
    if _queue is None or not _rate_allowed(batch["session"]["id"], len(batch["events"])):
        _dropped += len(batch["events"])
        return False
    try:
        _queue.put_nowait(batch)
        return True
    except queue.Full:
        _dropped += len(batch["events"])
        return False


def record_game_action(game_type: str, action: str, mode: str | None = None) -> bool:
    """Trusted gameplay hooks call this only after an accepted server action."""
    global _dropped
    if game_type not in {"zdwa", "zilch"} or action not in ACTIONS or _queue is None:
        return False
    mode = {"1": "solo", "2": "duo", "3": "trio", "2v2": "team"}.get(str(mode), mode)
    event = {"dedupe_key": hashlib.sha256(os.urandom(32)).hexdigest(), "session_id": None,
             "received_at": utcnow(), "event_type": "action", "page": normalize_page("/spiel", game_type),
             "game": game_type, "action": action, "active_ms": 0,
             "mode": mode if mode in MODES else "unknown", "source": "server"}
    try:
        _queue.put_nowait({"session": None, "events": [event]})
        return True
    except queue.Full:
        _dropped += 1
        return False


def persist_batches(batches: list[dict], *, now: datetime | None = None, sweep: bool = False) -> int:
    """One serialized background writer, with a short busy timeout, no game locks."""
    now = now or utcnow()
    stored = 0
    engine = get_engine()
    # Keep this exact connection checked out until the timeout is restored.
    # Session.commit() otherwise returns it to the shared pool too early.
    with engine.connect() as connection, Session(bind=connection) as db:
        if engine.dialect.name == "sqlite":
            connection.exec_driver_sql("PRAGMA busy_timeout=250")
            connection.commit()
        try:
            for batch in batches:
                session = batch["session"]
                if session:
                    existing = db.get(AnalyticsSession, session["id"])
                    if existing is None:
                        db.add(AnalyticsSession(**session))
                        db.flush()
                    else:
                        existing.last_seen_at = max(as_utc(existing.last_seen_at), as_utc(session["last_seen_at"]))
                keys = [event["dedupe_key"] for event in batch["events"]]
                seen = set(db.scalars(select(AnalyticsEvent.dedupe_key).where(AnalyticsEvent.dedupe_key.in_(keys))))
                rows = []
                for event in batch["events"]:
                    if event["dedupe_key"] not in seen:
                        rows.append(event)
                        seen.add(event["dedupe_key"])
                if rows:
                    db.execute(insert(AnalyticsEvent), rows)
                    stored += len(rows)
            if sweep:
                cutoff = now - timedelta(days=RETENTION_DAYS)
                db.execute(delete(AnalyticsEvent).where(AnalyticsEvent.received_at < cutoff))
                db.execute(delete(AnalyticsSession).where(AnalyticsSession.last_seen_at < cutoff))
                # A row cap bounds disk even under sustained anonymous traffic.
                oldest_kept = db.scalar(select(AnalyticsEvent.id).order_by(AnalyticsEvent.id.desc())
                                        .offset(MAX_STORED_EVENTS - 1).limit(1))
                if oldest_kept is not None:
                    db.execute(delete(AnalyticsEvent).where(AnalyticsEvent.id < oldest_kept))
                db.execute(delete(AnalyticsSession).where(
                    ~select(AnalyticsEvent.id).where(AnalyticsEvent.session_id == AnalyticsSession.id).exists()
                ))
            db.commit()
        finally:
            # Connections return to the shared pool with the game's normal timeout.
            db.rollback()
            if engine.dialect.name == "sqlite":
                connection.rollback()
                connection.exec_driver_sql("PRAGMA busy_timeout=30000")
                connection.commit()
    return stored


async def _run_worker() -> None:
    global _dropped
    last_sweep = 0.0
    while _stop is not None and (not _stop.is_set() or (_queue is not None and not _queue.empty())):
        batches = []
        try:
            batch = _queue.get_nowait()
            batches.append(batch)
            while len(batches) < 20 and not _queue.empty():
                batches.append(_queue.get_nowait())
        except queue.Empty:
            pass
        sweep = time.monotonic() - last_sweep > 60
        if batches or sweep:
            try:
                await asyncio.to_thread(persist_batches, batches, sweep=sweep)
            except (SQLAlchemyError, RuntimeError):
                _dropped += sum(len(batch["events"]) for batch in batches)
                logger.warning("Anonymous analytics batch unavailable; gameplay continues", exc_info=False)
            if sweep:
                last_sweep = time.monotonic()
        _sample_cpu()
        if not batches:
            await asyncio.sleep(1)


async def start_analytics() -> bool:
    global _queue, _worker, _stop, _started, _dropped, _global_rate
    if _worker is not None and not _worker.done():
        return False
    # Nested app lifespans can run in separate TestClient event-loop threads.
    # The queue is deliberately thread safe; exactly one lifespan owns shutdown.
    _queue = queue.Queue(maxsize=MAX_QUEUE_BATCHES)
    _stop = asyncio.Event()
    _started = time.monotonic()
    _dropped = 0
    _rate.clear()
    _global_rate = (0.0, 0)
    _worker = asyncio.create_task(_run_worker(), name="anonymous-analytics")
    return True


async def stop_analytics() -> None:
    global _queue, _worker, _stop
    if _stop:
        _stop.set()
    if _worker:
        try:
            await asyncio.wait_for(_worker, timeout=10)
        except asyncio.TimeoutError:
            _worker.cancel()
            await asyncio.gather(_worker, return_exceptions=True)
    _queue, _worker, _stop = None, None, None


def configure_analytics_runtime(provider: Callable[[], dict]) -> None:
    global _runtime_provider
    _runtime_provider = provider


def _proc_root() -> tuple[Path, str]:
    host = Path(os.getenv("ANALYTICS_HOST_PROC", "/host/proc"))
    if (host / "stat").is_file():
        return host, "host"
    return Path("/proc"), "container"


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="ascii")
    except (OSError, UnicodeError):
        return None


def _sample_cpu() -> None:
    global _cpu_previous, _cpu_percent
    proc, _ = _proc_root()
    raw = _read_text(proc / "stat")
    if not raw:
        return
    try:
        fields = [int(value) for value in raw.splitlines()[0].split()[1:9]]
        total, idle = sum(fields), fields[3] + fields[4]
        if _cpu_previous is not None and total > _cpu_previous[0]:
            _cpu_percent = round(100 * (1 - (idle - _cpu_previous[1]) / (total - _cpu_previous[0])), 1)
        _cpu_previous = total, idle
    except (ValueError, IndexError):
        pass


def server_snapshot() -> dict:
    global _server_cache
    clock = time.monotonic()
    if _server_cache and clock - _server_cache[0] < 3:
        result = dict(_server_cache[1])
        result["app_uptime_seconds"] = int(clock - _started)
        return result
    proc, scope = _proc_root()
    cpu = {"percent": _cpu_percent, "cores": os.cpu_count(), "load1": None, "load5": None,
           "load15": None, "scope": scope}
    memory = {"used_bytes": None, "total_bytes": None, "percent": None, "scope": scope}
    host_uptime = None
    try:
        load = _read_text(proc / "loadavg")
        if load:
            cpu.update(dict(zip(("load1", "load5", "load15"), [float(x) for x in load.split()[:3]])))
        info = _read_text(proc / "meminfo")
        if info:
            values = {line.split(":", 1)[0]: int(line.split()[1]) * 1024 for line in info.splitlines()}
            total = values["MemTotal"]
            available = values.get("MemAvailable", values.get("MemFree", 0))
            memory.update(used_bytes=total - available, total_bytes=total,
                          percent=round(100 * (total - available) / total, 1))
        uptime = _read_text(proc / "uptime")
        if uptime and scope == "host":
            host_uptime = int(float(uptime.split()[0]))
    except (ValueError, KeyError, IndexError, ZeroDivisionError):
        pass
    # /proc can expose machine memory even in Docker. Show the actual cgroup
    # allocation separately, never mislabel it as the server's capacity.
    container = {"used_bytes": None, "total_bytes": None, "percent": None, "scope": "cgroup"}
    try:
        used = _read_text(Path("/sys/fs/cgroup/memory.current"))
        limit = _read_text(Path("/sys/fs/cgroup/memory.max"))
        if used:
            container["used_bytes"] = int(used)
        if limit and limit.strip() != "max":
            container["total_bytes"] = int(limit)
            if container["used_bytes"] is not None:
                container["percent"] = round(100 * container["used_bytes"] / container["total_bytes"], 1)
        if scope == "container":
            memory = container
    except (ValueError, ZeroDivisionError):
        pass
    disk_path = Path(os.getenv("ANALYTICS_DATA_PATH", "/app/data"))
    if not disk_path.exists():
        disk_path = Path(os.getenv("DATA_DIR", "data"))
    disk = {"used_bytes": None, "total_bytes": None, "free_bytes": None, "percent": None, "scope": "data_filesystem"}
    try:
        usage = shutil.disk_usage(disk_path)
        disk.update(used_bytes=usage.used, total_bytes=usage.total, free_bytes=usage.free,
                    percent=round(100 * usage.used / usage.total, 1))
    except (OSError, ZeroDivisionError):
        pass
    status = _read_text(Path("/proc/self/status"))
    rss = None
    if status:
        match = re.search(r"^VmRSS:\s+(\d+)\s+kB", status, re.MULTILINE)
        if match:
            rss = int(match.group(1)) * 1024
    elif sys.platform == "darwin":
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    runtime = {"active_rooms": None, "players_online": None}
    if _runtime_provider:
        try:
            runtime.update(_runtime_provider())
        except (KeyError, TypeError, RuntimeError):
            pass
    result = {"cpu": cpu, "memory": memory, "container_memory": container, "disk": disk,
              "host_uptime_seconds": host_uptime, "app_uptime_seconds": int(clock - _started),
              "process_memory_bytes": rss, "measurement_at": utcnow().isoformat(), **runtime}
    _server_cache = clock, result
    return result


def _result_duration(raw: str) -> int | None:
    try:
        snapshot = json.loads(raw)
        duration = snapshot.get("duration_seconds")
        if isinstance(duration, (int, float)) and not isinstance(duration, bool) and 0 <= duration <= 86400 * 30:
            return int(duration)
        start = snapshot.get("started_at", snapshot.get("_started_at"))
        end = snapshot.get("finished_at", snapshot.get("_finished_at"))
        if isinstance(start, str) and isinstance(end, str):
            duration = (as_utc(datetime.fromisoformat(end.replace("Z", "+00:00"))) -
                        as_utc(datetime.fromisoformat(start.replace("Z", "+00:00")))).total_seconds()
            if 0 <= duration <= 86400 * 30:
                return int(duration)
    except (ValueError, TypeError, AttributeError):
        pass
    return None


def dashboard_stats(days: int = 7, game: str = "all", *, now: datetime | None = None) -> dict:
    if days not in {1, 7, 30, 90} or game not in {"all", "zdwa", "zilch"}:
        raise ValueError("analytics_invalid_filter")
    now = now or utcnow()
    # UTC calendar days make daily bars and overview describe the same window.
    start = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)
    filters = [AnalyticsEvent.received_at >= start, AnalyticsEvent.received_at <= now]
    result_filters = [CompletedGame.finished_at >= start, CompletedGame.finished_at <= now]
    if game != "all":
        filters.append(AnalyticsEvent.game == game)
        result_filters.append(CompletedGame.game_type == game)
    views = func.sum(func.cast(AnalyticsEvent.event_type == "page_view", Integer))
    active = func.sum(AnalyticsEvent.active_ms)
    with session_scope() as db:
        count, page_views, active_ms = db.execute(select(
            func.count(func.distinct(AnalyticsEvent.session_id)), views, active
        ).where(*filters)).one()
        live = db.scalar(select(func.count(func.distinct(AnalyticsEvent.session_id))).where(
            *filters, AnalyticsEvent.received_at >= now - timedelta(seconds=LIVE_WINDOW_SECONDS))) or 0
        page_rows = db.execute(select(AnalyticsEvent.page, AnalyticsEvent.game, views,
                                     func.count(func.distinct(AnalyticsEvent.session_id)), active)
                               .where(*filters, AnalyticsEvent.source == "client")
                               .group_by(AnalyticsEvent.page, AnalyticsEvent.game).order_by(views.desc())).all()
        pages = [{"page": page, "game": product, "views": int(pv or 0), "sessions": sc,
                  "active_seconds": round((ms or 0) / 1000, 1),
                  "avg_active_seconds": round((ms or 0) / 1000 / max(sc, 1), 1)}
                 for page, product, pv, sc, ms in page_rows]
        dimensions = {}
        for key, field in (("referrers", AnalyticsSession.referrer), ("devices", AnalyticsSession.device),
                           ("countries", AnalyticsSession.country)):
            rows = db.execute(select(field, func.count(func.distinct(AnalyticsEvent.session_id)))
                              .join(AnalyticsSession, AnalyticsEvent.session_id == AnalyticsSession.id)
                              .where(*filters).group_by(field)
                              .order_by(func.count(func.distinct(AnalyticsEvent.session_id)).desc())).all()
            label = {"referrers": "source", "devices": "device", "countries": "country"}[key]
            dimensions[key] = [{label: value, "sessions": total} for value, total in rows]
        action_rows = db.execute(select(AnalyticsEvent.action, AnalyticsEvent.game, AnalyticsEvent.source, func.count())
                                 .where(*filters, AnalyticsEvent.event_type == "action")
                                 .group_by(AnalyticsEvent.action, AnalyticsEvent.game, AnalyticsEvent.source)
                                 .order_by(func.count().desc())).all()
        actions = [{"action": action, "game": product, "source": source, "count": total}
                   for action, product, source, total in action_rows]
        date_expr = func.date(AnalyticsEvent.received_at)
        activity_daily = {str(day): (sc, pv or 0, ms or 0) for day, sc, pv, ms in db.execute(
            select(date_expr, func.count(func.distinct(AnalyticsEvent.session_id)), views, active)
            .where(*filters).group_by(date_expr)).all()}
        result_daily = {str(day): total for day, total in db.execute(select(
            func.date(CompletedGame.finished_at), func.count()).where(*result_filters)
            .group_by(func.date(CompletedGame.finished_at))).all()}
        daily = []
        for offset in range(days):
            day = (start + timedelta(days=offset)).date().isoformat()
            sc, pv, ms = activity_daily.get(day, (0, 0, 0))
            daily.append({"date": day, "sessions": sc, "page_views": pv, "active_seconds": round(ms / 1000, 1),
                          "completed_games": result_daily.get(day, 0)})
        # SQL aggregation keeps reads bounded even at the retention row cap.
        hour_expr = func.extract("hour", AnalyticsEvent.received_at)
        hour_rows = {int(hour): (pv or 0, ms or 0) for hour, pv, ms in db.execute(
            select(hour_expr, views, active).where(*filters).group_by(hour_expr)).all()}
        hourly = [{"hour": hour, "page_views": hour_rows.get(hour, (0, 0))[0],
                   "active_seconds": round(hour_rows.get(hour, (0, 0))[1] / 1000, 1)} for hour in range(24)]
        completed = db.scalar(select(func.count()).select_from(CompletedGame).where(*result_filters)) or 0
        play_mode = (func.json_extract(CompletedGame.snapshot_json, "$.play_mode")
                     if get_engine().dialect.name == "sqlite" else
                     cast(CompletedGame.snapshot_json, JSON)["play_mode"].as_string())
        result_mode = case((CompletedGame.game_type == "zilch", func.coalesce(play_mode, CompletedGame.mode)),
                           else_=CompletedGame.mode)
        mode_names = {"1": "solo", "2": "duo", "3": "trio", "2v2": "team"}
        modes = [{"game": product, "mode": mode_names.get(mode, mode), "hardcore": bool(hardcore),
                  "completed_games": total}
                 for product, mode, hardcore, total in db.execute(select(
                     CompletedGame.game_type, result_mode, CompletedGame.hardcore, func.count())
                 .where(*result_filters).group_by(CompletedGame.game_type, result_mode, CompletedGame.hardcore)).all()]
        games = []
        for product in ("zdwa", "zilch"):
            if game not in {"all", product}:
                continue
            product_filters = [*result_filters, CompletedGame.game_type == product]
            total = db.scalar(select(func.count()).select_from(CompletedGame).where(*product_filters)) or 0
            participants = db.scalar(select(func.count()).select_from(GameParticipant)
                                      .join(CompletedGame, GameParticipant.game_id == CompletedGame.id)
                                      .where(*product_filters)) or 0
            # JSON result payloads are read only for this narrow optional metric,
            # never included in the response or retained by analytics.
            durations = [_result_duration(raw) for raw in db.scalars(select(CompletedGame.snapshot_json)
                         .where(*product_filters).order_by(CompletedGame.finished_at.desc()).limit(2000))]
            valid_durations = [duration for duration in durations if duration is not None]
            games.append({"game": product, "completed_games": total, "participants": participants,
                          "avg_duration_seconds": round(sum(valid_durations) / len(valid_durations), 1)
                          if valid_durations else None, "duration_sample_count": len(valid_durations),
                          "duration_sample_limit": 2000})
        first = db.scalar(select(func.min(AnalyticsEvent.received_at)))
        stored_events = db.scalar(select(func.count()).select_from(AnalyticsEvent)) or 0
        active_rooms = db.scalar(select(func.count()).select_from(ActiveGame)) or 0
    server = server_snapshot()
    if server["active_rooms"] is None:
        server["active_rooms"] = active_rooms
    return {"generated_at": now.isoformat(), "period": {"days": days, "game": game, "from": start.isoformat(),
             "to": now.isoformat(), "timezone": "UTC"},
            "collection": {"first_seen_at": as_utc(first).isoformat() if first else None,
                           "retention_days": RETENTION_DAYS, "session_scope": "anonymous_tab",
                           "live_window_seconds": LIVE_WINDOW_SECONDS,
                           "country_source": "cloudflare_verified_peer", "queued": _queue.qsize() if _queue else 0,
                           "dropped": _dropped,
                           "event_cap": MAX_STORED_EVENTS, "stored_events": stored_events,
                           "cap_reached": stored_events >= MAX_STORED_EVENTS,
                           "results_source": "server_results"},
            "overview": {"sessions": count, "page_views": int(page_views or 0),
                         "active_seconds": round((active_ms or 0) / 1000, 1),
                         "avg_active_seconds": round((active_ms or 0) / 1000 / max(count, 1), 1),
                         "live_sessions": live, "completed_games": completed,
                         "game_clicks": sum(row["count"] for row in actions if row["game"] in {"zdwa", "zilch"})},
            "daily": daily, "pages": pages, **dimensions, "actions": actions, "games": games,
            "modes": modes, "hourly": hourly, "server": server}
