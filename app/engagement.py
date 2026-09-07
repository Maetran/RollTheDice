"""Post-rollout account interaction tracking and award synchronization."""

from __future__ import annotations

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
