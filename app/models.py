from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, validates

from .game_types import DEFAULT_GAME_TYPE, normalize_game_type


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(32), nullable=False)
    username_normalized: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    # Email addresses are private account recovery data.  They are intentionally
    # absent from public player projections and may stay unset for legacy users.
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    email_normalized: Mapped[str | None] = mapped_column(String(254), nullable=True, unique=True)
    email_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # A random WebAuthn user handle is deliberately distinct from a public
    # username or recovery email. It remains stable across account renames.
    webauthn_user_handle: Mapped[bytes | None] = mapped_column(LargeBinary(32), nullable=True, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    announce_selection_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="overlay")
    auto_write_announced: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    mobile_row_quick_entry: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    haptic_feedback: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    keep_screen_awake: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    lobby_chat_popups: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    lobby_chat_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    lobby_chat_muted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    lobby_chat_excluded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    friend_activity_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    game_invite_push_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    game_invite_push_last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # A gentle, account-wide reminder to review optional Push settings.  This
    # is deliberately separate from delivery claims: it never authorizes a
    # notification and only limits how often the lobby may invite a player to
    # make an informed choice.
    push_opt_in_prompted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    daily_reminder_push_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    release_push_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    game_invite_push_audience: Mapped[str] = mapped_column(String(16), nullable=False, default="all")
    daily_reminder_push_last_sent_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    daily_reminder_push_sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_played_on: Mapped[date | None] = mapped_column(Date, nullable=True)
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
    # Shared ZDWA/Zilch activity goals have their own rollout boundary.  This
    # keeps freshly introduced cross-game badges from reinterpreting old or
    # imported history as a new player achievement.
    achievement_cross_game_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    sessions: Mapped[list[Session]] = relationship(back_populates="user", cascade="all, delete-orphan")
    participations: Mapped[list[GameParticipant]] = relationship(
        back_populates="user", foreign_keys="GameParticipant.user_id"
    )
    achievements: Mapped[list[UserAchievement]] = relationship(back_populates="user", cascade="all, delete-orphan")
    web_push_subscriptions: Mapped[list[WebPushSubscription]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    passkey_credentials: Mapped[list[PasskeyCredential]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class UserAvatar(Base):
    """Only a sanitized, bounded WebP; original uploads are never persisted."""

    __tablename__ = "user_avatars"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (CheckConstraint("length(data) BETWEEN 1 AND 65536", name="ck_user_avatar_size"),)


class UserEngagementEvent(Base):
    """One durable, explicit post-rollout account interaction.

    Keeping interactions separate from game history makes these awards
    non-retroactive. The only exception is the one-time ``avatar_set`` repair
    for an already persisted current avatar, whose durable timestamp is a
    stronger source than a browser click.
    """

    __tablename__ = "user_engagement_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    event_key: Mapped[str] = mapped_column(String(64), nullable=False)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    __table_args__ = (
        UniqueConstraint("user_id", "event_key", name="uq_user_engagement_event"),
        Index("ix_user_engagement_events_user", "user_id"),
    )


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


class PasskeyCredential(Base):
    """One server-side half of a WebAuthn credential.

    Only the public credential material belongs here. The authenticator keeps
    the private key, while browser-provided device hints stay optional and are
    never used as an authorization decision.
    """

    __tablename__ = "passkey_credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    credential_id: Mapped[bytes] = mapped_column(LargeBinary(1024), nullable=False)
    credential_public_key: Mapped[bytes] = mapped_column(LargeBinary(8192), nullable=False)
    sign_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    device_type: Mapped[str] = mapped_column(String(24), nullable=False, default="single_device")
    backed_up: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # A friendly device name is optional and only supplied deliberately by the
    # account holder. Browser transport hints are not persisted.
    label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="passkey_credentials")

    __table_args__ = (
        UniqueConstraint("credential_id", name="uq_passkey_credentials_credential_id"),
        CheckConstraint("length(credential_id) BETWEEN 1 AND 1024", name="ck_passkey_credentials_id_size"),
        CheckConstraint(
            "length(credential_public_key) BETWEEN 1 AND 8192",
            name="ck_passkey_credentials_public_key_size",
        ),
        CheckConstraint("sign_count >= 0", name="ck_passkey_credentials_sign_count"),
        Index("ix_passkey_credentials_user_last_used", "user_id", "last_used_at"),
    )


