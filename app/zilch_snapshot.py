"""Client projection for the isolated, server-authoritative Zilch state."""

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
from .zilch_engine import (
    ZILCH_DICE_COUNT,
    ZILCH_TARGET_SCORE,
    ZilchRuleError,
    bank_allowed,
    options_for_turn,
)
from .zilch_state import (
    current_zilch_start_roll,
    current_zilch_turn,
    ensure_zilch_engine_state,
    zilch_expected_connection_count,
    zilch_expected_participant_count,
    zilch_participants,
)


def _six_dice(game: GameDict) -> list[int]:
    """Normalize persisted preview dice without accepting malformed state."""
    values = list(game.get("_dice") or [])[:ZILCH_DICE_COUNT]
    values.extend([0] * (ZILCH_DICE_COUNT - len(values)))
    return [value if isinstance(value, int) and 0 <= value <= 6 else 0 for value in values]


def _boards(
    game: GameDict,
    *,
    active_player_id: str | None = None,
    final_round: dict | None = None,
) -> dict[str, dict]:
    """Project exactly the per-player fields needed by the preview client."""
    result: dict[str, dict] = {}
    raw_boards = game.get("_zilch_boards", {}) or {}
    transport_by_id = {
        str(player.get("id") or ""): player
        for player in game.get("_players", [])
        if isinstance(player, dict) and str(player.get("id") or "")
    }
    for participant in zilch_participants(game)[:2]:
        player_id = str(participant.get("id") or "")
        if not player_id:
            continue
        participant_type = participant.get("type")
        is_cpu = participant_type == "cpu"
        connection_id = participant.get("connection_player_id")
        connection = transport_by_id.get(str(connection_id or player_id))
        raw_board = raw_boards.get(player_id, {}) if isinstance(raw_boards, dict) else {}
        round_points = game.get("_round_points", {})
        total_points = game.get("_total_points", {})
        raw_rounds = raw_board.get("rounds", []) if isinstance(raw_board, dict) else []
        result[player_id] = {
            "player_id": player_id,
            # A CPU owns no transport at all. ``None`` deliberately means
            # "not applicable", not an offline opponent.
            "connected": None if is_cpu else bool(connection and _player_connected(connection)),
            "participant_type": participant_type,
            "is_cpu": is_cpu,
            "active": player_id == active_player_id,
            "round_points": int(
                raw_board.get("round_points", round_points.get(player_id, 0))
                if isinstance(raw_board, dict) and isinstance(round_points, dict)
                else 0
            ),
            "total_points": int(
                raw_board.get("total_points", total_points.get(player_id, 0))
                if isinstance(raw_board, dict) and isinstance(total_points, dict)
                else 0
            ),
            "zilch_streak": int(raw_board.get("zilch_streak", 0) or 0) if isinstance(raw_board, dict) else 0,
            "rounds": [dict(entry) if isinstance(entry, dict) else entry for entry in raw_rounds]
            if isinstance(raw_rounds, list)
            else [],
            "final_round_triggered_by": (
                str(final_round.get("triggered_by") or "") == player_id if isinstance(final_round, dict) else False
            ),
            "final_reply_pending": (
                player_id in {str(value) for value in final_round.get("pending_player_ids", [])}
                if isinstance(final_round, dict)
                else False
            ),
        }
    return result


