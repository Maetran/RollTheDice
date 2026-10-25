"""Canonical Watten pages behind the native account-scoped preview boundary."""

import re
from pathlib import Path
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse, Response

from .auth import resolve_session
from .product_hosts import is_watten_host
from .public_discovery import public_suite_markup
from .site_seo import PUBLIC_WATTEN_DOCUMENTS
from .watten_access import require_watten_access, watten_game_preview_enabled, watten_request_enabled
from .watten_pwa import account_pwa_head
from .watten_readiness import watten_account_preview_enabled, watten_public_beta_enabled
from .watten_seo import public_watten_metadata

router = APIRouter()
_STATIC = Path(__file__).resolve().parent / "static"
_HEADERS = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"}
_GAME_ID = re.compile(r"[0-9a-f]{16}")


def _require_preview(request: Request) -> None:
    if not watten_request_enabled(request):
        raise HTTPException(status_code=404, detail="game_not_found", headers=_HEADERS)
    if watten_public_beta_enabled(request):
        return
    if watten_game_preview_enabled(request):
        if not watten_account_preview_enabled(request):
            raise HTTPException(status_code=404, detail="game_not_found", headers=_HEADERS)
    else:
        require_watten_access(request, resolve_session(request))


def _page(request: Request, filename: str, page: str, *, game_id: str = "") -> Response:
    _require_preview(request)
    public = watten_public_beta_enabled(request) and page in {"lobby", "rules"}
    language = "en" if request.query_params.getlist("lang") == ["en"] else "de"
    if public:
        filename = PUBLIC_WATTEN_DOCUMENTS["/watten/regeln" if page == "rules" else "/watten"]
    path = _STATIC / filename
    if not path.is_file():
        raise HTTPException(status_code=503, detail="watten_preview_not_ready", headers=_HEADERS)
    content = path.read_text(encoding="utf-8").replace("{watten_page}", page).replace("{game_id}", game_id)
    headers = dict(_HEADERS)
    if public:
        if page == "rules":
            rules = (_STATIC / "watten-rules.html").read_text(encoding="utf-8")
            article = re.search(r'<article lang="' + language + r'".*?</article>', rules, re.DOTALL)
            content = content.replace("{watten_rules_content}", article.group(0) if article else "")
        content, canonical = public_watten_metadata(content, page=page, language=language, request=request)
        content = public_suite_markup(content, request, language=language)
        headers.update({"Content-Language": language, "Link": f'<{canonical}>; rel="canonical"'})
        if is_watten_host(request):
            del headers["X-Robots-Tag"]
    return Response(account_pwa_head(content) if watten_account_preview_enabled(request) else content,
                    media_type="text/html", headers=headers)


def home_page(request: Request) -> Response:
    return _page(request, "watten-game.html", "lobby")


@router.get("/watten/regeln", include_in_schema=False)
def watten_rules_page(request: Request):
    return _page(request, "watten-rules.html", "rules")


def _table_page(request: Request, game_id: str, *, spectator: bool) -> Response:
    _require_preview(request)
    if not _GAME_ID.fullmatch(game_id):
        raise HTTPException(status_code=404, detail="game_not_found", headers=_HEADERS)
    if resolve_session(request) is None:
        return RedirectResponse("/watten/anmelden?" + urlencode({"return_to": request.url.path}),
                                status_code=303, headers=_HEADERS)
    return _page(request, "watten-game.html", "spectator" if spectator else "table", game_id=game_id)


@router.get("/watten/spiel/{game_id}", include_in_schema=False)
def watten_table_page(game_id: str, request: Request):
    return _table_page(request, game_id, spectator=False)


@router.get("/watten/spiel/{game_id}/zuschauen", include_in_schema=False)
def watten_spectator_page(game_id: str, request: Request):
    return _table_page(request, game_id, spectator=True)
