"""Semantic release sequencing and read-only player-facing version history."""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import Response

from app import api_releases, release_push, versioning
from app.api_releases import AcknowledgeReleaseRequest, acknowledge_release, release_history
from app.database import session_scope
from app.models import PushRelease, PushReleaseRecipient, ReleaseAcknowledgement
from app.release_manifest import ReleaseNotice
from app.release_push import publish_release_notice
from scripts import product_versions
from tests import test_player_release_notes as notes_fixtures
from tests.test_release_push import NOTES


def version_metadata() -> tuple[dict, list[dict]]:
    history = [
        {"version": "1.0.0", "revision": "a" * 40, "date": "2026-09-18", "bump": "major", "summary": "First game"},
        {"version": "1.1.0", "revision": "b" * 40, "date": "2026-09-19", "bump": "minor", "summary": "New mode"},
    ]
    current = {
        "version": "1.1.1", "previous_revision": "b" * 40, "date": "2026-09-20", "bump": "patch",
        "summary": {"de": "Lesbare Aktionen", "en": "Readable actions"},
    }
    return current, history


class ProductVersionRulesTestCase(unittest.TestCase):
    def test_major_minor_and_patch_reset_only_the_following_components(self):
        self.assertEqual(versioning.version_tuple("2.10.11"), (2, 10, 11))
        self.assertGreater(versioning.version_tuple("2.10.0"), versioning.version_tuple("2.9.9"))
        for bump, expected in (("major", "3.0.0"), ("minor", "2.10.0"), ("patch", "2.9.9")):
            with self.subTest(bump=bump):
                self.assertEqual(versioning.next_version("2.9.8", bump), expected)

    def test_noncanonical_versions_and_unknown_bumps_are_rejected(self):
        for value in (None, 1.2, "", "1", "1.2", "1.2.3.4", "01.2.3", "1.02.3", "1.2.03",
                      "v1.2.3", "1.2.3-beta", "1.2.3+build", " 1.2.3", "1.2.3\n", "-1.2.3", "1.1١.0"):
            with self.subTest(version=value), self.assertRaises(ValueError):
                versioning.version_tuple(value)
        for bump in (None, "", "feature", "MINOR"):
            with self.subTest(bump=bump), self.assertRaises(ValueError):
                versioning.next_version("1.2.3", bump)

    def test_repository_metadata_is_a_valid_continuous_version_sequence(self):
        current = json.loads(product_versions.CURRENT.read_text(encoding="utf-8"))
        history = json.loads(product_versions.HISTORY.read_text(encoding="utf-8"))
        product_versions.validate(current, history)
        self.assertEqual(history[0]["version"], "1.0.0")
        self.assertEqual(versioning.current_version(), current["version"])
        self.assertEqual(versioning.version_for_revision(history[-1]["revision"]), history[-1]["version"])
        self.assertIsNone(versioning.version_for_revision("not-a-recorded-revision"))

    def test_api_schema_reports_the_same_product_version(self):
        from app.main import app

        self.assertEqual(app.openapi()["info"]["version"], versioning.current_version())

    def test_history_cannot_skip_versions_reuse_revisions_or_lose_translations(self):
        current, history = version_metadata()
        product_versions.validate(current, history)
        for label, mutate in (
            ("missing history", lambda c, h: h.clear()),
            ("skipped minor", lambda c, h: h[1].update(version="1.2.0")),
            ("minor retaining patch", lambda c, h: h[1].update(version="1.1.1")),
            ("duplicate revision", lambda c, h: h[1].update(revision=h[0]["revision"])),
            ("short revision", lambda c, h: h[1].update(revision="abcdef0")),
            ("empty summary", lambda c, h: h[1].update(summary=" ")),
            ("invalid date", lambda c, h: h[1].update(date="2026-02-30")),
            ("wrong current bump", lambda c, h: c.update(bump="minor")),
            ("wrong previous revision", lambda c, h: c.update(previous_revision="c" * 40)),
            ("missing English", lambda c, h: c["summary"].pop("en")),
        ):
            candidate, entries = copy.deepcopy(current), copy.deepcopy(history)
            mutate(candidate, entries)
            with self.subTest(case=label), self.assertRaises(ValueError):
                product_versions.validate(candidate, entries)

    def test_new_deploy_requires_a_bump_and_exact_previous_version_mapping(self):
        current, history = version_metadata()
        previous, head = "b" * 40, "c" * 40
        product_versions.validate_deploy(current, history, previous, head, "1.1.0")
        for value in ("1.1.0", "1.0.9"):
            with self.subTest(version=value), self.assertRaisesRegex(ValueError, "Advance"):
                product_versions.validate_deploy({**current, "version": value}, history, previous, head, "1.1.0")
        for entries in (history[:1], [{**entry, "version": "1.0.9"} for entry in history]):
            with self.subTest(history=entries), self.assertRaisesRegex(ValueError, "unchanged version"):
                product_versions.validate_deploy(current, entries, previous, head, "1.1.0")

    def test_redeploy_of_the_same_revision_needs_no_artificial_bump(self):
        current, history = version_metadata()
        product_versions.validate_deploy(current, history, "c" * 40, "c" * 40, current["version"])

    def test_unversioned_previous_deployment_requires_an_explicit_historical_mapping(self):
        current, history = version_metadata()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            document = root / "VERSION_HISTORY.md"
            document.write_text(product_versions.history_document(current, history), encoding="utf-8")
            (root / "CHANGELOG.md").write_text("## 1.1.1 — Readable actions\n", encoding="utf-8")
            with patch.object(product_versions, "ROOT", root), patch.object(product_versions, "DOCUMENT", document), \
                    patch.object(product_versions.subprocess, "run", return_value=SimpleNamespace(returncode=1)), \
                    patch.object(product_versions, "git", return_value="c" * 40):
                product_versions.check(current, history, "b" * 40)
                with self.assertRaisesRegex(ValueError, "explicit historical mapping"):
                    product_versions.check(current, history, "f" * 40)

    def test_bump_archives_the_committed_version_once_without_mutating_existing_history(self):
        current, history = version_metadata()
        original = copy.deepcopy(history)
        with patch.object(product_versions, "git", side_effect=["c" * 40, json.dumps(current), "2026-09-20"]):
            advanced, archived = product_versions.bump(current, history, "minor", "Neuer Modus", "New mode")
        self.assertEqual(advanced["version"], "1.2.0")
        self.assertEqual(advanced["previous_revision"], "c" * 40)
        self.assertEqual(archived[-1]["revision"], "c" * 40)
        self.assertEqual(archived[-1]["version"], "1.1.1")
        self.assertEqual(history, original)
        with patch.object(product_versions, "git", return_value="c" * 40), self.assertRaisesRegex(ValueError, "twice"):
            product_versions.bump(advanced, archived, "patch", "Korrektur", "Fix")
        with patch.object(product_versions, "git", side_effect=["c" * 40, json.dumps({**current, "version": "1.1.0"})]), \
                self.assertRaisesRegex(ValueError, "uncommitted changes"):
            product_versions.bump(current, history, "patch", "Korrektur", "Fix")

    def test_release_payload_freezes_its_version_instead_of_relabeling_on_a_later_build(self):
        with patch("app.release_manifest.current_version", return_value="2.36.0"):
            notice = ReleaseNotice.from_payload({**NOTES, "revision": "c" * 40})
        self.assertEqual(notice.version, "2.36.0")
        with patch("app.release_manifest.current_version", return_value="3.0.0"):
            restored = ReleaseNotice.from_payload(notice.payload())
        self.assertEqual(restored.version, "2.36.0")
        for invalid in ("2.36", "02.36.0", "next"):
            with self.subTest(version=invalid), self.assertRaises(ValueError):
                ReleaseNotice.from_payload({**NOTES, "revision": "c" * 40, "version": invalid})


