"""Per-room lifecycle fence and exact-account admission for legacy rooms.

ZDWA, Zilch and Hausdepp rooms are shared dicts mutated from the event loop
and from threadpool HTTP/snapshot paths. ``room_lock`` serializes one room's
timeout decision, RAM mutation and checkpoint inside this process. The
``active_games.admission_revision`` compare-and-set stays the authority across
database connections: a checkpoint derived from an existing room only UPDATEs
the revision it was bound to, and every admission advances that revision.

Never await while holding a room lock. Watten keeps its native async table
lock and never enters these helpers.

Lock order: ``hausdepp_rematch._LOCK`` (Hausdepp only) → room lock → database
write transaction (the game row first, then exact ``User`` rows ascending).
"""

from __future__ import annotations

import json
import logging
import threading
import weakref
from contextlib import contextmanager, nullcontext
from typing import Any, Callable, Iterable, Iterator

from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError

from .game_types import HAUSDEPP_GAME_TYPE

logger = logging.getLogger(__name__)

# Process-local link between one in-memory room object and the durable row it
# was inserted as or restored from. It is never serialized: a JSON copy of a
# room must not inherit write authority over the row.
BINDING_KEY = "_active_row"
_CANDIDATE = "candidate"
# Transport-only containers keep their identity in an admission candidate so
# installation cannot detach a live socket registry.
_SHARED_TRANSPORT_KEYS = frozenset({"_live_sockets", "_spectators", "_roll_cooldown"})

# Weak values: an entry lives exactly as long as some holder or waiter keeps
# the lock (``room_lock`` binds it to a local for the whole ``with``), so an
# active waiter can never be handed a different lock for the same room id.
_ROOM_LOCKS: "weakref.WeakValueDictionary[str, Any]" = weakref.WeakValueDictionary()
_ROOM_LOCKS_GUARD = threading.Lock()

# Test seam: called inside the room lock after the staged candidate is fully
# validated and immediately before its strict database commit.
_before_admission_commit: Callable[[dict], None] | None = None


