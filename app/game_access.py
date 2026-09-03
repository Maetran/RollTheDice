"""Central authorization policy for games that are not publicly available."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .game_types import ZILCH_GAME_TYPE, game_type_from_state
from .security import normalize_username

if TYPE_CHECKING:
    from .auth import AuthIdentity


ZILCH_PREVIEW_USERNAME = "mani"


def can_access_zilch_preview(identity: AuthIdentity | None) -> bool:
    """Return whether an authenticated identity may use the internal preview.

    This deliberately combines the existing account role with the existing
    username normalization.  Callers must not reproduce the comparison.
    """
    return bool(
        identity
        and identity.is_admin
        and normalize_username(identity.username) == ZILCH_PREVIEW_USERNAME
    )


def can_access_game(identity: AuthIdentity | None, game: dict) -> bool:
    """Apply the game-specific access policy to a live state."""
    return game_type_from_state(game) != ZILCH_GAME_TYPE or can_access_zilch_preview(identity)


def public_game_access_payload(identity: AuthIdentity | None) -> dict[str, bool]:
    """Expose only the client capability derived from the server-side policy."""
    return {"zilch_preview": can_access_zilch_preview(identity)}
