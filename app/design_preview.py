"""Owner-only preview switches for unreleased visual designs.

A design preview changes presentation only: rules, scoring, storage and
realtime payloads stay identical for every account.  The browser receives the
capability below and applies a scoped stylesheet; without it the page renders
exactly as before.  ``ROLLTHEDICE_ZDWA_DESIGN_PREVIEW=off`` is the server-side
kill switch for a rollback without a code deploy.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .auth import AuthIdentity


ZDWA_DESIGN_PREVIEW_ENV = "ROLLTHEDICE_ZDWA_DESIGN_PREVIEW"
ZDWA_DESIGN_PREVIEW_OWNER = "owner"
ZDWA_DESIGN_PREVIEW_OFF = "off"


def configured_zdwa_design_preview_mode() -> str:
    """Return ``owner`` or ``off``; unknown values never widen the audience."""
    configured = os.getenv(ZDWA_DESIGN_PREVIEW_ENV, ZDWA_DESIGN_PREVIEW_OWNER).strip().casefold()
    return configured if configured == ZDWA_DESIGN_PREVIEW_OWNER else ZDWA_DESIGN_PREVIEW_OFF


def design_preview_payload(identity: AuthIdentity | None) -> dict[str, bool]:
    """Return the design previews this account may see."""
    enabled = bool(
        identity is not None
        and identity.is_owner
        and configured_zdwa_design_preview_mode() == ZDWA_DESIGN_PREVIEW_OWNER
    )
    return {"zdwa_2026": enabled}
