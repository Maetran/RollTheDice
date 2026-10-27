from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select, update
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
            if key not in {"ws", "_roll_cooldown", "_live_sockets", "_active_row"}
        }
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return None


def serializable_game_state(game: dict) -> dict:
    """Return durable state; live connections are rebuilt on rejoin."""
    if game_type_from_state(game) == "watten":
        from .watten_runtime import serialize_watten_game

        return serialize_watten_game(game)
    state = _json_safe(game)
    # A reversible in-browser Zilch draft is shared only with people currently
    # watching the room. It is never a persisted scoring hold and must not
    # reappear after a process restart.
    state.pop("_zilch_draft_preview", None)
    state.pop("_hausdepp_cpu_thinking", None)
    state.pop("_hausdepp_presentation_until", None)
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


def save_active_game(game: dict, *, creating: bool = False) -> None:
    """Upsert a live game, retaining terminal state until durable accounting.

    A terminal board is itself recovery data: the completed-result finalizer
    needs it after a database failure or a restart.  It is removed only after
    the successful finalizer marks ``_completion_persisted``.  An aborted board
    similarly remains until its separate abandonment aggregate is written (or
    safely found inapplicable for an unstarted/guest-only room). This applies
    to both supported game types; their payload construction remains separate.

    A room bound to its row only UPDATEs the admission revision it holds; a
    zero-row result (deleted, retired or newer admission) is refused and never
    becomes an INSERT. An unbound object (for example a JSON copy) is refused;
    only a genuine new-room factory passes ``creating=True`` to INSERT strictly.
    """
    if game_type_from_state(game) == "watten":
        from .watten_runtime import persist_watten_game

        persist_watten_game(game)
        return
    if not database_schema_ready():
        return
    game_id = str(game.get("_id") or "").strip()
    if not game_id:
        return
    from .game_lifecycle import is_candidate, room_lock

    if is_candidate(game):
        # A staged admission persists only through its strict commit.
        return
    with room_lock(game):
        _save_active_game_locked(game, game_id, creating=creating)


def _save_active_game_locked(game: dict, game_id: str, *, creating: bool) -> None:
    from .game_lifecycle import bind_room, bound_revision

    # Resolve/validate the marker before serializing an active state.  Missing
    # historical markers still default to ZDWA through the shared contract.
    game_type_from_state(game)
    if game_type_from_state(game) == "hausdepp" and (game.get("_finished") or game.get("_aborted")):
        from .hausdepp_rematch import retain_rematch_source

        # Capture before an accounted abort/completion removes its only live
        # state. The recipe deliberately has no cards or plaintext room code.
        if retain_rematch_source(game):
            game.pop("_hausdepp_rematch_source_pending", None)
        else:
            game["_hausdepp_rematch_source_pending"] = True
    from .hausdepp_tournament import tournament_is_pending

    if not game.get("_hausdepp_rematch_source_pending") and (game.get("_completion_persisted") and not tournament_is_pending(game) or (
        game.get("_aborted") and game.get("_abandonment_accounted")
    )):
        if bound_revision(game) is not None:
            _delete_row(game_id, bound_revision(game))
        else:
            logger.warning("Refusing terminal delete from unbound game object %s", game_id)
        return
    now = utcnow()
    payload = json.dumps(serializable_game_state(game), ensure_ascii=False, separators=(",", ":"))
    revision = bound_revision(game)
    try:
        with session_scope() as db:
            if revision is not None:
                if game_type_from_state(game) == "hausdepp":
                    from .hausdepp_features import validate_checkpoint_features

                    # Read the old policy snapshot only after reserving the
                    # exact row for writing. A deferred SQLite read cannot
                    # safely upgrade after a competing writer changes it.
                    previous_raw = db.execute(update(ActiveGame).where(
                        ActiveGame.game_id == game_id, ActiveGame.admission_revision == revision,
                    ).values(state_json=ActiveGame.state_json).returning(ActiveGame.state_json)
                        .execution_options(synchronize_session=False)).scalar_one_or_none()
                    if previous_raw is None:
                        logger.warning("Refusing stale or retired Hausdepp checkpoint for game %s", game_id)
                        return
                    validate_checkpoint_features(db, game, json.loads(previous_raw))
                changed = db.execute(update(ActiveGame).where(
                    ActiveGame.game_id == game_id, ActiveGame.admission_revision == revision,
                ).values(state_json=payload, updated_at=now).execution_options(synchronize_session=False))
                if changed.rowcount != 1:
                    logger.warning("Refusing stale or retired checkpoint for game %s (revision %s)",
                                   game_id, revision)
                return
            if not creating:
                # A JSON copy or restored dict never gains write authority, and
                # a missing row never means "new". (A discarded/retired room
                # keeps its binding and is refused by the UPDATE above.)
                logger.error("Refusing unbound checkpoint for game %s", game_id)
                return
            if db.scalar(select(ActiveGame.id).where(ActiveGame.game_id == game_id)) is not None:
                logger.error("Refusing to create already stored game %s", game_id)
                return
            if game_type_from_state(game) == "hausdepp":
                from .hausdepp_features import validate_checkpoint_features

                validate_checkpoint_features(db, game, creating=True)
            db.add(ActiveGame(game_id=game_id, state_json=payload, created_at=now, updated_at=now,
                              admission_revision=0))
        bind_room(game, game_id, 0)
    except SQLAlchemyError:
        logger.exception("Could not persist active game %s", game_id)


