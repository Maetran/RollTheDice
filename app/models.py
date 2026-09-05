from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, validates

from .game_types import DEFAULT_GAME_TYPE, normalize_game_type


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(32), nullable=False)
    username_normalized: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    announce_selection_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="overlay")
    auto_write_announced: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    mobile_row_quick_entry: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    haptic_feedback: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    keep_screen_awake: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    preferred_language: Mapped[str] = mapped_column(String(2), nullable=False, default="de")
    statistics_views: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    achievement_gameplay_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    achievement_extra_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    achievement_expansion_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    achievement_office_hours_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    achievement_multiplayer_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    achievement_top_section_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    sessions: Mapped[list[Session]] = relationship(back_populates="user", cascade="all, delete-orphan")
    participations: Mapped[list[GameParticipant]] = relationship(
        back_populates="user", foreign_keys="GameParticipant.user_id"
    )
    achievements: Mapped[list[UserAchievement]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    csrf_token: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped[User] = relationship(back_populates="sessions")

    __table_args__ = (Index("ix_sessions_user_expires", "user_id", "expires_at"),)


class AuthRateEvent(Base):
    __tablename__ = "auth_rate_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    client_key: Mapped[str] = mapped_column(String(64), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("ix_auth_rate_events_kind_client_time", "kind", "client_key", "occurred_at"),
        Index("ix_auth_rate_events_kind_time", "kind", "occurred_at"),
    )


class CompletedGame(Base):
    __tablename__ = "completed_games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    game_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    # This discriminator is deliberately persisted rather than inferred from
    # the JSON payload.  A completed Zilch must never become a ZDWA scorecard
    # merely because a caller uses one of the historic result readers.
    game_type: Mapped[str] = mapped_column(String(16), nullable=False, default=DEFAULT_GAME_TYPE)
    game_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    hardcore: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False)
    imported_from_legacy: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    participants: Mapped[list[GameParticipant]] = relationship(
        back_populates="game", cascade="all, delete-orphan", order_by="GameParticipant.position"
    )

    __table_args__ = (
        CheckConstraint("game_type IN ('zdwa', 'zilch')", name="ck_completed_games_game_type"),
        Index("ix_completed_games_finished_at", "finished_at"),
        # Both the public ZDWA readers and the private Zilch history filter by
        # type and show the newest finished rows first.
        Index("ix_completed_games_game_type_finished_at", "game_type", "finished_at"),
    )

    @validates("game_type")
    def _validate_game_type(self, _key: str, value: object) -> str:
        """Keep ORM writers aligned with the database discriminator contract."""
        try:
            return normalize_game_type(value)
        except ValueError as exc:
            raise ValueError("invalid_game_type") from exc


class ActiveGame(Base):
    """Restart-safe snapshot of a waiting or running game."""

    __tablename__ = "active_games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    game_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    state_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (Index("ix_active_games_updated_at", "updated_at"),)


class DeletedGame(Base):
    __tablename__ = "deleted_games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    game_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    game_type: Mapped[str] = mapped_column(String(16), nullable=False, default=DEFAULT_GAME_TYPE)
    game_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    hardcore: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    deleted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    deleted_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        CheckConstraint("game_type IN ('zdwa', 'zilch')", name="ck_deleted_games_game_type"),
        Index("ix_deleted_games_deleted_at", "deleted_at"),
    )

    @validates("game_type")
    def _validate_game_type(self, _key: str, value: object) -> str:
        """Use the same central validation for audit tombstones."""
        try:
            return normalize_game_type(value)
        except ValueError as exc:
            raise ValueError("invalid_game_type") from exc


class GameParticipant(Base):
    __tablename__ = "game_participants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("completed_games.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    player_key: Mapped[str] = mapped_column(String(64), nullable=False)
    display_name: Mapped[str] = mapped_column(String(64), nullable=False)
    team: Mapped[str | None] = mapped_column(String(8), nullable=True)
    points: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    assigned_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    game: Mapped[CompletedGame] = relationship(back_populates="participants")
    user: Mapped[User | None] = relationship(back_populates="participations", foreign_keys=[user_id])

    __table_args__ = (
        UniqueConstraint("game_id", "player_key", name="uq_game_participant_player"),
        Index("ix_game_participants_user", "user_id"),
    )


class AssignmentAudit(Base):
    __tablename__ = "assignment_audit"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    participant_id: Mapped[int] = mapped_column(ForeignKey("game_participants.id", ondelete="CASCADE"), nullable=False)
    previous_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    new_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    admin_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class UserAchievement(Base):
    __tablename__ = "user_achievements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    achievement_key: Mapped[str] = mapped_column(String(64), nullable=False)
    # Only awards that can be proven to have crossed their threshold through
    # one concrete ZDWA result receive a source. Historic materializations and
    # account-only achievements deliberately remain unlinked.
    source_completed_game_id: Mapped[int | None] = mapped_column(
        ForeignKey("completed_games.id", ondelete="SET NULL"), nullable=True
    )
    unlocked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped[User] = relationship(back_populates="achievements")

    __table_args__ = (
        UniqueConstraint("user_id", "achievement_key", name="uq_user_achievement"),
        Index("ix_user_achievements_user", "user_id"),
        Index("ix_user_achievements_source_game", "source_completed_game_id"),
    )


