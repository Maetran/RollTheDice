"""Short-lived rollout state, written only by the trusted deployment CLI."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import tempfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

NOTICE_FILENAME = "deployment-notice.json"
NOTICE_LIFETIME_SECONDS = 300
MAX_DELAY_SECONDS = 300
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}\Z")


def configured_data_dir() -> Path:
    """Use the same existing-data selection as application assembly."""
    here = Path(__file__).resolve().parent
    return next((path for path in (here.parent / "data", here / "data") if path.exists()), here)


def _validated_notice(value: object) -> dict[str, str] | None:
    if not isinstance(value, dict) or set(value) != {"id", "restart_at", "expires_at"}:
        return None
    if not isinstance(value["id"], str) or not _ID.fullmatch(value["id"]):
        return None
    try:
        restart = datetime.fromisoformat(value["restart_at"])
        expires = datetime.fromisoformat(value["expires_at"])
    except (TypeError, ValueError):
        return None
    if restart.utcoffset() != timedelta(0) or expires.utcoffset() != timedelta(0):
        return None
    if (expires - restart).total_seconds() != NOTICE_LIFETIME_SECONDS:
        return None
    return {"id": value["id"], "restart_at": restart.isoformat(), "expires_at": expires.isoformat()}


def read_notice(data_dir: Path, *, now: datetime | None = None) -> dict[str, str] | None:
    """Read an atomic marker without database access or exposing operator input."""
    try:
        with (data_dir / NOTICE_FILENAME).open(encoding="utf-8") as source:
            # A corrupt/untrusted file cannot make every browser poll allocate
            # unbounded memory. Writers only produce three small scalar fields.
            value = json.loads(source.read(4097))
        notice = _validated_notice(value)
    except (OSError, ValueError, UnicodeError):
        return None
    if notice is None:
        return None
    current = now or datetime.now(timezone.utc)
    restart = datetime.fromisoformat(notice["restart_at"])
    expires = datetime.fromisoformat(notice["expires_at"])
    if expires <= current or restart > current + timedelta(seconds=MAX_DELAY_SECONDS):
        return None
    return notice


@contextmanager
def _writer_lock(data_dir: Path) -> Iterator[None]:
    data_dir.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(data_dir / ".deployment-notice.lock", os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(descriptor, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def announce(data_dir: Path, notice_id: str, *, delay: int = 30, now: datetime | None = None) -> dict[str, str]:
    if not _ID.fullmatch(notice_id):
        raise ValueError("Notice ID must contain 1–80 letters, digits, dots, underscores or hyphens")
    if not 0 <= delay <= MAX_DELAY_SECONDS:
        raise ValueError(f"Delay must be between 0 and {MAX_DELAY_SECONDS} seconds")
    current = now or datetime.now(timezone.utc)
    if current.utcoffset() is None:
        raise ValueError("Announcement time must include a timezone")
    restart = current.astimezone(timezone.utc) + timedelta(seconds=delay)
    notice = {
        "id": notice_id,
        "restart_at": restart.isoformat(),
        "expires_at": (restart + timedelta(seconds=NOTICE_LIFETIME_SECONDS)).isoformat(),
    }
    with _writer_lock(data_dir):
        descriptor, temporary = tempfile.mkstemp(prefix=".deployment-notice-", dir=data_dir)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as target:
                json.dump(notice, target)
                target.flush()
                os.fsync(target.fileno())
            os.replace(temporary, data_dir / NOTICE_FILENAME)
        finally:
            Path(temporary).unlink(missing_ok=True)
    return notice


def clear(data_dir: Path, notice_id: str) -> bool:
    """An older deployment must never remove a newer deployment's notice."""
    with _writer_lock(data_dir):
        notice = read_notice(data_dir)
        if notice is None or notice["id"] != notice_id:
            return False
        (data_dir / NOTICE_FILENAME).unlink(missing_ok=True)
        return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("announce", "clear"):
        command_parser = subparsers.add_parser(command)
        command_parser.add_argument("--id", required=True)
        if command == "announce":
            command_parser.add_argument("--delay", type=int, default=30)
    arguments = parser.parse_args()
    data_dir = configured_data_dir()
    if arguments.command == "announce":
        try:
            notice = announce(data_dir, arguments.id, delay=arguments.delay)
        except ValueError as error:
            parser.error(str(error))
        print(json.dumps({"notice": notice}))
    else:
        print(json.dumps({"cleared": clear(data_dir, arguments.id)}))


if __name__ == "__main__":
    main()
