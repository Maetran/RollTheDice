"""Live-state integration for the isolated, server-authoritative Zilch rules."""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import replace
from datetime import datetime, timezone
from typing import Final, Literal

from .active_games import save_active_game
from .game_state import GameDict, games
from .game_types import ZILCH_GAME_TYPE
from .zilch_cpu_strategy import ZILCH_CPU_STRATEGIES as _CPU_STRATEGY_NAMES
from .zilch_cpu_strategy import validate_zilch_cpu_strategy
from .zilch_engine import (
    ZILCH_DICE_COUNT,
    ZILCH_RULESET_VERSION,
    ZILCH_TARGET_SCORE,
    ZilchRuleError,
    ZilchTurn,
    apply_zilch_streak,
    new_zilch_turn,
    resolve_zilch_start_attempt,
    zilch_turn_from_state,
)
from .zilch_solo_objective import (
    ZilchSoloObjectiveError,
    abandon_solo_objective,
    new_zilch_solo_objective_state,
    record_solo_objective_active_duration,
    record_solo_objective_bank,
    record_solo_objective_hot_dice,
    record_solo_objective_roll,
    record_solo_objective_turn_started,
    record_solo_objective_zilch,
    zilch_solo_objective_state_from_payload,
)

ZILCH_MIN_PLAYERS = 1
ZILCH_MAX_PLAYERS = 2

ZilchPlayMode = Literal["solo", "cpu", "multiplayer"]
ZilchParticipantType = Literal["human", "cpu"]
ZilchCpuStrategy = Literal["conservative", "normal", "aggressive"]

ZILCH_SOLO_MODE: Final[ZilchPlayMode] = "solo"
ZILCH_CPU_MODE: Final[ZilchPlayMode] = "cpu"
ZILCH_MULTIPLAYER_MODE: Final[ZilchPlayMode] = "multiplayer"
ZILCH_HUMAN_PARTICIPANT: Final[ZilchParticipantType] = "human"
ZILCH_CPU_PARTICIPANT: Final[ZilchParticipantType] = "cpu"
ZILCH_CPU_HOST_USER_KEY: Final = "_zilch_cpu_host_user_id"
ZILCH_CPU_GUEST_CAPABILITY_DIGEST_KEY: Final = "_zilch_cpu_host_token_hash"
ZILCH_SOLO_HOST_USER_KEY: Final = "_zilch_solo_host_user_id"
ZILCH_SOLO_GUEST_CAPABILITY_DIGEST_KEY: Final = "_zilch_solo_host_token_hash"
# Kept as a backwards-compatible state-module export while the pure strategy
# module remains the one canonical validation source.
ZILCH_CPU_STRATEGIES: Final[frozenset[str]] = _CPU_STRATEGY_NAMES
ZILCH_START_ROLL_AWAITING: Final = "awaiting_rolls"
ZILCH_START_ROLL_RESOLVED: Final = "resolved"


def _normalized_guest_host_token(value: object) -> str | None:
    """Accept only an opaque, browser-storable creator token.

    The raw token is returned once from creation and lives only in the
    creator's session storage. Active-game state stores its digest, never the
    token itself, so a database backup cannot claim a guest's solo/CPU seat.
    """
    if not isinstance(value, str):
        return None
    token = value.strip()
    if not 32 <= len(token) <= 128 or not token.isascii():
        return None
    if not all(character.isalnum() or character in "-_" for character in token):
        return None
    return token


def _guest_host_token_digest(value: object) -> str | None:
    token = _normalized_guest_host_token(value)
    return hashlib.sha256(token.encode("ascii")).hexdigest() if token else None


def _configure_zilch_host(
    game: GameDict,
    *,
    user_id: int | None,
    host_token: object,
    user_key: str,
    token_hash_key: str,
    required_code: str,
) -> None:
    """Store exactly one durable creator credential for a private seat."""
    has_user = type(user_id) is int and user_id >= 1
    token_digest = _guest_host_token_digest(host_token)
    if has_user == bool(token_digest):
        raise ValueError(required_code)
    game[user_key] = user_id if has_user else None
    game[token_hash_key] = token_digest


def validate_zilch_mode(mode: object) -> str:
    """Validate the only player counts intentionally supported by this scaffold."""
    normalized = str(mode).strip()
    if normalized not in {"1", "2"}:
        raise ValueError("zilch_invalid_player_count")
    return normalized


def validate_zilch_hvh_mode(mode: object) -> str:
    """Validate the only creation mode exposed by the playable alpha.

    The broader ``validate_zilch_mode`` remains intentionally available to
    preserve the future solo/CPU domain contract and old active snapshots.
    HTTP creation for this branch, however, is strictly two authenticated
    human participants.
    """
    normalized = validate_zilch_mode(mode)
    if normalized != "2":
        raise ValueError("zilch_multiplayer_only")
    return normalized


def zilch_play_mode_for_player_count(mode: object) -> ZilchPlayMode:
    """Map today's supported creation choices to the durable domain mode.

    CPU is deliberately not exposed by the API yet. Keeping the play mode
    separate from the expected connection count prevents a future CPU
    participant from being modelled as a fake WebSocket user.
    """
    return ZILCH_SOLO_MODE if validate_zilch_mode(mode) == "1" else ZILCH_MULTIPLAYER_MODE


def new_zilch_participant(
    participant_id: str,
    name: str,
    *,
    participant_type: ZilchParticipantType,
    connection_player_id: str | None = None,
    user_id: int | None = None,
    cpu_strategy: ZilchCpuStrategy | None = None,
) -> dict:
    """Create a game participant independently from transport identity."""
    if participant_type not in {ZILCH_HUMAN_PARTICIPANT, ZILCH_CPU_PARTICIPANT}:
        raise ValueError("zilch_invalid_participant_type")
    if participant_type == ZILCH_CPU_PARTICIPANT:
        cpu_strategy = validate_zilch_cpu_strategy(cpu_strategy)
        connection_player_id = None
        user_id = None
    elif cpu_strategy is not None:
        raise ValueError("zilch_human_cannot_have_cpu_strategy")
    return {
        "id": str(participant_id),
        "name": str(name or "Player")[:64],
        "type": participant_type,
        "connection_player_id": connection_player_id,
        "user_id": user_id,
        "cpu_strategy": cpu_strategy,
    }


def _positive_zilch_count(value: object, *, fallback: int) -> int:
    """Return a bounded participant/connection count from durable JSON."""
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = fallback
    return min(ZILCH_MAX_PLAYERS, max(1, parsed))


def zilch_expected_participant_count(game: GameDict) -> int:
    """Return the durable seat count, independently of WebSocket seats."""
    return _positive_zilch_count(game.get("_expected"), fallback=ZILCH_MAX_PLAYERS)


def zilch_expected_connection_count(game: GameDict) -> int:
    """Return how many human transport seats must connect before start.

    Pre-Part-6 snapshots did not distinguish participants from WebSocket
    players, so their old ``_expected`` value remains the safe fallback.  A
    restored CPU state with no newer marker is also recognised defensively.
    """
    expected_participants = zilch_expected_participant_count(game)
    participants = game.get("_participants")
    has_cpu = isinstance(participants, list) and any(
        isinstance(participant, dict) and participant.get("type") == ZILCH_CPU_PARTICIPANT
        for participant in participants
    )
    if game.get("_play_mode") == ZILCH_CPU_MODE or has_cpu:
        # Part 6 deliberately supports exactly one human plus one CPU.  Do
        # not trust a stale/malformed transport count here: it could make a
        # restored game wait for a nonexistent second WebSocket.
        return max(1, expected_participants - 1)
    raw = game.get("_expected_connections")
    try:
        expected_connections = int(raw)
    except (TypeError, ValueError):
        expected_connections = -1
    if 1 <= expected_connections <= expected_participants:
        return expected_connections
    return expected_participants