class WebAuthnCeremony(Base):
    """Short-lived, one-time server state for a WebAuthn ceremony.

    The state cookie is opaque and stored only as a hash. The raw challenge is
    intentionally retained for a few minutes because the verifier must compare
    it byte-for-byte with the signed client data.
    """

    __tablename__ = "webauthn_ceremonies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    state_token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    purpose: Mapped[str] = mapped_column(String(16), nullable=False)
    challenge: Mapped[bytes] = mapped_column(LargeBinary(64), nullable=False)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    session_id: Mapped[int | None] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "purpose IN ('registration', 'authentication')",
            name="ck_webauthn_ceremonies_purpose",
        ),
        CheckConstraint(
            "(purpose = 'registration' AND user_id IS NOT NULL AND session_id IS NOT NULL) "
            "OR (purpose = 'authentication' AND user_id IS NULL AND session_id IS NULL)",
            name="ck_webauthn_ceremonies_subject",
        ),
        CheckConstraint("length(challenge) BETWEEN 32 AND 64", name="ck_webauthn_ceremonies_challenge_size"),
        Index("ix_webauthn_ceremonies_expires", "expires_at"),
    )


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


class PendingEmailRegistration(Base):
    """A non-loginable account request that expires unless its email is confirmed."""

    __tablename__ = "pending_email_registrations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(32), nullable=False)
    username_normalized: Mapped[str] = mapped_column(String(32), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    email_normalized: Mapped[str] = mapped_column(String(254), nullable=False)
    preferred_language: Mapped[str] = mapped_column(String(2), nullable=False, default="de")
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("preferred_language IN ('de', 'en')", name="ck_pending_email_registration_language"),
        Index("ix_pending_email_registrations_expires", "expires_at"),
    )


class AccountEmailToken(Base):
    """One-time actions for a confirmed account email or password reset."""

    __tablename__ = "account_email_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    purpose: Mapped[str] = mapped_column(String(24), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    email_normalized: Mapped[str] = mapped_column(String(254), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("purpose IN ('email_verify', 'password_reset')", name="ck_account_email_token_purpose"),
        Index("ix_account_email_tokens_user_purpose", "user_id", "purpose", "expires_at"),
        Index("ix_account_email_tokens_expires", "expires_at"),
    )


class LobbyChatMessage(Base):
    """A short-lived lobby-chat event with a fixed authorized audience."""

    __tablename__ = "lobby_chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    sender_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    sender_username: Mapped[str] = mapped_column(String(32), nullable=False)
    game_type: Mapped[str] = mapped_column(String(16), nullable=False, default=DEFAULT_GAME_TYPE)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint("kind IN ('message', 'presence')", name="ck_lobby_chat_messages_kind"),
        CheckConstraint("game_type IN ('zdwa', 'zilch')", name="ck_lobby_chat_messages_game_type"),
        Index("ix_lobby_chat_messages_created_at", "created_at"),
    )


