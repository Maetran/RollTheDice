from __future__ import annotations

import asyncio
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import httpx
from sqlalchemy import delete, inspect
from starlette.requests import Request

from app import main
from app.achievement_feed import (
    ACHIEVEMENT_FEED_PAGE_SIZE,
    ZDWA_ACHIEVEMENT_DIFFICULTIES,
    ZDWA_FEED_DEFINITIONS,
    ZILCH_ACHIEVEMENT_DIFFICULTIES,
    ZILCH_FEED_DEFINITIONS,
)
from app.achievements import ACHIEVEMENTS
from app.auth import create_user, login
from app.database import configure_database, get_engine, session_scope, upgrade_database
from app.game_types import DEFAULT_GAME_TYPE, ZILCH_GAME_TYPE
from app.models import CompletedGame, GameParticipant, User, UserAchievement, ZilchAchievementUnlock
from app.zilch_achievements import ZILCH_ACHIEVEMENTS


def request_for_login() -> Request:
    return Request({
        "type": "http",
        "method": "POST",
        "scheme": "http",
        "path": "/api/auth/login",
        "headers": [(b"host", b"testserver")],
        "client": ("127.0.0.1", 1234),
        "server": ("testserver", 80),
    })


class AchievementFeedTestCase(TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "achievement-feed.sqlite3"
        self.environment = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.database_path}",
            "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
            "ROLLTHEDICE_TURNSTILE_SECRET": "",
            "ROLLTHEDICE_ZILCH_ACCESS_MODE": "public",
            "ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "",
        })
        self.environment.start()
        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)

    def tearDown(self) -> None:
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.temporary_directory.cleanup()

    @staticmethod
    def _request(path: str, *, token: str | None = None) -> httpx.Response:
        async def request() -> httpx.Response:
            transport = httpx.ASGITransport(app=main.app)
            cookies = {"rollthedice_session": token} if token else None
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://testserver",
                cookies=cookies,
            ) as client:
                return await client.get(path)

        return asyncio.run(request())

    @staticmethod
    def _completed_game(
        db,
        game_id: str,
        *,
        game_type: str = DEFAULT_GAME_TYPE,
        finished_at: datetime,
    ) -> CompletedGame:
        game = CompletedGame(
            game_id=game_id,
            game_type=game_type,
            game_name=game_id,
            finished_at=finished_at,
            mode="solo",
            hardcore=False,
            snapshot_json="{}",
            imported_from_legacy=False,
            created_at=finished_at,
        )
        db.add(game)
        db.flush()
        return game

    def test_catalog_classification_is_complete_and_fairplay_reminders_are_excluded(self) -> None:
        fairplay_keys = {
            definition.key
            for definition in ACHIEVEMENTS
            if definition.key.startswith(("manual_solo_aborts_", "manual_multiplayer_aborts_"))
        }
        self.assertTrue(fairplay_keys)
        self.assertEqual(
            set(ZDWA_FEED_DEFINITIONS),
            {definition.key for definition in ACHIEVEMENTS} - fairplay_keys,
        )
        self.assertEqual(set(ZDWA_ACHIEVEMENT_DIFFICULTIES), set(ZDWA_FEED_DEFINITIONS))
        self.assertFalse(fairplay_keys & set(ZDWA_ACHIEVEMENT_DIFFICULTIES))
        self.assertEqual(set(ZILCH_FEED_DEFINITIONS), {definition.key for definition in ZILCH_ACHIEVEMENTS})
        self.assertEqual(set(ZILCH_ACHIEVEMENT_DIFFICULTIES), set(ZILCH_FEED_DEFINITIONS))
        self.assertEqual(
            {
                definition.target: ZILCH_ACHIEVEMENT_DIFFICULTIES[definition.key]
                for definition in ZILCH_ACHIEVEMENTS
                if definition.points == 0
            },
            {
                100: "easy",
                500: "easy",
                1_000: "easy",
                5_000: "medium",
                10_000: "medium",
                25_000: "medium",
                50_000: "hard",
                100_000: "hard",
            },
        )

    def test_migration_creates_feed_order_indexes(self) -> None:
        database = inspect(get_engine())
        self.assertTrue({
            "ix_user_achievements_feed_order",
            "ix_user_achievements_key_feed_order",
        }.issubset({index["name"] for index in database.get_indexes("user_achievements")}))
        self.assertTrue({
            "ix_zilch_achievement_unlocks_feed_order",
            "ix_zilch_achievement_unlocks_key_feed_order",
        }.issubset({index["name"] for index in database.get_indexes("zilch_achievement_unlocks")}))

    def test_zdwa_feed_is_stably_paginated_and_links_only_a_proven_live_source(self) -> None:
        active = create_user("FeedActive", "feed-active-password-123", must_change_password=False)
        inactive = create_user("FeedInactive", "feed-inactive-password-123", must_change_password=False)
        definitions = list(ZDWA_FEED_DEFINITIONS.values())[:25]
        base = datetime(2026, 9, 20, 12, 0, tzinfo=timezone.utc)
        expected_rows: list[tuple[datetime, int, str]] = []
        with session_scope() as db:
            db.execute(delete(UserAchievement).where(UserAchievement.user_id.in_({active.id, inactive.id})))
            db.get(User, inactive.id).is_active = False
            valid_source = self._completed_game(db, "visible-source", finished_at=base)
            db.add(GameParticipant(
                game_id=valid_source.id,
                position=0,
                player_key="active",
                display_name=active.username,
                points=700,
                user_id=active.id,
            ))
            # Multiple historical seats assigned to one account must never
            # duplicate its award or move the pagination boundary.
            db.add(GameParticipant(
                game_id=valid_source.id,
                position=1,
                player_key="active-other-seat",
                display_name=active.username,
                points=650,
                user_id=active.id,
            ))
            wrong_product_source = self._completed_game(
                db,
                "private-zilch-source",
                game_type=ZILCH_GAME_TYPE,
                finished_at=base,
            )
            db.add(GameParticipant(
                game_id=wrong_product_source.id,
                position=0,
                player_key="active-zilch",
                display_name=active.username,
                points=10_000,
                user_id=active.id,
            ))
            other_players_source = self._completed_game(db, "other-player-source", finished_at=base)
            db.add(GameParticipant(
                game_id=other_players_source.id,
                position=0,
                player_key="inactive",
                display_name=inactive.username,
                points=650,
                user_id=inactive.id,
            ))
            for index, definition in enumerate(definitions):
                unlocked_at = base + timedelta(minutes=index // 2)
                source_id = None
                if index == 24:
                    source_id = valid_source.id
                elif index == 23:
                    source_id = wrong_product_source.id
                elif index == 22:
                    source_id = other_players_source.id
                row = UserAchievement(
                    user_id=active.id,
                    achievement_key=definition.key,
                    source_completed_game_id=source_id,
                    unlocked_at=unlocked_at,
                )
                db.add(row)
                db.flush()
                expected_rows.append((unlocked_at, row.id, definition.key))
            db.add(UserAchievement(
                user_id=active.id,
                achievement_key="unknown.future.achievement",
                unlocked_at=base + timedelta(days=2),
            ))
            fairplay_key = next(
                definition.key for definition in ACHIEVEMENTS
                if definition.key.startswith("manual_solo_aborts_")
            )
            db.add(UserAchievement(
                user_id=active.id,
                achievement_key=fairplay_key,
                unlocked_at=base + timedelta(days=1),
            ))
            db.add(UserAchievement(
                user_id=inactive.id,
                achievement_key=definitions[25 % len(definitions)].key,
                unlocked_at=base + timedelta(days=3),
            ))

        expected_ids = [
            row_id
            for _timestamp, row_id, _key in sorted(expected_rows, key=lambda value: (value[0], value[1]), reverse=True)
        ]
        first = self._request("/api/achievements/recent")
        self.assertEqual(first.status_code, 200)
        payload = first.json()
        self.assertEqual(payload["page_size"], ACHIEVEMENT_FEED_PAGE_SIZE)
        self.assertEqual(payload["total"], 25)
        self.assertEqual(payload["pages"], 2)
        self.assertFalse(payload["has_previous"])
        self.assertTrue(payload["has_next"])
        self.assertEqual([item["id"] for item in payload["items"]], expected_ids[:20])
        linked = next(item for item in payload["items"] if item["id"] == expected_rows[24][1])
        self.assertEqual(linked["game_url"], "/ergebnis/visible-source")
        self.assertNotIn("game_url", next(item for item in payload["items"] if item["id"] == expected_rows[23][1]))
        self.assertNotIn("game_url", next(item for item in payload["items"] if item["id"] == expected_rows[22][1]))
        self.assertEqual(linked["player"]["avatar_url"], f"/api/avatars/{active.id}")
        self.assertEqual(linked["player"]["profile_url"], f"/api/players/by-id/{active.id}/profile?game=zdwa")
        self.assertNotIn("source_completed_game_id", first.text)

        second = self._request("/api/achievements/recent?page=2")
        self.assertEqual(second.status_code, 200)
        second_payload = second.json()
        self.assertEqual([item["id"] for item in second_payload["items"]], expected_ids[20:])
        self.assertTrue(second_payload["has_previous"])
        self.assertFalse(second_payload["has_next"])

    def test_each_difficulty_filter_is_exclusive_and_invalid_values_are_rejected(self) -> None:
        user = create_user("FeedFilters", "feed-filters-password-123", must_change_password=False)
        base = datetime(2026, 9, 20, 12, 0, tzinfo=timezone.utc)
        zdwa_by_difficulty = {
            difficulty: next(
                definition for definition in ZDWA_FEED_DEFINITIONS.values()
                if ZDWA_ACHIEVEMENT_DIFFICULTIES[definition.key] == difficulty
            )
            for difficulty in ("easy", "medium", "hard")
        }
        zilch_by_difficulty = {
            difficulty: next(
                definition for definition in ZILCH_FEED_DEFINITIONS.values()
                if ZILCH_ACHIEVEMENT_DIFFICULTIES[definition.key] == difficulty
            )
            for difficulty in ("easy", "medium", "hard")
        }
        with session_scope() as db:
            db.execute(delete(UserAchievement).where(UserAchievement.user_id == user.id))
            for index, definition in enumerate(zdwa_by_difficulty.values()):
                db.add(UserAchievement(
                    user_id=user.id,
                    achievement_key=definition.key,
                    unlocked_at=base + timedelta(minutes=index),
                ))
            for index, definition in enumerate(zilch_by_difficulty.values()):
                db.add(ZilchAchievementUnlock(
                    user_id=user.id,
                    achievement_key=definition.key,
                    definition_version=definition.definition_version,
                    source_game_id=f"private-filter-{index}",
                    presentation_game_id=f"private-presentation-{index}",
                    unlocked_at=base + timedelta(minutes=index),
                ))

        for difficulty in ("easy", "medium", "hard"):
            with self.subTest(product="zdwa", difficulty=difficulty):
                payload = self._request(f"/api/achievements/recent?difficulty={difficulty}").json()
                self.assertEqual(payload["difficulty"], difficulty)
                self.assertEqual(payload["total"], 1)
                self.assertEqual({item["achievement"]["difficulty"] for item in payload["items"]}, {difficulty})
            with self.subTest(product="zilch", difficulty=difficulty):
                payload = self._request(f"/api/zilch/achievements/recent?difficulty={difficulty}").json()
                self.assertEqual(payload["difficulty"], difficulty)
                self.assertEqual(payload["total"], 1)
                self.assertEqual({item["achievement"]["difficulty"] for item in payload["items"]}, {difficulty})

        for path in ("/api/achievements/recent", "/api/zilch/achievements/recent"):
            for query in ("difficulty=impossible", "difficulty=", "page=0", "page=-1", "page=1.5", "page=bad"):
                with self.subTest(path=path, query=query):
                    self.assertEqual(self._request(f"{path}?{query}").status_code, 422)

    def test_empty_and_out_of_range_pages_keep_valid_pagination_metadata(self) -> None:
        paths = ("/api/achievements/recent", "/api/zilch/achievements/recent")
        for path in paths:
            payload = self._request(path).json()
            self.assertEqual(payload["items"], [])
            self.assertEqual(payload["total"], 0)
            self.assertEqual(payload["pages"], 0)
            self.assertFalse(payload["has_next"])
            self.assertFalse(payload["has_previous"])

        user = create_user("FeedBoundary", "feed-boundary-password-123", must_change_password=False)
        now = datetime(2026, 9, 20, 12, 0, tzinfo=timezone.utc)
        with session_scope() as db:
            db.execute(delete(UserAchievement).where(UserAchievement.user_id == user.id))
            for definition in list(ZDWA_FEED_DEFINITIONS.values())[:ACHIEVEMENT_FEED_PAGE_SIZE]:
                db.add(UserAchievement(user_id=user.id, achievement_key=definition.key, unlocked_at=now))
            for definition in list(ZILCH_FEED_DEFINITIONS.values())[:ACHIEVEMENT_FEED_PAGE_SIZE]:
                db.add(ZilchAchievementUnlock(
                    user_id=user.id,
                    achievement_key=definition.key,
                    definition_version=definition.definition_version,
                    unlocked_at=now,
                ))

        for path in paths:
            with self.subTest(path=path):
                payload = self._request(path).json()
                self.assertEqual(len(payload["items"]), 20)
                self.assertEqual(payload["total"], 20)
                self.assertEqual(payload["pages"], 1)
                self.assertFalse(payload["has_next"])
                for page in (2, 10**30):
                    response = self._request(f"{path}?page={page}")
                    self.assertEqual(response.status_code, 200)
                    out_of_range = response.json()
                    self.assertEqual(out_of_range["items"], [])
                    self.assertEqual(out_of_range["page"], page)
                    self.assertEqual(out_of_range["total"], 20)
                    self.assertEqual(out_of_range["pages"], 1)
                    self.assertTrue(out_of_range["has_previous"])
                    self.assertFalse(out_of_range["has_next"])

    def test_deleted_zdwa_source_leaves_no_dead_result_link(self) -> None:
        user = create_user("DeletedFeedSource", "deleted-feed-source-password-123", must_change_password=False)
        now = datetime(2026, 9, 20, 12, 0, tzinfo=timezone.utc)
        definition = next(iter(ZDWA_FEED_DEFINITIONS.values()))
        with session_scope() as db:
            db.execute(delete(UserAchievement).where(UserAchievement.user_id == user.id))
            source = self._completed_game(db, "deleted-feed-source", finished_at=now)
            source_id = source.id
            db.add(GameParticipant(
                game_id=source.id,
                position=0,
                player_key="source-player",
                display_name=user.username,
                points=700,
                user_id=user.id,
            ))
            db.add(UserAchievement(
                user_id=user.id,
                achievement_key=definition.key,
                source_completed_game_id=source.id,
                unlocked_at=now,
            ))
        before = self._request("/api/achievements/recent").json()
        self.assertEqual(before["items"][0]["game_url"], "/ergebnis/deleted-feed-source")

        with session_scope() as db:
            db.delete(db.get(CompletedGame, source_id))

        after = self._request("/api/achievements/recent").json()
        self.assertEqual(after["total"], 1)
        self.assertEqual(len(after["items"]), 1)
        self.assertNotIn("game_url", after["items"][0])

    def test_zilch_feed_is_paginated_without_private_provenance(self) -> None:
        active = create_user("ZilchFeedActive", "zilch-feed-active-password-123", must_change_password=False)
        inactive = create_user("ZilchFeedInactive", "zilch-feed-inactive-password-123", must_change_password=False)
        definitions = list(ZILCH_FEED_DEFINITIONS.values())[:23]
        base = datetime(2026, 9, 20, 12, 0, tzinfo=timezone.utc)
        expected_rows: list[tuple[datetime, int]] = []
        secret = "never-public-zilch-result"
        with session_scope() as db:
            db.get(User, inactive.id).is_active = False
            for index, definition in enumerate(definitions):
                unlocked_at = base + timedelta(minutes=index // 2)
                row = ZilchAchievementUnlock(
                    user_id=active.id,
                    achievement_key=definition.key,
                    definition_version=definition.definition_version,
                    source_game_id=f"{secret}-source-{index}",
                    presentation_game_id=f"{secret}-presentation-{index}",
                    unlocked_at=unlocked_at,
                )
                db.add(row)
                db.flush()
                expected_rows.append((unlocked_at, row.id))
            db.add(ZilchAchievementUnlock(
                user_id=active.id,
                achievement_key="zilch.unknown.future",
                definition_version=1,
                source_game_id=secret,
                presentation_game_id=secret,
                unlocked_at=base + timedelta(days=2),
            ))
            db.add(ZilchAchievementUnlock(
                user_id=inactive.id,
                achievement_key=definitions[0].key,
                definition_version=definitions[0].definition_version,
                source_game_id=secret,
                presentation_game_id=secret,
                unlocked_at=base + timedelta(days=3),
            ))

        expected_ids = [
            row_id
            for timestamp, row_id in sorted(expected_rows, key=lambda value: (value[0], value[1]), reverse=True)
        ]
        first = self._request("/api/zilch/achievements/recent")
        self.assertEqual(first.status_code, 200)
        payload = first.json()
        self.assertEqual(payload["total"], 23)
        self.assertEqual(payload["pages"], 2)
        self.assertEqual([item["id"] for item in payload["items"]], expected_ids[:20])
        self.assertNotIn(secret, first.text)
        for item in payload["items"]:
            self.assertEqual(set(item), {"id", "unlocked_at", "player", "achievement"})
            self.assertFalse({"game_url", "source_game_id", "presentation_game_id", "source_evidence_id"} & set(item))
            self.assertEqual(item["player"]["profile_url"], f"/api/players/by-id/{active.id}/profile?game=zilch")

        second = self._request("/api/zilch/achievements/recent?page=2").json()
        self.assertEqual([item["id"] for item in second["items"]], expected_ids[20:])

    def test_zilch_feed_uses_the_existing_product_access_policy(self) -> None:
        preview_user = create_user("PreviewDenied", "preview-denied-password-123", must_change_password=False)
        admin = create_user("Mani", "mani-feed-password-123", role="admin", must_change_password=False)
        denied_identity, denied_token = login(
            request_for_login(),
            preview_user.username,
            "preview-denied-password-123",
        )
        self.assertIsNotNone(denied_identity)
        admin_identity, admin_token = login(request_for_login(), admin.username, "mani-feed-password-123")
        self.assertIsNotNone(admin_identity)

        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_ACCESS_MODE": "preview"}):
            self.assertEqual(self._request("/api/zilch/achievements/recent").status_code, 401)
            self.assertEqual(
                self._request("/api/zilch/achievements/recent", token=denied_token).status_code,
                403,
            )
            self.assertEqual(
                self._request("/api/zilch/achievements/recent", token=admin_token).status_code,
                200,
            )