def _normalise_existing_participants(game: GameDict) -> list[dict]:
    """Hydrate legacy human participants while preserving durable CPU seats.

    ``_players`` is intentionally transport-only from Part 6 onward.  Older
    active Zilch states only had that collection, therefore this small bridge
    creates matching human participants exactly once during hydration.
    """
    raw_participants = game.get("_participants")
    participants: list[dict] = []
    known_ids: set[str] = set()
    if isinstance(raw_participants, list):
        for participant in raw_participants:
            if not isinstance(participant, dict):
                continue
            participant_id = str(participant.get("id") or "")
            participant_type = participant.get("type")
            if (
                not participant_id
                or participant_id in known_ids
                or participant_type not in {ZILCH_HUMAN_PARTICIPANT, ZILCH_CPU_PARTICIPANT}
            ):
                continue
            try:
                cleaned = new_zilch_participant(
                    participant_id,
                    str(participant.get("name") or "Player"),
                    participant_type=participant_type,
                    connection_player_id=(
                        str(participant.get("connection_player_id"))
                        if participant.get("connection_player_id") is not None
                        else None
                    ),
                    user_id=participant.get("user_id") if type(participant.get("user_id")) is int else None,
                    cpu_strategy=participant.get("cpu_strategy"),
                )
            except ValueError:
                if participant_type != ZILCH_CPU_PARTICIPANT:
                    continue
                # A recovered CPU with an unknown strategy must stay visible
                # as a CPU seat.  Dropping it would silently turn a damaged
                # private game into a different participant layout.  The
                # runner then marks it unavailable, while result recovery
                # rejects its payload without deleting the active state.
                cleaned = {
                    "id": participant_id,
                    "name": str(participant.get("name") or "CPU")[:64],
                    "type": ZILCH_CPU_PARTICIPANT,
                    "connection_player_id": None,
                    "user_id": None,
                    "cpu_strategy": participant.get("cpu_strategy"),
                }
            participants.append(cleaned)
            known_ids.add(participant_id)

    for player in game.get("_players", []):
        if not isinstance(player, dict):
            continue
        player_id = str(player.get("id") or "")
        if not player_id or player_id in known_ids:
            continue
        participants.append(
            new_zilch_participant(
                player_id,
                str(player.get("name") or "Player"),
                participant_type=ZILCH_HUMAN_PARTICIPANT,
                connection_player_id=player_id,
                user_id=player.get("user_id") if type(player.get("user_id")) is int else None,
            )
        )
        known_ids.add(player_id)
    game["_participants"] = participants[:ZILCH_MAX_PLAYERS]
    return game["_participants"]


def zilch_participants(game: GameDict) -> list[dict]:
    """Return canonical durable participants, hydrating pre-CPU snapshots."""
    return _normalise_existing_participants(game)


def zilch_cpu_participant(game: GameDict) -> dict | None:
    """Return the sole CPU domain seat, never a transport player."""
    for participant in zilch_participants(game):
        if participant.get("type") == ZILCH_CPU_PARTICIPANT:
            return participant
    return None


def zilch_human_join_error(game: GameDict, *, user_id: object, host_token: object = None) -> str | None:
    """Return a machine-readable reason when a human cannot take a Zilch seat.

    Common session code can use this before allocating a resume token.  It is
    deliberately a state policy rather than an HTTP-specific check, so a
    second browser can never become a hidden third participant.
    """
    play_mode = game.get("_play_mode")
    if play_mode not in {ZILCH_CPU_MODE, ZILCH_SOLO_MODE}:
        return None
    if play_mode == ZILCH_SOLO_MODE and not zilch_is_configured_solo_game(game):
        # A legacy mode-1 foundation snapshot is not silently assigned the
        # new private challenge policy. It remains loadable for diagnosis.
        return None
    expected_host = game.get(ZILCH_CPU_HOST_USER_KEY if play_mode == ZILCH_CPU_MODE else ZILCH_SOLO_HOST_USER_KEY)
    expected_token_hash = game.get(
        ZILCH_CPU_GUEST_CAPABILITY_DIGEST_KEY
        if play_mode == ZILCH_CPU_MODE
        else ZILCH_SOLO_GUEST_CAPABILITY_DIGEST_KEY
    )
    if type(expected_host) is int:
        if type(user_id) is not int or user_id != expected_host:
            return "zilch_cpu_host_required" if play_mode == ZILCH_CPU_MODE else "zilch_solo_host_required"
    elif isinstance(expected_token_hash, str) and expected_token_hash:
        candidate_hash = _guest_host_token_digest(host_token)
        if not candidate_hash or not hmac.compare_digest(candidate_hash, expected_token_hash):
            return "zilch_cpu_host_required" if play_mode == ZILCH_CPU_MODE else "zilch_solo_host_required"
    if len(game.get("_players", [])) >= zilch_expected_connection_count(game):
        return "zilch_cpu_human_seat_taken" if play_mode == ZILCH_CPU_MODE else "zilch_solo_human_seat_taken"
    return None


def configure_zilch_cpu_game(
    game: GameDict,
    *,
    cpu_strategy: object,
    host_user_id: int | None = None,
    host_token: str | None = None,
    cpu_name: str = "CPU",
) -> dict:
    """Configure a freshly created two-seat Zilch game for one human and CPU.

    Only the CPU is inserted at creation time.  The human is still joined by
    the normal authenticated WebSocket path and therefore receives the normal
    connection player and resume token.  This preserves the shared room
    fields (name, passphrase, chat and lifecycle) while making ``_players`` a
    strictly transport-bound collection.
    """
    if game.get("_started") or game.get("_finished") or game.get("_aborted"):
        raise ValueError("zilch_cpu_configuration_not_new")
    if game.get("_players") or game.get("_participants"):
        raise ValueError("zilch_cpu_configuration_not_new")
    game_id = str(game.get("_id") or "").strip()
    if not game_id:
        raise ValueError("zilch_cpu_missing_game_id")
    strategy = validate_zilch_cpu_strategy(cpu_strategy)
    _configure_zilch_host(
        game,
        user_id=host_user_id,
        host_token=host_token,
        user_key=ZILCH_CPU_HOST_USER_KEY,
        token_hash_key=ZILCH_CPU_GUEST_CAPABILITY_DIGEST_KEY,
        required_code="zilch_cpu_host_required",
    )
    cpu_id = f"cpu-{game_id}"
    cpu = new_zilch_participant(
        cpu_id,
        cpu_name,
        participant_type=ZILCH_CPU_PARTICIPANT,
        cpu_strategy=strategy,
    )
    # ``_expected`` remains the total domain seat count.  Only the new
    # connection marker changes start readiness for a CPU game.
    game["_mode"] = "2"
    game["_play_mode"] = ZILCH_CPU_MODE
    game["_expected"] = ZILCH_MAX_PLAYERS
    game["_expected_connections"] = 1
    game["_zilch_cpu_participant_id"] = cpu_id
    game["_participants"] = [cpu]
    game.setdefault("_zilch_boards", {})[cpu_id] = new_zilch_board(cpu_id)
    game.setdefault("_round_points", {})[cpu_id] = 0
    game.setdefault("_total_points", {})[cpu_id] = 0
    game.setdefault("_zilch_zilch_streaks", {})[cpu_id] = 0
    return cpu


