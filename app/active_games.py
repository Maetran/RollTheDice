from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from .database import database_schema_ready, session_scope
from .game_types import game_type_from_state
from .models import ActiveGame
from .security import utcnow

logger = logging.getLogger(__name__)


def _json_safe(value: Any) -> Any:
    """Convert runtime state to JSON without sockets or process-local timers."""
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    if isinstance(value, dict):
        return {
            str(key): _json_safe(item)
            for key, item in value.items()
            if key not in {"ws", "_roll_cooldown", "_live_sockets"}
        }
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return None


def serializable_game_state(game: dict) -> dict:
    """Return durable state; live connections are rebuilt on rejoin."""
    state = _json_safe(game)
    # A reversible in-browser Zilch draft is shared only with people currently
    # watching the room. It is never a persisted scoring hold and must not
    # reappear after a process restart.
    state.pop("_zilch_draft_preview", None)
    # Persist an explicit marker even when the source was restored from an old
    # snapshot.  ``game_type_from_state`` supplies the documented ZDWA default.
    state["_game_type"] = game_type_from_state(game)
    state["_spectators"] = []
    state["_superadmins"] = {}
    state["_roll_cooldown"] = {}
    state["_correction"] = {"active": False}
    for player in state.get("_players", []):
        player["ws"] = None
    return state


def save_active_game(game: dict) -> None:
    """Upsert a live game, retaining terminal state until typed persistence.

    A terminal board is itself recovery data: the completed-result finalizer
    needs it after a database failure or a restart.  It is removed only after
    the successful finalizer marks ``_completion_persisted``.  This applies to
    both supported game types; their payload construction remains separate.
    """
    if not database_schema_ready():
        return
    game_id = str(game.get("_id") or "").strip()
    if not game_id:
        return
    # Resolve/validate the marker before serializing an active state.  Missing
    # historical markers still default to ZDWA through the shared contract.
    game_type_from_state(game)
    if game.get("_aborted") or game.get("_completion_persisted"):
        delete_active_game(game_id)
        return
    now = utcnow()
    payload = json.dumps(serializable_game_state(game), ensure_ascii=False, separators=(",", ":"))
    try:
        with session_scope() as db:
            stored = db.scalar(select(ActiveGame).where(ActiveGame.game_id == game_id))
            if stored is None:
                db.add(ActiveGame(game_id=game_id, state_json=payload, created_at=now, updated_at=now))
            else:
                stored.state_json = payload
                stored.updated_at = now
    except SQLAlchemyError:
        logger.exception("Could not persist active game %s", game_id)


def delete_active_game(game_id: str) -> None:
    if not database_schema_ready():
        return
    try:
        with session_scope() as db:
            stored = db.scalar(select(ActiveGame).where(ActiveGame.game_id == str(game_id)))
            if stored is not None:
                db.delete(stored)
    except SQLAlchemyError:
        logger.exception("Could not delete active game %s", game_id)


def _parse_activity(value: Any) -> datetime:
    try:
        text = str(value or "")
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return utcnow()


def load_active_games() -> dict[str, dict]:
    """Load durable states and mark connected players for explicit rejoin."""
    if not database_schema_ready():
        return {}
    restored: dict[str, dict] = {}
    try:
        with session_scope() as db:
            rows = list(db.scalars(select(ActiveGame)).all())
            for row in rows:
                game: dict | None = None
                try:
                    game = json.loads(row.state_json)
                    if not isinstance(game, dict):
                        db.delete(row)
                        continue
                    # Missing type markers belong to pre-multigame ZDWA
                    # snapshots. Unknown markers are malformed and must never
                    # be silently routed through a different rules engine.
                    game["_game_type"] = game_type_from_state(game)
                    if game.get("_aborted") or game.get("_completion_persisted"):
                        db.delete(row)
                        continue
                    game["_id"] = row.game_id
                    game["_last_activity"] = _parse_activity(game.get("_last_activity"))
                    game["_spectators"] = []
                    game["_superadmins"] = {}
                    game["_roll_cooldown"] = {}
                    game["_correction"] = {"active": False}
                    for player in game.get("_players", []):
                        player["ws"] = None
                    if game.get("_started") and game.get("_players"):
                        game["_resume_required"] = True
                    # Active Solo duration intentionally excludes the process
                    # downtime between persistence and restart.  Import here
                    # rather than at module scope because zilch_state itself
                    # persists new games through this module.
                    if game.get("_started") and game.get("_game_type") == "zilch":
                        from .zilch_state import pause_zilch_solo_timer, zilch_is_configured_solo_game

                        if zilch_is_configured_solo_game(game):
                            pause_zilch_solo_timer(game, count_elapsed=False)
                    restored[row.game_id] = game
                except (TypeError, ValueError, json.JSONDecodeError):
                    # A terminal state with an unknown game type may contain
                    # the only surviving evidence of a result.  It cannot be
                    # routed safely, but Part 4 must not silently delete it
                    # during startup recovery.  Keep the row for inspection;
                    # ordinary malformed live snapshots retain the previous
                    # cleanup behaviour.
                    if isinstance(game, dict) and game.get("_finished"):
                        logger.exception("Retaining unrouteable terminal active game %s", row.game_id)
                        continue
                    logger.exception("Could not restore active game %s", row.game_id)
                    db.delete(row)
    except SQLAlchemyError:
        logger.exception("Could not load active games")
    return restored
