"""Canonical search-discovery metadata for the stable public pages."""

from __future__ import annotations

from dataclasses import dataclass

SITE_ORIGIN = "https://zockdiewandan.online"
ZILCH_ORIGIN = "https://zilch.zockdiewandan.online"


@dataclass(frozen=True)
class PublicSeoPage:
    """One evergreen page that is eligible for search indexing."""

    path: str
    static_filename: str
    changefreq: str
    priority: float
    origin: str = SITE_ORIGIN

    @property
    def canonical_url(self) -> str:
        return f"{self.origin}{self.path}"


# This is the single source of truth for indexable pages. New public pages are
# automatically included in the sitemap once they are registered here. Account,
# game, result and administration pages intentionally remain noindex because
# their contents are personal, short-lived, or access-controlled.
PUBLIC_SEO_PAGES: tuple[PublicSeoPage, ...] = (
    PublicSeoPage("/", "index.html", "weekly", 1.0),
    PublicSeoPage("/regeln", "rules.html", "monthly", 0.9),
    PublicSeoPage("/spieler", "players.html", "daily", 0.8),
    PublicSeoPage("/rangabzeichen", "ranks.html", "monthly", 0.6),
    # Zilch is a separate public product host. Game rooms, account surfaces,
    # results and individual player profiles remain intentionally noindex.
    PublicSeoPage("/", "zilch-lobby.html", "weekly", 0.8, origin=ZILCH_ORIGIN),
    PublicSeoPage("/regeln", "zilch-rules.html", "monthly", 0.8, origin=ZILCH_ORIGIN),
)


def robots_document(*, origin: str = SITE_ORIGIN) -> str:
    """Return crawler guidance without blocking pages that need a noindex tag."""
    return "\n".join(
        (
            "User-agent: *",
            "Allow: /",
            "Disallow: /api/",
            "Disallow: /docs",
            "Disallow: /openapi.json",
            f"Sitemap: {origin}/sitemap.xml",
            "",
        )
    )


def sitemap_document(*, origin: str = SITE_ORIGIN) -> str:
    """Render one host's stable public pages from the shared registry."""
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for page in PUBLIC_SEO_PAGES:
        if page.origin != origin:
            continue
        lines.extend(
            (
                "  <url>",
                f"    <loc>{page.canonical_url}</loc>",
                f"    <changefreq>{page.changefreq}</changefreq>",
                f"    <priority>{page.priority:.1f}</priority>",
                "  </url>",
            )
        )
    lines.extend(("</urlset>", ""))
    return "\n".join(lines)


def zilch_page_is_indexable(path: str) -> bool:
    """Keep private room/account URLs out of crawlers despite one SPA shell."""
    return any(page.origin == ZILCH_ORIGIN and page.path == path for page in PUBLIC_SEO_PAGES)