def _utcnow() -> datetime:
    """Keep the Solo clock injectable through the module's datetime seam."""
    return datetime.now(timezone.utc)


def _parse_zilch_timestamp(value: object) -> datetime | None:
    """Parse one persisted UTC timestamp without inventing elapsed time."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        text = value[:-1] + "+00:00" if value.endswith("Z") else value
        parsed = datetime.fromisoformat(text)
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _solo_objective_state(game: GameDict):
    """Read the configured Solo objective or expose a stable rule error.

    A historical preview state with ``_play_mode == 'solo'`` but no objective
    remains a legacy placeholder.  It is deliberately not silently upgraded
    into the new Sprint challenge, because that would invent product data.
    """
    if game.get("_play_mode") != ZILCH_SOLO_MODE:
        raise ZilchRuleError("zilch_solo_mode_required")
    raw = game.get("_zilch_solo_objective")
    if not isinstance(raw, dict):
        raise ZilchRuleError("zilch_solo_objective_not_configured")
    try:
        return zilch_solo_objective_state_from_payload(raw)
    except ZilchSoloObjectiveError as exc:
        game["_zilch_solo_error"] = exc.code
        raise ZilchRuleError(exc.code) from exc


def zilch_is_configured_solo_game(game: GameDict) -> bool:
    """Return whether this is a real v1 Solo run, not an old mode-1 stub."""
    if game.get("_play_mode") != ZILCH_SOLO_MODE or not isinstance(game.get("_zilch_solo_objective"), dict):
        return False
    try:
        zilch_solo_objective_state_from_payload(game["_zilch_solo_objective"])
    except ZilchSoloObjectiveError as exc:
        game["_zilch_solo_error"] = exc.code
        return False
    return True


def _solo_metrics_from_state(state) -> dict[str, int]:
    progress = state.progress_payload()
    return {
        **progress,
        "remaining_points": max(0, progress["target_score"] - progress["total_points"]),
    }


def _store_solo_objective_state(game: GameDict, state) -> None:
    """Persist the one authoritative objective envelope plus a read model."""
    game["_zilch_solo_objective"] = state.payload()
    game["_zilch_solo_metrics"] = _solo_metrics_from_state(state)
    game["_zilch_solo_error"] = None


def configure_zilch_solo_game(
    game: GameDict,
    *,
    host_user_id: int | None = None,
    host_token: str | None = None,
) -> None:
    """Configure a new one-human Sprint without a fake opponent or start roll."""
    if game.get("_started") or game.get("_finished") or game.get("_aborted"):
        raise ValueError("zilch_solo_configuration_not_new")
    if game.get("_players") or game.get("_participants"):
        raise ValueError("zilch_solo_configuration_not_new")
    _configure_zilch_host(
        game,
        user_id=host_user_id,
        host_token=host_token,
        user_key=ZILCH_SOLO_HOST_USER_KEY,
        token_hash_key=ZILCH_SOLO_GUEST_CAPABILITY_DIGEST_KEY,
        required_code="zilch_solo_host_required",
    )
    game["_mode"] = "1"
    game["_play_mode"] = ZILCH_SOLO_MODE
    game["_expected"] = ZILCH_MIN_PLAYERS
    game["_expected_connections"] = ZILCH_MIN_PLAYERS
    game["_zilch_solo_active_since"] = None
    game["_zilch_solo_paused_at"] = None
    _store_solo_objective_state(game, new_zilch_solo_objective_state())


def zilch_solo_active_duration_seconds(game: GameDict, *, now: datetime | None = None) -> int:
    """Return elapsed active play time; paused or restart downtime is excluded."""
    state = _solo_objective_state(game)
    elapsed = state.active_duration_seconds
    anchor = _parse_zilch_timestamp(game.get("_zilch_solo_active_since"))
    if anchor is None:
        return elapsed
    current = now or _utcnow()
    return elapsed + max(0, int((current - anchor).total_seconds()))


def settle_zilch_solo_active_duration(game: GameDict, *, now: datetime | None = None) -> int:
    """Copy one elapsed active-time interval into the objective.

    The active timestamp is an interval anchor, not the beginning of the
    whole run.  Advance it after every settlement so a later roll, hold or
    bank adds only the new interval instead of charging the time since the
    start a second time.
    """
    state = _solo_objective_state(game)
    anchor = _parse_zilch_timestamp(game.get("_zilch_solo_active_since"))
    if anchor is None:
        return state.active_duration_seconds
    current = now or _utcnow()
    elapsed_seconds = max(0, int((current - anchor).total_seconds()))
    duration = state.active_duration_seconds + elapsed_seconds
    if duration > state.active_duration_seconds:
        try:
            state = record_solo_objective_active_duration(state, duration)
        except ZilchSoloObjectiveError as exc:
            raise ZilchRuleError(exc.code) from exc
        _store_solo_objective_state(game, state)
    # Do not move an anchor backwards if a system clock briefly does so.  The
    # next trustworthy event will settle the missing interval once.
    if current >= anchor:
        game["_zilch_solo_active_since"] = current.isoformat()
    return duration


def pause_zilch_solo_timer(
    game: GameDict,
    *,
    now: datetime | None = None,
    count_elapsed: bool = True,
) -> None:
    """Stop Solo time for disconnect, manual pause, or restart recovery."""
    if not zilch_is_configured_solo_game(game):
        return
    current = now or _utcnow()
    if count_elapsed:
        settle_zilch_solo_active_duration(game, now=current)
    game["_zilch_solo_active_since"] = None
    game["_zilch_solo_paused_at"] = current.isoformat()


def resume_zilch_solo_timer(game: GameDict, *, now: datetime | None = None) -> None:
    """Restart Solo time only while a valid, nonterminal run is playable."""
    if not zilch_is_configured_solo_game(game) or game.get("_finished") or game.get("_aborted"):
        return
    if _parse_zilch_timestamp(game.get("_zilch_solo_active_since")) is not None:
        return
    current = now or _utcnow()
    game["_zilch_solo_active_since"] = current.isoformat()
    game["_zilch_solo_paused_at"] = None


def repair_overcounted_zilch_solo_terminal_duration(game: GameDict) -> bool:
    """Conservatively cap the known old Solo timer overcount on recovery.

    Earlier snapshots could repeatedly add elapsed time from the same anchor.
    Such a terminal snapshot cannot produce a result because active time may
    never exceed the wall-clock duration.  This repair is deliberately
    narrow: callers invoke it only after that exact historic persistence
    error.  Capping at wall-clock duration can never improve a sprint's
    ranking and lets the already-authoritative score and board history be
    finalized normally.
    """
    if not game.get("_finished") or not zilch_is_configured_solo_game(game):
        return False
    started_at = _parse_zilch_timestamp(game.get("_started_at"))
    finished_at = _parse_zilch_timestamp(game.get("_finished_at"))
    if started_at is None or finished_at is None or finished_at < started_at:
        return False
    try:
        state = _solo_objective_state(game)
    except ZilchRuleError:
        return False
    maximum_duration = int((finished_at - started_at).total_seconds())
    if state.active_duration_seconds <= maximum_duration:
        return False
    _store_solo_objective_state(game, replace(state, active_duration_seconds=maximum_duration))
    game["_zilch_solo_active_since"] = None
    game["_zilch_solo_paused_at"] = finished_at.isoformat()
    return True


def zilch_solo_objective_projection(game: GameDict) -> dict | None:
    """Build a read-only, localizable Solo projection from server state."""
    if not zilch_is_configured_solo_game(game):
        return None
    try:
        state = _solo_objective_state(game)
    except ZilchRuleError:
        return None
    payload = state.payload()
    metrics = _solo_metrics_from_state(state)
    if game.get("_started") and not game.get("_finished"):
        metrics["active_duration_seconds"] = zilch_solo_active_duration_seconds(game)
    metrics["remaining_points"] = max(0, metrics["target_score"] - metrics["total_points"])
    definition = state.definition.payload()
    return {
        **payload,
        "name_key": definition["name_key"],
        "description_key": definition["description_key"],
        "primary_metric": definition["primary_metric"],
        "tie_break_metrics": definition["tie_break_metrics"],
        "allows_abandon": definition["allows_abandon"],
        "metrics": metrics,
    }


def _record_solo_turn_started(game: GameDict, turn: ZilchTurn) -> None:
    if not zilch_is_configured_solo_game(game):
        return
    try:
        _store_solo_objective_state(
            game,
            record_solo_objective_turn_started(_solo_objective_state(game), turn_id=turn.turn_id),
        )
    except ZilchSoloObjectiveError as exc:
        raise ZilchRuleError(exc.code) from exc


def record_zilch_solo_roll(game: GameDict, turn: ZilchTurn) -> None:
    """Observe an accepted roll after the shared fair engine produced it."""
    if not zilch_is_configured_solo_game(game):
        return
    settle_zilch_solo_active_duration(game)
    try:
        _store_solo_objective_state(
            game,
            record_solo_objective_roll(
                _solo_objective_state(game), turn_id=turn.turn_id, roll_id=turn.roll_id
            ),
        )
    except ZilchSoloObjectiveError as exc:
        raise ZilchRuleError(exc.code) from exc


def record_zilch_solo_hot_dice(game: GameDict, turn: ZilchTurn) -> None:
    """Observe a Hot-Dice event selected from the authoritative option list."""
    if not zilch_is_configured_solo_game(game):
        return
    settle_zilch_solo_active_duration(game)
    try:
        _store_solo_objective_state(
            game,
            record_solo_objective_hot_dice(
                _solo_objective_state(game), turn_id=turn.turn_id, roll_id=turn.roll_id
            ),
        )
    except ZilchSoloObjectiveError as exc:
        raise ZilchRuleError(exc.code) from exc


def _record_solo_bank(game: GameDict, turn: ZilchTurn, total: int) -> None:
    if not zilch_is_configured_solo_game(game):
        return
    settle_zilch_solo_active_duration(game)
    try:
        _store_solo_objective_state(
            game,
            record_solo_objective_bank(
                _solo_objective_state(game),
                turn_id=turn.turn_id,
                banked_points=turn.round_points,
                total_points_after=total,
            ),
        )
    except ZilchSoloObjectiveError as exc:
        raise ZilchRuleError(exc.code) from exc


def _record_solo_zilch(game: GameDict, turn: ZilchTurn, *, total: int, penalty: int) -> None:
    if not zilch_is_configured_solo_game(game):
        return
    settle_zilch_solo_active_duration(game)
    try:
        _store_solo_objective_state(
            game,
            record_solo_objective_zilch(
                _solo_objective_state(game),
                turn_id=turn.turn_id,
                total_points_after=total,
                penalty_points=penalty,
            ),
        )
    except ZilchSoloObjectiveError as exc:
        raise ZilchRuleError(exc.code) from exc


def new_zilch_game(gid: str, name: str, mode: object) -> GameDict:
    """Create an isolated Zilch state without importing ZDWA scoring concepts."""
    normalized_mode = validate_zilch_mode(mode)
    expected = int(normalized_mode)
    now = datetime.now(timezone.utc)
    game: GameDict = {
        "_id": gid,
        "_game_type": ZILCH_GAME_TYPE,
        "_name": name,
        "_mode": normalized_mode,
        "_play_mode": zilch_play_mode_for_player_count(normalized_mode),
        "_hardcore": False,
        # ``_expected`` is always the number of durable participants.  The
        # CPU mode later narrows the separate connection count to one.
        "_expected": expected,
        "_expected_connections": expected,
        "_started": False,
        "_finished": False,
        "_aborted": False,
        "_started_at": None,
        # A terminal timestamp is authoritative result data.  It is set once
        # by ``finish_zilch_game`` rather than inferred from mutable activity
        # timestamps (for example a later chat/reconnect event).
        "_finished_at": None,
        "_updated_at": now.isoformat(),
        "_players": [],
        # Domain participants are intentionally separate from connected
        # WebSocket players. Humans currently populate both collections;
        # future CPU participants will only exist here.
        "_participants": [],
        ZILCH_CPU_HOST_USER_KEY: None,
        ZILCH_CPU_GUEST_CAPABILITY_DIGEST_KEY: None,
        "_zilch_cpu_participant_id": None,
        # A true Solo run is configured explicitly by the protected create
        # endpoint. Keeping the legacy mode-1 factory state empty prevents an
        # old scaffold or malformed snapshot from receiving invented Sprint
        # progress, a host identity, or a direct-start lifecycle.
        ZILCH_SOLO_HOST_USER_KEY: None,
        ZILCH_SOLO_GUEST_CAPABILITY_DIGEST_KEY: None,
        "_zilch_solo_objective": None,
        "_zilch_solo_metrics": None,
        "_zilch_solo_active_since": None,
        "_zilch_solo_paused_at": None,
        "_zilch_solo_error": None,
        "_spectators": [],
        "_turn": None,
        "_dice": [0] * ZILCH_DICE_COUNT,
        "_holds": [False] * ZILCH_DICE_COUNT,
        "_rolls_used": 0,
        "_rolls_max": None,
        "_zilch_ruleset": ZILCH_RULESET_VERSION,
        "_zilch_turn_order": [],
        "_zilch_turn_sequence": 0,
        "_zilch_start_roll": None,
        "_zilch_final_round": None,
        "_zilch_outcome": None,
        "_zilch_result": None,
        "_zilch_cpu_error": None,
        "_zilch_zilch_streaks": {},
        "_zilch_last_event": None,
        "_target_score": ZILCH_TARGET_SCORE,
        "_round_points": {},
        "_total_points": {},
        # A board exists independently for every joined player.  Its schema
        # intentionally stays small until the house rules are confirmed.
        "_zilch_boards": {},
        "_results": None,
        "_completion_persisted": False,
        "_finalization_pending": False,
        "_passphrase": None,
        "_last_activity": now,
        "_chat_history": [],
        "_resume_required": False,
        "_manual_pause": False,
        "_manual_pause_by": None,
        "_manual_pause_by_name": None,
        "_manual_pause_at": None,
        # Common coordinator fields are retained so shared lifecycle and chat
        # code need no ZDWA-shaped special cases.
        "_superadmins": {},
        "_roll_cooldown": {},
        "_correction": {"active": False},
    }
    games[gid] = game
    save_active_game(game)
    return game


def new_zilch_board(player_id: str) -> dict:
    """Return one independent, durable board for a Zilch participant."""
    return {
        "player_id": str(player_id),
        "round_points": 0,
        "total_points": 0,
        "zilch_streak": 0,
        "rounds": [],
    }


def join_zilch_player(game: GameDict, player: dict) -> None:
    """Attach one authenticated human transport player to a Zilch seat.

    A CPU is never added here: it is a durable participant configured before
    the host opens the room.  This guard also keeps direct state callers from
    accidentally inserting a second human beside that CPU.
    """
    if not isinstance(player, dict):
        raise ValueError("zilch_invalid_human_player")
    player_id = str(player["id"])
    if not player_id:
        raise ValueError("zilch_invalid_human_player")
    # The raw guest creator token is consumed for the seat check and removed
    # before the common transport object is persisted or broadcast.
    host_token = player.pop("_zilch_host_token", None)
    if join_error := zilch_human_join_error(game, user_id=player.get("user_id"), host_token=host_token):
        raise ValueError(join_error)
    players = game.setdefault("_players", [])
    if any(str(existing.get("id") or "") == player_id for existing in players if isinstance(existing, dict)):
        raise ValueError("zilch_duplicate_human_player")
    participants = zilch_participants(game)
    if any(str(participant.get("id") or "") == player_id for participant in participants):
        raise ValueError("zilch_duplicate_participant")
    game.setdefault("_players", []).append(player)
    participant = new_zilch_participant(
        player_id,
        str(player.get("name") or "Player"),
        participant_type=ZILCH_HUMAN_PARTICIPANT,
        connection_player_id=player_id,
        user_id=player.get("user_id") if type(player.get("user_id")) is int else None,
    )
    # Put the human first in CPU reports and opening-roll presentation even
    # though the CPU's durable seat was allocated at game creation.
    if game.get("_play_mode") == ZILCH_CPU_MODE:
        participants.insert(0, participant)
    else:
        participants.append(participant)
    game["_participants"] = participants[:ZILCH_MAX_PLAYERS]
    game.setdefault("_zilch_boards", {})[player_id] = new_zilch_board(player_id)
    game.setdefault("_round_points", {})[player_id] = 0
    game.setdefault("_total_points", {})[player_id] = 0
    game.setdefault("_zilch_zilch_streaks", {})[player_id] = 0


def zilch_participant_ids(game: GameDict) -> list[str]:
    """Return the durable participant order without transport-only details."""
    participants = zilch_participants(game)
    ids = [str(participant.get("id") or "") for participant in participants]
    ids = [player_id for player_id in ids if player_id]
    if ids:
        return ids
    return [str(player.get("id") or "") for player in game.get("_players", []) if str(player.get("id") or "")]


def zilch_is_ready_to_start(game: GameDict) -> bool:
    """Check both durable seats and required human transport connections."""
    participant_ids = zilch_participant_ids(game)
    players = [player for player in game.get("_players", []) if isinstance(player, dict)]
    connection_ids = [str(player.get("id") or "") for player in players]
    expected_participants = zilch_expected_participant_count(game)
    expected_connections = zilch_expected_connection_count(game)
    return (
        len(participant_ids) == expected_participants
        and len(set(participant_ids)) == expected_participants
        and len(connection_ids) == expected_connections
        and len(set(connection_ids)) == expected_connections
        and all(connection_id in participant_ids for connection_id in connection_ids)
    )


def zilch_turn_order(game: GameDict) -> list[str]:
    """Return the durable turn order, falling back safely for old states."""
    participant_ids = zilch_participant_ids(game)
    raw_order = game.get("_zilch_turn_order")
    if isinstance(raw_order, list):
        order = [str(player_id) for player_id in raw_order if str(player_id) in participant_ids]
        if len(order) == len(participant_ids) and len(set(order)) == len(order):
            return order
    return participant_ids


def new_zilch_start_roll(player_ids: list[str]) -> dict:
    """Create the durable, visible state for participant-by-participant rolls."""
    ids = [str(player_id) for player_id in player_ids if str(player_id)]
    if not ids or len(ids) > ZILCH_MAX_PLAYERS or len(set(ids)) != len(ids):
        raise ZilchRuleError("zilch_invalid_starting_players")
    return {
        "phase": ZILCH_START_ROLL_AWAITING,
        "version": 0,
        "attempt": 1,
        "player_ids": ids,
        "pending_player_ids": ids[:],
        "rolls": {},
        "attempts": [],
        "winner_id": None,
        "tied": False,
    }


def _normalise_start_attempts(raw_attempts: object, player_ids: list[str]) -> list[dict]:
    """Keep persisted opening attempts compact, complete, and client-safe."""
    if not isinstance(raw_attempts, list):
        return []
    attempts: list[dict] = []
    for raw_attempt in raw_attempts:
        if not isinstance(raw_attempt, dict):
            continue
        raw_rolls = raw_attempt.get("rolls", raw_attempt)
        if not isinstance(raw_rolls, dict):
            continue
        rolls = {
            player_id: value
            for player_id in player_ids
            if type((value := raw_rolls.get(player_id))) is int and 1 <= value <= 6
        }
        if len(rolls) != len(player_ids):
            continue
        attempts.append({"attempt": len(attempts) + 1, "rolls": rolls})
    return attempts


def normalise_zilch_start_roll(game: GameDict) -> dict | None:
    """Hydrate new and pre-Alpha opening-roll state without losing games.

    Part 2 stored an already resolved ``winner_id`` plus raw attempt maps.  A
    restart must keep that game playable, while newly started Part 3 games use
    the participant-triggered state shape below.
    """
    player_ids = zilch_participant_ids(game)
    if not player_ids:
        return None
    raw = game.get("_zilch_start_roll")
    if not isinstance(raw, dict):
        return None
    attempts = _normalise_start_attempts(raw.get("attempts"), player_ids)
    winner_id = str(raw.get("winner_id") or "")
    if winner_id in player_ids and raw.get("phase") != ZILCH_START_ROLL_AWAITING:
        last_rolls = dict(attempts[-1]["rolls"]) if attempts else {}
        return {
            "phase": ZILCH_START_ROLL_RESOLVED,
            "version": max(0, _normalise_score(raw.get("version"))),
            "attempt": max(1, len(attempts)),
            "player_ids": player_ids,
            "pending_player_ids": [],
            "rolls": last_rolls,
            "attempts": attempts,
            "winner_id": winner_id,
            "tied": False,
        }
    if raw.get("phase") == ZILCH_START_ROLL_AWAITING:
        raw_rolls = raw.get("rolls")
        if not isinstance(raw_rolls, dict):
            raw_rolls = {}
        rolls = {
            player_id: value
            for player_id in player_ids
            if type((value := raw_rolls.get(player_id))) is int
            and 1 <= value <= 6
        }
        pending = [player_id for player_id in player_ids if player_id not in rolls]
        return {
            "phase": ZILCH_START_ROLL_AWAITING,
            "version": max(0, _normalise_score(raw.get("version"))),
            "attempt": max(1, _normalise_score(raw.get("attempt")) or len(attempts) + 1),
            "player_ids": player_ids,
            "pending_player_ids": pending,
            "rolls": rolls,
            "attempts": attempts,
            "winner_id": None,
            "tied": bool(raw.get("tied")),
        }
    return None


def current_zilch_start_roll(game: GameDict) -> dict:
    """Return the active opening procedure or a stable rule error."""
    start_roll = normalise_zilch_start_roll(game)
    if not start_roll:
        raise ZilchRuleError("zilch_start_roll_not_ready")
    game["_zilch_start_roll"] = start_roll
    return start_roll


def record_zilch_start_roll(game: GameDict, player_id: str, die_value: int) -> dict:
    """Record one server-generated opening die and resolve/tie-reroll it.

    The caller has already authenticated the player and generated the die via
    the engine RNG seam.  This state helper validates the durable procedure,
    persists every visible attempt, and only creates the first regular turn
    after an unambiguous winner exists.
    """
    ensure_zilch_engine_state(game)
    start_roll = current_zilch_start_roll(game)
    if start_roll.get("phase") != ZILCH_START_ROLL_AWAITING:
        raise ZilchRuleError("zilch_start_roll_finished")
    actor_id = str(player_id)
    if actor_id not in start_roll.get("player_ids", []):
        raise ZilchRuleError("zilch_not_participant")
    if actor_id not in start_roll.get("pending_player_ids", []):
        raise ZilchRuleError("zilch_start_roll_already_recorded")
    if type(die_value) is not int or not 1 <= die_value <= 6:
        raise ZilchRuleError("zilch_invalid_start_roll")

    rolls = dict(start_roll.get("rolls") or {})
    rolls[actor_id] = die_value
    start_roll["rolls"] = rolls
    start_roll["pending_player_ids"] = [
        candidate for candidate in start_roll.get("player_ids", []) if candidate not in rolls
    ]
    start_roll["version"] = _normalise_score(start_roll.get("version")) + 1
    start_roll["tied"] = False

    if start_roll["pending_player_ids"]:
        game["_zilch_start_roll"] = start_roll
        return {
            "type": "start_roll",
            "player_id": actor_id,
            "value": die_value,
            "attempt": start_roll["attempt"],
            "resolved": False,
        }

    player_ids = [str(candidate) for candidate in start_roll["player_ids"]]
    winner_id = resolve_zilch_start_attempt(player_ids, rolls)
    attempts = list(start_roll.get("attempts") or [])
    attempts.append({"attempt": len(attempts) + 1, "rolls": {candidate: rolls[candidate] for candidate in player_ids}})
    start_roll["attempts"] = attempts
    if winner_id is None:
        start_roll["attempt"] = len(attempts) + 1
        start_roll["pending_player_ids"] = player_ids[:]
        start_roll["rolls"] = {}
        start_roll["tied"] = True
        game["_zilch_start_roll"] = start_roll
        return {
            "type": "start_roll_tie",
            "player_id": actor_id,
            "value": die_value,
            "attempt": len(attempts),
            "resolved": False,
        }

    start_roll["phase"] = ZILCH_START_ROLL_RESOLVED
    start_roll["winner_id"] = winner_id
    start_roll["pending_player_ids"] = []
    start_roll["rolls"] = {candidate: rolls[candidate] for candidate in player_ids}
    game["_zilch_start_roll"] = start_roll
    game["_zilch_turn_order"] = [winner_id, *[candidate for candidate in player_ids if candidate != winner_id]]
    _start_turn_for(game, winner_id)
    return {
        "type": "start_roll_resolved",
        "player_id": actor_id,
        "value": die_value,
        "attempt": len(attempts),
        "winner_id": winner_id,
        "resolved": True,
    }


def _normalise_score(value: object) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _board_for(game: GameDict, player_id: str) -> dict:
    board = game.setdefault("_zilch_boards", {}).setdefault(player_id, new_zilch_board(player_id))
    if not isinstance(board, dict):
        board = new_zilch_board(player_id)
        game["_zilch_boards"][player_id] = board
    board.setdefault("player_id", player_id)
    board.setdefault("rounds", [])
    board.setdefault("round_points", 0)
    board.setdefault("total_points", 0)
    board.setdefault("zilch_streak", 0)
    return board


def _round_number_for(game: GameDict, turn_id: int) -> int:
    count = max(1, len(zilch_participant_ids(game)))
    return max(1, ((int(turn_id) - 1) // count) + 1)


def sync_zilch_turn(game: GameDict, turn: ZilchTurn) -> None:
    """Project a pure engine turn into the durable live-game dictionary."""
    player_id = turn.player_id
    game["_turn"] = turn.payload()
    game["_dice"] = list(turn.dice)
    game["_holds"] = [index in set(turn.held_indices) for index in range(ZILCH_DICE_COUNT)]
    game["_rolls_used"] = turn.rolls_used
    game["_rolls_max"] = None
    game.setdefault("_round_points", {})[player_id] = turn.round_points
    board = _board_for(game, player_id)
    board["round_points"] = turn.round_points


def current_zilch_turn(game: GameDict) -> ZilchTurn:
    """Read the current turn through the backwards-compatible engine parser."""
    raw_turn = game.get("_turn")
    if not isinstance(raw_turn, dict):
        raise ZilchRuleError("zilch_turn_not_ready")
    return zilch_turn_from_state(raw_turn, game.get("_dice") or [0] * ZILCH_DICE_COUNT, game.get("_holds"))


def ensure_zilch_engine_state(game: GameDict) -> None:
    """Hydrate old foundation snapshots with harmless engine defaults.

    Active Zilch preview games already persisted before the rules engine
    existed.  They retain their players and boards; only missing turn metadata
    receives the new defaults.
    """
    # Hydrate the durable participant layer before deriving turn order or
    # boards.  Old human-vs-human JSON has only ``_players``; new CPU JSON
    # keeps the CPU exclusively in ``_participants``.
    player_ids = zilch_participant_ids(game)
    expected_participants = zilch_expected_participant_count(game)
    game["_expected"] = expected_participants
    expected_connections = zilch_expected_connection_count(game)
    game.setdefault("_expected_connections", expected_connections)
    # A malformed persisted connection marker must never make a CPU wait for
    # a fake socket.  Replace it with the documented compatible fallback.
    if game.get("_play_mode") == ZILCH_CPU_MODE:
        game["_expected_connections"] = expected_connections
    elif not isinstance(game.get("_expected_connections"), int) or not (
        1 <= int(game["_expected_connections"]) <= expected_participants
    ):
        game["_expected_connections"] = expected_connections
    game.setdefault("_zilch_ruleset", ZILCH_RULESET_VERSION)
    raw_turn_order = game.get("_zilch_turn_order")
    if not isinstance(raw_turn_order, list) or set(map(str, raw_turn_order)) != set(player_ids) or len(raw_turn_order) != len(player_ids):
        game["_zilch_turn_order"] = player_ids[:]
    game.setdefault("_zilch_turn_sequence", 0)
    existing_start_roll = normalise_zilch_start_roll(game)
    if existing_start_roll:
        game["_zilch_start_roll"] = existing_start_roll
    else:
        game.setdefault("_zilch_start_roll", None)
    game.setdefault("_zilch_final_round", None)
    game.setdefault("_zilch_outcome", None)
    game.setdefault("_zilch_last_event", None)
    game.setdefault("_zilch_cpu_error", None)
    game.setdefault("_zilch_solo_host_user_id", None)
    game.setdefault("_zilch_solo_objective", None)
    game.setdefault("_zilch_solo_metrics", None)
    game.setdefault("_zilch_solo_active_since", None)
    game.setdefault("_zilch_solo_paused_at", None)
    game.setdefault("_zilch_solo_error", None)
    # A configured Solo snapshot must validate as the exact known objective.
    # Do not repair or create one while loading an older one-player scaffold:
    # it has no authoritative Objective ID/version to preserve.
    if game.get("_play_mode") == ZILCH_SOLO_MODE and isinstance(game.get("_zilch_solo_objective"), dict):
        try:
            _store_solo_objective_state(game, _solo_objective_state(game))
        except ZilchRuleError:
            # Retain the original JSON and a machine-readable reason so an
            # active damaged private run is not silently transformed or lost.
            pass
    for key in ("_round_points", "_total_points", "_zilch_zilch_streaks", "_zilch_boards"):
        if not isinstance(game.get(key), dict):
            game[key] = {}
    for player_id in player_ids:
        board = _board_for(game, player_id)
        total = _normalise_score(game["_total_points"].get(player_id, board.get("total_points")))
        round_points = _normalise_score(game["_round_points"].get(player_id, board.get("round_points")))
        streak = _normalise_score(game["_zilch_zilch_streaks"].get(player_id, board.get("zilch_streak")))
        game["_total_points"][player_id] = total
        game["_round_points"][player_id] = round_points
        game["_zilch_zilch_streaks"][player_id] = streak
        board["total_points"] = total
        board["round_points"] = round_points
        board["zilch_streak"] = streak
    if not isinstance(game.get("_dice"), list) or len(game["_dice"]) != ZILCH_DICE_COUNT:
        game["_dice"] = [0] * ZILCH_DICE_COUNT
    if not isinstance(game.get("_holds"), list) or len(game["_holds"]) != ZILCH_DICE_COUNT:
        game["_holds"] = [False] * ZILCH_DICE_COUNT
    raw_turn = game.get("_turn")
    if isinstance(raw_turn, dict) and player_ids:
        try:
            turn = current_zilch_turn(game)
        except ZilchRuleError:
            player_id = str(raw_turn.get("player_id") or player_ids[0])
            if player_id not in player_ids:
                player_id = player_ids[0]
            turn_id = max(1, _normalise_score(raw_turn.get("turn_id", raw_turn.get("round", 1))))
            turn = new_zilch_turn(player_id, turn_id=turn_id, round_number=_round_number_for(game, turn_id))
        game["_zilch_turn_sequence"] = max(_normalise_score(game.get("_zilch_turn_sequence")), turn.turn_id)
        sync_zilch_turn(game, turn)


def _start_turn_for(game: GameDict, player_id: str) -> ZilchTurn:
    sequence = _normalise_score(game.get("_zilch_turn_sequence")) + 1
    turn = new_zilch_turn(
        player_id,
        turn_id=sequence,
        round_number=_round_number_for(game, sequence),
    )
    game["_zilch_turn_sequence"] = sequence
    sync_zilch_turn(game, turn)
    _record_solo_turn_started(game, turn)
    return turn


def begin_next_zilch_turn(game: GameDict, current_player_id: str) -> ZilchTurn:
    """Advance in the fixed opening-roll order without importing ZDWA turns."""
    ensure_zilch_engine_state(game)
    order = zilch_turn_order(game)
    if not order:
        raise ZilchRuleError("zilch_missing_participants")
    player_id = str(current_player_id)
    if player_id in order:
        next_player = order[(order.index(player_id) + 1) % len(order)]
    else:
        next_player = order[0]
    return _start_turn_for(game, next_player)


def _append_round(board: dict, entry: dict) -> None:
    rounds = board.setdefault("rounds", [])
    if not isinstance(rounds, list):
        rounds = []
        board["rounds"] = rounds
    rounds.append(entry)


def record_zilch_bank(game: GameDict, turn: ZilchTurn) -> int:
    """Bank current points, reset only this player's Zilch streak, and log it."""
    ensure_zilch_engine_state(game)
    player_id = turn.player_id
    board = _board_for(game, player_id)
    previous_total = _normalise_score(game["_total_points"].get(player_id))
    total = previous_total + turn.round_points
    game["_total_points"][player_id] = total
    game["_round_points"][player_id] = 0
    game["_zilch_zilch_streaks"][player_id] = 0
    board["total_points"] = total
    board["round_points"] = 0
    board["zilch_streak"] = 0
    _append_round(
        board,
        {
            "turn_id": turn.turn_id,
            "round": turn.round_number,
            "event": "bank",
            "points": turn.round_points,
            "total_after": total,
            "rolls_used": turn.rolls_used,
            "committed_holds": [dict(entry) for entry in turn.committed_holds],
        },
    )
    # Keep the durable current-turn projection in sync until the coordinator
    # advances it.  Otherwise the compatibility hydrator could restore the
    # just-banked round points from the previous turn payload.
    sync_zilch_turn(
        game,
        replace(
            turn,
            dice=(0,) * ZILCH_DICE_COUNT,
            held_indices=(),
            round_points=0,
            phase="ready_to_roll",
            version=turn.version + 1,
            confirmation_reasons=(),
            last_event="bank",
        ),
    )
    game["_zilch_last_event"] = {"event": "bank", "player_id": player_id, "points": turn.round_points}
    _record_solo_bank(game, turn, total)
    return total


