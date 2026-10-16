"""Canonical search-discovery metadata for the stable public pages."""

from __future__ import annotations

from dataclasses import dataclass

SITE_ORIGIN = "https://zockdiewandan.online"
ZILCH_ORIGIN = "https://zilch.zockdiewandan.online"
HAUSDEPP_ORIGIN = "https://hausdepp.zockdiewandan.online"

# Deliberately separate from indexable pages: a new private route must never
# enter a sitemap just because it has a useful title or complete rule text.
PUBLIC_HAUSDEPP_DOCUMENTS = {
    "/hausdepp": "hausdepp-lobby.html",
    "/hausdepp/regeln": "hausdepp-rules.html",
}
PRIVATE_HAUSDEPP_DOCUMENTS = {
    "/hausdepp/konto": "hausdepp-account.html",
    "/hausdepp/rangliste": "hausdepp-leaderboard.html",
    "/hausdepp/spiel/{game_id}": "hausdepp.html",
    "/hausdepp/spiel/{game_id}/zuschauen": "hausdepp.html",
}

# Public product artwork can appear in search/site-name previews. Keep this
# explicit: user uploads, app shells and API responses retain their noindex.
PUBLIC_ZILCH_IMAGE_PATHS = frozenset({
    "/favicon.ico",
    "/static/icons/zilch-icon-32.png",
    "/static/icons/zilch-icon-192.png",
    "/static/icons/zilch-icon-512.png",
    "/static/icons/zilch-apple-touch-icon-180.png",
})
PUBLIC_HAUSDEPP_IMAGE_PATHS = frozenset({
    "/favicon.ico",
    "/static/icons/hausdepp-icon-32.png",
    "/static/icons/hausdepp-icon-192.png",
    "/static/icons/hausdepp-icon-512.png",
    "/static/icons/hausdepp-apple-touch-icon-180.png",
})


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
    PublicSeoPage("/hausdepp", "hausdepp-lobby.html", "weekly", 0.8, origin=HAUSDEPP_ORIGIN),
    PublicSeoPage("/hausdepp/regeln", "hausdepp-rules.html", "monthly", 0.8, origin=HAUSDEPP_ORIGIN),
)


def robots_document(*, origin: str = SITE_ORIGIN) -> str:
    """Return crawler guidance without blocking pages that need a noindex tag."""
    return "\n".join(
        (
            "User-agent: *",
            "Disallow: /api/",
            "Disallow: /docs",
            "Disallow: /openapi.json",
            "Allow: /",
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


def hausdepp_page_is_indexable(path: str) -> bool:
    """Only the lobby and evergreen rule guide are public discovery documents."""
    return path in PUBLIC_HAUSDEPP_DOCUMENTS
