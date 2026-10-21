"""Round-scoped spectator pacing after the only human has finished."""

from __future__ import annotations

from .game_state import multiplayer_pause_reason
from .game_types import HAUSDEPP_GAME_TYPE, game_type_from_state


def _finished_solo_player(game: dict, *, allow_finished: bool = False) -> str | None:
    state = game.get("_hausdepp") or {}
    terminal = bool(allow_finished and game.get("_finished") and state.get("phase") == "finished")
    if (game_type_from_state(game) != HAUSDEPP_GAME_TYPE or not game.get("_started")
            or game.get("_aborted") or not terminal and (game.get("_finished") or state.get("phase") != "playing")):
        return None
    humans = [player for player in game.get("_participants", []) if not player.get("is_cpu")]
    if len(humans) != 1:
        return None
    human = humans[0]
    seated = next((player for player in game.get("_players", []) if player.get("id") == human.get("id")), None)
    players = state.get("players", [])
    own = next((player for player in players if player.get("id") == human.get("id")), None)
    withdrawn = state.get("withdrawn_ids", [])
    remaining = [player for player in players if not player.get("finished") and player.get("id") not in withdrawn]
    if (not seated or type(human.get("user_id")) is not int or human["user_id"] <= 0
            or seated.get("user_id") != human["user_id"] or not own or not own.get("finished") or own.get("hand")
            or human.get("id") in withdrawn or not terminal and len(remaining) < 2
            or any(not player.get("is_cpu") for player in players if player.get("id") != human.get("id"))):
        return None
    return human["id"]


def cpu_tempo_round(game: dict) -> int:
    return (game.get("_hausdepp_tournament") or {}).get("round_number", 1)


def fast_cpu_tempo(game: dict) -> bool:
    return bool(type(game.get("_hausdepp_cpu_fast_round")) is int
                and game["_hausdepp_cpu_fast_round"] == cpu_tempo_round(game)
                and _finished_solo_player(game, allow_finished=True))


def cpu_tempo_permissions(game: dict, viewer_id: str | None) -> dict:
    active = fast_cpu_tempo(game)
    return {"fast": active, "can_speed_up": bool(viewer_id and viewer_id == _finished_solo_player(game)
                                                and not active and not multiplayer_pause_reason(game))}


def enable_fast_cpu_tempo(game: dict, player_id: str, round_number: object) -> None:
    from .hausdepp_engine import HausdeppRuleError

    if type(round_number) is not int or round_number != cpu_tempo_round(game):
        raise HausdeppRuleError("hausdepp_stale_version")
    if not player_id or player_id != _finished_solo_player(game):
        raise HausdeppRuleError("hausdepp_cpu_tempo_unavailable")
    game["_hausdepp_cpu_fast_round"] = round_number


def paced_cpu_delay(game: dict, delay: float) -> float:
    """Keep each visible move readable while shortening ordinary pauses by 70%."""
    return max(0.4, delay * 0.3) if delay > 0 and fast_cpu_tempo(game) else delay