def record_zilch_loss(game: GameDict, turn: ZilchTurn, *, reason: str) -> dict:
    """Discard unbanked points, apply a possible every-third-Zilch penalty, and log it."""
    ensure_zilch_engine_state(game)
    player_id = turn.player_id
    board = _board_for(game, player_id)
    previous_total = _normalise_score(game["_total_points"].get(player_id))
    prior_streak = _normalise_score(game["_zilch_zilch_streaks"].get(player_id))
    total, streak, penalty = apply_zilch_streak(previous_total, prior_streak)
    game["_total_points"][player_id] = total
    game["_round_points"][player_id] = 0
    game["_zilch_zilch_streaks"][player_id] = streak
    board["total_points"] = total
    board["round_points"] = 0
    board["zilch_streak"] = streak
    _append_round(
        board,
        {
            "turn_id": turn.turn_id,
            "round": turn.round_number,
            "event": "zilch",
            "reason": str(reason),
            "discarded_points": turn.round_points,
            "penalty": penalty,
            "total_after": total,
            "zilch_streak": streak,
            "rolls_used": turn.rolls_used,
            # From typed results onward, retain the already authoritative
            # holds even for a lost turn.  This makes Hot-Dice metrics
            # auditable without inventing an event after the fact.
            "committed_holds": [dict(entry) for entry in turn.committed_holds],
        },
    )
    sync_zilch_turn(
        game,
        replace(
            turn,
            dice=(0,) * ZILCH_DICE_COUNT,
            held_indices=(),
            round_points=0,
            phase="ready_to_roll",
            version=turn.version + 1,
            confirmation_reasons=(),
            last_event="zilch",
        ),
    )
    game["_zilch_last_event"] = {
        "event": "zilch",
        "player_id": player_id,
        "reason": str(reason),
        "penalty": penalty,
    }
    _record_solo_zilch(game, turn, total=total, penalty=penalty)
    return {"total": total, "streak": streak, "penalty": penalty}


