"""Initial public content and crawlable links, never personal account data."""

from __future__ import annotations

import json
import re
from html import escape

from .achievements import achievement_rank_legend_payload
from .game_access import can_access_zilch_preview
from .game_presentation import game_presentation_markup
from .site_seo import HAUSDEPP_ORIGIN, SITE_ORIGIN, WATTEN_ORIGIN, ZILCH_ORIGIN
from .watten_readiness import watten_public_beta_enabled

_SUITE_SCRIPT = re.compile(r'(<script\b[^>]*\bdata-suite-discovery[^>]*>)(.*?)(</script>)', re.DOTALL)


def public_suite_members(request) -> list[dict[str, str]]:
    """Use anonymous release capabilities, including Watten's raw Host guard."""
    members = [("ZDWA", f"{SITE_ORIGIN}/")]
    if can_access_zilch_preview(None):
        members.append(("Zilch die Wand an", f"{ZILCH_ORIGIN}/"))
    members.append(("Hausdepp", f"{HAUSDEPP_ORIGIN}/hausdepp"))
    if watten_public_beta_enabled(request):
        members.append(("Watten", f"{WATTEN_ORIGIN}/watten"))
    return [{"@type": "VideoGame", "@id": url + "#game", "name": name, "url": url}
            for name, url in members]


def _suite(members: list[dict[str, str]]) -> dict:
    return {"@type": "CreativeWorkSeries", "@id": f"{SITE_ORIGIN}/#game-suite",
            "name": " · ".join(member["name"] for member in members),
            "url": f"{SITE_ORIGIN}/", "hasPart": members}


def public_suite_markup(content: str, request, *, language: str = "de") -> str:
    """Render only when called by a registered public-document route.

    Keep the footer outside client-rendered game roots so hydration cannot
    erase discovery links. API and private shell callers do not use this hook.
    """
    members = public_suite_members(request)

    def schema(match):
        payload = json.loads(match.group(2))
        for node in payload.get("@graph", [payload]):
            if node.get("@type") == "VideoGame":
                node["isPartOf"] = _suite(members)
        return match.group(1) + json.dumps(payload, ensure_ascii=False) + match.group(3)

    content = _SUITE_SCRIPT.sub(schema, content)
    label, heading = (("Games in this suite", "More games") if language == "en"
                      else ("Spiele der Suite", "Weitere Spiele"))
    links = []
    for member in members:
        url = member["url"] + ("?lang=en" if language == "en" and member["url"].startswith(WATTEN_ORIGIN) else "")
        links.append(f'<a href="{escape(url, quote=True)}" translate="no">{escape(member["name"])}</a>')
    footer = (f'<footer data-public-suite-links><nav aria-label="{label}"><p><strong>{heading}</strong></p>'
              + '<ul>' + ''.join(f'<li>{link}</li>' for link in links) + '</ul></nav></footer>')
    return game_presentation_markup(content.replace("</body>", footer + "\n</body>", 1))


def public_rank_guide(content: str) -> str:
    """Render the same public catalogue that the interactive legend hydrates."""
    payload = achievement_rank_legend_payload()
    rows = []
    for rank in payload["ranks"]:
        key, title = escape(rank["key"], quote=True), escape(rank["title"])
        stars = "★" * rank["stars"] or "☆"
        rows.append(
            f'<li class="rank-legend-row" data-rank-key="{key}" data-rank-minimum="{rank["minimum_points"]}">'
            f'<span class="rank-legend-insignia rank-legend-insignia--{key}" aria-label="{rank["stars"]} Sterne">{stars}</span>'
            f'<span class="rank-legend-title"><strong>{title}</strong>'
            '<small>Ab diesem Wert trägst du dieses Rangabzeichen.</small></span>'
            f'<span class="rank-legend-minimum">ab {rank["minimum_points"]} Ehrenberg-Marken</span></li>'
        )
    summary = ('<div class="rank-legend-stat"><small>Aktuell möglich</small>'
               f'<strong>{payload["points_possible"]} Ehrenberg-Marken</strong></div>'
               f'<div class="rank-legend-stat"><small>Rangstufen</small><strong>{len(rows)}</strong></div>')
    return content.replace("<!-- public-rank-summary -->", summary).replace("<!-- public-rank-rows -->", "".join(rows))


def public_game_suite(request) -> dict:
    """Share the exact same public membership with Watten's generated schema."""
    return _suite(public_suite_members(request))
