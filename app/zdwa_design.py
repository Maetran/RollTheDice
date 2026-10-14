"""ZDWA presentation choice: the 2026 design or the previous one.

The design changes presentation only: rules, scoring, storage and realtime
payloads stay identical for every account.  Accounts store their choice in
``users.zdwa_design``; guests keep it in their browser.  The server only says
whether the 2026 design may be offered at all, so
``ROLLTHEDICE_ZDWA_DESIGN=off`` (or ``owner``) narrows it for everyone without a
code deploy.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import update

if TYPE_CHECKING:
    from .auth import AuthIdentity


ZDWA_DESIGN_ENV = "ROLLTHEDICE_ZDWA_DESIGN"
MODE_ALL = "all"
MODE_OWNER = "owner"
MODE_OFF = "off"
MODES = frozenset({MODE_ALL, MODE_OWNER, MODE_OFF})

DESIGN_NEW = "new"
DESIGN_OLD = "old"
DESIGNS = frozenset({DESIGN_NEW, DESIGN_OLD})


def configured_zdwa_design_mode() -> str:
    """Return ``all``, ``owner`` or ``off``; unknown values fail closed to ``off``."""
    configured = os.getenv(ZDWA_DESIGN_ENV, MODE_ALL).strip().casefold()
    return configured if configured in MODES else MODE_OFF


def zdwa_design_available(identity: AuthIdentity | None) -> bool:
    mode = configured_zdwa_design_mode()
    if mode == MODE_ALL:
        return True
    return mode == MODE_OWNER and identity is not None and bool(identity.is_owner)


def normalize_design(value: object) -> str:
    return value if value in DESIGNS else DESIGN_NEW


def design_payload(identity: AuthIdentity | None) -> dict:
    """Describe the design state for the browser (account or guest)."""
    available = zdwa_design_available(identity)
    payload: dict = {"zdwa_2026_available": available}
    if identity is not None:
        payload["zdwa"] = normalize_design(identity.zdwa_design)
        # Only ask accounts that can actually use the 2026 design.
        payload["prompt_pending"] = available and identity.zdwa_design_prompt_pending
    return payload


def claim_design_prompt(db, user_id: int) -> bool:
    """Atomically mark the one-time design question as shown; True only once."""
    from .models import User

    result = db.execute(
        update(User)
        .where(User.id == user_id, User.zdwa_design_prompted_at.is_(None))
        .values(zdwa_design_prompted_at=datetime.now(UTC))
    )
    return bool(result.rowcount)