class AdmissionError(RuntimeError):
    """A rejected admission; nothing was committed or installed."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _lock_for(game_id: str):
    with _ROOM_LOCKS_GUARD:
        lock = _ROOM_LOCKS.get(game_id)
        if lock is None:
            lock = _ROOM_LOCKS[game_id] = threading.RLock()
        return lock


@contextmanager
def room_lock(game: dict) -> Iterator[None]:
    """Synchronous reentrant fence for one legacy room id."""
    outer: Any = nullcontext()
    if game.get("_game_type") == HAUSDEPP_GAME_TYPE:
        from .hausdepp_rematch import _LOCK

        # Rematch guards already take _LOCK before reaching timeout/save.
        # Acquire it first here too so no path holds room lock → _LOCK.
        outer = _LOCK
    lock = _lock_for(str(game.get("_id") or ""))
    with outer, lock:
        yield


def bind_room(game: dict, game_id: str, revision: int) -> None:
    game[BINDING_KEY] = {"game_id": str(game_id), "revision": int(revision)}


def bound_revision(game: dict) -> int | None:
    """The row revision this exact object may write, or None when unbound."""
    binding = game.get(BINDING_KEY)
    if (isinstance(binding, dict) and binding.get("game_id") == str(game.get("_id") or "")
            and type(binding.get("revision")) is int):
        return binding["revision"]
    return None


def is_candidate(game: dict) -> bool:
    return game.get(BINDING_KEY) == _CANDIDATE


def recoverable_member_user_ids(state: dict) -> set[int]:
    """Exact accounts that hold or may reclaim a seat in a legacy checkpoint.

    Pure helper for the conservative membership backfill: every seated human
    and every account-bound host of ZDWA, Zilch and Hausdepp rooms.
    """
    ids: set[int] = set()
    for collection in ("_players", "_participants"):
        for person in state.get(collection) or []:
            if isinstance(person, dict) and not person.get("is_cpu") and person.get("type") != "cpu":
                value = person.get("user_id")
                if type(value) is int and value > 0:
                    ids.add(value)
    for key in ("_hausdepp_host_user_id", "_zilch_cpu_host_user_id", "_zilch_solo_host_user_id"):
        value = state.get(key)
        if type(value) is int and value > 0:
            ids.add(value)
    return ids


def clone_candidate(game: dict) -> dict:
    """Copy all mutable state while preserving live transport references.

    ``_players`` is copied as a list whose existing player dicts (and their
    ``ws``) stay identical; native joins append to it but never edit an
    existing transport player. Every other container is copied deeply.
    """

    def copy(value: Any) -> Any:
        if isinstance(value, dict):
            return {key: copy(item) for key, item in value.items()}
        if isinstance(value, list):
            return [copy(item) for item in value]
        return value

    candidate: dict = {}
    for key, value in game.items():
        if key in _SHARED_TRANSPORT_KEYS:
            candidate[key] = value
        elif key == "_players" and isinstance(value, list):
            candidate[key] = list(value)
        else:
            candidate[key] = copy(value)
    # A candidate never persists itself: native helpers that save or retain
    # (timeout pins, rematch guards) are refused until the strict commit.
    candidate[BINDING_KEY] = _CANDIDATE
    return candidate


def install_candidate(game: dict, candidate: dict, revision: int) -> None:
    """Non-failing in-place installation into the same room object."""
    bind_room(candidate, str(game.get("_id") or ""), revision)
    removed = [key for key in game if key not in candidate]
    game.update(candidate)
    for key in removed:
        game.pop(key, None)


def _exact_accounts(db, user_ids: Iterable[int]) -> None:
    from .account_progress import ProgressIdentityError, require_exact_active_account

    try:
        for user_id in sorted(set(user_ids)):
            require_exact_active_account(db, user_id)
    except ProgressIdentityError as exc:
        raise AdmissionError("account_retired_or_inactive") from exc


def _add_memberships(db, game_id: str, user_ids: Iterable[int], revision: int, now) -> None:
    from .models import GameAccountMembership

    for user_id in sorted(set(user_ids)):
        if db.get(GameAccountMembership, (game_id, user_id)) is None:
            db.add(GameAccountMembership(game_id=game_id, user_id=user_id,
                                         admission_revision=revision, admitted_at=now))


def commit_admission(game: dict, candidate: dict, user_ids: Iterable[int], *, creating: bool = False) -> int:
    """Strictly persist an accepted candidate plus its exact memberships.

    The caller holds the room lock. A bound object only UPDATEs its captured
    revision. An unbound object is rejected unless the caller is an explicit
    new-room creation (``creating=True``), which strictly INSERTs. A missing
    row is never taken to mean "new". Returns the new revision; raises
    ``AdmissionError`` without side effects.
    """
    from .active_games import serializable_game_state
    from .database import database_schema_ready, session_scope
    from .models import ActiveGame
    from .security import utcnow

    game_id = str(game.get("_id") or "")
    if not game_id:
        raise AdmissionError("admission_room_missing")
    revision = bound_revision(game)
    if not database_schema_ready():
        if candidate.get("_game_type") == HAUSDEPP_GAME_TYPE and candidate.get("_hausdepp_four_of_a_kind_as_ten"):
            raise AdmissionError("hausdepp_feature_settings_unavailable")
        # No configured durable store (focused unit setups): rooms are
        # volatile exactly like ``save_active_game``'s no-op.
        return (revision or 0) + 1
    if revision is None and (not creating or is_candidate(game)):
        # Ordinary admissions need a row binding. A discarded or retired
        # object keeps its binding, so its CAS below fails instead.
        raise AdmissionError("admission_room_unbound")
    user_ids = sorted({int(value) for value in user_ids})
    payload = json.dumps(serializable_game_state(candidate), ensure_ascii=False, separators=(",", ":"))
    now = utcnow()
    try:
        with session_scope() as db:
            previous = None
            if revision is not None and candidate.get("_game_type") == HAUSDEPP_GAME_TYPE:
                previous_raw = db.scalar(select(ActiveGame.state_json).where(
                    ActiveGame.game_id == game_id, ActiveGame.admission_revision == revision).with_for_update())
                if previous_raw is None:
                    raise AdmissionError("admission_room_changed")
                previous = json.loads(previous_raw)
            if revision is None:
                new_revision = 0
                db.add(ActiveGame(game_id=game_id, state_json=payload, created_at=now, updated_at=now,
                                  admission_revision=new_revision))
                db.flush()
            else:
                new_revision = revision + 1
                # The game row is the first write: it takes SQLite's write lock
                # and fences a deleted, retired or concurrently admitted room.
                changed = db.execute(update(ActiveGame).where(
                    ActiveGame.game_id == game_id, ActiveGame.admission_revision == revision,
                ).values(state_json=payload, updated_at=now, admission_revision=new_revision)
                    .execution_options(synchronize_session=False))
                if changed.rowcount != 1:
                    raise AdmissionError("admission_room_changed")
            if candidate.get("_game_type") == HAUSDEPP_GAME_TYPE:
                from .account_progress import ProgressIdentityError, lock_account_rows
                from .hausdepp_features import HausdeppFeatureError, creator_ids, validate_checkpoint_features

                try:
                    # Prelock the complete set before either exact-account
                    # validation or the policy singleton can acquire locks.
                    feature_accounts = creator_ids(candidate) if previous is None or previous.get("_hausdepp") is None else set()
                    if feature_accounts:
                        lock_account_rows(db, set(user_ids) | feature_accounts)
                    _exact_accounts(db, user_ids)
                    validate_checkpoint_features(db, candidate, previous, creating=creating)
                except (HausdeppFeatureError, ProgressIdentityError) as exc:
                    raise AdmissionError(str(exc)) from exc
            else:
                _exact_accounts(db, user_ids)
            _add_memberships(db, game_id, user_ids, new_revision, now)
    except SQLAlchemyError as exc:
        logger.exception("Could not commit admission for game %s", game_id)
        raise AdmissionError("admission_storage_unavailable") from exc
    return new_revision


def admit_player(game: dict, player: dict) -> None:
    """Stage, strictly commit and install one native join (plus autostart).

    Raises ``AdmissionError`` (rejected/storage) or ``ValueError`` (native
    rule). On any error the room, its row and its memberships are unchanged.
    """
    from .game_registry import join_player_to_game, start_game_if_ready
    from .game_state import _join_block_reason, check_timeout_and_abort, touch

    with room_lock(game):
        # The deadline decision is made under the same fence as the admission.
        check_timeout_and_abort(game)
        if reason := _join_block_reason(game):
            raise AdmissionError(reason)
        candidate = clone_candidate(game)
        join_player_to_game(candidate, player)
        start_game_if_ready(candidate)
        touch(candidate)
        user_id = player.get("user_id")
        user_ids = [user_id] if type(user_id) is int and user_id > 0 else []
        if _before_admission_commit is not None:
            _before_admission_commit(game)
        revision = commit_admission(game, candidate, user_ids)
        install_candidate(game, candidate, revision)


def commit_room_binding(game: dict, user_ids: Iterable[int]) -> None:
    """Strictly persist a configured new room and its account-bound hosts.

    Explicit creation: an unregistered, never-stored room INSERTs; a room its
    factory already stored only advances that exact row revision.
    """
    with room_lock(game):
        candidate = clone_candidate(game)
        revision = commit_admission(game, candidate, user_ids, creating=True)
        install_candidate(game, candidate, revision)


def discard_new_room(game: dict) -> None:
    """Roll back a room whose strict creation failed before anyone saw it."""
    from .active_games import delete_active_game
    from .game_state import games

    game_id = str(game.get("_id") or "")
    with room_lock(game):
        if games.get(game_id) is game:
            games.pop(game_id, None)
        if bound_revision(game) is not None:
            delete_active_game(game_id, expected_revision=bound_revision(game))
        # A discarded object can never write its id again.
        game[BINDING_KEY] = {"game_id": game_id, "revision": -1}


def verify_exact_account(game: dict, user_id: object) -> None:
    """Rejoin guard: the seat's exact account must still be active."""
    from .database import database_schema_ready, session_scope

    if type(user_id) is not int or user_id < 1 or not database_schema_ready():
        return
    try:
        with session_scope() as db:
            _exact_accounts(db, [user_id])
    except SQLAlchemyError as exc:
        logger.exception("Could not verify account for game %s", game.get("_id"))
        raise AdmissionError("admission_storage_unavailable") from exc
