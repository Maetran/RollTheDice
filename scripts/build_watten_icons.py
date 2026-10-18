#!/usr/bin/env python3
"""Rasterize our small rect/polygon SVG mark reproducibly using existing Pillow."""

from __future__ import annotations

import argparse
import io
from html.parser import HTMLParser
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "frontend/watten/icon.svg"
OUTPUT = ROOT / "app/static/watten/icons"


class _IconShapes(HTMLParser):
    def __init__(self, source: str):
        super().__init__()
        self.shapes = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        if tag in {"rect", "polygon"}:
            self.shapes.append((tag, dict(attrs)))
        elif tag not in {"svg", "title"}:
            raise ValueError(f"Unsupported icon vector element: {tag}")


def rendered_icons() -> dict[str, bytes]:
    scale = 4
    image = Image.new("RGB", (512 * scale, 512 * scale), "#26583e")
    draw = ImageDraw.Draw(image)
    for kind, attrs in _IconShapes(SOURCE.read_text(encoding="utf-8")).shapes:
        fill = attrs.get("fill")
        stroke = attrs.get("stroke")
        width = round(float(attrs.get("stroke-width", "0")) * scale)
        if kind == "rect":
            x, y, w, h = (float(attrs[key]) * scale for key in ("x", "y", "width", "height"))
            draw.rounded_rectangle((x, y, x + w, y + h), radius=float(attrs.get("rx", "0")) * scale,
                                   fill=fill, outline=stroke, width=width or 1)
        elif kind == "polygon":
            points = [tuple(float(part) * scale for part in point.split(",")) for point in attrs["points"].split()]
            draw.polygon(points, fill=fill)
            if stroke:
                draw.line([*points, points[0]], fill=stroke, width=width, joint="curve")
    result = {"watten-icon.svg": SOURCE.read_bytes()}
    for size in (32, 180, 192, 512):
        output = io.BytesIO()
        image.resize((size, size), Image.Resampling.LANCZOS).save(output, format="PNG", optimize=True)
        result[f"watten-icon-{size}.png"] = output.getvalue()
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    stale = []
    for filename, data in rendered_icons().items():
        target = OUTPUT / filename
        if target.exists() and target.read_bytes() == data:
            continue
        stale.append(filename)
        if not arguments.check:
            OUTPUT.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    if arguments.check and stale:
        print("Stale Watten icons: " + ", ".join(stale))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
