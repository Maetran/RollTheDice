"""Private HTTP and deletion contracts for isolated Zilch awards.

These tests deliberately exercise the completed-result boundary instead of
fabricating an unlock in the browser.  They protect the three boundaries that
are easy to accidentally blur with the established ZDWA achievement system:

* the session identity is the only achievement recipient;
* acknowledgement is a CSRF-protected, idempotent delivery action; and
* deleting a typed Zilch result revokes its Zilch award without triggering a
  ZDWA achievement rebuild.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import httpx
from sqlalchemy import select
from starlette.requests import Request

from app import main
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.models import ZilchAchievementEvidence, ZilchAchievementUnlock
from app.zilch_achievements import (
    ZILCH_ACHIEVEMENTS,
    zilch_achievement_points_for_keys,
    zilch_achievement_rank_for_points,
)
from app.zilch_results import finalize_zilch_result
from app.zilch_state import (
    configure_zilch_cpu_game,
    finish_zilch_game,
    join_zilch_player,
    new_zilch_game,
    record_zilch_start_roll,
    start_zilch_game,
)


def request_for(*, cookie: str = "") -> Request:
    headers = [(b"host", b"testserver")]
    if cookie:
        headers.append((b"cookie", cookie.encode("ascii")))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": "http",
            "path": "/",
            "headers": headers,
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 80),
        }
    )


class ZilchAchievementApiTestCase(TestCase):
    """The private Zilch API never accepts an account identity from clients."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "zilch-achievement-api.sqlite3"
        self.environment = patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.database_path}",
                "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
                "ROLLTHEDICE_TURNSTILE_SECRET": "",
                "ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "",
            },
        )
        self.environment.start()
        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)
        self.sequence = 0

    def tearDown(self) -> None:
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.temporary_directory.cleanup()

    @staticmethod
    def _request(
        method: str,
        path: str,
        *,
        token: str | None = None,
        csrf: str | None = None,
        body: dict | None = None,
    ) -> httpx.Response:
        async def request() -> httpx.Response:
            transport = httpx.ASGITransport(app=main.app)
            headers = {"x-csrf-token": csrf} if csrf else None
            cookies = {"rollthedice_session": token} if token else None
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://testserver",
                cookies=cookies,
            ) as client:
                return await client.request(method, path, headers=headers, json=body)

        return asyncio.run(request())

    @staticmethod
    def _identity(username: str, *, role: str = "user") -> tuple[object, str, str]:
        password = f"{username}-secure-password-123"
        user = create_user(username, password, role=role, must_change_password=False)
        identity, token = login(request_for(), username, password)
        return user, token, identity.csrf_token

    @staticmethod
    def _bank_round(*, turn: int, points: int, total_after: int) -> dict:
        return {
            "turn_id": turn,
            "round": turn,
            "event": "bank",
            "points": points,
            "total_after": total_after,
            "rolls_used": 1,
            "committed_holds": [],
        }

    def _persist_cpu_win(self, human) -> str:
        """Persist an authoritative CPU game, not a fabricated award row."""
        self.sequence += 1
        game_id = f"achievement-cpu-{self.sequence}"
        game = new_zilch_game(game_id, "Achievement fixture", 2)
        cpu = configure_zilch_cpu_game(game, host_user_id=human.id, cpu_strategy="normal")
        human_id = "human"
        cpu_id = str(cpu["id"])
        join_zilch_player(game, {"id": human_id, "name": human.username, "user_id": human.id, "ws": None})
        start_zilch_game(game)
        record_zilch_start_roll(game, human_id, 6)
        record_zilch_start_roll(game, cpu_id, 2)

        started_at = datetime(2026, 9, 3, 12, 0, tzinfo=timezone.utc) + timedelta(hours=self.sequence)
        finished_at = started_at + timedelta(minutes=5)
        game["_started_at"] = started_at.isoformat()
        game["_finished_at"] = finished_at.isoformat()
        game["_total_points"] = {human_id: 10_000, cpu_id: 9_000}
        game["_round_points"] = {human_id: 0, cpu_id: 0}
        game["_zilch_zilch_streaks"] = {human_id: 0, cpu_id: 0}
        game["_zilch_boards"] = {
            human_id: {
                "player_id": human_id,
                "round_points": 0,
                "total_points": 10_000,
                "zilch_streak": 0,
                "rounds": [self._bank_round(turn=1, points=10_000, total_after=10_000)],
            },
            cpu_id: {
                "player_id": cpu_id,
                "round_points": 0,
                "total_points": 9_000,
                "zilch_streak": 0,
                "rounds": [self._bank_round(turn=2, points=9_000, total_after=9_000)],
            },
        }
        finish_zilch_game(game)
        result = finalize_zilch_result(game)
        self.assertTrue(result["result_persisted"])
        return game_id

    def test_achievement_apis_enforce_preview_policy_and_ignore_client_user_id(self) -> None:
        mani, mani_token, _mani_csrf = self._identity("Mani", role="admin")
        other, other_token, _other_csrf = self._identity("Other")
        endpoints = (
            "/api/zilch/achievements?user_id=999999",
            "/api/zilch/achievements/pending?user_id=999999",
            "/api/zilch/achievement-ranks",
        )

        for endpoint in endpoints:
            with self.subTest(endpoint=endpoint, identity="anonymous"):
                self.assertEqual(self._request("GET", endpoint).status_code, 401)
            with self.subTest(endpoint=endpoint, identity="non-preview"):
                self.assertEqual(self._request("GET", endpoint, token=other_token).status_code, 403)
            with self.subTest(endpoint=endpoint, identity="preview"):
                response = self._request("GET", endpoint, token=mani_token)
                self.assertEqual(response.status_code, 200)
                self.assertIn("no-store", response.headers.get("cache-control", ""))

        sentinel = {"version": 1, "categories": [], "unlocked": [], "locked": []}
        with patch("app.main.get_zilch_achievement_profile", return_value=sentinel) as profile:
            response = self._request("GET", f"/api/zilch/achievements?user_id={other.id}", token=mani_token)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), sentinel)
        profile.assert_called_once_with(mani.id)

        rank_sentinel = {
            "version": 2,
            "points_possible": 42,
            "ranks": [{"key": "newbie", "minimum_points": 0}],
        }
        with patch(
            "app.main.zilch_achievement_rank_legend_payload",
            return_value=rank_sentinel,
        ) as rank_legend:
            response = self._request("GET", "/api/zilch/achievement-ranks", token=mani_token)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), rank_sentinel)
        rank_legend.assert_called_once_with()

    def test_acknowledgement_is_csrf_protected_idempotent_and_owned_by_the_session_user(self) -> None:
        mani, mani_token, mani_csrf = self._identity("Mani", role="admin")
        _other, other_token, other_csrf = self._identity("PreviewFriend")
        game_id = self._persist_cpu_win(mani)

        pending = self._request("GET", "/api/zilch/achievements/pending", token=mani_token)
        self.assertEqual(pending.status_code, 200)
        self.assertIn("zilch.first_game", {award["key"] for award in pending.json()["awards"]})
        self.assertEqual(
            {award["source_game_id"] for award in pending.json()["awards"]},
            {game_id},
        )
        self.assertEqual(
            {award["presentation_game_id"] for award in pending.json()["awards"]},
            {game_id},
        )

        acknowledgement_path = "/api/zilch/achievements/zilch.first_game/acknowledge"
        self.assertEqual(self._request("POST", acknowledgement_path, token=mani_token).status_code, 403)
        self.assertEqual(
            self._request("POST", acknowledgement_path, token=mani_token, csrf="wrong-token").status_code,
            403,
        )
        acknowledged = self._request("POST", acknowledgement_path, token=mani_token, csrf=mani_csrf)
        self.assertEqual(acknowledged.status_code, 200)
        self.assertEqual(acknowledged.json()["key"], "zilch.first_game")
        self.assertIsNotNone(acknowledged.json()["acknowledged_at"])
        repeated = self._request("POST", acknowledgement_path, token=mani_token, csrf=mani_csrf)
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(repeated.json(), acknowledged.json())
        self.assertNotIn(
            "zilch.first_game",
            {award["key"] for award in self._request("GET", "/api/zilch/achievements/pending", token=mani_token).json()["awards"]},
        )

        # A valid CSRF token for another *preview* session cannot acknowledge
        # Mani's delivery.  There is deliberately no client-supplied user id
        # in this route, and PreviewFriend owns no matching unlock.
        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "previewfriend"}):
            other_attempt = self._request("POST", acknowledgement_path, token=other_token, csrf=other_csrf)
        self.assertEqual(other_attempt.status_code, 404)

    def test_rank_upgrade_acknowledgement_is_csrf_protected_and_retroactive(self) -> None:
        mani, mani_token, mani_csrf = self._identity("Mani", role="admin")
        _other, other_token, other_csrf = self._identity("PreviewFriend")
        keys: set[str] = set()
        previous = zilch_achievement_rank_for_points(0)
        transition = None
        with session_scope() as db:
            for index, definition in enumerate(
                (definition for definition in ZILCH_ACHIEVEMENTS if definition.points > 0),
                start=1,
            ):
                keys.add(definition.key)
                current = zilch_achievement_rank_for_points(zilch_achievement_points_for_keys(keys))
                db.add(
                    ZilchAchievementUnlock(
                        user_id=mani.id,
                        achievement_key=definition.key,
                        definition_version=definition.definition_version,
                        source_evidence_id=None,
                        source_community_recipient_id=None,
                        source_game_id=f"retro-rank-api-{index}",
                        unlocked_at=datetime(2026, 9, 5, 12, 0, tzinfo=timezone.utc) + timedelta(minutes=index),
                    )
                )
                if current["key"] != previous["key"]:
                    transition = (index, previous, current)
                    break
                previous = current
        self.assertIsNotNone(transition)
        assert transition is not None

        pending = self._request("GET", "/api/zilch/achievements/pending", token=mani_token)
        self.assertEqual(pending.status_code, 200)
        card = pending.json()["rank_upgrade"]
        self.assertEqual(card["previous"]["key"], transition[1]["key"])
        self.assertEqual(card["current"]["key"], transition[2]["key"])
        self.assertEqual(card["source_game_id"], f"retro-rank-api-{transition[0]}")

        acknowledgement_path = "/api/zilch/achievement-rank/acknowledge"
        self.assertEqual(self._request("POST", acknowledgement_path, token=mani_token).status_code, 403)
        self.assertEqual(
            self._request("POST", acknowledgement_path, token=mani_token, csrf="wrong-token").status_code,
            403,
        )
        acknowledged = self._request("POST", acknowledgement_path, token=mani_token, csrf=mani_csrf)
        self.assertEqual(acknowledged.status_code, 200)
        self.assertEqual(acknowledged.json()["rank_key"], transition[2]["key"])
        self.assertIsNotNone(acknowledged.json()["acknowledged_at"])
        repeated = self._request("POST", acknowledgement_path, token=mani_token, csrf=mani_csrf)
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(repeated.json(), acknowledged.json())
        self.assertIsNone(
            self._request("GET", "/api/zilch/achievements/pending", token=mani_token).json()["rank_upgrade"]
        )

        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "previewfriend"}):
            other_attempt = self._request("POST", acknowledgement_path, token=other_token, csrf=other_csrf)
        self.assertEqual(other_attempt.status_code, 404)

    def test_public_player_profile_keeps_award_provenance_private(self) -> None:
        mani, _mani_token, _mani_csrf = self._identity("Mani", role="admin")
        game_id = self._persist_cpu_win(mani)

        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_ACCESS_MODE": "public"}):
            profile = self._request("GET", "/api/zilch/players/Mani/achievements")
            self.assertEqual(profile.status_code, 200)
            payload = profile.json()
            self.assertEqual(payload["player"], {"username": "Mani"})
            self.assertTrue(payload["unlocked"])
            self.assertEqual(self._request("GET", "/api/zilch/achievements").status_code, 401)

        for award in payload["unlocked"] + payload["locked"]:
            self.assertNotIn("source_game_id", award)
            self.assertNotIn("presentation_game_id", award)
            self.assertNotIn("source_evidence_id", award)
            self.assertNotIn("queued_at", award)
            self.assertNotIn("acknowledged_at", award)
        self.assertNotIn(game_id, repr(payload))

    def test_cpu_has_no_award_recipient_and_deletion_revokes_zilch_without_zdwa_sync(self) -> None:
        mani, mani_token, mani_csrf = self._identity("Mani", role="admin")
        game_id = self._persist_cpu_win(mani)

        with session_scope() as db:
            evidence = list(db.scalars(select(ZilchAchievementEvidence).where(ZilchAchievementEvidence.source_game_id == game_id)))
            unlocks = list(db.scalars(select(ZilchAchievementUnlock).where(ZilchAchievementUnlock.user_id == mani.id)))
        self.assertEqual({row.user_id for row in evidence}, {mani.id})
        self.assertTrue(unlocks)
        self.assertNotIn(None, {row.user_id for row in unlocks})

        with patch("app.main.sync_achievements_for_users") as zdwa_sync:
            response = self._request(
                "DELETE",
                f"/api/admin/completed-games/{game_id}",
                token=mani_token,
                csrf=mani_csrf,
                body={
                    "confirmation_game_id": game_id,
                    "reason": "Revoke private Zilch achievement evidence",
                },
            )
        self.assertEqual(response.status_code, 200)
        zdwa_sync.assert_not_called()

        profile = self._request("GET", "/api/zilch/achievements", token=mani_token)
        self.assertEqual(profile.status_code, 200)
        self.assertFalse(profile.json()["unlocked"])
        with session_scope() as db:
            self.assertFalse(
                list(db.scalars(select(ZilchAchievementEvidence).where(ZilchAchievementEvidence.source_game_id == game_id)))
            )
            self.assertFalse(list(db.scalars(select(ZilchAchievementUnlock).where(ZilchAchievementUnlock.user_id == mani.id))))
