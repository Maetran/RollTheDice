"""Client projection for the isolated Zilch preview state."""

from __future__ import annotations

from .game_snapshot import public_player_payload
from .game_state import (
    CHAT_HISTORY_LIMIT,
    GameDict,
    _format_duration_hm,
    _offline_players,
    _player_connected,
    check_timeout_and_abort,
    multiplayer_pause_reason,
    pause_remaining_seconds,
    timeout_seconds,
)
from .game_types import ZILCH_GAME_TYPE
from .zilch_state import ZILCH_DICE_COUNT, ZILCH_TARGET_SCORE


def _six_dice(game: GameDict) -> list[int]:
    """Normalize persisted preview dice without accepting malformed state."""
    values = list(game.get("_dice") or [])[:ZILCH_DICE_COUNT]
    values.extend([0] * (ZILCH_DICE_COUNT - len(values)))
    return [value if isinstance(value, int) and 0 <= value <= 6 else 0 for value in values]


def _boards(game: GameDict) -> dict[str, dict]:
    """Project exactly the per-player fields needed by the preview client."""
    result: dict[str, dict] = {}
    raw_boards = game.get("_zilch_boards", {}) or {}
    for player in game.get("_players", [])[:2]:
        player_id = str(player.get("id") or "")
        raw_board = raw_boards.get(player_id, {}) if isinstance(raw_boards, dict) else {}
        result[player_id] = {
            "player_id": player_id,
            "round_points": int(raw_board.get("round_points", game.get("_round_points", {}).get(player_id, 0)) or 0),
            "total_points": int(raw_board.get("total_points", game.get("_total_points", {}).get(player_id, 0)) or 0),
            "rounds": list(raw_board.get("rounds", [])) if isinstance(raw_board.get("rounds", []), list) else [],
        }
    return result


def snapshot_zilch(game: GameDict) -> dict:
    """Return a rule-neutral Zilch snapshot; never invoke ZDWA scoring helpers."""
    check_timeout_and_abort(game)
    pause_reason = multiplayer_pause_reason(game)
    pause_left = pause_remaining_seconds(game)
    boards = _boards(game)
    return {
        "_game_type": ZILCH_GAME_TYPE,
        "_name": game.get("_name", "Zilch"),
        "_players": [
            public_player_payload(player, connected=_player_connected(player))
            for player in game.get("_players", [])
        ],
        "_participants": [
            {
                "id": str(participant.get("id") or ""),
                "name": str(participant.get("name") or "Player"),
                "type": participant.get("type"),
                "connection_player_id": participant.get("connection_player_id"),
                "user_id": participant.get("user_id"),
                "cpu_strategy": participant.get("cpu_strategy"),
            }
            for participant in game.get("_participants", [])[:2]
        ],
        "_play_mode": game.get(
            "_play_mode",
            "solo" if int(game.get("_expected", 0) or 0) == 1 else "multiplayer",
        ),
        "_players_joined": len(game.get("_players", [])),
        "_expected": int(game.get("_expected", 0) or 0),
        "_started": bool(game.get("_started")),
        "_finished": bool(game.get("_finished")),
        "_aborted": bool(game.get("_aborted")),
        "_started_at": game.get("_started_at"),
        "_updated_at": game.get("_updated_at"),
        "_paused": bool(pause_reason),
        "_pause_reason": pause_reason,
        "_manual_pause": bool(game.get("_manual_pause")),
        "_pause_remaining_seconds": pause_left,
        "_pause_remaining_label": _format_duration_hm(pause_left),
        "_timeout_seconds": timeout_seconds(),
        "_timeout_label": _format_duration_hm(timeout_seconds()),
        "_offline_players": _offline_players(game),
        "_connected": {str(player.get("id")): _player_connected(player) for player in game.get("_players", [])},
        "locked": bool(game.get("_passphrase")),
        "_turn": game.get("_turn"),
        "_dice": _six_dice(game),
        "_target_score": int(game.get("_target_score", ZILCH_TARGET_SCORE) or ZILCH_TARGET_SCORE),
        "_round_points": {
            player_id: board["round_points"] for player_id, board in boards.items()
        },
        "_total_points": {
            player_id: board["total_points"] for player_id, board in boards.items()
        },
        "_zilch_boards": boards,
        "_chat_history": list(game.get("_chat_history", []))[-CHAT_HISTORY_LIMIT:],
        "_gameplay_status": "scaffold",
        "_gameplay_notice": "Zilch gameplay is not implemented yet.",
    }