class PlayerProductVersionTestCase(unittest.TestCase):
    setUp = notes_fixtures.PlayerReleaseNotesTestCase.setUp
    tearDown = notes_fixtures.PlayerReleaseNotesTestCase.tearDown

    def test_api_preserves_persisted_versions_and_maps_old_revisions_without_guessing(self):
        historical_revision = "8a00d7e41a2456bc518f42a6cc68101aa9b41b61"
        for revision, stored_version in ((historical_revision, None), ("c" * 40, "2.36.0"), ("d" * 40, None)):
            notice = ReleaseNotice.from_payload({**NOTES, "revision": revision, "version": "2.36.0"})
            publish_release_notice(notice, now=self.now)
            with session_scope() as db:
                db.get(PushRelease, revision).version = stored_version
        with patch.object(api_releases, "current_version", return_value="3.0.0"):
            for game in ("zdwa", "zilch"):
                result = release_history(self.request, Response(), game_type=game, language="en")
                by_revision = {item["revision"]: item for item in result["releases"]}
                self.assertEqual(result["current_version"], "3.0.0")
                self.assertEqual(by_revision[historical_revision]["version"], "2.35.0")
                self.assertEqual(by_revision["c" * 40]["version"], "2.36.0")
                self.assertIsNone(by_revision["d" * 40]["version"])
        with session_scope() as db:
            self.assertIsNone(db.get(PushRelease, historical_revision).version)

    def test_reading_a_silent_new_version_creates_no_release_push_or_new_acknowledgement(self):
        revision = "8a00d7e41a2456bc518f42a6cc68101aa9b41b61"
        notice = ReleaseNotice.from_payload({**NOTES, "revision": revision, "version": "2.35.0"})
        publish_release_notice(notice, now=self.now)
        acknowledge_release(revision, AcknowledgeReleaseRequest(viewer_id=self.player.id), self.request, Response(), game_type="zdwa")
        with session_scope() as db:
            acknowledged_at = db.query(ReleaseAcknowledgement).one().acknowledged_at
            published_at = db.get(PushRelease, revision).published_at
        with patch.object(release_push, "publish_release_notice") as publish, patch.object(release_push, "_send_web_push") as send:
            for current in ("2.36.0", "2.37.0"):
                with patch.object(api_releases, "current_version", return_value=current):
                    for game in ("zdwa", "zilch"):
                        for language in ("de", "en"):
                            result = release_history(self.request, Response(), game_type=game, language=language)
                            self.assertEqual(result["current_version"], current)
                            self.assertEqual(len(result["releases"]), 1)
                            self.assertTrue(result["releases"][0]["acknowledged"])
                            self.assertEqual(result["releases"][0]["revision"], revision)
                            self.assertEqual(result["releases"][0]["version"], "2.35.0")
                            guest = release_history(self.guest, Response(), game_type=game, language=language)
                            self.assertFalse(guest["releases"][0]["acknowledged"])
            publish.assert_not_called()
            send.assert_not_called()
        with session_scope() as db:
            self.assertEqual(db.query(PushRelease).count(), 1)
            self.assertEqual(db.query(PushReleaseRecipient).count(), 0)
            self.assertEqual(db.query(ReleaseAcknowledgement).count(), 1)
            self.assertEqual(db.query(ReleaseAcknowledgement).one().acknowledged_at, acknowledged_at)
            self.assertEqual(db.get(PushRelease, revision).published_at, published_at)

    def test_current_version_is_available_even_when_no_release_has_been_announced(self):
        for game in ("zdwa", "zilch"):
            response = Response()
            result = release_history(self.guest, response, game_type=game, language="de")
            self.assertEqual(result["current_version"], versioning.current_version())
            self.assertEqual(result["releases"], [])
            self.assertEqual(response.headers["Cache-Control"], "no-store")
        with session_scope() as db:
            self.assertEqual(db.query(PushRelease).count(), 0)
            self.assertEqual(db.query(PushReleaseRecipient).count(), 0)
            self.assertEqual(db.query(ReleaseAcknowledgement).count(), 0)