def advance_after_zilch_turn(game: GameDict, current_player_id: str) -> bool:
    """Apply the at-least-10,000 final-reply contract after a complete turn.

    Returns ``True`` when every required final reply has been consumed and the
    caller must mark the game terminal.  This is domain state only; it never
    calls the ZDWA completed-game pipeline.
    """
    ensure_zilch_engine_state(game)
    order = zilch_turn_order(game)
    if not order:
        return True
    player_id = str(current_player_id)
    if zilch_is_configured_solo_game(game):
        state = _solo_objective_state(game)
        # Sprint completion is the only solo terminal criterion. There is no
        # synthetic opponent, final reply, winner, or tie.
        if state.is_terminal:
            return True
        begin_next_zilch_turn(game, player_id)
        return False
    final_round = game.get("_zilch_final_round")
    if isinstance(final_round, dict):
        pending = [str(candidate) for candidate in final_round.get("pending_player_ids", []) if str(candidate) in order]
        if player_id in pending:
            pending.remove(player_id)
        final_round["pending_player_ids"] = pending
        if not pending:
            return True
        _start_turn_for(game, pending[0])
        return False

    target = _normalise_score(game.get("_target_score", ZILCH_TARGET_SCORE)) or ZILCH_TARGET_SCORE
    if _normalise_score(game.get("_total_points", {}).get(player_id)) >= target:
        if player_id in order:
            index = order.index(player_id)
            pending = [*order[index + 1 :], *order[:index]]
        else:
            pending = order[:]
        game["_zilch_final_round"] = {
            "triggered_by": player_id,
            "target_score": target,
            "pending_player_ids": pending,
        }
        if not pending:
            return True
        _start_turn_for(game, pending[0])
        return False

    begin_next_zilch_turn(game, player_id)
    return False


