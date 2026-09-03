"""Central validation and backwards-compatible access to game types."""

from __future__ import annotations

from typing import Final, Literal

GameType = Literal["zdwa", "zilch"]

DEFAULT_GAME_TYPE: Final[GameType] = "zdwa"
ZILCH_GAME_TYPE: Final[GameType] = "zilch"
GAME_TYPES: Final[frozenset[str]] = frozenset({DEFAULT_GAME_TYPE, ZILCH_GAME_TYPE})


def normalize_game_type(value: object | None, *, default: GameType = DEFAULT_GAME_TYPE) -> GameType:
    """Return one supported game type, defaulting old state to ZDWA.

    Active-game snapshots predate ``_game_type``.  Treating a missing value as
    ZDWA is the explicit compatibility contract; present but unknown values are
    rejected instead of silently being interpreted as a different game.
    """
    if value is None:
        return default
    normalized = str(value).strip().lower()
    if not normalized:
        return default
    if normalized not in GAME_TYPES:
        raise ValueError("invalid_game_type")
    return normalized  # type: ignore[return-value]


def game_type_from_state(game: dict) -> GameType:
    """Read the durable type marker from a live state with the legacy default."""
    return normalize_game_type(game.get("_game_type"))
