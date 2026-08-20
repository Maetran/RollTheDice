from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from .database import database_schema_ready, session_scope
from .models import CompletedGame, DeletedGame, GameParticipant
from .rules import compute_overall
from .security import as_utc, utcnow


logger = logging.getLogger(__name__)


def stable_game_id(entry: dict) -> str | None:
    """Return the real game ID or a deterministic ID for pre-snapshot rows."""
    if entry.get("game_id"):
        return str(entry["game_id"])
    if not entry.get("ts") or not entry.get("name") or entry.get("points") is None:
        return None
    identity = {
        key: entry.get(key)
        for key in ("ts", "name", "points", "gamename", "opponent", "opp_points", "hardcore")
    }
    digest = hashlib.sha256(
        json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:20]
    return f"legacy-{digest}"


def _legacy_mode(entry: dict) -> str:
    if entry.get("mode") is not None:
        return str(entry["mode"])
    if str(entry.get("opponent") or "").strip() in {"", "-"} and int(entry.get("opp_points") or 0) == 0:
        return "1"
    return "legacy"


def _parse_datetime(value: object) -> datetime:
    if isinstance(value, datetime):
        return as_utc(value)
    text = str(value or "")
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return utcnow()


def _scoreboard_total(board: dict, *, hardcore: bool) -> int:
    rows: dict[int, dict[str, int]] = {1: {}, 2: {}, 3: {}, 4: {}}
    for item in (board or {}).get("reihen", []):
        if not isinstance(item, dict):
            continue
        try:
            index = int(item.get("index"))
        except (TypeError, ValueError):
            continue
        if index not in rows or not isinstance(item.get("rows"), dict):
            continue
        rows[index] = {
            str(key): int(value)
            for key, value in item["rows"].items()
            if isinstance(value, (int, float))
        }
    return int(compute_overall(rows, hardcore=hardcore)["overall"]["overall_total"])


def _participants_from_snapshot(snapshot: dict) -> list[dict]:
    players = snapshot.get("players") if isinstance(snapshot.get("players"), list) else []
    scoreboards = snapshot.get("scoreboards") if isinstance(snapshot.get("scoreboards"), dict) else {}
    hardcore = bool(snapshot.get("hardcore"))
    mode = str(snapshot.get("mode") or "")
    participants = []
    for position, player in enumerate(players):
        if not isinstance(player, dict):
            continue
        player_key = str(player.get("id") or f"legacy-{position}")
        team = str(player.get("team") or "") or None
        board_key = team if mode.lower() == "2v2" and team else player_key
        points = _scoreboard_total(scoreboards.get(board_key, {}), hardcore=hardcore)
        participants.append({
            "position": position,
            "player_key": player_key,
            "display_name": str(player.get("name") or "Gast")[:64],
            "team": team,
            "points": points,
            # Numerische user_ids aus JSON dürfen nicht in eine neue Datenbank
            # übernommen werden: dort könnten sie zu einem anderen Konto gehören.
            "user_id": None,
        })
    return participants


def persist_completed_game(
    *,
    game_id: str,
    game_name: str,
    mode: str,
    hardcore: bool,
    finished_at: datetime,
    snapshot: dict,
    participants: list[dict],
    imported_from_legacy: bool = False,
) -> bool:
    if not database_schema_ready():
        return False
    try:
        with session_scope() as db:
            if db.scalar(select(DeletedGame.id).where(DeletedGame.game_id == str(game_id))):
                return False
            if db.scalar(select(CompletedGame.id).where(CompletedGame.game_id == str(game_id))):
                return False
            row = CompletedGame(
                game_id=str(game_id),
                game_name=str(game_name or "")[:160],
                finished_at=as_utc(finished_at),
                mode=str(mode or ""),
                hardcore=bool(hardcore),
                snapshot_json=json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")),
                imported_from_legacy=bool(imported_from_legacy),
                created_at=utcnow(),
            )
            db.add(row)
            db.flush()
            for position, participant in enumerate(participants):
                db.add(GameParticipant(
                    game_id=row.id,
                    position=int(participant.get("position", position)),
                    player_key=str(participant.get("player_key") or f"player-{position}")[:64],
                    display_name=str(participant.get("display_name") or "Gast")[:64],
                    team=(str(participant.get("team"))[:8] if participant.get("team") else None),
                    points=int(participant.get("points", 0)),
                    user_id=participant.get("user_id"),
                    assigned_at=utcnow() if participant.get("user_id") is not None else None,
                ))
        return True
    except SQLAlchemyError:
        logger.exception("Could not persist completed game %s", game_id)
        return False


def deleted_game_ids() -> set[str]:
    if not database_schema_ready():
        return set()
    with session_scope() as db:
        return {str(game_id) for game_id in db.scalars(select(DeletedGame.game_id))}


