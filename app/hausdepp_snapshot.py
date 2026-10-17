"""Explicit per-viewer card projection; the default is a spectator view."""

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
from .hausdepp_state import hausdepp_progress


def snapshot_hausdepp(game: GameDict, viewer_id: str | None = None) -> dict:
    from .hausdepp_engine import project_state
    from .hausdepp_tournament import project_hausdepp_tournament
    from .hausdepp_waiting import waiting_permissions

    check_timeout_and_abort(game)
    state = game.get("_hausdepp")
    # A spectator ID is never a hand owner, including the founder's spectator socket.
    valid_viewer = viewer_id if any(player["id"] == viewer_id for player in game.get("_players", [])) else None
    projection = project_state(state, valid_viewer) if state else None
    paused_reason = multiplayer_pause_reason(game)
    if projection and (paused_reason or game.get("_finished")):
        projection["available_actions"] = []
        projection["playable_cards"] = []
    if projection:
        from .hausdepp_cpu_strategy import table_tip
        from .hausdepp_experience import wants_tips

        # Only the viewer's own options, and only during their first rounds.
        projection["table_tip"] = table_tip(projection) if wants_tips(game, valid_viewer) else None
    return {
        "_game_type": "hausdepp", "_name": game["_name"], "_mode": game["_mode"],
        "_players": [public_player_payload(player, connected=_player_connected(player))
                     for player in game.get("_players", [])],
        "_participants": hausdepp_progress(game), "_players_joined": len(game.get("_players", [])),
        "_expected": game["_expected"], "_expected_connections": game.get("_expected_connections"),
        "_play_mode": game.get("_play_mode"), "_started": game.get("_started", False),
        "_finished": game.get("_finished", False), "_started_at": game.get("_started_at"),
        "_updated_at": game.get("_updated_at"), "_aborted": bool(game.get("_aborted")),
        "_abort_reason": game.get("_abort_reason") if game.get("_aborted") else None,
        "_paused": bool(paused_reason), "_pause_reason": paused_reason,
        "_manual_pause": bool(game.get("_manual_pause")),
        "_pause_remaining_seconds": pause_remaining_seconds(game),
        "_pause_remaining_label": _format_duration_hm(pause_remaining_seconds(game)),
        "_timeout_seconds": timeout_seconds(), "_timeout_label": _format_duration_hm(timeout_seconds()),
        "_offline_players": _offline_players(game),
        "_turn": ({"player_id": projection["current_player_id"]}
                  if projection and projection.get("current_player_id") else None),
        "_connected": {str(player["id"]): _player_connected(player) for player in game.get("_players", [])},
        "_chat_history": [dict(entry) for entry in game.get("_chat_history", [])][-CHAT_HISTORY_LIMIT:],
        "_spectators": [public_player_payload(player) for player in game.get("_spectators", [])],
        "locked": bool(game.get("_passphrase")), "_hausdepp": projection,
        "_results": game.get("_results"), "_cpu_thinking": bool(game.get("_hausdepp_cpu_thinking")),
        "_hausdepp_round_summary": game.get("_hausdepp_round_summary") if game.get("_finished") else None,
        "_hausdepp_tournament": project_hausdepp_tournament(game, valid_viewer),
        "_waiting_permissions": waiting_permissions(game, valid_viewer),
    }
