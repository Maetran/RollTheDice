"""Voluntary, durable departures without ending the other people's card game."""

from __future__ import annotations

import inspect
import logging
from datetime import datetime, timezone

from .game_types import HAUSDEPP_GAME_TYPE, game_type_from_state
from .hausdepp_engine import HausdeppRuleError, withdraw_player

logger = logging.getLogger(__name__)


def departure_permissions(game: dict, viewer_id: str | None) -> dict:
    """The server describes whether leaving forfeits this particular hand."""
    from .hausdepp_tournament import tournament_is_pending

    player = next((person for person in game.get("_players", []) if person.get("id") == viewer_id), None)
    state = game.get("_hausdepp") or {}
    hand = next((person for person in state.get("players", []) if person.get("id") == viewer_id), None)
    can_leave = bool(game_type_from_state(game) == HAUSDEPP_GAME_TYPE and player and hand
                     and game.get("_started") and not game.get("_aborted")
                     and (not game.get("_finished") or tournament_is_pending(game)))
    return {"can_leave": can_leave,
            "forfeits_round": bool(can_leave and state.get("phase") != "finished" and not hand.get("finished")),
            "ends_tournament_participation": bool(can_leave and tournament_is_pending(game))}


def _propose_departure(game: dict, player_id: str, version: object, departed_at: datetime) -> tuple[dict, bool]:
    """Keep socket-bearing objects shared; copy every domain object we change."""
    from .game_state import _offline_players, touch
    from .hausdepp_state import hausdepp_is_host
    from .hausdepp_tournament import record_finished_round, record_tournament_departure

    permissions = departure_permissions(game, player_id)
    if not permissions["can_leave"]:
        raise HausdeppRuleError("hausdepp_game_not_running")
    if type(version) is not int or version != game["_hausdepp"]["version"]:
        raise HausdeppRuleError("hausdepp_stale_version")
    proposed = dict(game)
    state = withdraw_player(game["_hausdepp"], player_id, version=version)
    if state["version"] == version:
        state["version"] += 1
        state["table_version"] = state["version"]
    proposed["_hausdepp"] = state
    proposed["_players"] = [player for player in game["_players"] if player["id"] != player_id]
    departures = dict(game.get("_hausdepp_departures", {}))
    departures[player_id] = {"round_number": (game.get("_hausdepp_tournament") or {}).get("round_number", 1),
                             "departed_at": departed_at.isoformat(),
                             "forfeited_round": permissions["forfeits_round"]}
    proposed["_hausdepp_departures"] = departures
    leaving = next(player for player in game["_players"] if player["id"] == player_id)
    if hausdepp_is_host(game, leaving):
        accounts = [player for player in proposed["_players"]
                    if type(player.get("user_id")) is int and player["user_id"] > 0]
        candidates = accounts or proposed["_players"]
        next_host = next((player for player in candidates if player.get("ws") is not None),
                         next(iter(candidates), {}))
        proposed["_hausdepp_host_user_id"] = next_host.get("user_id")
        proposed["_hausdepp_host_player_id"] = next_host.get("id")
    if game.get("_manual_pause_by") == player_id:
        proposed.update(_manual_pause=False, _manual_pause_by=None, _manual_pause_by_name=None, _manual_pause_at=None)
    if str(leaving.get("user_id")) in game.get("_admin_help_away", {}):
        proposed["_admin_help_away"] = {key: value for key, value in game["_admin_help_away"].items()
                                        if key != str(leaving.get("user_id"))}
    record_tournament_departure(proposed, player_id)
    if state["phase"] == "finished" and not game.get("_finished"):
        proposed.update(_finished=True, _finished_at=departed_at.isoformat(),
                        _results={key: state.get(key) for key in
                                  ("loser_id", "finished_order", "withdrawn_ids", "round_end_reason", "remaining_player_id")})
        record_finished_round(proposed)
    proposed["_turn"] = {"player_id": state["current_player_id"]} if state.get("current_player_id") else None
    proposed["_resume_required"] = bool(_offline_players(proposed))
    touch(proposed)
    return proposed, permissions["forfeits_round"]


async def leave_hausdepp_session(session, data: dict, *, finalize_game=None) -> bool:
    """Commit this socket's own departure before granting the client its exit."""
    from .auth import resolve_session
    from .game_snapshot import snapshot
    from .hausdepp_departure_store import persist_hausdepp_departure
    from .hausdepp_gameplay import game_lock, publish_hausdepp_transition
    from .hausdepp_tournament import round_result_id, tournament_is_pending
    from .hausdepp_voice import refresh_voice_game, voice_socket_disconnected

    game = session.game
    command_id = data.get("command_id")
    command_id = command_id if isinstance(command_id, str) and 0 < len(command_id) <= 100 else None
    async with game_lock(game):
        player = next((person for person in game.get("_players", []) if person.get("id") == session.player_id), None)
        account = player.get("user_id") if player else None
        identity = resolve_session(session.websocket) if account is not None else None
        if (game_type_from_state(game) != HAUSDEPP_GAME_TYPE or session.is_spectator or not player
                or player.get("ws") is not session.websocket
                or account is not None and (not identity or identity.user_id != account)):
            await session.websocket.send_json({"error": "hausdepp_invalid_actor", "error_code": "hausdepp_invalid_actor"})
            return False
        departed_at = datetime.now(timezone.utc)
        try:
            proposed, forfeited = _propose_departure(game, player["id"], data.get("version"), departed_at)
        except HausdeppRuleError as exc:
            await session.websocket.send_json({"error": exc.code, "error_code": exc.code,
                                               "scoreboard": snapshot(game, session.player_id)})
            return False
        tournament = proposed.get("_hausdepp_tournament")
        result_id = round_result_id(game["_id"], tournament["round_number"]) if tournament else game["_id"]
        try:
            persisted = persist_hausdepp_departure(proposed, user_id=account, player_id=player["id"],
                                                  result_id=result_id, departed_at=departed_at,
                                                  forfeited_round=forfeited)
            if inspect.isawaitable(persisted):
                persisted = await persisted
            if not persisted.get("departure_persisted"):
                raise RuntimeError("departure checkpoint not committed")
        except Exception:
            logger.exception("Could not commit Hausdepp departure for %s", game["_id"])
            await session.websocket.send_json({"error": "hausdepp_departure_persistence_failed",
                                               "error_code": "hausdepp_departure_persistence_failed"})
            return False
        game.update(proposed)
        session.player_id = None
        # Retirement is deliberately irrevocable after the durable commit. A
        # provider or delivery failure cannot put this hand back into play.
        try:
            await voice_socket_disconnected(session, revoke=True)
            await refresh_voice_game(game)
        except Exception:
            logger.exception("Could not finish voice cleanup after Hausdepp departure")
        try:
            await publish_hausdepp_transition(game, finalize_game=finalize_game)
        except Exception:
            logger.exception("Could not publish committed Hausdepp departure for %s", game["_id"])
        continues = not game.get("_finished") or tournament_is_pending(game)
        try:
            await session.websocket.send_json({"left_hausdepp_game": True, "table_continues": continues,
                                               "redirect": "/hausdepp", **({"command_id": command_id} if command_id else {})})
        finally:
            await session.websocket.close(code=1000)
        return True