def finish_zilch_solo_game(game: GameDict, *, status: str) -> dict:
    """Close a configured Solo run without competitive outcome fields."""
    if status not in {"completed", "abandoned"}:
        raise ZilchRuleError("zilch_solo_invalid_outcome")
    ensure_zilch_engine_state(game)
    state = _solo_objective_state(game)
    settle_zilch_solo_active_duration(game)
    state = _solo_objective_state(game)
    try:
        if status == "completed":
            if state.outcome != "completed":
                raise ZilchSoloObjectiveError("zilch_solo_objective_not_completed")
        elif state.outcome is None:
            state = abandon_solo_objective(state)
        elif state.outcome != "abandoned":
            raise ZilchSoloObjectiveError("zilch_solo_objective_finished")
    except ZilchSoloObjectiveError as exc:
        raise ZilchRuleError(exc.code) from exc
    _store_solo_objective_state(game, state)
    pause_zilch_solo_timer(game, count_elapsed=False)
    participant_ids = zilch_participant_ids(game)
    player_id = participant_ids[0] if participant_ids else None
    total = _normalise_score(game.get("_total_points", {}).get(player_id)) if player_id else 0
    outcome = {
        "status": status,
        "objective_id": state.objective_id,
        "objective_version": state.objective_version,
        "target_score": state.definition.target_score,
        "total_points": total,
        "totals": {player_id: total} if player_id else {},
    }
    game["_zilch_outcome"] = outcome
    game["_started"] = False
    game["_finished"] = True
    # A manual/reconnect pause cannot obscure a terminal abandoned outcome.
    game["_manual_pause"] = False
    game["_manual_pause_by"] = None
    game["_manual_pause_by_name"] = None
    game["_manual_pause_at"] = None
    game["_resume_required"] = False
    if not isinstance(game.get("_finished_at"), str) or not str(game.get("_finished_at") or "").strip():
        game["_finished_at"] = _utcnow().isoformat()
    game["_results"] = None
    game["_turn"] = None
    game["_dice"] = [0] * ZILCH_DICE_COUNT
    game["_holds"] = [False] * ZILCH_DICE_COUNT
    game["_rolls_used"] = 0
    return outcome


