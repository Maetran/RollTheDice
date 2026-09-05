#!/usr/bin/env python3
"""Fail fast when product documentation, localization, or SEO drift apart."""

from __future__ import annotations

import ast
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class HeadParser(HTMLParser):
    """Read the small amount of metadata the delivery gate needs."""

    def __init__(self) -> None:
        super().__init__()
        self.h1_count = 0
        self.description = ""
        self.robots = ""
        self.canonical = ""
        self.og_title = ""
        self.og_description = ""
        self.og_url = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "h1":
            self.h1_count += 1
        elif tag == "meta" and attributes.get("name") == "description":
            self.description = attributes.get("content") or ""
        elif tag == "meta" and attributes.get("name") == "robots":
            self.robots = attributes.get("content") or ""
        elif tag == "meta" and attributes.get("property") == "og:title":
            self.og_title = attributes.get("content") or ""
        elif tag == "meta" and attributes.get("property") == "og:description":
            self.og_description = attributes.get("content") or ""
        elif tag == "meta" and attributes.get("property") == "og:url":
            self.og_url = attributes.get("content") or ""
        elif tag == "link" and attributes.get("rel") == "canonical":
            self.canonical = attributes.get("href") or ""


def _check(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def achievement_catalog_values() -> list[str]:
    """Read achievement names and descriptions without importing app dependencies.

    This checker intentionally runs with the system ``python3`` from npm scripts,
    so it cannot require SQLAlchemy just to inspect the authored catalog.
    """
    source = (ROOT / "app" / "achievements.py").read_text(encoding="utf-8")
    values: list[str] = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
            continue
        if node.func.id == "Achievement" and len(node.args) >= 3:
            name, description = node.args[1:3]
            if isinstance(name, ast.Constant) and isinstance(name.value, str):
                values.extend((name.value, description.value))
        elif node.func.id == "_tiered" and len(node.args) >= 3 and isinstance(node.args[2], ast.List):
            for item in node.args[2].elts:
                if not isinstance(item, ast.Tuple) or len(item.elts) < 3:
                    continue
                name, description = item.elts[1:3]
                if isinstance(name, ast.Constant) and isinstance(name.value, str):
                    values.extend((name.value, description.value))
    return values


def seo_contract():
    """Import the dependency-free SEO registry only when this check runs."""
    from app.site_seo import PUBLIC_SEO_PAGES, robots_document, sitemap_document

    return PUBLIC_SEO_PAGES, robots_document, sitemap_document


def main() -> int:
    """Validate the versioned product-delivery contract."""
    errors: list[str] = []
    static_dir = ROOT / "app" / "static"
    catalog = (ROOT / "frontend" / "i18n" / "catalog.js").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    rules = (static_dir / "rules.html").read_text(encoding="utf-8")
    public_seo_pages, robots, sitemap = seo_contract()

    registered = {page.static_filename: page for page in public_seo_pages}
    _check(len(registered) == len(public_seo_pages), "SEO registry has duplicate static filenames.", errors)
    for page in public_seo_pages:
        _check((static_dir / page.static_filename).is_file(), f"SEO page is missing: {page.static_filename}", errors)
        _check(
            f"<loc>{page.canonical_url}</loc>" in sitemap(origin=page.origin),
            f"Sitemap does not include {page.canonical_url}",
            errors,
        )

    _check("Sitemap: https://zockdiewandan.online/sitemap.xml" in robots(), "robots.txt lacks the sitemap.", errors)
    _check("Disallow: /api/" in robots(), "robots.txt must keep API responses out of crawl queues.", errors)

    for html_path in sorted(static_dir.glob("*.html")):
        parser = HeadParser()
        parser.feed(html_path.read_text(encoding="utf-8"))
        _check(parser.h1_count == 1, f"{html_path.name}: expected exactly one h1.", errors)
        _check(bool(parser.description), f"{html_path.name}: missing meta description.", errors)
        page = registered.get(html_path.name)
        if page is None:
            _check("noindex" in parser.robots.lower(), f"{html_path.name}: non-public page needs noindex.", errors)
            continue
        _check(len(parser.description) >= 80, f"{html_path.name}: public description is too short.", errors)
        _check(parser.canonical == page.canonical_url, f"{html_path.name}: canonical does not match SEO registry.", errors)
        _check(not parser.robots, f"{html_path.name}: public page must not be noindex.", errors)
        _check(bool(parser.og_title), f"{html_path.name}: public page lacks og:title.", errors)
        _check(bool(parser.og_description), f"{html_path.name}: public page lacks og:description.", errors)
        _check(parser.og_url == page.canonical_url, f"{html_path.name}: og:url does not match SEO registry.", errors)

    for value in achievement_catalog_values():
        _check(f'"{value}":' in catalog, f"Achievement is missing an English catalog entry: {value}", errors)

    _check("## Product delivery gate" in readme, "README lacks the product delivery gate.", errors)
    _check("Achievement milestones" in readme, "README does not document achievement milestones.", errors)
    _check((ROOT / "docs" / "PRODUCT_DELIVERY.md").is_file(), "Product delivery standard is missing.", errors)
    _check((ROOT / "AGENTS.md").is_file(), "Repository delivery instructions are missing.", errors)
    _check("Erfolge &amp; Fortschritt" in rules, "Game guide does not document achievements.", errors)

    if errors:
        print("Product delivery check failed:")
        print("\n".join(f"- {error}" for error in errors))
        return 1
    print("Product delivery, localization, and SEO checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