def snapshot_zilch(game: GameDict) -> dict:
    """Project only Zilch engine data; never invoke ZDWA scoring helpers."""
    ensure_zilch_engine_state(game)
    check_timeout_and_abort(game)
    pause_reason = multiplayer_pause_reason(game)
    pause_left = pause_remaining_seconds(game)
    try:
        start_roll = current_zilch_start_roll(game) if game.get("_zilch_start_roll") else None
    except ZilchRuleError:
        start_roll = None
    try:
        turn = current_zilch_turn(game) if game.get("_turn") else None
    except ZilchRuleError:
        turn = None
    final_round = game.get("_zilch_final_round") if isinstance(game.get("_zilch_final_round"), dict) else None
    boards = _boards(
        game,
        active_player_id=turn.player_id if turn else None,
        final_round=final_round,
    )
    participants = zilch_participants(game)
    transport_players = [player for player in game.get("_players", []) if isinstance(player, dict)]
    transport_by_id = {
        str(player.get("id") or ""): player
        for player in transport_players
        if str(player.get("id") or "")
    }
    options = options_for_turn(turn) if turn else ()
    can_bank, bank_reason = bank_allowed(turn) if turn else (False, "zilch_turn_not_ready")
    current_turn_state = (
        {
            "turn_id": turn.turn_id,
            "version": turn.version,
            "phase": turn.phase,
            "roll_id": turn.roll_id,
            "rolls_used": turn.rolls_used,
            "available_dice_indices": list(turn.available_indices),
            "held_dice_indices": list(turn.held_indices),
            "committed_holds": [dict(entry) for entry in turn.committed_holds],
            "round_points": turn.round_points,
            "confirmation_required": turn.confirmation_required,
            "confirmation_reasons": list(turn.confirmation_reasons),
            "can_roll": turn.phase in {"ready_to_roll", "confirmation_roll_required"},
            "can_select_hold": turn.phase == "awaiting_hold",
            "can_bank": can_bank,
            "bank_block_reason": bank_reason,
        }
        if turn
        else None
    )
    return {
        "_game_type": ZILCH_GAME_TYPE,
        "_name": game.get("_name", "Zilch"),
        "_players": [
            public_player_payload(player, connected=_player_connected(player))
            for player in transport_players
        ],
        "_participants": [
            {
                "id": str(participant.get("id") or ""),
                "name": str(participant.get("name") or "Player"),
                "type": participant.get("type"),
                "connection_player_id": participant.get("connection_player_id"),
                "user_id": participant.get("user_id"),
                "cpu_strategy": participant.get("cpu_strategy"),
                "is_cpu": participant.get("type") == "cpu",
                "connected": (
                    None
                    if participant.get("type") == "cpu"
                    else bool(
                        transport_by_id.get(
                            str(participant.get("connection_player_id") or participant.get("id") or "")
                        )
                        and _player_connected(
                            transport_by_id[
                                str(participant.get("connection_player_id") or participant.get("id") or "")
                            ]
                        )
                    )
                ),
            }
            for participant in participants[:2]
        ],
        "_play_mode": game.get(
            "_play_mode",
            "solo" if int(game.get("_expected", 0) or 0) == 1 else "multiplayer",
        ),
        "_mode": game.get("_mode"),
        # `_players` and `_players_joined` intentionally retain their
        # historic transport meaning.  The explicit fields below let a CPU
        # game show two durable seats while requiring only one connection.
        "_players_joined": len(transport_players),
        "_connections_joined": len(transport_players),
        "_expected_connections": zilch_expected_connection_count(game),
        "_participants_joined": len(participants),
        "_expected_participants": zilch_expected_participant_count(game),
        "_expected": zilch_expected_participant_count(game),
        "_started": bool(game.get("_started")),
        "_finished": bool(game.get("_finished")),
        "_aborted": bool(game.get("_aborted")),
        "_started_at": game.get("_started_at"),
        "_finished_at": game.get("_finished_at"),
        "_updated_at": game.get("_updated_at"),
        "_finalization_pending": bool(game.get("_finalization_pending")),
        "_paused": bool(pause_reason),
        "_pause_reason": pause_reason,
        "_manual_pause": bool(game.get("_manual_pause")),
        "_pause_remaining_seconds": pause_left,
        "_pause_remaining_label": _format_duration_hm(pause_left),
        "_timeout_seconds": timeout_seconds(),
        "_timeout_label": _format_duration_hm(timeout_seconds()),
        "_offline_players": _offline_players(game),
        "_connected": {str(player.get("id")): _player_connected(player) for player in transport_players},
        "_participant_connected": {
            str(participant.get("id") or ""): (
                None
                if participant.get("type") == "cpu"
                else bool(
                    transport_by_id.get(
                        str(participant.get("connection_player_id") or participant.get("id") or "")
                    )
                    and _player_connected(
                        transport_by_id[
                            str(participant.get("connection_player_id") or participant.get("id") or "")
                        ]
                    )
                )
            )
            for participant in participants
        },
        "locked": bool(game.get("_passphrase")),
        "_turn": game.get("_turn"),
        "_dice": _six_dice(game),
        "_holds": [bool(value) for value in list(game.get("_holds") or [])[:ZILCH_DICE_COUNT]],
        "_rolls_used": int(game.get("_rolls_used", 0) or 0),
        "_target_score": int(game.get("_target_score", ZILCH_TARGET_SCORE) or ZILCH_TARGET_SCORE),
        "_round_points": {
            player_id: board["round_points"] for player_id, board in boards.items()
        },
        "_total_points": {
            player_id: board["total_points"] for player_id, board in boards.items()
        },
        "_zilch_boards": boards,
        "_zilch_ruleset": game.get("_zilch_ruleset"),
        "_zilch_start_roll": start_roll,
        "_zilch_final_round": final_round,
        "_zilch_outcome": game.get("_zilch_outcome"),
        "_zilch_result": game.get("_zilch_result"),
        "_zilch_last_event": game.get("_zilch_last_event"),
        "_zilch_cpu_error": game.get("_zilch_cpu_error"),
        "_zilch_turn_state": current_turn_state,
        "_zilch_quick_holds": [option.payload() for option in options],
        "_chat_history": list(game.get("_chat_history", []))[-CHAT_HISTORY_LIMIT:],
        "_gameplay_status": "playable_alpha",
        "_gameplay_notice": {"message_key": "zilch.preview.playable_alpha"},
    }