class LobbyChatMessageRecipient(Base):
    """An account that was eligible to receive a lobby-chat event when sent."""

    __tablename__ = "lobby_chat_message_recipients"

    message_id: Mapped[int] = mapped_column(
        ForeignKey("lobby_chat_messages.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)

    __table_args__ = (Index("ix_lobby_chat_recipients_user_message", "user_id", "message_id"),)


class WebPushSubscription(Base):
    """A browser-owned endpoint authorized by one signed-in account."""

    __tablename__ = "web_push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    p256dh: Mapped[str] = mapped_column(String(256), nullable=False)
    auth: Mapped[str] = mapped_column(String(128), nullable=False)
    product_context: Mapped[str] = mapped_column(String(16), nullable=False, default=DEFAULT_GAME_TYPE)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped[User] = relationship(back_populates="web_push_subscriptions")

    __table_args__ = (
        CheckConstraint(
            "product_context IN ('zdwa', 'zilch')",
            name="ck_web_push_subscriptions_product_context",
        ),
        Index("ix_web_push_subscriptions_user", "user_id"),
    )


class PushInviteAllowedSender(Base):
    """A private, directed allowlist; never a public friendship relationship."""

    __tablename__ = "push_invite_allowed_senders"
    recipient_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    sender_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (CheckConstraint("recipient_user_id != sender_user_id", name="ck_push_allowlist_not_self"),)


class PushRelease(Base):
    """Immutable successful deployment and its bilingual announcement."""

    __tablename__ = "push_releases"
    revision: Mapped[str] = mapped_column(String(40), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    summary_de: Mapped[str] = mapped_column(String(140), nullable=False)
    summary_en: Mapped[str] = mapped_column(String(140), nullable=False)
    game_types_json: Mapped[str] = mapped_column(Text, nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    player_notes_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (CheckConstraint("kind IN ('backend', 'usability')", name="ck_push_release_kind"),)


class ReleaseAcknowledgement(Base):
    """Account-wide acknowledgement, independent of push subscriptions."""

    __tablename__ = "release_acknowledgements"
    revision: Mapped[str] = mapped_column(ForeignKey("push_releases.revision", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    acknowledged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PushReleaseRecipient(Base):
    """Frozen release audience with a durable, at-most-once dispatch claim."""

    __tablename__ = "push_release_recipients"
    revision: Mapped[str] = mapped_column(ForeignKey("push_releases.revision", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    product_context: Mapped[str] = mapped_column(String(16), nullable=False)
    subscription_snapshot_json: Mapped[str] = mapped_column(Text, nullable=False)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("product_context IN ('zdwa', 'zilch')", name="ck_push_release_recipient_context"),
        Index("ix_push_release_pending", "claimed_at", "revision"),
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


class AbandonedGame(Base):
    """Minimal, account-safe record for a started game that was abandoned.

    This is deliberately separate from ``CompletedGame``.  It provides the
    source for aggregate abandonment statistics without making an interrupted
    game eligible for completed-game rankings, achievements, or result pages.
    No live snapshot is retained here.
    """

    __tablename__ = "abandoned_games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    game_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    game_type: Mapped[str] = mapped_column(String(16), nullable=False, default=DEFAULT_GAME_TYPE)
    game_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    hardcore: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    abandoned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    aborted_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    participants: Mapped[list[AbandonedGameParticipant]] = relationship(
        back_populates="game", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint("game_type IN ('zdwa', 'zilch')", name="ck_abandoned_games_game_type"),
        CheckConstraint(
            "reason IN ('manual', 'inactivity_timeout')",
            name="ck_abandoned_games_reason",
        ),
        Index("ix_abandoned_games_game_type_abandoned_at", "game_type", "abandoned_at"),
        Index("ix_abandoned_games_abandoned_at", "abandoned_at"),
    )

    @validates("game_type")
    def _validate_game_type(self, _key: str, value: object) -> str:
        """Keep abandoned-game writers on the shared type contract."""
        try:
            return normalize_game_type(value)
        except ValueError as exc:
            raise ValueError("invalid_game_type") from exc


class AbandonedGameParticipant(Base):
    """One account associated with an abandoned game, at most once per game.

    Guests and CPU seats are intentionally not represented.  The relational
    association is enough for aggregate profile counts and avoids keeping an
    interrupted game's names, scores, chat, or board state.
    """

    __tablename__ = "abandoned_game_participants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    abandoned_game_id: Mapped[int] = mapped_column(
        ForeignKey("abandoned_games.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    was_abort_initiator: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    game: Mapped[AbandonedGame] = relationship(back_populates="participants")

    __table_args__ = (
        UniqueConstraint("abandoned_game_id", "user_id", name="uq_abandoned_game_participant_user"),
        Index("ix_abandoned_game_participants_user", "user_id"),
    )


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
    # Only already-existing Styler awards are preserved when replacing the
    # ambiguous score-based rule. New awards must retain real dice evidence.
    legacy_styler: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
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
