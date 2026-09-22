"""Optional, explicit operator binding of the permanent founder account."""

import os
import re

from .database import session_scope
from .ownership import bind_founder


def ensure_configured_founder() -> None:
    # Never infer ownership from a mutable name, bootstrap order or web request.
    configured_id = os.getenv("ROLLTHEDICE_FOUNDER_USER_ID", "").strip()
    if not configured_id:
        return
    if not re.fullmatch(r"[1-9][0-9]*", configured_id):
        raise ValueError("ROLLTHEDICE_FOUNDER_USER_ID must be a positive account ID")
    with session_scope() as db:
        bind_founder(db, int(configured_id))