def recent_winner_points_by_mode(limit: int = 3) -> dict[str, list[int]]:
    """Return winner/team scores from the latest completed games per scoring mode."""
    result: dict[str, list[int]] = {"normal": [], "hc": []}
    if not database_schema_ready():
        return result
    with session_scope() as db:
        rows = db.execute(
            select(
                CompletedGame.hardcore,
                CompletedGame.finished_at,
                CompletedGame.id,
                func.max(GameParticipant.points),
            )
            .join(GameParticipant, GameParticipant.game_id == CompletedGame.id)
            .group_by(CompletedGame.id)
            .order_by(CompletedGame.finished_at.desc(), CompletedGame.id.desc())
        ).all()
    for hardcore, _finished_at, _game_id, points in rows:
        bucket = result["hc" if hardcore else "normal"]
        if len(bucket) < limit and points is not None:
            bucket.append(int(points))
        if all(len(values) >= limit for values in result.values()):
            break
    return result


def delete_completed_game(*, game_id: str, admin_user_id: int, reason: str) -> dict:
    """Delete snapshot/participants and retain only a non-scoring audit tombstone."""
    clean_reason = str(reason or "").strip()
    if len(clean_reason) < 10:
        raise ValueError("deletion_reason_too_short")
    with session_scope() as db:
        if db.scalar(select(DeletedGame.id).where(DeletedGame.game_id == str(game_id))):
            raise ValueError("game_already_deleted")
        game = db.scalar(select(CompletedGame).where(CompletedGame.game_id == str(game_id)))
        if not game:
            raise LookupError("game_not_found")
        participants = list(game.participants)
        winner_points = max((int(participant.points) for participant in participants), default=0)
        affected_user_ids = sorted({
            int(participant.user_id) for participant in participants if participant.user_id is not None
        })
        result = {
            "game_id": game.game_id,
            "game_name": game.game_name,
            "finished_at": as_utc(game.finished_at),
            "mode": game.mode,
            "hardcore": bool(game.hardcore),
            "imported_from_legacy": bool(game.imported_from_legacy),
            "winner_points": winner_points,
            "affected_user_ids": affected_user_ids,
        }
        db.add(DeletedGame(
            game_id=game.game_id,
            game_name=game.game_name,
            finished_at=game.finished_at,
            mode=game.mode,
            hardcore=game.hardcore,
            deleted_at=utcnow(),
            deleted_by_user_id=admin_user_id,
            reason=clean_reason,
        ))
        db.delete(game)
        return result


def persist_runtime_game(game: dict, totals: dict[str, int], snapshot: dict) -> bool:
    mode = str(game.get("_mode") or "")
    is_team = mode.lower() == "2v2"
    participants = []
    for position, player in enumerate(game.get("_players", [])):
        player_key = str(player.get("id") or f"player-{position}")
        team = game.get("_team_of", {}).get(player_key) if is_team else None
        score_key = team if is_team else player_key
        participants.append({
            "position": position,
            "player_key": player_key,
            "display_name": player.get("name") or "Gast",
            "team": team,
            "points": int(totals.get(score_key, 0)),
            "user_id": player.get("user_id"),
        })
    finished_at = _parse_datetime(snapshot.get("finished_at"))
    return persist_completed_game(
        game_id=str(game.get("_id") or snapshot.get("game_id") or ""),
        game_name=str(game.get("_name") or ""),
        mode=mode,
        hardcore=bool(game.get("_hardcore")),
        finished_at=finished_at,
        snapshot=snapshot,
        participants=participants,
    )


def import_legacy_leaderboards(paths: list[Path]) -> int:
    candidates: dict[str, dict] = {}
    for path in paths:
        if not path.exists():
            continue
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            logger.warning("Skipping unreadable legacy leaderboard %s", path)
            continue
        arrays = list(raw.values()) if isinstance(raw, dict) else [raw]
        for array in arrays:
            if not isinstance(array, list):
                continue
            for entry in array:
                if not isinstance(entry, dict):
                    continue
                game_id = stable_game_id(entry)
                if not game_id:
                    continue
                current = candidates.get(game_id)
                has_snapshot = isinstance(entry.get("players"), list) and isinstance(entry.get("scoreboards"), dict)
                current_has_snapshot = bool(
                    current and isinstance(current.get("players"), list) and isinstance(current.get("scoreboards"), dict)
                )
                if current is None or (has_snapshot and not current_has_snapshot):
                    candidates[game_id] = entry

    imported = 0
    for game_id, entry in candidates.items():
        participants = _participants_from_snapshot(entry)
        if not participants:
            participants = [{
                "position": 0,
                "player_key": f"legacy-{game_id}",
                "display_name": entry.get("name") or "Gast",
                "team": None,
                "points": int(entry.get("points", 0)),
                "user_id": None,
            }]
        if persist_completed_game(
            game_id=game_id,
            game_name=str(entry.get("gamename") or entry.get("name") or ""),
            mode=_legacy_mode(entry),
            hardcore=bool(entry.get("hardcore")),
            finished_at=_parse_datetime(entry.get("finished_at") or entry.get("ts")),
            snapshot=entry,
            participants=participants,
            imported_from_legacy=True,
        ):
            imported += 1
    if imported:
        logger.info("Imported %s legacy completed games", imported)
    return imported
