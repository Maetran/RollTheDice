#!/usr/bin/env python3
"""Synchronize PWA cache names and asset query strings to one content hash."""

from __future__ import annotations

import argparse
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT / "app" / "static"
MANIFESTS = (ROOT / "manifest.webmanifest", ROOT / "manifest-en.webmanifest")
TEXT_SUFFIXES = {".css", ".html", ".js", ".webmanifest"}
VERSION_RE = re.compile(
    r"((?:(?:/static/|\./)[A-Za-z0-9_./-]+\.(?:css|js|png|webp|svg|ico)|"
    r"/manifest(?:-en)?\.webmanifest)\?v=)[A-Za-z0-9._-]+"
)
CACHE_RE = re.compile(r"const CACHE_VERSION = '[^']+';")


def source_files() -> list[Path]:
    return sorted(
        [path for path in STATIC_DIR.rglob("*") if path.is_file()]
        + [path for path in MANIFESTS if path.is_file()],
        key=lambda path: path.relative_to(ROOT).as_posix(),
    )


def normalized_bytes(path: Path) -> bytes:
    data = path.read_bytes()
    if path.suffix not in TEXT_SUFFIXES:
        return data
    text = data.decode("utf-8")
    text = VERSION_RE.sub(r"\1ASSET_VERSION", text)
    text = CACHE_RE.sub("const CACHE_VERSION = 'ASSET_VERSION';", text)
    return text.encode("utf-8")


def content_version() -> str:
    digest = hashlib.sha256()
    for path in source_files():
        digest.update(path.relative_to(ROOT).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(normalized_bytes(path))
        digest.update(b"\0")
    return digest.hexdigest()[:12]


def desired_text(path: Path, version: str) -> str:
    text = path.read_text(encoding="utf-8")
    text = VERSION_RE.sub(lambda match: f"{match.group(1)}{version}", text)
    if path == STATIC_DIR / "sw.js":
        text = CACHE_RE.sub(f"const CACHE_VERSION = 'assets-{version}';", text)
    return text


def synchronize(*, check: bool) -> int:
    version = content_version()
    stale: list[Path] = []
    for path in source_files():
        if path.suffix not in TEXT_SUFFIXES:
            continue
        desired = desired_text(path, version)
        if desired == path.read_text(encoding="utf-8"):
            continue
        stale.append(path)
        if not check:
            path.write_text(desired, encoding="utf-8")

    if stale:
        action = "stale" if check else "updated"
        print(f"Asset version {version}: {action} " + ", ".join(
            path.relative_to(ROOT).as_posix() for path in stale
        ))
        return 1 if check else 0
    print(f"Asset version {version}: synchronized")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail instead of updating stale versions")
    return synchronize(check=parser.parse_args().check)


if __name__ == "__main__":
    raise SystemExit(main())