class ZilchAchievementEvaluation(Base):
    """Durable, explicitly registered work item for one Zilch result.

    Zilch achievements deliberately do not scan historic ``CompletedGame``
    rows.  The Zilch finalizer registers a newly persisted result here, then
    the isolated achievement service consumes only these work items.  A
    pending row survives a transient evaluation failure and makes a bounded,
    idempotent recovery pass possible without touching pre-rollout games.
    """

    __tablename__ = "zilch_achievement_evaluations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    game_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    game_type: Mapped[str] = mapped_column(String(16), nullable=False, default="zilch")
    result_schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    ruleset: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    registered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    evaluated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(160), nullable=True)

    __table_args__ = (
        CheckConstraint("game_type = 'zilch'", name="ck_zilch_achievement_evaluations_game_type"),
        CheckConstraint("result_schema_version >= 1", name="ck_zilch_achievement_evaluations_schema"),
        CheckConstraint("status IN ('pending', 'completed')", name="ck_zilch_achievement_evaluations_status"),
        CheckConstraint("attempts >= 0", name="ck_zilch_achievement_evaluations_attempts"),
        Index("ix_zilch_achievement_evaluations_status_registered", "status", "registered_at"),
    )


class ZilchAchievementEvidence(Base):
    """Validated, normalized facts for one human Zilch seat and result.

    The JSON contains only the narrow, server-derived facts the Zilch
    achievement definitions need.  It is written only after the result
    payload has passed the shared Zilch result validator, and is removed when
    its source result is administratively deleted.
    """

    __tablename__ = "zilch_achievement_evidence"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    evaluation_id: Mapped[int] = mapped_column(
        ForeignKey("zilch_achievement_evaluations.id", ondelete="CASCADE"), nullable=False
    )
    source_game_id: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    result_schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    ruleset: Mapped[str] = mapped_column(String(64), nullable=False)
    play_mode: Mapped[str] = mapped_column(String(24), nullable=False)
    facts_json: Mapped[str] = mapped_column(Text, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint("result_schema_version >= 1", name="ck_zilch_achievement_evidence_schema"),
        CheckConstraint(
            "play_mode IN ('multiplayer', 'cpu', 'solo')",
            name="ck_zilch_achievement_evidence_play_mode",
        ),
        UniqueConstraint("evaluation_id", "user_id", name="uq_zilch_achievement_evidence_evaluation_user"),
        Index("ix_zilch_achievement_evidence_user", "user_id"),
        Index("ix_zilch_achievement_evidence_source_game", "source_game_id"),
    )


class ZilchCommunityState(Base):
    """Singleton counter for exactly-once qualified Zilch completions."""

    __tablename__ = "zilch_community_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    qualified_games: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    achievement_catalog_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint("id = 1", name="ck_zilch_community_state_singleton"),
        CheckConstraint("qualified_games >= 0", name="ck_zilch_community_state_games"),
        CheckConstraint(
            "achievement_catalog_version >= 0",
            name="ck_zilch_community_state_catalog_version",
        ),
    )


class ZilchCommunityGame(Base):
    """One qualified result counted once in the monotonic community ledger."""

    __tablename__ = "zilch_community_games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    game_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    counted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint("ordinal >= 1", name="ck_zilch_community_games_ordinal"),
        Index("ix_zilch_community_games_counted", "counted_at"),
    )


class ZilchCommunityParticipant(Base):
    """Durable account participation in one counted community game."""

    __tablename__ = "zilch_community_participants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    game_id: Mapped[str] = mapped_column(
        ForeignKey("zilch_community_games.game_id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    qualified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        UniqueConstraint("game_id", "user_id", name="uq_zilch_community_participant_game_user"),
        Index("ix_zilch_community_participants_user", "user_id"),
    )


class ZilchCommunityMilestone(Base):
    """Immutable record of one globally reached community threshold."""

    __tablename__ = "zilch_community_milestones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    achievement_key: Mapped[str] = mapped_column(String(96), nullable=False, unique=True)
    threshold: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    reached_ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    trigger_game_id: Mapped[str] = mapped_column(
        ForeignKey("zilch_community_games.game_id", ondelete="RESTRICT"), nullable=False
    )
    reached_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint("threshold >= 1", name="ck_zilch_community_milestones_threshold"),
        CheckConstraint("reached_ordinal = threshold", name="ck_zilch_community_milestones_ordinal"),
        Index("ix_zilch_community_milestones_reached", "reached_at"),
    )