def _delete_row(game_id: str, revision: int | None) -> None:
    """Delete one row, fenced to ``revision`` when the caller knows it."""
    conditions = [ActiveGame.game_id == str(game_id)]
    if revision is not None:
        conditions.append(ActiveGame.admission_revision == revision)
    try:
        with session_scope() as db:
            # Memberships follow through their database-level CASCADE.
            if db.execute(delete(ActiveGame).where(*conditions)).rowcount != 1 and revision is not None:
                logger.warning("Terminal delete for game %s did not match revision %s", game_id, revision)
    except SQLAlchemyError:
        logger.exception("Could not delete active game %s", game_id)


def delete_active_game(game_id: str, *, expected_revision: int | None = None) -> None:
    """Retire a stored room, fenced to a captured revision.

    Callers pass the revision they captured (startup uses the row it read;
    runtime callers capture it before removing the room from the registry).
    Without one, the live registry object's binding is used. A runtime delete
    with neither is refused rather than deleting by id.
    """
    if not database_schema_ready():
        return
    from .game_lifecycle import bound_revision, room_lock
    from .game_state import games

    game_id = str(game_id)
    live = games.get(game_id)
    with room_lock(live if live is not None else {"_id": game_id}):
        if expected_revision is None and live is not None:
            expected_revision = bound_revision(live)
        if expected_revision is None:
            logger.error("Refusing unfenced delete of active game %s", game_id)
            return
        _delete_row(game_id, expected_revision)


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
            # Materialize plain values and release the read transaction before
            # any recovery writer opens its own session. Otherwise a pending
            # delete can lock SQLite and starve all following recovery writes.
            rows = list(db.execute(select(
                ActiveGame.game_id, ActiveGame.state_json, ActiveGame.admission_revision,
            )).all())
    except SQLAlchemyError:
        logger.exception("Could not load active games")
        return restored
    from .game_lifecycle import bind_room

    for game_id, state_json, revision in rows:
        game: dict | None = None
        # Startup cleanup below is fenced to the exact row revision it read.
        try:
            game = json.loads(state_json)
            # A native payload signature still requires its strict decoder
            # when the discriminator is damaged; never use legacy defaults
            # or terminal cleanup for a private Watten recovery checkpoint.
            if isinstance(game, dict) and (game.get("_game_type") == "watten" or "_watten" in game):
                from .watten_runtime import restore_watten_json

                game = restore_watten_json(state_json)
                if game["_id"] != game_id:
                    raise ValueError("watten_storage_context_mismatch")
                restored[game_id] = game
                continue
            if not isinstance(game, dict):
                delete_active_game(game_id, expected_revision=revision)
                continue
            game["_id"] = game_id
            game["_game_type"] = game_type_from_state(game)
            # The row, not the JSON, carries the authoritative revision.
            bind_room(game, game_id, revision)
            from .hausdepp_tournament import tournament_is_pending, validate_tournament

            if game.get("_hausdepp_tournament") is not None:
                participants = game.get("_participants")
                if (not isinstance(participants, list) or not 2 <= len(participants) <= 6
                        or any(not isinstance(player, dict) or not isinstance(player.get("id"), str)
                               or not 1 <= len(player["id"]) <= 64 for player in participants)
                        or len({player["id"] for player in participants}) != len(participants)):
                    raise ValueError("hausdepp_invalid_tournament_participants")
                game["_hausdepp_tournament"] = validate_tournament(
                    game["_hausdepp_tournament"], {player["id"] for player in participants},
                    finished_round=bool(game.get("_finished")),
                )
            if game_type_from_state(game) == "hausdepp" and (game.get("_finished") or game.get("_aborted")):
                from .hausdepp_rematch import retain_rematch_source

                if not retain_rematch_source(game):
                    # Retain an unroutable terminal recovery row while its
                    # minimal recipe is unavailable; never revive the table.
                    continue
                game.pop("_hausdepp_rematch_source_pending", None)
            if game.get("_completion_persisted") and not tournament_is_pending(game) or (
                game.get("_aborted") and game.get("_abandonment_accounted")
            ):
                delete_active_game(game_id, expected_revision=revision)
                continue
            if game.get("_aborted"):
                from .abandoned_games import persist_abandoned_game

                result = persist_abandoned_game(game)
                if result.succeeded or result.status == "skipped":
                    delete_active_game(game_id, expected_revision=revision)
                else:
                    logger.error(
                        "Retaining abandoned active game %s until accounting succeeds: %s",
                        game_id,
                        result.reason or result.status,
                    )
                continue
            game["_last_activity"] = _parse_activity(game.get("_last_activity"))
            game["_spectators"] = []
            game["_superadmins"] = {}
            game["_roll_cooldown"] = {}
            game["_correction"] = {"active": False}
            # Current achievement points can change while the server is down
            # (for example a scoped award reset). Rehydrate cached ZDWA ranks.
            game.pop("_achievement_ranks_finalized", None)
            for player in game.get("_players", []):
                player["ws"] = None
                player.pop("achievement_rank", None)
            if game.get("_started") and game.get("_players"):
                game["_resume_required"] = True
            if game.get("_started") and game.get("_game_type") == "zilch":
                from .zilch_state import pause_zilch_solo_timer, zilch_is_configured_solo_game

                if zilch_is_configured_solo_game(game):
                    pause_zilch_solo_timer(game, count_elapsed=False)
            restored[game_id] = game
        except (TypeError, ValueError, json.JSONDecodeError):
            if isinstance(game, dict) and (game.get("_game_type") == "watten" or "_watten" in game):
                logger.exception("Retaining unrouteable private Watten checkpoint %s", game_id)
                continue
            if isinstance(game, dict) and game.get("_finished"):
                logger.exception("Retaining unrouteable terminal active game %s", game_id)
                continue
            logger.exception("Could not restore active game %s", game_id)
            delete_active_game(game_id, expected_revision=revision)
    return restored
