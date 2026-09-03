"""Explicit, non-scoring gameplay boundary for the Zilch foundation branch."""

from __future__ import annotations

from typing import Any

from .game_realtime import send_game_message
from .game_ws_session import GameSocketSession

# These names intentionally do not overlap ZDWA's five-dice actions.  Future
# rule work must implement them here instead of routing through game_engine.
ZILCH_GAMEPLAY_ACTIONS = frozenset({"zilch_roll_dice", "zilch_submit_score"})


async def handle_zilch_gameplay_action(
    session: GameSocketSession,
    action: str,
    _data: dict[str, Any],
    **_kwargs: Any,
) -> None:
    """Answer honestly until score rules and manual-entry semantics are confirmed."""
    if action not in ZILCH_GAMEPLAY_ACTIONS:
        raise ValueError(f"Unsupported Zilch gameplay action: {action}")
    await send_game_message(
        session.websocket,
        {
            "error": "Zilch-Vorschau: Würfeln und Punkteingabe sind noch nicht implementiert.",
            "zilch_scaffold": {"action": action, "status": "not_implemented"},
        },
    )
