"""Live-state integration for the isolated, server-authoritative Zilch rules."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from typing import Final, Literal

from .active_games import save_active_game
from .game_state import GameDict, games
from .game_types import ZILCH_GAME_TYPE
from .zilch_engine import (
    ZILCH_DICE_COUNT,
    ZILCH_RULESET_VERSION,
    ZILCH_TARGET_SCORE,
    ZilchRuleError,
    ZilchTurn,
    apply_zilch_streak,
    new_zilch_turn,
    roll_starting_player,
    zilch_turn_from_state,
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
ZILCH_CPU_STRATEGIES: Final[frozenset[str]] = frozenset(
    {"conservative", "normal", "aggressive"}
)


def validate_zilch_mode(mode: object) -> str:
    """Validate the only player counts intentionally supported by this scaffold."""
    normalized = str(mode).strip()
    if normalized not in {"1", "2"}:
        raise ValueError("zilch_invalid_player_count")
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
        if cpu_strategy not in ZILCH_CPU_STRATEGIES:
            raise ValueError("zilch_invalid_cpu_strategy")
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
        "_expected": expected,
        "_started": False,
        "_finished": False,
        "_aborted": False,
        "_started_at": None,
        "_updated_at": now.isoformat(),
        "_players": [],
        # Domain participants are intentionally separate from connected
        # WebSocket players. Humans currently populate both collections;
        # future CPU participants will only exist here.
        "_participants": [],
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
        "_zilch_zilch_streaks": {},
        "_zilch_last_event": None,
        "_target_score": ZILCH_TARGET_SCORE,
        "_round_points": {},
        "_total_points": {},
        # A board exists independently for every joined player.  Its schema
        # intentionally stays small until the house rules are confirmed.
        "_zilch_boards": {},
        "_results": None,
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
    """Attach a player and create only that player's independent board."""
    player_id = str(player["id"])
    game.setdefault("_players", []).append(player)
    game.setdefault("_participants", []).append(
        new_zilch_participant(
            player_id,
            str(player.get("name") or "Player"),
            participant_type=ZILCH_HUMAN_PARTICIPANT,
            connection_player_id=player_id,
            user_id=player.get("user_id"),
        )
    )
    game.setdefault("_zilch_boards", {})[player_id] = new_zilch_board(player_id)
    game.setdefault("_round_points", {})[player_id] = 0
    game.setdefault("_total_points", {})[player_id] = 0
    game.setdefault("_zilch_zilch_streaks", {})[player_id] = 0


def zilch_participant_ids(game: GameDict) -> list[str]:
    """Return the durable participant order without transport-only details."""
    participants = game.get("_participants", [])
    if isinstance(participants, list):
        ids = [str(participant.get("id") or "") for participant in participants if isinstance(participant, dict)]
        ids = [player_id for player_id in ids if player_id]
        if ids:
            return ids
    return [str(player.get("id") or "") for player in game.get("_players", []) if str(player.get("id") or "")]


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
    player_ids = zilch_participant_ids(game)
    game.setdefault("_zilch_ruleset", ZILCH_RULESET_VERSION)
    game.setdefault("_zilch_turn_order", player_ids[:])
    if list(game.get("_zilch_turn_order") or []) != player_ids:
        game["_zilch_turn_order"] = player_ids[:]
    game.setdefault("_zilch_turn_sequence", 0)
    game.setdefault("_zilch_start_roll", None)
    game.setdefault("_zilch_final_round", None)
    game.setdefault("_zilch_outcome", None)
    game.setdefault("_zilch_last_event", None)
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
    return turn


def begin_next_zilch_turn(game: GameDict, current_player_id: str) -> ZilchTurn:
    """Advance in the fixed opening-roll order without importing ZDWA turns."""
    ensure_zilch_engine_state(game)
    order = zilch_participant_ids(game)
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
    return total


def record_zilch_loss(game: GameDict, turn: ZilchTurn, *, reason: str) -> dict:
    """Discard unbanked points, apply a possible third-Zilch penalty, and log it."""
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
    return {"total": total, "streak": streak, "penalty": penalty}


def advance_after_zilch_turn(game: GameDict, current_player_id: str) -> bool:
    """Apply the at-least-10,000 final-reply contract after a complete turn.

    Returns ``True`` when every required final reply has been consumed and the
    caller must mark the game terminal.  This is domain state only; it never
    calls the ZDWA completed-game pipeline.
    """
    ensure_zilch_engine_state(game)
    order = zilch_participant_ids(game)
    if not order:
        return True
    player_id = str(current_player_id)
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


def finish_zilch_game(game: GameDict) -> dict:
    """Close a Zilch state without invoking ZDWA results, stats, or awards."""
    ensure_zilch_engine_state(game)
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
    game["_results"] = None
    return outcome


def start_zilch_game(game: GameDict, *, randint_fn=None) -> None:
    """Start a 1/2-player game through the shared fair RNG contract."""
    if game.get("_started") or len(game.get("_players", [])) != int(game.get("_expected", 0)):
        return
    game["_started"] = True
    game["_started_at"] = datetime.now(timezone.utc).isoformat()
    ensure_zilch_engine_state(game)
    player_ids = zilch_participant_ids(game)
    opening_roll = roll_starting_player(player_ids, randint_fn=randint_fn)
    game["_zilch_turn_order"] = player_ids[:]
    game["_zilch_start_roll"] = opening_roll.payload()
    game["_zilch_turn_sequence"] = 0
    game["_zilch_final_round"] = None
    game["_zilch_outcome"] = None
    _start_turn_for(game, opening_roll.player_id)