def finish_zilch_game(game: GameDict) -> dict:
    """Close a Zilch state without invoking ZDWA results, stats, or awards."""
    ensure_zilch_engine_state(game)
    if zilch_is_configured_solo_game(game):
        return finish_zilch_solo_game(game, status="completed")
    totals = {player_id: _normalise_score(value) for player_id, value in game.get("_total_points", {}).items()}
    highest = max(totals.values(), default=0)
    winner_ids = [player_id for player_id in zilch_participant_ids(game) if totals.get(player_id, 0) == highest]
    outcome = {
        "status": "completed",
        "target_score": _normalise_score(game.get("_target_score", ZILCH_TARGET_SCORE)) or ZILCH_TARGET_SCORE,
        "totals": totals,
        "winner_ids": winner_ids,
        "winner_id": winner_ids[0] if len(winner_ids) == 1 else None,
        "tied": len(winner_ids) > 1,
        "final_round": dict(game.get("_zilch_final_round") or {}),
    }
    game["_zilch_outcome"] = outcome
    game["_started"] = False
    game["_finished"] = True
    if not isinstance(game.get("_finished_at"), str) or not str(game.get("_finished_at") or "").strip():
        game["_finished_at"] = datetime.now(timezone.utc).isoformat()
    game["_results"] = None
    game["_turn"] = None
    game["_dice"] = [0] * ZILCH_DICE_COUNT
    game["_holds"] = [False] * ZILCH_DICE_COUNT
    game["_rolls_used"] = 0
    return outcome


