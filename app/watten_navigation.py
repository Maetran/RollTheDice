"""Server-owned Watten main-menu entries for every deployment variant.

The header's account entry always means account settings. Native Watten
settings exist for the public beta and the local account preview; the private
founder preview opens the settings tab of the shared suite account, where its
settings route already redirects. That page links back to Watten progress. Markers, not literal hrefs, identify the links so header
edits cannot silently reopen a game or account route.
"""

import re

from starlette.requests import HTTPConnection

from .watten_readiness import watten_account_preview_enabled

NATIVE_ACCOUNT_SETTINGS = "/watten/konto/einstellungen"
# The shared account opens on its settings tab, matching the native entry.
SHARED_ACCOUNT_SETTINGS = "/konto#settings"
_ACCOUNT_LINK = re.compile(r'(<a\b[^>]*?\bhref=")[^"]*("[^>]*\bdata-watten-account-link\b)')
_RANKING_LINK = re.compile(r'\s*<a\b[^>]*\bdata-watten-ranking-link\b[^>]*>.*?</a>', re.DOTALL)


def watten_account_entry(connection: HTTPConnection) -> str:
    """Return the settings destination that this deployment actually serves."""
    return NATIVE_ACCOUNT_SETTINGS if watten_account_preview_enabled(connection) else SHARED_ACCOUNT_SETTINGS


def apply_watten_navigation(content: str, connection: HTTPConnection, *, ranking: bool = True) -> str:
    """Point every marked account entry at the served settings page.

    ``ranking=False`` removes Spieler & Ranking for an account without access to
    the closed game surface.
    """
    entry = watten_account_entry(connection)
    content = _ACCOUNT_LINK.sub(lambda match: f"{match.group(1)}{entry}{match.group(2)}", content)
    if not ranking:
        content = _RANKING_LINK.sub("", content)
    return content
