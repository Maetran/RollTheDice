"""Public abandonment rankings must identify initiators, never their opponents."""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import main
from app.abandonment_leaderboard import abandonment_leaderboard
from app.auth import create_user, issue_session_for_user
from app.database import configure_database, session_scope, upgrade_database
from app.leaderboard_storage import LeaderboardFiles
from app.models import AbandonedGame, AbandonedGameParticipant, User

NOW = datetime(2026, 9, 12, 14, 37, 19, 125000, tzinfo=timezone.utc)


class AbandonmentLeaderboardTestCase(TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.environment = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.root / 'rankings.sqlite3'}",
        })
        self.environment.start()
        configure_database(self.root)
        upgrade_database(main.BASE)
        self.game_sequence = 0

    def tearDown(self):
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.directory.cleanup()

    def _user(self, username):
        return create_user(username, "secure-test-password-123", must_change_password=False)

    def _game(self, user_id, *, at=NOW, reason="manual", game_type="zdwa", mode="2", hardcore=False, opponents=()):
        self.game_sequence += 1
        with session_scope() as db:
            game = AbandonedGame(
                game_id=f"abandonment-ranking-{self.game_sequence}",
                game_name="Private room title that must never be published",
                game_type=game_type, mode=mode, hardcore=hardcore,
                started_at=at - timedelta(hours=1), abandoned_at=at,
                reason=reason, aborted_by_user_id=user_id, created_at=at,
            )
            db.add(game)
            db.flush()
            for opponent_id in opponents:
                # Even a contradictory legacy participant flag must not
                # override the authoritative initiator column.
                db.add(AbandonedGameParticipant(
                    abandoned_game_id=game.id, user_id=opponent_id, was_abort_initiator=True,
                ))

    @staticmethod
    def _entry(user, count, rank=1):
        return {"rank": rank, "user_id": user.id, "username": user.username, "count": count}

    def test_empty_history_and_unavailable_schema_return_two_empty_lists(self):
        expected = {"recent": [], "alltime": []}
        self.assertEqual(abandonment_leaderboard(now=NOW), expected)
        owner = self._user("EmptyThenOne")
        self._game(owner.id)
        with (
            patch("app.abandonment_leaderboard.database_schema_ready", return_value=False),
            patch("app.abandonment_leaderboard.session_scope") as database,
        ):
            self.assertEqual(abandonment_leaderboard(now=NOW), expected)
            database.assert_not_called()

    def test_recent_window_has_inclusive_utc_boundaries_and_excludes_future_rows(self):
        owner = self._user("BoundaryPlayer")
        cutoff = NOW - timedelta(days=10)
        for at in (cutoff - timedelta(microseconds=1), cutoff, NOW, NOW + timedelta(microseconds=1)):
            self._game(owner.id, at=at)
        # A caller's timezone cannot change the rolling ten-day UTC interval.
        local_now = NOW.astimezone(timezone(timedelta(hours=2)))
        self.assertEqual(abandonment_leaderboard(now=local_now), {
            "recent": [self._entry(owner, 2)],
            "alltime": [self._entry(owner, 3)],
        })

    def test_only_manual_zdwa_initiators_count_across_all_modes_and_difficulties(self):
        owner = self._user("Initiator")
        opponent = self._user("InnocentOpponent")
        for mode, hardcore in (("1", False), ("2", True), ("2v2", True)):
            self._game(owner.id, mode=mode, hardcore=hardcore, opponents=(opponent.id,))
        for _ in range(4):
            self._game(opponent.id, reason="inactivity_timeout")
            self._game(opponent.id, game_type="zilch")
            # Guests, CPU/unknown initiators and free room labels provide no
            # account ownership, even if account participants are present.
            self._game(None, opponents=(opponent.id,))
        expected = [self._entry(owner, 3)]
        self.assertEqual(abandonment_leaderboard(now=NOW), {"recent": expected, "alltime": expected})

    def test_renamed_account_keeps_counts_when_another_user_takes_the_freed_name(self):
        original = self._user("FreedName")
        self._game(original.id)
        self._game(original.id)
        with session_scope() as db:
            user = db.get(User, original.id)
            user.username = "CurrentName"
            user.username_normalized = "currentname"
        original.username = "CurrentName"
        replacement = self._user("FreedName")
        self._game(replacement.id)
        expected = [self._entry(original, 2), self._entry(replacement, 1, rank=2)]
        self.assertEqual(abandonment_leaderboard(now=NOW), {"recent": expected, "alltime": expected})

    def test_inactive_and_deleted_accounts_are_excluded(self):
        active = self._user("ActivePlayer")
        inactive = self._user("InactivePlayer")
        deleted = self._user("DeletedPlayer")
        self._game(active.id)
        for _ in range(4):
            self._game(inactive.id)
            self._game(deleted.id)
        with session_scope() as db:
            db.get(User, inactive.id).is_active = False
            db.delete(db.get(User, deleted.id))
        expected = [self._entry(active, 1)]
        self.assertEqual(abandonment_leaderboard(now=NOW), {"recent": expected, "alltime": expected})

    def test_each_period_selects_at_most_three_accounts_with_stable_competition_ranks(self):
        first, second, third, fourth = [self._user(f"RankPlayer{number}") for number in range(4)]
        for user, count in ((first, 5), (second, 5), (third, 3), (fourth, 3)):
            for _ in range(count):
                self._game(user.id)
        for _ in range(8):
            self._game(fourth.id, at=NOW - timedelta(days=11))
        expected = {
            "recent": [self._entry(first, 5), self._entry(second, 5), self._entry(third, 3, rank=3)],
            "alltime": [self._entry(fourth, 11), self._entry(first, 5, rank=2), self._entry(second, 5, rank=2)],
        }
        self.assertEqual(abandonment_leaderboard(now=NOW), expected)
        self.assertEqual(abandonment_leaderboard(now=NOW), expected)

    def test_public_api_exposes_only_bounded_account_counts_to_guests_and_signed_in_visitors(self):
        owner = self._user("PublicPlayer")
        other = self._user("DifferentViewer")
        self._game(owner.id)
        with session_scope() as db:
            user = db.get(User, owner.id)
            user.email = "private-mailbox@example.test"
            user.email_normalized = user.email
            user.webauthn_user_handle = b"private-passkey-handle"
            _, raw_session = issue_session_for_user(db, db.get(User, other.id))
        expected_rows = [self._entry(owner, 1)]
        client = TestClient(main.app)
        try:
            with (
                patch.object(main, "LEADERBOARD_FILES", LeaderboardFiles.in_directory(self.root)),
                patch("app.leaderboard_service.datetime", wraps=datetime) as clock,
            ):
                clock.now.return_value = NOW
                guest = client.get(f"/api/leaderboard?game_type=zilch&user_id={other.id}")
                self.assertEqual(guest.status_code, 200, guest.text)
                self.assertEqual(guest.json()["abandonments"], {"recent": expected_rows, "alltime": expected_rows})
                client.cookies.set("rollthedice_session", raw_session)
                signed_in = client.get("/api/leaderboard")
                self.assertEqual(signed_in.status_code, 200, signed_in.text)
                self.assertEqual(signed_in.json()["abandonments"], guest.json()["abandonments"])
                for response in (guest, signed_in):
                    for entries in response.json()["abandonments"].values():
                        for row in entries:
                            self.assertEqual(set(row), {"rank", "user_id", "username", "count"})
                    for private_value in ("private-mailbox", "private-passkey", "Private room title", "password_hash", "csrf_token"):
                        self.assertNotIn(private_value, response.text)
        finally:
            client.close()
