"""Post-rollout account interaction tracking and award synchronization."""

from __future__ import annotations

import logging

from sqlalchemy import select

from .database import database_schema_ready, session_scope
from .models import User, UserEngagementEvent
from .security import utcnow

ENGAGEMENT_EVENTS = frozenset({
    "avatar_set", "avatar_changed", "settings_viewed", "settings_saved",
    "statistics_viewed", "achievements_viewed", "rules_viewed", "history_viewed",
    "leaderboard_viewed", "github_clicked", "theme_changed", "language_changed",
    "game_switcher_used", "push_settings_viewed", "chat_settings_saved",
})

# These names describe UI regions, not achievement keys.  Keeping the mapping
# on the server means a browser cannot submit an arbitrary award identifier.
ACCOUNT_TAB_EVENTS = {
    "statistics": "statistics_viewed",
    "achievements": "achievements_viewed",
    "settings": "settings_viewed",
}

logger = logging.getLogger(__name__)


def record_engagement(user_id: int, event_key: str) -> dict:
    """Record one allow-listed live action and refresh both game projections."""
    event_key = str(event_key or "").strip()
    if event_key not in ENGAGEMENT_EVENTS or not database_schema_ready():
        return {"recorded": False}
    now = utcnow()
    with session_scope() as db:
        user = db.get(User, int(user_id))
        if user is None or not user.is_active:
            return {"recorded": False}
        event = db.scalar(select(UserEngagementEvent).where(
            UserEngagementEvent.user_id == user.id,
            UserEngagementEvent.event_key == event_key,
        ))
        if event is None:
            db.add(UserEngagementEvent(
                user_id=user.id, event_key=event_key,
                first_seen_at=now, last_seen_at=now, count=1,
            ))
        else:
            event.count += 1
            event.last_seen_at = now
        db.flush()
    # Import lazily to keep model/database imports cycle-free.
    from .achievements import sync_engagement_achievements_for_users
    sync_engagement_achievements_for_users({int(user_id)})
    try:
        from .zilch_achievements import sync_zilch_engagement_achievements_for_users
        sync_zilch_engagement_achievements_for_users({int(user_id)})
    except (ImportError, RuntimeError):
        # Engagement must never make an otherwise successful settings action fail.
        pass
    return {"recorded": True, "event": event_key}


def record_account_tab_engagement(user_id: int, tab: str) -> dict:
    """Record one explicitly named account tab, never a caller-supplied key."""
    event_key = ACCOUNT_TAB_EVENTS.get(str(tab or "").strip())
    if event_key is None:
        return {"recorded": False}
    return record_engagement(user_id, event_key)


def record_engagement_safely(user_id: int, event_key: str) -> dict:
    """Keep a completed product action successful if its award projection fails."""
    try:
        return record_engagement(user_id, event_key)
    except Exception:  # pragma: no cover - the caller's action is the priority
        logger.exception("Could not record engagement event %s", event_key)
        return {"recorded": False}


def record_request_engagement(request, event_key: str) -> dict:
    """Record a real page or redirect navigation for its signed-in visitor."""
    try:
        # Import lazily: auth owns session resolution and already depends on
        # the same persistence models as this small projection.
        from .auth import resolve_session

        identity = resolve_session(request)
        if identity is None:
            return {"recorded": False}
        return record_engagement_safely(identity.user_id, event_key)
    except Exception:  # pragma: no cover - navigation must remain available
        logger.exception("Could not resolve a request engagement event %s", event_key)
        return {"recorded": False}