def start_zilch_game(game: GameDict, *, randint_fn=None) -> None:
    """Enter the persisted opening-roll phase once all participants joined.

    ``randint_fn`` remains a harmless compatibility parameter for callers from
    the Part-2 test seam.  Randomness is deliberately consumed only when each
    human presses the explicit Zilch start-roll action.
    """
    if game.get("_started"):
        return
    ensure_zilch_engine_state(game)
    if not zilch_is_ready_to_start(game):
        return
    game["_started"] = True
    game["_started_at"] = _utcnow().isoformat()
    game["_finished_at"] = None
    player_ids = zilch_participant_ids(game)
    game["_zilch_turn_order"] = player_ids[:]
    game["_zilch_start_roll"] = new_zilch_start_roll(player_ids)
    game["_zilch_turn_sequence"] = 0
    game["_zilch_final_round"] = None
    game["_zilch_outcome"] = None
    game["_zilch_result"] = None
    game["_completion_persisted"] = False
    game["_finalization_pending"] = False
    if zilch_is_configured_solo_game(game):
        # The confirmed Sprint begins with a meaningful regular turn. A
        # one-player start roll would decide nothing and is deliberately not
        # serialized in this lifecycle.
        game["_zilch_start_roll"] = None
        game["_zilch_last_event"] = {"type": "solo_started", "player_id": player_ids[0]}
        game["_turn"] = None
        game["_dice"] = [0] * ZILCH_DICE_COUNT
        game["_holds"] = [False] * ZILCH_DICE_COUNT
        game["_rolls_used"] = 0
        resume_zilch_solo_timer(game)
        _start_turn_for(game, player_ids[0])
        return
    game["_zilch_last_event"] = {"type": "start_roll_waiting", "player_ids": player_ids}
    game["_turn"] = None
    game["_dice"] = [0] * ZILCH_DICE_COUNT
    game["_holds"] = [False] * ZILCH_DICE_COUNT
    game["_rolls_used"] = 0