class ZilchCommunityRecipient(Base):
    """Frozen account eligibility at the instant a community goal is reached."""

    __tablename__ = "zilch_community_recipients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    milestone_id: Mapped[int] = mapped_column(
        ForeignKey("zilch_community_milestones.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    awarded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        UniqueConstraint("milestone_id", "user_id", name="uq_zilch_community_recipient"),
        Index("ix_zilch_community_recipients_user", "user_id"),
    )


class ZilchAchievementUnlock(Base):
    """One namespaced Zilch achievement and its auditable source per account."""

    __tablename__ = "zilch_achievement_unlocks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    achievement_key: Mapped[str] = mapped_column(String(96), nullable=False)
    definition_version: Mapped[int] = mapped_column(Integer, nullable=False)
    source_evidence_id: Mapped[int | None] = mapped_column(
        ForeignKey("zilch_achievement_evidence.id", ondelete="SET NULL"), nullable=True
    )
    source_community_recipient_id: Mapped[int | None] = mapped_column(
        ForeignKey("zilch_community_recipients.id", ondelete="SET NULL"), nullable=True
    )
    source_game_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # The first supporting evidence can predate the game that actually
    # completed an aggregate award. Keep that proof source separate from the
    # table where the award was presented, so a finished-game report can tell
    # the story truthfully without exposing private evidence identifiers.
    presentation_game_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    unlocked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint("definition_version >= 1", name="ck_zilch_achievement_unlocks_definition"),
        UniqueConstraint("user_id", "achievement_key", name="uq_zilch_achievement_unlock_user_key"),
        Index("ix_zilch_achievement_unlocks_user", "user_id"),
        Index("ix_zilch_achievement_unlocks_community_source", "source_community_recipient_id"),
        Index("ix_zilch_achievement_unlocks_presentation_game", "presentation_game_id"),
    )


class ZilchAchievementDelivery(Base):
    """Reload-safe presentation state for a newly unlocked Zilch award."""

    __tablename__ = "zilch_achievement_deliveries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    unlock_id: Mapped[int] = mapped_column(
        ForeignKey("zilch_achievement_unlocks.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    queued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (Index("ix_zilch_achievement_deliveries_pending", "acknowledged_at", "queued_at"),)


class ZilchAchievementRankDelivery(Base):
    """Reload-safe presentation state for one account's latest Zilch rank-up.

    Unlike an individual award delivery, an account only needs to see its most
    recent upward rank transition.  A later transition replaces this row and
    clears its acknowledgement, while the source unlock remains available for
    a terminal-game presentation when it still exists.
    """

    __tablename__ = "zilch_achievement_rank_deliveries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    source_unlock_id: Mapped[int | None] = mapped_column(
        ForeignKey("zilch_achievement_unlocks.id", ondelete="SET NULL"), nullable=True
    )
    previous_rank_key: Mapped[str] = mapped_column(String(32), nullable=False)
    rank_key: Mapped[str] = mapped_column(String(32), nullable=False)
    previous_points: Mapped[int] = mapped_column(Integer, nullable=False)
    points: Mapped[int] = mapped_column(Integer, nullable=False)
    queued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("previous_points >= 0", name="ck_zilch_rank_delivery_previous_points"),
        CheckConstraint("points >= 0", name="ck_zilch_rank_delivery_points"),
        Index("ix_zilch_rank_deliveries_pending", "acknowledged_at", "queued_at"),
    )


class ZilchAchievementRankMoment(Base):
    """One durable, result-scoped Zilch rank transition.

    A delivery is intentionally only the latest, acknowledgeable celebration
    for an account. A finished-game report instead needs an immutable answer
    to what happened at that table, even after later rank-ups replace the
    delivery. This narrow event has no profile or evidence payload.
    """

    __tablename__ = "zilch_achievement_rank_moments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    game_id: Mapped[str] = mapped_column(
        ForeignKey("zilch_achievement_evaluations.game_id", ondelete="CASCADE"), nullable=False
    )
    previous_rank_key: Mapped[str] = mapped_column(String(32), nullable=False)
    rank_key: Mapped[str] = mapped_column(String(32), nullable=False)
    previous_points: Mapped[int] = mapped_column(Integer, nullable=False)
    points: Mapped[int] = mapped_column(Integer, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint("previous_points >= 0", name="ck_zilch_rank_moment_previous_points"),
        CheckConstraint("points >= 0", name="ck_zilch_rank_moment_points"),
        UniqueConstraint("user_id", "game_id", name="uq_zilch_rank_moment_user_game"),
        Index("ix_zilch_rank_moments_game", "game_id", "recorded_at"),
    )
