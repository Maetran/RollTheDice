"""Completed-game projection, legacy leaderboard writes and aggregate statistics."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from .achievements import public_achievement_ranks, sync_achievements_for_users
from .active_games import delete_active_game
from .game_engine import _compute_final_totals, _rows_from_scoreboard
from .game_history import persist_runtime_game, stable_game_id
from .game_state import CHAT_HISTORY_LIMIT, GameDict, is_team_mode
from .leaderboard_service import (
    GLOBAL_AVERAGE_STARTED_AT,
    _average_bucket,
    _empty_average_points,
    _entry_ts,
    _stats_with_average_points,
    _valid_entry_since,
)
from .leaderboard_storage import (
    LeaderboardFiles,
    atomic_write_json,
    mutate_json,
    read_json,
)

logger = logging.getLogger(__name__)


def _rank_ups_for_completed_game(
    g: GameDict,
    before: dict[int, dict],
    after: dict[int, dict],
) -> dict[str, dict[str, dict]]:
    """Return only genuine upward title changes, keyed by game player id.

    The client identifies itself with the short in-game player id, whereas
    achievement ranks are persisted per account id.  Keeping that mapping at
    the result boundary lets every connected player receive only their own
    celebratory rank-up card.
    """
    upgrades: dict[str, dict[str, dict]] = {}
    for player in g.get("_players", []):
        try:
            user_id = int(player.get("user_id"))
        except (TypeError, ValueError):
            continue
        previous = before.get(user_id)
        current = after.get(user_id)
        if not isinstance(previous, dict) or not isinstance(current, dict):
            continue
        if previous.get("key") == current.get("key"):
            continue
        try:
            advanced = int(current.get("minimum_points", 0)) > int(previous.get("minimum_points", 0))
        except (TypeError, ValueError):
            advanced = False
        if advanced:
            upgrades[str(player.get("id") or "")] = {"previous": previous, "current": current}
    return upgrades


def _achievement_ranks_safely(user_ids: set[int], *, game_id: object) -> dict[int, dict]:
    """Fetch optional display ranks without risking result persistence."""
    if not user_ids:
        return {}
    try:
        return public_achievement_ranks(user_ids)
    except Exception:
        logger.exception("Could not compare achievement ranks for completed game %s", game_id)
        return {}


def mutate_stats(
    files: LeaderboardFiles, incr_games=False, *, average_points: int | None = None, hardcore: bool = False
):
    """Aktualisiert die Statistik-Daten.

    Args:
        incr_games (bool): Ob die Anzahl der Spiele inkrementiert werden soll
    """
    with files.lock:
        stats = _stats_with_average_points(read_json(files.stats, {"games_played": 0}))
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
        atomic_write_json(files.stats, stats)


def remove_deleted_game_from_files(files: LeaderboardFiles, deleted: dict) -> None:
    game_id = str(deleted["game_id"])

    def without_game(data):
        if isinstance(data, list):
            return [item for item in data if not isinstance(item, dict) or stable_game_id(item) != game_id]
        if isinstance(data, dict):
            return {
                key: without_game(value) if isinstance(value, (list, dict)) else value for key, value in data.items()
            }
        return data

    with files.lock:
        for path in (files.recent, files.alltime, files.shame, files.last_games):
            mutate_json(files, path, without_game)

        stats = _stats_with_average_points(read_json(files.stats, {"games_played": 0}))
        stats["games_played"] = max(0, int(stats.get("games_played", 0)) - 1)
        if deleted["finished_at"] >= GLOBAL_AVERAGE_STARTED_AT:
            bucket_key = "hc" if deleted["hardcore"] else "normal"
            bucket = stats["average_points"][bucket_key]
            old_average = float(bucket.get("average_points", 0) or 0)
            games_count = max(0, int(bucket.get("games", 0) or 0) - 1)
            points_total = max(0, int(bucket.get("points_total", 0) or 0) - int(deleted["winner_points"]))
            updated = _average_bucket(games_count, points_total)
            new_average = float(updated["average_points"])
            updated["trend"] = "up" if new_average > old_average else "down" if new_average < old_average else "same"
            stats["average_points"][bucket_key] = updated
        atomic_write_json(files.stats, stats)


def build_leaderboard_snapshot_fields(g: GameDict) -> dict:
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
            players.append(
                {
                    "id": pid,
                    "name": p.get("name", "Player"),
                    "team": (team_of.get(pid) if is_team_mode(g) else None),
                    "user_id": p.get("user_id"),
                    **({"achievement_rank": p["achievement_rank"]} if isinstance(p.get("achievement_rank"), dict) else {}),
                }
            )

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
                    clean_rows = {
                        k: int(v)
                        for k, v in rows_map.items()
                        if k in {"1", "2", "3", "4", "5", "6", "max", "min", "kenter", "full", "poker", "60"}
                        and isinstance(v, (int, float))
                    }
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
                    clean_rows = {
                        k: int(v)
                        for k, v in rows_map.items()
                        if k in {"1", "2", "3", "4", "5", "6", "max", "min", "kenter", "full", "poker", "60"}
                        and isinstance(v, (int, float))
                    }
                    reihen.append({"index": idx, "rows": clean_rows})
                scoreboards[str(pid)] = {"reihen": reihen}

        return {
            "game_id": str(g.get("_id") or ""),
            "finished_at": finished_at,
            "mode": mode,
            "hardcore": bool(g.get("_hardcore", False)),
            "players": players,
            "scoreboards": scoreboards,
            "chat_history": list(g.get("_chat_history", []))[-CHAT_HISTORY_LIMIT:],
            "admin_edits": g.get("_admin_edits", {}),
        }
    except Exception:
        # Defensive: falls beim Snapshot etwas schiefgeht, Eintrag nicht blockieren
        logger.exception("Could not serialize completed game %s", g.get("_id"))
        return {
            "game_id": str(g.get("_id") or ""),
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "mode": str(g.get("_mode", "")).lower(),
            "players": [],
            "scoreboards": {},
            "chat_history": [],
            "admin_edits": {},
        }


def finalize_and_log_results(files: LeaderboardFiles, g: GameDict):
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
    snapshot_fields = build_leaderboard_snapshot_fields(g)

    # Vollständige Historie für Profile und Rankings. Die bisherigen JSON-
    # Leaderboards bleiben während der Übergangsphase parallel bestehen.
    achievement_unlocks: dict[int, list[dict]] = {}
    achievement_rank_ups: dict[str, dict[str, dict]] = {}
    achievement_user_ids = {
        int(player["user_id"])
        for player in g.get("_players", [])
        if player.get("user_id") is not None
    }
    if persist_runtime_game(g, totals, snapshot_fields):
        ranks_before = _achievement_ranks_safely(achievement_user_ids, game_id=g.get("_id"))
        achievement_unlocks = sync_achievements_for_users(achievement_user_ids)
        ranks_after = _achievement_ranks_safely(achievement_user_ids, game_id=g.get("_id"))
        achievement_rank_ups = _rank_ups_for_completed_game(
            g,
            ranks_before,
            ranks_after,
        )
    delete_active_game(str(g.get("_id") or ""))

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
        losers = ", ".join(_name(pid) for pid in (mB if winner_team == "A" else mA))
        rec = {
            "ts": entry_time,
            "points": wt_total,
            "name": winners,
            "gamename": game_name,
            "opponent": losers,
            "opp_points": lt_total,
            "diff": diff,
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
            "diff": diff,
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
            "diff": diff,
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
            "diff": shame_diff,
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
            for x in lst or []:
                try:
                    ts = datetime.fromisoformat(x.get("ts"))
                except (AttributeError, TypeError, ValueError):
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
        data[bucket] = list(data[bucket]) + entries_for_alltime
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

    mutate_json(files, files.recent, mutate_recent)
    mutate_json(files, files.alltime, mutate_alltime)
    if not is_hc:
        mutate_json(files, files.shame, mutate_shame)
    mutate_json(files, files.last_games, mutate_last_games)
    mutate_stats(
        files,
        incr_games=True,
        average_points=winner_points_for_average,
        hardcore=is_hc,
    )
    return {
        "achievement_unlocks": {
            str(player["id"]): achievement_unlocks.get(int(player["user_id"]), [])
            for player in g.get("_players", [])
            if player.get("user_id") is not None and achievement_unlocks.get(int(player["user_id"]))
        },
        "achievement_rank_ups": achievement_rank_ups,
    }
