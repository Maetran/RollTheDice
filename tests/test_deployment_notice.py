from __future__ import annotations

import io
import json
import stat
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import httpx

from app import deployment_notice, main
from app.analytics import request_traffic_excluded

NOW = datetime(2026, 10, 21, 17, 0, tzinfo=timezone.utc)


class DeploymentNoticeTestCase(unittest.TestCase):
    def test_atomic_persisted_notice_survives_a_new_reader_and_expires(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            notice = deployment_notice.announce(data, "revision-123", now=NOW)
            self.assertEqual(datetime.fromisoformat(notice["restart_at"]), NOW + timedelta(seconds=30))
            self.assertEqual(deployment_notice.read_notice(data, now=NOW), notice)
            self.assertEqual(deployment_notice.read_notice(data, now=NOW + timedelta(seconds=329)), notice)
            self.assertIsNone(deployment_notice.read_notice(data, now=NOW + timedelta(seconds=330)))
            self.assertEqual(stat.S_IMODE((data / deployment_notice.NOTICE_FILENAME).stat().st_mode), 0o600)
            self.assertFalse(list(data.glob(".deployment-notice-*")))

    def test_rejected_partial_or_corrupt_files_cannot_create_operator_messages(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            valid = deployment_notice.announce(data, "revision", now=NOW)
            path = data / deployment_notice.NOTICE_FILENAME
            invalid = [None, [], {}, {**valid, "id": "<img src=x>"}, {**valid, "message": "injected"},
                       {**valid, "restart_at": "invalid"}, {**valid, "restart_at": None},
                       {**valid, "expires_at": []}, {**valid, "restart_at": NOW.replace(tzinfo=None).isoformat()},
                       {**valid, "expires_at": (NOW + timedelta(days=1)).isoformat()}]
            for value in invalid:
                with self.subTest(value=value):
                    path.write_text(json.dumps(value), encoding="utf-8")
                    self.assertIsNone(deployment_notice.read_notice(data, now=NOW))
            for value in ("{", "x" * 5000):
                path.write_text(value, encoding="utf-8")
                self.assertIsNone(deployment_notice.read_notice(data, now=NOW))
            path.unlink()
            self.assertIsNone(deployment_notice.read_notice(data, now=NOW))

    def test_clear_is_scoped_to_the_current_deployment_id(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            deployment_notice.announce(data, "old")
            deployment_notice.announce(data, "new")
            self.assertFalse(deployment_notice.clear(data, "old"))
            self.assertEqual(deployment_notice.read_notice(data)["id"], "new")
            self.assertTrue(deployment_notice.clear(data, "new"))
            self.assertIsNone(deployment_notice.read_notice(data))

    def test_a_failed_atomic_write_keeps_the_previous_notice(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            original = deployment_notice.announce(data, "original", now=NOW)
            with patch.object(deployment_notice.os, "replace", side_effect=OSError("disk unavailable")):
                with self.assertRaises(OSError):
                    deployment_notice.announce(data, "replacement", now=NOW)
            self.assertEqual(deployment_notice.read_notice(data, now=NOW), original)
            self.assertFalse(list(data.glob(".deployment-notice-*")))

    def test_timing_is_utc_and_an_unreasonably_future_marker_is_ignored(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            local = NOW.astimezone(timezone(timedelta(hours=2)))
            notice = deployment_notice.announce(data, "utc", now=local)
            self.assertTrue(notice["restart_at"].endswith("+00:00"))
            self.assertEqual(deployment_notice.read_notice(data, now=NOW), notice)
            self.assertIsNone(deployment_notice.read_notice(data, now=NOW - timedelta(seconds=301)))
            with self.assertRaises(ValueError):
                deployment_notice.announce(data, "naive", now=NOW.replace(tzinfo=None))

    def test_invalid_operator_arguments_do_not_replace_existing_notice(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            original = deployment_notice.announce(data, "original", now=NOW)
            for value in ("", "../file", "a" * 81, "abc\nmessage"):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    deployment_notice.announce(data, value, now=NOW)
            for delay in (-1, 301):
                with self.assertRaises(ValueError):
                    deployment_notice.announce(data, "new", delay=delay, now=NOW)
            self.assertEqual(deployment_notice.read_notice(data, now=NOW), original)

    def test_cli_announces_and_clears_using_the_actual_application_data_selection(self):
        self.assertEqual(deployment_notice.configured_data_dir(), main.DATA_DIR)
        with tempfile.TemporaryDirectory() as directory, patch.object(
            deployment_notice, "configured_data_dir", return_value=Path(directory),
        ):
            for arguments in (["announce", "--id", "cli", "--delay", "30"], ["clear", "--id", "cli"]):
                with patch("sys.argv", ["deployment_notice", *arguments]), redirect_stdout(io.StringIO()) as output:
                    deployment_notice.main()
                self.assertIsInstance(json.loads(output.getvalue()), dict)
            self.assertIsNone(deployment_notice.read_notice(Path(directory)))


class DeploymentNoticeHttpTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_common_notice_remains_readable_while_watten_is_closed(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(main, "DATA_DIR", Path(directory)), patch.dict(
            "os.environ", {"ROLLTHEDICE_WATTEN_PUBLIC_BETA": "0"},
        ):
            expected = deployment_notice.announce(Path(directory), "closed-watten")
            transport = httpx.ASGITransport(app=main.app)
            async with httpx.AsyncClient(transport=transport, base_url="https://watten.zockdiewandan.online") as client:
                result = await client.get("/api/deployment-notice")
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json(), {"notice": expected})
                self.assertEqual(result.headers["cache-control"], "no-store")
                self.assertIn("noindex", result.headers["x-robots-tag"])
                head = await client.head("/api/deployment-notice")
                self.assertEqual(head.status_code, 200)
                self.assertEqual(head.content, b"")
                self.assertEqual((await client.post("/api/deployment-notice")).status_code, 503)

    async def test_guests_get_only_current_timing_on_each_product_without_cache_or_indexing(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(main, "DATA_DIR", Path(directory)), patch.dict(
            "os.environ", {"ROLLTHEDICE_WATTEN_PUBLIC_BETA": "1"},
        ):
            expected = deployment_notice.announce(Path(directory), "http-notice")
            transport = httpx.ASGITransport(app=main.app)
            for origin in ("https://zockdiewandan.online", "https://zilch.zockdiewandan.online",
                           "https://hausdepp.zockdiewandan.online", "https://watten.zockdiewandan.online"):
                async with httpx.AsyncClient(transport=transport, base_url=origin) as client:
                    result = await client.get("/api/deployment-notice")
                    self.assertEqual(result.status_code, 200)
                    self.assertEqual(result.json(), {"notice": expected})
                    self.assertEqual(result.headers["cache-control"], "no-store")
                    self.assertEqual(result.headers["x-robots-tag"], "noindex, nofollow")
                    self.assertNotIn("set-cookie", result.headers)
                    self.assertEqual((await client.post("/api/deployment-notice", json={"id": "forged"})).status_code, 405)
            self.assertTrue(request_traffic_excluded("/api/deployment-notice"))
            deployment_notice.clear(Path(directory), "http-notice")
            async with httpx.AsyncClient(transport=transport, base_url="https://zockdiewandan.online") as client:
                self.assertEqual((await client.get("/api/deployment-notice")).json(), {"notice": None})
