"""Small public account pictures, rebuilt from pixels at the trust boundary."""

from __future__ import annotations

import asyncio
import hashlib
import io
import warnings
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response
from PIL import Image, ImageOps, PngImagePlugin, UnidentifiedImageError
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.sqlite import insert
from starlette.concurrency import run_in_threadpool
from starlette.responses import RedirectResponse

from .auth import require_csrf, require_user
from .database import session_scope
from .models import AuthRateEvent, User, UserAvatar
from .security import utcnow

router = APIRouter(prefix="/api", tags=["avatars"])

# Source files must accommodate ordinary current phone photos. They are fully
# decoded under the pixel limit and immediately rebuilt; only the tiny output
# below is retained. This is deliberately distinct from stored-avatar limits.
INPUT_MAX_BYTES = 8 * 1024 * 1024
INPUT_MAX_SIDE = 4096
INPUT_MAX_PIXELS = INPUT_MAX_SIDE * INPUT_MAX_SIDE
OUTPUT_SIDE = 256
OUTPUT_MAX_BYTES = 64 * 1024
UPLOADS_PER_MINUTE = 6
UPLOAD_TIMEOUT_SECONDS = 10
DEFAULT_AVATAR_URL = "/static/default-avatar.svg"
ACCEPTED_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}

# This is the only image-processing boundary in the application. Configure
# parser-wide ceilings once; the warning policy itself stays local to a request
# so image handling cannot change warning behaviour elsewhere in the server.
Image.MAX_IMAGE_PIXELS = INPUT_MAX_PIXELS
PngImagePlugin.MAX_TEXT_CHUNK = 64 * 1024
PngImagePlugin.MAX_TEXT_MEMORY = 256 * 1024


def _authorize_mutation(request: Request) -> int:
    identity = require_user(request)
    require_csrf(request, identity)
    if request.headers.get("x-avatar-viewer-id") != str(identity.user_id):
        raise HTTPException(status_code=409, detail="avatar_viewer_changed")
    return identity.user_id


def _lock_account(db, user_id: int) -> None:
    # First DML reserves SQLite's writer before rate counts and replacements.
    result = db.execute(update(User).where(User.id == user_id, User.is_active.is_(True)).values(updated_at=utcnow()))
    if not result.rowcount:
        raise HTTPException(status_code=401, detail="authentication_required")


def _claim_upload(user_id: int) -> None:
    now = utcnow()
    key = hashlib.sha256(f"avatar:{user_id}".encode("ascii")).hexdigest()
    with session_scope() as db:
        _lock_account(db, user_id)
        db.execute(delete(AuthRateEvent).where(
            AuthRateEvent.kind == "avatar_upload", AuthRateEvent.occurred_at < now - timedelta(days=1),
        ))
        count = db.scalar(select(func.count()).select_from(AuthRateEvent).where(
            AuthRateEvent.kind == "avatar_upload", AuthRateEvent.client_key == key,
            AuthRateEvent.occurred_at >= now - timedelta(minutes=1),
        ))
        if count >= UPLOADS_PER_MINUTE:
            raise HTTPException(status_code=429, detail="avatar_rate_limited", headers={"Retry-After": "60"})
        # Count malformed uploads too, before any body read or image decoding.
        db.add(AuthRateEvent(kind="avatar_upload", client_key=key, occurred_at=now))


def _metadata(user_id: int) -> dict:
    with session_scope() as db:
        digest = db.scalar(select(UserAvatar.sha256).where(UserAvatar.user_id == user_id))
    return {
        "viewer_id": user_id,
        "has_avatar": bool(digest),
        "avatar_url": f"/api/avatars/{user_id}?v={digest}" if digest else DEFAULT_AVATAR_URL,
        "limits": {
            "input_bytes": INPUT_MAX_BYTES, "max_width": INPUT_MAX_SIDE, "max_height": INPUT_MAX_SIDE,
            "output_size": OUTPUT_SIDE, "output_bytes": OUTPUT_MAX_BYTES,
            "formats": list(ACCEPTED_FORMATS),
        },
    }


async def _read_upload(request: Request) -> bytes:
    if request.headers.get("content-encoding", "identity").lower() != "identity":
        raise HTTPException(status_code=415, detail="avatar_format_unsupported")
    length = request.headers.get("content-length")
    if length is not None:
        try:
            declared = int(length)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="avatar_invalid") from exc
        if declared < 0 or declared > INPUT_MAX_BYTES:
            raise HTTPException(status_code=413, detail="avatar_too_large")
    body = bytearray()
    try:
        async with asyncio.timeout(UPLOAD_TIMEOUT_SECONDS):
            async for chunk in request.stream():
                if len(body) + len(chunk) > INPUT_MAX_BYTES:
                    raise HTTPException(status_code=413, detail="avatar_too_large")
                body.extend(chunk)
    except TimeoutError as exc:
        raise HTTPException(status_code=408, detail="avatar_upload_timeout") from exc
    if not body:
        raise HTTPException(status_code=400, detail="avatar_invalid")
    return bytes(body)


