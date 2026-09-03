"""Central authorization policy for games that are not publicly available."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from .game_types import ZILCH_GAME_TYPE, game_type_from_state
from .security import normalize_username

if TYPE_CHECKING:
    from .auth import AuthIdentity


ZILCH_PREVIEW_USERNAME = "mani"
ZILCH_PREVIEW_ALLOWLIST_ENV = "ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES"
ZILCH_ACCESS_MODE_ENV = "ROLLTHEDICE_ZILCH_ACCESS_MODE"
ZILCH_ACCESS_MODE_PREVIEW = "preview"
ZILCH_ACCESS_MODE_AUTHENTICATED = "authenticated"


def configured_zilch_access_mode() -> str:
    """Return the deliberately closed Zilch audience mode.

    ``preview`` remains the safe default. A separate staging environment may
    opt into ``authenticated`` to exercise the signed-in product audience;
    unknown values fail closed to preview rather than widening access.
    """
    configured = os.getenv(ZILCH_ACCESS_MODE_ENV, ZILCH_ACCESS_MODE_PREVIEW).strip().casefold()
    valid_modes = {ZILCH_ACCESS_MODE_PREVIEW, ZILCH_ACCESS_MODE_AUTHENTICATED}
    return configured if configured in valid_modes else ZILCH_ACCESS_MODE_PREVIEW


def configured_zilch_preview_usernames() -> frozenset[str]:
    """Return the explicit, optional non-admin preview allowlist.

    The production-safe default is an empty set.  The special ``mani``
    identity is intentionally excluded here: it always retains the stricter
    administrator requirement below, even if somebody accidentally adds it to
    the environment variable.  Values are normalized with the exact same
    helper that account lookup uses, so display casing never changes access.
    """
    raw_value = os.getenv(ZILCH_PREVIEW_ALLOWLIST_ENV, "")
    usernames = {
        normalize_username(candidate)
        for candidate in raw_value.split(",")
        if normalize_username(candidate)
    }
    usernames.discard(ZILCH_PREVIEW_USERNAME)
    return frozenset(usernames)


def can_access_zilch_preview(identity: AuthIdentity | None) -> bool:
    """Return whether an authenticated identity may use the internal preview.

    This deliberately combines the existing account role with the existing
    username normalization.  Callers must not reproduce the comparison.
    """
    if not identity:
        return False
    if configured_zilch_access_mode() == ZILCH_ACCESS_MODE_AUTHENTICATED:
        return True
    username = normalize_username(identity.username)
    if username == ZILCH_PREVIEW_USERNAME:
        return identity.is_admin
    # Explicit allowlisted identities get only the Zilch preview capability;
    # their normal application role stays untouched.
    return username in configured_zilch_preview_usernames()


def can_access_game(identity: AuthIdentity | None, game: dict) -> bool:
    """Apply the game-specific access policy to a live state."""
    return game_type_from_state(game) != ZILCH_GAME_TYPE or can_access_zilch_preview(identity)


def public_game_access_payload(identity: AuthIdentity | None) -> dict[str, bool]:
    """Expose only the client capability derived from the server-side policy."""
    return {"zilch_preview": can_access_zilch_preview(identity)}
