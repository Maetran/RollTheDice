#!/usr/bin/env python3
"""Derive the small public-lobby atlas from the unchanged full playing deck.

All 36 cells, source attribution, crops and ordering stay the same. The lobby
displays cards at up to 140 CSS pixels; 288 pixels retain two-pixel density.
Rebuild after changing the full atlas; --check detects a stale derivative.
"""

from __future__ import annotations

import argparse
import io
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "app/static/hausdepp/cards-atlas.webp"
OUTPUT = ROOT / "app/static/hausdepp/cards-lobby-atlas.webp"
CELL = (288, 456)
COLUMNS, ROWS = 9, 4


def render() -> bytes:
    with Image.open(SOURCE) as source:
        if source.width % COLUMNS or source.height % ROWS or source.width * CELL[1] * ROWS != source.height * CELL[0] * COLUMNS:
            raise ValueError("The source must contain the same 9 by 4 card grid and card aspect ratio.")
        image = source.convert("RGB").resize((COLUMNS * CELL[0], ROWS * CELL[1]), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, "WEBP", quality=80, method=6)
    return buffer.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="fail if the public-lobby atlas is outdated")
    args = parser.parse_args()
    data = render()
    if args.check:
        if not OUTPUT.is_file() or OUTPUT.read_bytes() != data:
            print("Public-lobby card atlas is outdated; run scripts/build_hausdepp_lobby_cards.py")
            return 1
        return 0
    OUTPUT.write_bytes(data)
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
