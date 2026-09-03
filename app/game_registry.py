"""Small composition registry separating shared coordination from game rules."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from .game_state import GameDict
from .game_types import DEFAULT_GAME_TYPE, ZILCH_GAME_TYPE, GameType, game_type_from_state, normalize_game_type

CreateState = Callable[[str, str, object], GameDict]
JoinPlayer = Callable[[GameDict, dict], None]
StartGame = Callable[[GameDict], None]
ProjectSnapshot = Callable[[GameDict], dict]
ProjectProgress = Callable[[GameDict], list[dict]]
HandleGameplay = Callable[..., Awaitable[None]]
FinalizeCompletedGame = Callable[[GameDict, Any], dict]


@dataclass(frozen=True)
class GameAdapter:
    """The deliberately small surface that varies by game type."""

    game_type: GameType
    create_state: CreateState
    join_player: JoinPlayer
    start_game: StartGame
    project_snapshot: ProjectSnapshot
    project_progress: ProjectProgress
    gameplay_actions: frozenset[str]
    handle_gameplay: HandleGameplay
    finalize_completed_game: FinalizeCompletedGame
    superadmin_actions: frozenset[str] = frozenset()


def _join_zdwa_player(game: GameDict, player: dict) -> None:
    from .game_state import assign_team_for_join, is_team_mode

    player_id = str(player["id"])
    game.setdefault("_players", []).append(player)
    game.setdefault("_scoreboards", {})[player_id] = {}
    if is_team_mode(game):
        assign_team_for_join(game, player_id)


def _start_zdwa_game(game: GameDict) -> None:
    from .game_engine import _set_roll_cap_for_current_turn

    if game.get("_started") or len(game.get("_players", [])) != int(game.get("_expected", 0)):
        return
    game["_started"] = True
    game["_started_at"] = datetime.now(timezone.utc).isoformat()
    game["_turn"] = {
        "player_id": game["_players"][0]["id"],
        "roll_index": 0,
        "first4oak_roll": None,
    }
    _set_roll_cap_for_current_turn(game)


def _zilch_progress(game: GameDict) -> list[dict]:
    # Zilch participants are durable domain seats.  A CPU deliberately has no
    # entry in `_players`, which remains shared WebSocket transport state.
    from .zilch_state import zilch_participants

    boards = game.get("_zilch_boards", {}) or {}
    connections = {
        str(player.get("id") or ""): player
        for player in game.get("_players", [])
        if isinstance(player, dict) and str(player.get("id") or "")
    }
    result = []
    for participant in zilch_participants(game):
        player_id = str(participant.get("id") or "")
        if not player_id:
            continue
        board = boards.get(player_id, {}) if isinstance(boards, dict) else {}
        is_cpu = participant.get("type") == "cpu"
        connection_id = str(participant.get("connection_player_id") or player_id)
        connection = connections.get(connection_id)
        result.append(
            {
                "id": player_id,
                "name": participant.get("name", "Player"),
                "user_id": participant.get("user_id"),
                "participant_type": participant.get("type"),
                "cpu_strategy": participant.get("cpu_strategy"),
                "is_cpu": is_cpu,
                "connected": None if is_cpu else bool(connection and connection.get("ws") is not None),
                "members": [],
                "filled": len(board.get("rounds", [])) if isinstance(board.get("rounds", []), list) else 0,
                "of": None,
                "points": int(board.get("total_points", 0) or 0),
            }
        )
    return result


def _zdwa_adapter() -> GameAdapter:
    # Local imports keep existing ZDWA modules independent of this registry and
    # avoid a broad import-order refactor.
    from .game_engine import _progress_for_game
    from .game_snapshot import snapshot_zdwa
    from .game_state import new_game
    from .game_ws_admin import SUPERADMIN_ACTIONS
    from .game_ws_gameplay import GAMEPLAY_ACTIONS, handle_gameplay_action

    def finalize_completed_game(game: GameDict, files: Any) -> dict:
        # Preserve the established ZDWA result, aggregate and achievement
        # implementation behind a thin typed adapter.
        from .game_results import finalize_and_log_results

        return finalize_and_log_results(files, game)

    return GameAdapter(
        game_type=DEFAULT_GAME_TYPE,
        create_state=new_game,
        join_player=_join_zdwa_player,
        start_game=_start_zdwa_game,
        project_snapshot=snapshot_zdwa,
        project_progress=_progress_for_game,
        gameplay_actions=GAMEPLAY_ACTIONS,
        handle_gameplay=handle_gameplay_action,
        finalize_completed_game=finalize_completed_game,
        superadmin_actions=SUPERADMIN_ACTIONS,
    )


def _zilch_adapter() -> GameAdapter:
    from .zilch_gameplay import ZILCH_GAMEPLAY_ACTIONS, handle_zilch_gameplay_action
    from .zilch_snapshot import snapshot_zilch
    from .zilch_state import join_zilch_player, new_zilch_game, start_zilch_game

    def finalize_completed_game(game: GameDict, _files: Any) -> dict:
        # Zilch owns its versioned payload and never enters the ZDWA
        # scorecard/leaderboard/achievement module.
        from .zilch_results import finalize_zilch_result

        return finalize_zilch_result(game)

    return GameAdapter(
        game_type=ZILCH_GAME_TYPE,
        create_state=new_zilch_game,
        join_player=join_zilch_player,
        start_game=start_zilch_game,
        project_snapshot=snapshot_zilch,
        project_progress=_zilch_progress,
        gameplay_actions=ZILCH_GAMEPLAY_ACTIONS,
        handle_gameplay=handle_zilch_gameplay_action,
        finalize_completed_game=finalize_completed_game,
    )


def adapter_for_game_type(value: object | None) -> GameAdapter:
    game_type = normalize_game_type(value)
    if game_type == ZILCH_GAME_TYPE:
        return _zilch_adapter()
    return _zdwa_adapter()


def adapter_for_game(game: GameDict) -> GameAdapter:
    return adapter_for_game_type(game_type_from_state(game))


def create_game_state(game_id: str, name: str, mode: object, game_type: object | None = None) -> GameDict:
    """Create state through the single, validated game-type factory."""
    return adapter_for_game_type(game_type).create_state(game_id, name, mode)


def join_player_to_game(game: GameDict, player: dict) -> None:
    adapter_for_game(game).join_player(game, player)


def start_game_if_ready(game: GameDict) -> None:
    adapter_for_game(game).start_game(game)


def gameplay_actions_for_game(game: GameDict) -> frozenset[str]:
    return adapter_for_game(game).gameplay_actions


def superadmin_actions_for_game(game: GameDict) -> frozenset[str]:
    return adapter_for_game(game).superadmin_actions


async def dispatch_gameplay_action(
    session: Any,
    action: str,
    data: dict[str, Any],
    **kwargs: Any,
) -> None:
    """Delegate gameplay only after common WebSocket checks have completed."""
    await adapter_for_game(session.game).handle_gameplay(session, action, data, **kwargs)


def project_game_snapshot(game: GameDict) -> dict:
    return adapter_for_game(game).project_snapshot(game)


def project_game_progress(game: GameDict) -> list[dict]:
    return adapter_for_game(game).project_progress(game)


def finalize_completed_game(game: GameDict, *, files: Any) -> dict:
    """Finalize through the game-specific adapter selected by durable type."""
    return adapter_for_game(game).finalize_completed_game(game, files)
