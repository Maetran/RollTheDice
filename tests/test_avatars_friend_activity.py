"""Safety and privacy contracts for account avatars and live start notices."""

from __future__ import annotations

import io
import unittest
from datetime import timedelta

from fastapi import HTTPException
from PIL import Image
from starlette.requests import Request

from app.api_avatars import DEFAULT_AVATAR_URL, INPUT_MAX_BYTES, OUTPUT_MAX_BYTES, public_avatar, sanitize_avatar
from app.auth import login
from app.database import session_scope
from app.friend_activity import _recipient_payload
from app.models import PushInviteAllowedSender, UserAvatar
from app.security import utcnow
from tests import test_push_allowlist as allowlist_fixtures
from tests import test_web_push as fixtures


def _image_bytes(*, fmt: str = "PNG", size: tuple[int, int] = (640, 320)) -> bytes:
    output = io.BytesIO()
    with Image.new("RGBA", size, "#2277bb") as image:
        image.save(output, format=fmt)
    return output.getvalue()


def _phone_photo_sized_png() -> bytes:
    """A valid, detailed phone-photo-sized source, larger than the old 200 KB cap."""
    output = io.BytesIO()
    with Image.effect_noise((675, 675), 100).convert("RGB") as image:
        image.save(output, format="PNG")
    return output.getvalue()


def _public_request(*, etag: str | None = None) -> Request:
    headers = [(b"host", b"testserver")]
    if etag:
        headers.append((b"if-none-match", etag.encode("ascii")))
    return Request({"type": "http", "method": "GET", "scheme": "https", "path": "/api/avatars/1", "headers": headers})


class AvatarAndFriendActivityTestCase(unittest.TestCase):
    tearDown = fixtures.WebPushTestCase.tearDown

    def setUp(self) -> None:
        allowlist_fixtures.PushAllowlistTestCase.setUp(self)
        self.recipient_identity, _ = login(
            fixtures.request_for(token="missing", csrf="missing"), "Recipient", "a-secure-password-123"
        )
        self.friend_identity, _ = login(
            fixtures.request_for(token="missing", csrf="missing"), "AllowedFriend", "another-password-123"
        )

    def test_avatar_is_rebuilt_as_small_webp_without_original_bytes(self) -> None:
        source = _image_bytes()
        result = sanitize_avatar(source, "image/png")
        self.assertTrue(result.startswith(b"RIFF") and result[8:12] == b"WEBP")
        self.assertLessEqual(len(result), OUTPUT_MAX_BYTES)
        self.assertNotEqual(result, source)
        with Image.open(io.BytesIO(result)) as image:
            self.assertEqual(image.format, "WEBP")
            self.assertEqual(image.size, (256, 256))
            self.assertFalse(image.info.get("exif"))

    def test_avatar_accepts_an_ordinary_photo_larger_than_the_old_200_kb_cap(self) -> None:
        source = _phone_photo_sized_png()
        self.assertGreater(len(source), 200 * 1024)
        self.assertLessEqual(len(source), INPUT_MAX_BYTES)
        result = sanitize_avatar(source, "image/png")
        self.assertTrue(result.startswith(b"RIFF") and result[8:12] == b"WEBP")
        self.assertLessEqual(len(result), OUTPUT_MAX_BYTES)

    def test_avatar_rejects_wrong_media_magic_and_oversized_dimensions(self) -> None:
        with self.assertRaises(HTTPException) as wrong_type:
            sanitize_avatar(_image_bytes(fmt="PNG"), "image/jpeg")
        self.assertEqual(wrong_type.exception.status_code, 415)
        with self.assertRaises(HTTPException) as dimensions:
            sanitize_avatar(_image_bytes(size=(4097, 32)), "image/png")
        self.assertEqual(dimensions.exception.status_code, 422)

    def test_public_avatar_uses_safe_headers_etag_and_default_redirect(self) -> None:
        missing = public_avatar(999_999, _public_request())
        self.assertEqual(missing.status_code, 302)
        self.assertEqual(missing.headers["location"], DEFAULT_AVATAR_URL)
        self.assertEqual(missing.headers["x-content-type-options"], "nosniff")
        clean = sanitize_avatar(_image_bytes(), "image/png")
        with session_scope() as db:
            db.add(UserAvatar(user_id=self.player.id, data=clean, sha256="a" * 64, updated_at=utcnow()))
        response = public_avatar(self.player.id, _public_request())
        self.assertEqual(response.media_type, "image/webp")
        self.assertEqual(response.headers["etag"], '"' + "a" * 64 + '"')
        self.assertEqual(public_avatar(self.player.id, _public_request(etag=response.headers["etag"])).status_code, 304)

    def test_live_notice_requires_current_selection_and_never_includes_the_player(self) -> None:
        with session_scope() as db:
            db.add(PushInviteAllowedSender(
                recipient_user_id=self.player.id, sender_user_id=self.friend.id, created_at=utcnow(),
            ))
        game = {
            "_id": "watchable-1", "_game_type": "zdwa", "_started": True,
            "_started_at": utcnow().isoformat(), "_finished": False, "_aborted": False,
            "_expected": 2, "_mode": "2", "_hardcore": True,
            "_players": [{"id": "friend-seat", "name": self.friend.username, "user_id": self.friend.id}],
        }
        event = _recipient_payload(game, self.recipient_identity, now=utcnow())
        self.assertEqual(event["friend_activity"]["players"], [{"id": self.friend.id, "username": self.friend.username}])
        self.assertEqual(event["friend_activity"]["game_type"], "zdwa")
        self.assertTrue(event["friend_activity"]["hardcore"])
        self.assertIsNone(_recipient_payload(game, self.friend_identity, now=utcnow()))
        stale = dict(game, _started_at=(utcnow() - timedelta(seconds=61)).isoformat())
        self.assertIsNone(_recipient_payload(stale, self.recipient_identity, now=utcnow()))
