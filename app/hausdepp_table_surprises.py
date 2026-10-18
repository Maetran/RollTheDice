"""Rare, room-wide table effects, independent of the versioned card engine."""

from __future__ import annotations

from hashlib import sha256
from uuid import uuid4

from .game_realtime import broadcast
from .game_state import multiplayer_pause_reason
from .game_ws_session import GameSocketSession
from .hausdepp_gameplay import game_lock
from .hausdepp_surprise_collection import SURPRISE_EFFECTS, record_surprise_collection

HAUSDEPP_TABLE_ACTIONS = frozenset({"hausdepp_table_surprise"})
_EFFECTS = SURPRISE_EFFECTS
_CLAIM_KEY = "_hausdepp_table_surprise_claim"
_SCORCHED_KEY = "_hausdepp_scorched_cards"


def table_effects_projection(game: dict) -> dict:
    """Public cosmetic state, including for viewers who join after the dragon."""
    return {"scorched_cards": game.get(_SCORCHED_KEY) is True}


def _round_number(game: dict) -> int:
    tournament = game.get("_hausdepp_tournament")
    value = tournament.get("round_number", 1) if isinstance(tournament, dict) else 1
    return value if type(value) is int and value > 0 else 1


def _eligible_effect(game_id: str, round_number: int) -> str | None:
    # Decide rarity first, independently of the variant pool. Only an eligible
    # round draws one of eight equally likely effects (~1/400 each). Viewers
    # use this server offer, never a separate client-side lottery.
    chance = sha256(f"hausdepp-table-surprise:eligibility:v1:{game_id}:{round_number}".encode()).digest()
    if int.from_bytes(chance, "big") % 50:
        return None
    variant = sha256(f"hausdepp-table-surprise:variant:v1:{game_id}:{round_number}".encode()).digest()
    return _EFFECTS[int.from_bytes(variant, "big") % len(_EFFECTS)]


def _human_participant(game: dict, player_id: str | None) -> bool:
    return bool(player_id and any(
        player.get("id") == player_id and not player.get("is_cpu") and player.get("type") != "cpu"
        for player in game.get("_participants", [])
    ) and any(player.get("id") == player_id for player in game.get("_players", [])))


def table_surprise_offer(game: dict, viewer_id: str | None) -> dict:
    """Project only an unused offer; an old explosion is never a snapshot event."""
    round_number = _round_number(game)
    offer = {"round_number": round_number, "effect": None}
    if (game.get("_game_type") != "hausdepp" or not game.get("_started")
            or game.get("_finished") or game.get("_aborted")
            or (game.get("_hausdepp") or {}).get("phase") != "playing"
            or not _human_participant(game, viewer_id) or multiplayer_pause_reason(game)):
        return offer
    claim = game.get(_CLAIM_KEY)
    claim = claim if isinstance(claim, dict) else {}
    if claim.get("round_number") == round_number and claim.get("activated") is True:
        return offer
    offer["effect"] = _eligible_effect(str(game["_id"]), round_number)
    return offer


def _claim_surprise(session: GameSocketSession, data: dict) -> dict:
    """Validate and claim synchronously while the caller owns the game lock."""
    game = session.game
    # A newer device may have replaced this socket while it was waiting.
    if (session.is_spectator or not _human_participant(game, session.player_id)
            or not any(player.get("id") == session.player_id and player.get("ws") is session.websocket
                       for player in game.get("_players", []))):
        code = "hausdepp_table_surprise_invalid_actor"
        return {"error_code": code, "error": code}
    offer = table_surprise_offer(game, session.player_id)
    effect = data.get("effect")
    requested_round = data.get("round_number")
    if (type(requested_round) is not int or requested_round != offer["round_number"]
            or not isinstance(effect, str) or effect != offer["effect"]):
        code = "hausdepp_table_surprise_unavailable"
        return {"error_code": code, "error": code, "hausdepp_table_surprises": offer}
    # Exactly one tiny claim per room, replaced on a later eligible round.
    # Existing active-game JSON retains it across a restart, but never an
    # animation payload, actor or private hand. No schema/history growth.
    game[_CLAIM_KEY] = {"round_number": offer["round_number"], "activated": True}
    record_surprise_collection(game, session.player_id, effect, offer["round_number"])
    if effect == "dragon":
        # A bounded visual flag for this table, outside the card engine. New
        # tournament rounds keep the singed paper; a new table starts clean.
        game[_SCORCHED_KEY] = True
    return {
        "hausdepp_table_surprise": {"id": uuid4().hex, "game_id": str(game["_id"]),
                                    "round_number": offer["round_number"], "actor_id": session.player_id,
                                    "effect": effect},
        "hausdepp_table_surprises": {"round_number": offer["round_number"], "effect": None},
        "hausdepp_table_effects": table_effects_projection(game),
    }


async def handle_table_surprise(session: GameSocketSession, data: dict) -> None:
    """Claim once, then fan out without blocking card actions behind socket I/O."""
    async with game_lock(session.game):
        message = _claim_surprise(session, data)
    if "hausdepp_table_surprise" in message:
        # No yield separates the claim from broadcast's synchronous save,
        # which persists it before the first network await. Slow recipients
        # never retain the card/CPU lock, and there is no duplicate save.
        await broadcast(session.game, message)
    else:
        await session.websocket.send_json(message)