def _magic_format(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "WEBP"
    return None


def _check_image(image: Image.Image, expected_format: str) -> None:
    if image.format != expected_format:
        raise HTTPException(status_code=415, detail="avatar_format_unsupported")
    if not (1 <= image.width <= INPUT_MAX_SIDE and 1 <= image.height <= INPUT_MAX_SIDE):
        raise HTTPException(status_code=422, detail="avatar_dimensions")
    if getattr(image, "is_animated", False) or getattr(image, "n_frames", 1) != 1 or "loop" in image.info:
        raise HTTPException(status_code=422, detail="avatar_animation_unsupported")


def sanitize_avatar(data: bytes, content_type: str) -> bytes:
    """Never return upload bytes, metadata, filenames, or parser error details."""
    if not data or len(data) > INPUT_MAX_BYTES:
        raise HTTPException(status_code=413 if data else 400, detail="avatar_too_large" if data else "avatar_invalid")
    expected_format = ACCEPTED_FORMATS.get(content_type)
    if not expected_format or _magic_format(data) != expected_format:
        raise HTTPException(status_code=415, detail="avatar_format_unsupported")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data), formats=[expected_format]) as candidate:
                _check_image(candidate, expected_format)
                candidate.verify()
            # verify() is not decoding. Reopen and load all pixels before changing
            # orientation or resizing; truncated/corrupt data must not be saved.
            with Image.open(io.BytesIO(data), formats=[expected_format]) as original:
                _check_image(original, expected_format)
                original.load()
                with ImageOps.exif_transpose(original) as oriented:
                    with oriented.convert("RGBA") as pixels:
                        with ImageOps.fit(pixels, (OUTPUT_SIDE, OUTPUT_SIDE), Image.Resampling.LANCZOS) as cropped:
                            # A genuinely fresh pixel image cannot carry GPS, EXIF,
                            # XMP, ICC, comments, or hidden appended file content.
                            with Image.new("RGBA", cropped.size) as clean:
                                clean.paste(cropped)
                                for quality in (84, 72, 60, 48, 36):
                                    output = io.BytesIO()
                                    clean.save(output, format="WEBP", quality=quality, alpha_quality=80,
                                               method=4, exif=b"", xmp=b"", icc_profile=b"")
                                    encoded = output.getvalue()
                                    if len(encoded) <= OUTPUT_MAX_BYTES:
                                        return encoded
        raise HTTPException(status_code=422, detail="avatar_output_too_large")
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise HTTPException(status_code=422, detail="avatar_dimensions") from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError) as exc:
        raise HTTPException(status_code=400, detail="avatar_invalid") from exc


def _store_avatar(request: Request, original_viewer: int, data: bytes) -> dict:
    # A logout, deactivation, or account change during upload is not authority
    # to persist a previously authenticated request after its slow body read.
    if _authorize_mutation(request) != original_viewer:
        raise HTTPException(status_code=409, detail="avatar_viewer_changed")
    values = {"data": data, "sha256": hashlib.sha256(data).hexdigest(), "updated_at": utcnow()}
    with session_scope() as db:
        _lock_account(db, original_viewer)
        db.execute(insert(UserAvatar).values(user_id=original_viewer, **values).on_conflict_do_update(
            index_elements=[UserAvatar.user_id], set_=values,
        ))
    return _metadata(original_viewer)


@router.get("/account/avatar")
def own_avatar(request: Request, response: Response):
    identity = require_user(request)
    response.headers["Cache-Control"] = "no-store"
    return _metadata(identity.user_id)


@router.put("/account/avatar")
async def upload_avatar(request: Request, response: Response):
    user_id = await run_in_threadpool(_authorize_mutation, request)
    await run_in_threadpool(_claim_upload, user_id)
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type not in ACCEPTED_FORMATS:
        raise HTTPException(status_code=415, detail="avatar_format_unsupported")
    data = await _read_upload(request)
    clean = await run_in_threadpool(sanitize_avatar, data, content_type)
    result = await run_in_threadpool(_store_avatar, request, user_id, clean)
    response.headers["Cache-Control"] = "no-store"
    return result


@router.delete("/account/avatar")
def remove_avatar(request: Request, response: Response):
    user_id = _authorize_mutation(request)
    with session_scope() as db:
        _lock_account(db, user_id)
        db.execute(delete(UserAvatar).where(UserAvatar.user_id == user_id))
    response.headers["Cache-Control"] = "no-store"
    return _metadata(user_id)


@router.get("/avatars/{user_id}")
def public_avatar(user_id: int, request: Request):
    headers = {
        "Cache-Control": "public, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-site",
    }
    with session_scope() as db:
        digest = db.scalar(select(UserAvatar.sha256).join(User, User.id == UserAvatar.user_id).where(
            UserAvatar.user_id == user_id, User.is_active.is_(True),
        ))
        if not digest:
            return RedirectResponse(DEFAULT_AVATAR_URL, status_code=302, headers=headers)
        headers["ETag"] = f'"{digest}"'
        if headers["ETag"] in [tag.strip() for tag in request.headers.get("if-none-match", "").split(",")]:
            return Response(status_code=304, headers=headers)
        data = db.scalar(select(UserAvatar.data).where(UserAvatar.user_id == user_id))
    headers["Content-Disposition"] = 'inline; filename="avatar.webp"'
    return Response(content=data, media_type="image/webp", headers=headers)
