"""Read-only leaderboard aggregation, profile linking and replay lookup."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select

from .abandonment_leaderboard import abandonment_leaderboard
from .achievements import earned_achievement_payloads_for_game, public_achievement_ranks
from .api_users import profile_links_for_games
from .database import database_schema_ready, session_scope
from .game_history import (
    deleted_game_ids,
    recent_winner_points_by_mode,
    stable_game_id,
)
from .game_types import DEFAULT_GAME_TYPE
from .leaderboard_storage import LeaderboardFiles, read_json, write_json_if_changed
from .models import CompletedGame
from .player_names import current_account_names, project_completed_players
from .security import as_utc
from .trends import recent_points_trend

logger = logging.getLogger(__name__)
GLOBAL_AVERAGE_STARTED_AT = datetime(2026, 7, 31, 11, 40, tzinfo=timezone.utc)


def _stored_zdwa_snapshot(game_id: str) -> dict | None:
    """Load one authoritative ZDWA snapshot beyond the capped JSON lists."""
    if not database_schema_ready():
        return None
    with session_scope() as db:
        game = db.scalar(
            select(CompletedGame).where(
                CompletedGame.game_id == str(game_id),
                CompletedGame.game_type == DEFAULT_GAME_TYPE,
            )
        )
        if game is None:
            return None
        try:
            snapshot = json.loads(game.snapshot_json)
        except (TypeError, ValueError, json.JSONDecodeError):
            logger.warning("Could not decode stored ZDWA snapshot %s", game_id, exc_info=True)
            return None
        if not isinstance(snapshot, dict):
            return None
        # Identity/type metadata comes from typed columns.  The mutable copy
        # retains the immutable scoreboards, players and chat from the result.
        snapshot = dict(snapshot)
        snapshot["game_id"] = game.game_id
        snapshot["gamename"] = game.game_name
        snapshot["finished_at"] = as_utc(game.finished_at).isoformat()
        snapshot["mode"] = game.mode
        snapshot["hardcore"] = bool(game.hardcore)
        return snapshot


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
    except (TypeError, ValueError):
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
    except (AttributeError, TypeError, ValueError):
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


def linked_players_for_entry(entry: dict, candidates: list[dict], *, opponent: bool = False) -> list[dict]:
    """Resolve a row to known seats, retaining guests when scores/names collide.

    New rows carry seat keys. Legacy rows may identify a unique seat/team by
    their recorded label within this game; a current username is never evidence.
    Ambiguous labels or scores do not produce an invented account association.
    """
    if not candidates:
        return []
    keys = entry.get("opponent_player_keys" if opponent else "entry_player_keys")
    if isinstance(keys, list):
        by_key = {seat["player_key"]: seat for seat in candidates if seat.get("player_key")}
        if keys and len(keys) == len(set(keys)) and all(key in by_key for key in keys):
            return [by_key[key] for key in keys]
        return []
    groups: list[list[dict]] = []
    if str(entry.get("mode") or "").lower() == "2v2":
        for team in ("A", "B"):
            group = [seat for seat in candidates if seat.get("team") == team]
            if group:
                groups.append(group)
    else:
        groups = [[seat] for seat in candidates]
    label = str(entry.get("opponent" if opponent else "name") or "").strip()
    matches = [group for group in groups if ", ".join(seat["display_name"] for seat in group) == label]
    if len(matches) == 1:
        return matches[0]
    try:
        points = int(entry.get("opp_points" if opponent else "points"))
    except (AttributeError, TypeError, ValueError):
        return []
    exact = [group for group in matches if all(seat.get("points") == points for seat in group)]
    return exact[0] if len(exact) == 1 else []


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


async def build_leaderboard(files: LeaderboardFiles):
    """API: Liefert aktuelles Leaderboard (recent + alltime) und Basis-Stats."""
    # Rohdaten lesen (neues Schema: {normal:[...], hc:[...]}, aber alte Liste weiterhin unterstützen)
    recent_raw = read_json(files.recent, {"normal": [], "hc": []})
    alltime_raw = read_json(files.alltime, {"normal": [], "hc": []})
    shame_raw = read_json(files.shame, {"recent": [], "alltime": []})
    last_raw = read_json(files.last_games, [])
    stats_raw = read_json(files.stats, {"games_played": 0})
    stats_f = _stats_with_average_points(stats_raw)

    # --- Cleanup "recent": nur letzte 7 Tage, sortiert, Top-10 ---
    now_utc = datetime.now(timezone.utc)
    recent_cutoff = now_utc - timedelta(days=7)
    shame_cutoff = now_utc - timedelta(days=10)

    recent_norm, recent_hc = _as_dual_lists(recent_raw)
    alltime_norm, alltime_hc = _as_dual_lists(alltime_raw)
    shame_recent, shame_alltime = _as_shame_lists(shame_raw)
    deleted_ids = deleted_game_ids()

    def exclude_deleted(entries):
        return [
            entry
            for entry in (entries or [])
            if not isinstance(entry, dict) or stable_game_id(entry) not in deleted_ids
        ]

    recent_norm = exclude_deleted(recent_norm)
    recent_hc = exclude_deleted(recent_hc)
    alltime_norm = exclude_deleted(alltime_norm)
    alltime_hc = exclude_deleted(alltime_hc)
    shame_recent = exclude_deleted(shame_recent)
    shame_alltime = exclude_deleted(shame_alltime)
    last_raw = exclude_deleted(last_raw if isinstance(last_raw, list) else [])

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
    recent_hc_f = process_recent(recent_hc)
    shame_recent_f = process_shame_recent(shame_recent)
    shame_alltime_f = process_shame_alltime(shame_alltime)
    last_games_f = process_last_games(last_raw if isinstance(last_raw, list) else [])

    recent_points = recent_winner_points_by_mode()
    for bucket_key in ("normal", "hc"):
        bucket = stats_f["average_points"][bucket_key]
        bucket.update(
            recent_points_trend(
                recent_points[bucket_key],
                games_played=bucket["games"],
                points_total=bucket["points_total"],
            )
        )

    visible_lists = [
        recent_norm_f,
        recent_hc_f,
        alltime_norm,
        alltime_hc,
        shame_recent_f,
        shame_alltime_f,
        last_games_f,
    ]
    visible_game_ids = {
        stable_game_id(entry)
        for entries in visible_lists
        for entry in (entries or [])
        if isinstance(entry, dict) and stable_game_id(entry)
    }
    links_by_game = profile_links_for_games(visible_game_ids)

    def with_profile_links(entries):
        enriched = []
        for entry in entries or []:
            if not isinstance(entry, dict):
                continue
            item = dict(entry)
            candidates = links_by_game.get(stable_game_id(item) or "", [])
            linked_players = linked_players_for_entry(item, candidates)
            item.pop("linked_players", None)
            if linked_players:
                item["entry_players"] = [
                    {
                        "name": seat["username"] or seat["display_name"],
                        "username": seat["username"],
                        "user_id": seat["user_id"],
                        "is_active": seat["is_active"],
                        "achievement_rank": seat["achievement_rank"],
                    }
                    for seat in linked_players
                ]
                item["name"] = ", ".join(player["name"] for player in item["entry_players"])
                item["linked_players"] = [
                    {**seat, "display_name": seat["username"]}
                    for seat in linked_players if seat["is_active"]
                ]
            opponents = linked_players_for_entry(entry, candidates, opponent=True)
            if opponents:
                item["opponent"] = ", ".join(seat["username"] or seat["display_name"] for seat in opponents)
            if isinstance(item.get("players"), list):
                item["players"] = project_completed_players(item["players"], candidates)
            enriched.append(item)
        return enriched

    # Optional: Datei aktualisieren, falls sich etwas geändert hat (idempotent)
    write_json_if_changed(files, files.recent, recent_raw, {"normal": recent_norm_f, "hc": recent_hc_f})

    # Alltime: falls Legacy-Format, jetzt in Bucket-Format persistieren (Migration)
    write_json_if_changed(files, files.alltime, alltime_raw, {"normal": alltime_norm, "hc": alltime_hc})
    write_json_if_changed(files, files.shame, shame_raw, {"recent": shame_recent_f, "alltime": shame_alltime_f})
    write_json_if_changed(files, files.last_games, last_raw, last_games_f)
    write_json_if_changed(files, files.stats, stats_raw, stats_f)

    return {
        "recent": {"normal": with_profile_links(recent_norm_f), "hc": with_profile_links(recent_hc_f)},
        "alltime": {"normal": with_profile_links(alltime_norm), "hc": with_profile_links(alltime_hc)},
        "shame": {"recent": with_profile_links(shame_recent_f), "alltime": with_profile_links(shame_alltime_f)},
        "abandonments": abandonment_leaderboard(now=now_utc),
        "last_games": with_profile_links(last_games_f),
        "stats": stats_f,
    }


def game_from_leaderboard(files: LeaderboardFiles, game_id: str):
    """API: Read-Only Snapshot eines abgeschlossenen Spiels aus Leaderboard-Dateien."""
    if str(game_id) in deleted_game_ids():
        raise HTTPException(status_code=404, detail="not_found")

    # Laden der Dateien (recent/alltime) – unterstützt altes (Liste) und neues (Bucket) Format
    def _read_list(path):
        data = read_json(path, [])
        if isinstance(data, dict):
            entries = []
            for key in ("normal", "hc", "recent", "alltime", "games"):
                bucket = data.get(key)
                if isinstance(bucket, list):
                    entries.extend(bucket)
            return entries
        return data if isinstance(data, list) else []

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
        players_copy = [dict(player) for player in players if isinstance(player, dict)]
        chat_history = [dict(message) for message in entry.get("chat_history", []) if isinstance(message, dict)]
        try:
            earned_by_player = earned_achievement_payloads_for_game(str(entry.get("game_id") or ""))
        except Exception:
            # A replay remains useful if the optional achievement projection
            # is temporarily unavailable. Never guess links from timestamps.
            logger.exception("Could not load earned achievements for completed game %s", entry.get("game_id"))
            earned_by_player = {}
        for player in players_copy:
            player["earned_achievements"] = list(earned_by_player.get(str(player.get("id") or ""), []))
        linked_players = profile_links_for_games({str(entry.get("game_id") or "")}).get(
            str(entry.get("game_id") or ""),
            [],
        )

        players_copy = project_completed_players(players_copy, linked_players)
        # Imported JSON account IDs may belong to a different database. A
        # historical sender label alone never proves who wrote a message.
        trusted_chat_ids = bool(linked_players) and not linked_players[0]["imported_from_legacy"]
        if not trusted_chat_ids:
            for message in chat_history:
                message.pop("user_id", None)
                message.pop("achievement_rank", None)
        names = current_account_names(message.get("user_id") for message in chat_history)
        for message in chat_history:
            if name := names.get(message.get("user_id")):
                message["sender"] = name
        ranks = public_achievement_ranks(
            [
                *[player.get("user_id") for player in players_copy],
                *[message.get("user_id") for message in chat_history],
            ]
        )

        def rank_for_user_id(user_id):
            try:
                return ranks.get(int(user_id)) if user_id is not None else None
            except (TypeError, ValueError):
                return None

        for player in players_copy:
            user_id = player.get("user_id")
            if rank := rank_for_user_id(user_id):
                player["achievement_rank"] = rank
        for message in chat_history:
            user_id = message.get("user_id")
            if rank := rank_for_user_id(user_id):
                message["achievement_rank"] = rank
        # Response minimal & stabil halten
        return {
            "game_id": entry.get("game_id"),
            "gamename": entry.get("gamename") or entry.get("name") or "",
            "finished_at": entry.get("finished_at") or entry.get("ts"),
            "mode": entry.get("mode"),
            "hardcore": bool(entry.get("hardcore", False)),
            "players": players_copy,
            "scoreboards": scoreboards,
            "chat_history": chat_history,
            "admin_edits": entry.get("admin_edits") if isinstance(entry.get("admin_edits"), dict) else {},
        }

    # Reihenfolge: Top-Listen zuerst, danach Zusatzlisten mit eigenen Dateien.
    for path in (files.recent, files.alltime, files.shame, files.last_games):
        entries = _read_list(path)
        for e in entries:
            proj = _project(e)
            if proj is not None:
                return proj

    # The legacy projections are intentionally capped.  Profile histories,
    # however, link every typed relational result and must keep those replay
    # URLs useful after a game falls out of all four JSON lists.
    stored_snapshot = _stored_zdwa_snapshot(str(game_id))
    if stored_snapshot is not None:
        projected = _project(stored_snapshot)
        if projected is not None:
            return projected

    # Nicht gefunden oder Eintrag ohne Snapshot-Felder
    raise HTTPException(status_code=404, detail="not_found")
