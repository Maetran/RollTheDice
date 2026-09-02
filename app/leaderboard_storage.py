"""Thread-safe JSON storage primitives for legacy leaderboard projections."""

from __future__ import annotations

import json
import logging
import os
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class LeaderboardFiles:
    recent: Path
    alltime: Path
    shame: Path
    last_games: Path
    stats: Path
    lock: threading.RLock = field(default_factory=threading.RLock)

    @classmethod
    def in_directory(cls, directory: Path) -> "LeaderboardFiles":
        return cls(
            recent=directory / "leaderboard_recent.json",
            alltime=directory / "leaderboard_alltime.json",
            shame=directory / "leaderboard_shame.json",
            last_games=directory / "leaderboard_last_games.json",
            stats=directory / "stats.json",
        )

    def legacy_paths(self) -> list[Path]:
        return [self.recent, self.alltime, self.shame, self.last_games]


def read_json(path: Path, default: Any) -> Any:
    """Read JSON defensively and return the supplied fallback on corruption."""
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        logger.warning("Could not read JSON file %s; using fallback", path, exc_info=True)
        return default


def atomic_write_json(path: Path, data: Any) -> None:
    """Replace one JSON file atomically after fully writing its sibling temp file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def write_json_if_changed(
    files: LeaderboardFiles,
    path: Path,
    original_data: Any,
    new_data: Any,
) -> None:
    """Write normalized data only if the source did not change meanwhile."""
    with files.lock:
        try:
            original_json = json.dumps(original_data, sort_keys=True)
            new_json = json.dumps(new_data, sort_keys=True)
            if original_json == new_json:
                return
            current_json = json.dumps(read_json(path, original_data), sort_keys=True)
            if current_json == original_json:
                atomic_write_json(path, new_data)
        except (OSError, TypeError, ValueError):
            logger.exception("Could not update JSON file %s", path)


def mutate_json(
    files: LeaderboardFiles,
    path: Path,
    mutation: Callable[[Any], Any],
) -> None:
    """Read, mutate and atomically replace one JSON document under its shared lock."""
    with files.lock:
        data = read_json(path, [])
        atomic_write_json(path, mutation(data))
