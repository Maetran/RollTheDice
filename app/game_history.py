from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from .database import database_schema_ready, session_scope
from .game_types import DEFAULT_GAME_TYPE, GameType, game_type_from_state, normalize_game_type
from .models import CompletedGame, DeletedGame, GameParticipant, User
from .rules import compute_overall
from .security import as_utc, utcnow

logger = logging.getLogger(__name__)


CompletedGameWriteStatus = Literal["stored", "already_stored", "blocked", "failed"]


@dataclass(frozen=True)
class CompletedGameWriteResult:
    """Outcome of one idempotent completed-game write attempt.

    ``already_stored`` is deliberately successful for a typed finalizer: a
    process may restart after committing the durable row but before removing
    its active terminal state.  The older boolean wrappers below retain their
    historic ``False`` result for a duplicate so existing ZDWA callers do not
    accidentally repeat aggregate side effects.
    """

    status: CompletedGameWriteStatus
    game_id: str
    game_type: GameType
    completed_game_id: int | None = None
    reason: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.status in {"stored", "already_stored"}


def _completed_game_type(value: object | None) -> GameType:
    """Validate a persisted result type using the central game-type contract."""
    return normalize_game_type(value)


def stable_game_id(entry: dict) -> str | None:
    """Return the real game ID or a deterministic ID for pre-snapshot rows."""
    if entry.get("game_id"):
        return str(entry["game_id"])
    if not entry.get("ts") or not entry.get("name") or entry.get("points") is None:
        return None
    identity = {
        key: entry.get(key) for key in ("ts", "name", "points", "gamename", "opponent", "opp_points", "hardcore")
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
        rows[index] = {str(key): int(value) for key, value in item["rows"].items() if isinstance(value, (int, float))}
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
        participants.append(
            {
                "position": position,
                "player_key": player_key,
                "display_name": str(player.get("name") or "Gast")[:64],
                "team": team,
                "points": points,
                # Numerische user_ids aus JSON dürfen nicht in eine neue Datenbank
                # übernommen werden: dort könnten sie zu einem anderen Konto gehören.
                "user_id": None,
            }
        )
    return participants


def persist_completed_game_result(
    *,
    game_id: str,
    game_name: str,
    game_type: object | None = DEFAULT_GAME_TYPE,
    mode: str,
    hardcore: bool,
    finished_at: datetime,
    snapshot: dict,
    participants: list[dict],
    imported_from_legacy: bool = False,
) -> CompletedGameWriteResult:
    """Atomically store a typed result and report idempotent success precisely."""
    normalized_game_id = str(game_id)
    normalized_type = _completed_game_type(game_type)
    if not database_schema_ready():
        return CompletedGameWriteResult("failed", normalized_game_id, normalized_type, reason="database_not_ready")

    def existing_result() -> CompletedGameWriteResult | None:
        try:
            with session_scope() as db:
                deleted = db.scalar(select(DeletedGame).where(DeletedGame.game_id == normalized_game_id))
                if deleted is not None:
                    return CompletedGameWriteResult("blocked", normalized_game_id, normalized_type, reason="game_deleted")
                existing = db.scalar(select(CompletedGame).where(CompletedGame.game_id == normalized_game_id))
                if existing is None:
                    return None
                if existing.game_type != normalized_type:
                    return CompletedGameWriteResult(
                        "failed",
                        normalized_game_id,
                        normalized_type,
                        completed_game_id=existing.id,
                        reason="game_id_type_conflict",
                    )
                return CompletedGameWriteResult(
                    "already_stored",
                    normalized_game_id,
                    normalized_type,
                    completed_game_id=existing.id,
                )
        except SQLAlchemyError:
            logger.exception("Could not inspect completed game %s", normalized_game_id)
            return CompletedGameWriteResult("failed", normalized_game_id, normalized_type, reason="database_error")

    try:
        with session_scope() as db:
            if db.scalar(select(DeletedGame.id).where(DeletedGame.game_id == normalized_game_id)):
                return CompletedGameWriteResult("blocked", normalized_game_id, normalized_type, reason="game_deleted")
            existing = db.scalar(select(CompletedGame).where(CompletedGame.game_id == normalized_game_id))
            if existing is not None:
                if existing.game_type == normalized_type:
                    return CompletedGameWriteResult(
                        "already_stored",
                        normalized_game_id,
                        normalized_type,
                        completed_game_id=existing.id,
                    )
                return CompletedGameWriteResult(
                    "failed",
                    normalized_game_id,
                    normalized_type,
                    completed_game_id=existing.id,
                    reason="game_id_type_conflict",
                )
            row = CompletedGame(
                game_id=normalized_game_id,
                game_type=normalized_type,
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
                raw_user_id = participant.get("user_id")
                try:
                    user_id = int(raw_user_id) if raw_user_id is not None else None
                except (TypeError, ValueError):
                    user_id = None
                # Result payloads retain the historical display name even
                # when an account vanished between a game and finalization.
                # Do not let an obsolete optional foreign key lose the whole
                # completed result.
                if user_id is not None and db.get(User, user_id) is None:
                    user_id = None
                db.add(
                    GameParticipant(
                        game_id=row.id,
                        position=int(participant.get("position", position)),
                        player_key=str(participant.get("player_key") or f"player-{position}")[:64],
                        display_name=str(participant.get("display_name") or "Gast")[:64],
                        team=(str(participant.get("team"))[:8] if participant.get("team") else None),
                        points=int(participant.get("points", 0)),
                        user_id=user_id,
                        assigned_at=utcnow() if user_id is not None else None,
                    )
                )
        return CompletedGameWriteResult("stored", normalized_game_id, normalized_type, completed_game_id=row.id)
    except IntegrityError:
        # A concurrent terminal action can win the unique game_id race after
        # both callers performed their preflight lookup.  Read it back and
        # treat only the same typed row as an idempotent success.
        result = existing_result()
        if result is not None:
            return result
        logger.exception("Could not persist completed game %s after a uniqueness conflict", normalized_game_id)
        return CompletedGameWriteResult("failed", normalized_game_id, normalized_type, reason="integrity_error")
    except (SQLAlchemyError, TypeError, ValueError):
        logger.exception("Could not persist completed game %s", normalized_game_id)
        return CompletedGameWriteResult("failed", normalized_game_id, normalized_type, reason="database_error")


def persist_completed_game(
    *,
    game_id: str,
    game_name: str,
    game_type: object | None = DEFAULT_GAME_TYPE,
    mode: str,
    hardcore: bool,
    finished_at: datetime,
    snapshot: dict,
    participants: list[dict],
    imported_from_legacy: bool = False,
) -> bool:
    """Compatibility wrapper returning ``True`` only for a fresh insert."""
    return persist_completed_game_result(
        game_id=game_id,
        game_name=game_name,
        game_type=game_type,
        mode=mode,
        hardcore=hardcore,
        finished_at=finished_at,
        snapshot=snapshot,
        participants=participants,
        imported_from_legacy=imported_from_legacy,
    ).status == "stored"


def deleted_game_ids(*, game_type: object | None = DEFAULT_GAME_TYPE) -> set[str]:
    """Return tombstones only for the requested result family.

    The public ZDWA leaderboard must not even conceptually consult private
    Zilch tombstones once both result types coexist.
    """
    if not database_schema_ready():
        return set()
    normalized_type = _completed_game_type(game_type)
    with session_scope() as db:
        return {
            str(game_id)
            for game_id in db.scalars(
                select(DeletedGame.game_id).where(DeletedGame.game_type == normalized_type)
            )
        }


def completed_game_type_for_id(game_id: str) -> GameType | None:
    """Return a stored result's validated type without exposing its payload."""
    if not database_schema_ready():
        return None
    with session_scope() as db:
        raw_type = db.scalar(
            select(CompletedGame.game_type).where(CompletedGame.game_id == str(game_id))
        )
    if raw_type is None:
        return None
    try:
        return _completed_game_type(raw_type)
    except ValueError:
        logger.error("Completed game %s has an unknown persisted type %r", game_id, raw_type)
        return None


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
            .where(CompletedGame.game_type == DEFAULT_GAME_TYPE)
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
        affected_user_ids = sorted(
            {int(participant.user_id) for participant in participants if participant.user_id is not None}
        )
        result = {
            "game_id": game.game_id,
            "game_type": game.game_type,
            "game_name": game.game_name,
            "finished_at": as_utc(game.finished_at),
            "mode": game.mode,
            "hardcore": bool(game.hardcore),
            "imported_from_legacy": bool(game.imported_from_legacy),
            "winner_points": winner_points,
            "affected_user_ids": affected_user_ids,
        }
        db.add(
            DeletedGame(
                game_id=game.game_id,
                game_type=game.game_type,
                game_name=game.game_name,
                finished_at=game.finished_at,
                mode=game.mode,
                hardcore=game.hardcore,
                deleted_at=utcnow(),
                deleted_by_user_id=admin_user_id,
                reason=clean_reason,
            )
        )
        db.delete(game)
        return result


def persist_runtime_game_result(
    game: dict,
    totals: dict[str, int],
    snapshot: dict,
) -> CompletedGameWriteResult:
    """Persist the established ZDWA runtime result with typed idempotency.

    This remains deliberately separate from Zilch: callers that attempt to
    route another game through the ZDWA scorecard history get a precise failed
    result rather than a best-effort row.
    """
    game_id = str(game.get("_id") or snapshot.get("game_id") or "")
    # Defensive second boundary: Zilch's result format must never create a
    # completed ZDWA row even if a future caller mistakenly asks to persist it.
    if game_type_from_state(game) != DEFAULT_GAME_TYPE:
        logger.warning("Refusing to persist non-ZDWA game %s in completed history", game.get("_id"))
        return CompletedGameWriteResult(
            "failed",
            game_id,
            DEFAULT_GAME_TYPE,
            reason="wrong_game_type",
        )
    mode = str(game.get("_mode") or "")
    is_team = mode.lower() == "2v2"
    participants = []
    for position, player in enumerate(game.get("_players", [])):
        player_key = str(player.get("id") or f"player-{position}")
        team = game.get("_team_of", {}).get(player_key) if is_team else None
        score_key = team if is_team else player_key
        participants.append(
            {
                "position": position,
                "player_key": player_key,
                "display_name": player.get("name") or "Gast",
                "team": team,
                "points": int(totals.get(score_key, 0)),
                "user_id": player.get("user_id"),
            }
        )
    finished_at = _parse_datetime(snapshot.get("finished_at"))
    return persist_completed_game_result(
        game_id=game_id,
        game_name=str(game.get("_name") or ""),
        game_type=DEFAULT_GAME_TYPE,
        mode=mode,
        hardcore=bool(game.get("_hardcore")),
        finished_at=finished_at,
        snapshot=snapshot,
        participants=participants,
    )


def persist_runtime_game(game: dict, totals: dict[str, int], snapshot: dict) -> bool:
    """Historic boolean facade for callers that only care about first write."""
    return persist_runtime_game_result(game, totals, snapshot).status == "stored"


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
                    current
                    and isinstance(current.get("players"), list)
                    and isinstance(current.get("scoreboards"), dict)
                )
                if current is None or (has_snapshot and not current_has_snapshot):
                    candidates[game_id] = entry

    imported = 0
    for game_id, entry in candidates.items():
        participants = _participants_from_snapshot(entry)
        if not participants:
            participants = [
                {
                    "position": 0,
                    "player_key": f"legacy-{game_id}",
                    "display_name": entry.get("name") or "Gast",
                    "team": None,
                    "points": int(entry.get("points", 0)),
                    "user_id": None,
                }
            ]
        if persist_completed_game(
            game_id=game_id,
            game_name=str(entry.get("gamename") or entry.get("name") or ""),
            game_type=DEFAULT_GAME_TYPE,
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
