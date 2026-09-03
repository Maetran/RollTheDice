"""Minimal, deliberately rule-neutral live state for the internal Zilch preview."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Final, Literal

from .active_games import save_active_game
from .game_state import GameDict, games
from .game_types import ZILCH_GAME_TYPE

ZILCH_DICE_COUNT = 6
ZILCH_TARGET_SCORE = 10_000
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
    """Return a separate score board shell for one Zilch player."""
    return {
        "player_id": str(player_id),
        "round_points": 0,
        "total_points": 0,
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


def start_zilch_game(game: GameDict) -> None:
    """Start a complete 1- or 2-player lobby without deciding any scoring rule."""
    if game.get("_started") or len(game.get("_players", [])) != int(game.get("_expected", 0)):
        return
    game["_started"] = True
    game["_started_at"] = datetime.now(timezone.utc).isoformat()
    first_player = game["_players"][0]["id"]
    game["_turn"] = {"player_id": first_player, "round": 1}
