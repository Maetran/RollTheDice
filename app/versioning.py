"""Shared semantic product versions, independent of asset hashes and push consent."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

VERSION_DIR = Path(__file__).resolve().parent


def version_tuple(value: str) -> tuple[int, int, int]:
    if not isinstance(value, str) or len(value) > 32 or not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", value):
        raise ValueError("Product versions must use Major.Minor.Patch, without leading zeros or suffixes")
    return tuple(int(part) for part in value.split("."))


def next_version(value: str, bump: str) -> str:
    major, minor, patch = version_tuple(value)
    if bump == "major":
        return f"{major + 1}.0.0"
    if bump == "minor":
        return f"{major}.{minor + 1}.0"
    if bump == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise ValueError("Choose major, minor or patch explicitly")


@lru_cache(maxsize=1)
def current_release() -> dict:
    return json.loads((VERSION_DIR / "version.json").read_text(encoding="utf-8"))


def current_version() -> str:
    value = current_release()["version"]
    version_tuple(value)
    return value


@lru_cache(maxsize=1)
def historical_versions() -> dict[str, str]:
    history = json.loads((VERSION_DIR / "version-history.json").read_text(encoding="utf-8"))
    return {entry["revision"]: entry["version"] for entry in history}


def version_for_revision(revision: str) -> str | None:
    return historical_versions().get(revision)
