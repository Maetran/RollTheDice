#!/usr/bin/env python3
"""Pre-render the Hausdepp card faces into one crisp, evenly sharpened atlas.

The licensed deck photograph (docs/HAUSDEPP_ASSETS.md) is sharp in its centre
and noticeably softer towards its left and right edges (aces and sixes).
Cutting each card out at runtime with an SVG matrix plus a colour filter made
some cards look crisp and others blurred, and cost a filter per card on every
frame of a flight. This script does that work once:

* exact perspective rectification from the measured corners in
  ``frontend/hausdepp/cards.js`` (with the same eight-source-pixel inset),
* the same per-card paper white balance the runtime filter applied,
* an unsharp mask that grows with the photograph's measured edge softness.

Output: ``app/static/hausdepp/cards-atlas.webp`` with suits as rows and ranks
as columns, in ``CARD_CORNERS`` order. Run it after changing corners, whites
or sources; ``--check`` verifies the committed atlas is current.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageFilter, ImageStat

ROOT = Path(__file__).resolve().parent.parent
CARDS_JS = ROOT / "frontend/hausdepp/cards.js"
SOURCE = ROOT / "app/static/hausdepp/cards-source.jpg"
LEAVES_TEN = ROOT / "app/static/hausdepp/tell-leaves-reference-v1.jpg"
OUTPUT = ROOT / "app/static/hausdepp/cards-atlas.webp"
LEAVES_TEN_CORNERS = [[1913.2, 1478.9], [2390.0, 1464.3], [2397.4, 2170.4], [1945.1, 2176.9]]
CELL = (432, 684)  # 1.2 × the 360 × 570 card viewBox
COLUMNS = 9
TARGET_WHITE = (247, 244, 235)
INSET = 8.0


def _object(source: str, name: str) -> dict:
    match = re.search(rf"export const {name} = (\{{.*?\n\}});", source, re.S)
    if not match:
        raise SystemExit(f"{name} not found in {CARDS_JS}")
    return json.loads(re.sub(r",(\s*[\]}])", r"\1", match.group(1)))


def _square_to_quad(quad):
    """Heckbert's projective map from the unit square to ``quad``."""
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = quad
    dx1, dx2, dy1, dy2 = x1 - x2, x3 - x2, y1 - y2, y3 - y2
    sx, sy = x0 - x1 + x2 - x3, y0 - y1 + y2 - y3
    if abs(sx) < 1e-9 and abs(sy) < 1e-9:
        g = h = 0.0
    else:
        den = dx1 * dy2 - dx2 * dy1
        g = (sx * dy2 - dx2 * sy) / den
        h = (dx1 * sy - sx * dy1) / den
    return [[x1 - x0 + g * x1, x3 - x0 + h * x3, x0],
            [y1 - y0 + g * y1, y3 - y0 + h * y3, y0],
            [g, h, 1.0]]


def _perspective_coefficients(corners, size):
    """PIL coefficients mapping each output pixel to its source position."""
    tl, tr, br, bl = corners
    width = (abs(complex(*tr) - complex(*tl)) + abs(complex(*br) - complex(*bl))) / 2
    height = (abs(complex(*bl) - complex(*tl)) + abs(complex(*br) - complex(*tr))) / 2
    mu, mv = INSET / width, INSET / height
    homography = _square_to_quad([tl, tr, br, bl])
    affine = [[(1 - 2 * mu) / size[0], 0.0, mu], [0.0, (1 - 2 * mv) / size[1], mv], [0.0, 0.0, 1.0]]
    m = [[sum(homography[r][k] * affine[k][c] for k in range(3)) for c in range(3)] for r in range(3)]
    return [value / m[2][2] for value in (m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1])]


def _softness(image: Image.Image, corners) -> float:
    """Relative lack of fine detail (1 = average), measured on the photograph."""
    xs, ys = [p[0] for p in corners], [p[1] for p in corners]
    crop = image.crop((int(min(xs)) + 30, int(min(ys)) + 30, int(max(xs)) - 30, int(max(ys)) - 30)).convert("L")
    fine = crop.filter(ImageFilter.Kernel((3, 3), [0, -1, 0, -1, 4, -1, 0, -1, 0], 1, 0))
    coarse = crop.filter(ImageFilter.GaussianBlur(2)).filter(ImageFilter.Kernel((3, 3), [0, -1, 0, -1, 4, -1, 0, -1, 0], 1, 0))
    return ImageStat.Stat(fine).mean[0] / max(1e-6, ImageStat.Stat(coarse).mean[0])


def render() -> bytes:
    source = CARDS_JS.read_text()
    corners, whites = _object(source, "CARD_CORNERS"), _object(source, "CARD_PAPER_WHITES")
    photo = Image.open(SOURCE).convert("RGB")
    leaves = Image.open(LEAVES_TEN).convert("RGB")
    cards = list(corners)
    detail = {card: _softness(leaves if card == "leaves-10" else photo,
                              LEAVES_TEN_CORNERS if card == "leaves-10" else corners[card]) for card in cards}
    # The replacement leaves-10 photograph is sharper than the whole deck
    # photo; calibrate on the deck's own crisp centre (90th percentile).
    deck = sorted(value for card, value in detail.items() if card != "leaves-10")
    sharpest = deck[int(len(deck) * .9)]
    rows = -(-len(cards) // COLUMNS)
    atlas = Image.new("RGB", (CELL[0] * COLUMNS, CELL[1] * rows), TARGET_WHITE)
    for index, card in enumerate(cards):
        image, quad = (leaves, LEAVES_TEN_CORNERS) if card == "leaves-10" else (photo, corners[card])
        face = image.transform(CELL, Image.Transform.PERSPECTIVE, _perspective_coefficients(quad, CELL),
                               Image.Resampling.BICUBIC)
        gains = [max(.9, min(1.34, target / white)) for target, white in zip(TARGET_WHITE, whites[card])]
        face = Image.merge("RGB", [channel.point(lambda value, gain=gain: min(255, round(value * gain)))
                                   for channel, gain in zip(face.split(), gains)])
        # Softer photo regions receive proportionally more sharpening, so every
        # card reaches a similar crispness without haloing the sharp centre.
        deficit = max(0.0, 1 - detail[card] / sharpest)
        face = face.filter(ImageFilter.UnsharpMask(radius=1.2, percent=round(70 + 400 * deficit), threshold=3))
        atlas.paste(face, ((index % COLUMNS) * CELL[0], (index // COLUMNS) * CELL[1]))
    buffer = io.BytesIO()
    atlas.save(buffer, "WEBP", quality=80, method=6)
    return buffer.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="fail if the committed atlas is outdated")
    args = parser.parse_args()
    data = render()
    if args.check:
        current = OUTPUT.read_bytes() if OUTPUT.exists() else b""
        if hashlib.sha256(current).digest() != hashlib.sha256(data).digest():
            print(f"{OUTPUT.relative_to(ROOT)} is outdated; run scripts/build_hausdepp_cards.py", file=sys.stderr)
            return 1
        return 0
    OUTPUT.write_bytes(data)
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({len(data) // 1024} KiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
