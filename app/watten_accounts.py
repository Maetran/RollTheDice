"""Local-only Watten account journeys, sharing the suite's actual accounts."""

from pathlib import Path
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse, Response

from .auth import resolve_session
from .product_hosts import safe_watten_account_path
from .watten_pwa import account_pwa_head
from .watten_readiness import watten_account_preview_enabled

router = APIRouter()
_STATIC = Path(__file__).resolve().parent / "static"
_HEADERS = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"}


def _require_local_preview(request: Request) -> None:
    if not watten_account_preview_enabled(request):
        raise HTTPException(status_code=503, detail="watten_not_available", headers=_HEADERS)


def _account_entry_link(content: str, request: Request) -> str:
    from .watten_access import watten_request_enabled

    if not watten_request_enabled(request):
        # An account-only preview must not link into the closed game surface.
        content = content.replace('href="/watten/konto/fortschritt" data-watten-account-link',
                                  'href="/watten/konto/einstellungen" data-watten-account-link')
    return content


def _page(request: Request, page: str) -> Response:
    _require_local_preview(request)
    content = _account_entry_link(
        (_STATIC / "watten-account.html").read_text(encoding="utf-8").replace("{page}", page), request)
    if page == "home":
        # Explain the closed game and keep account links useful without JS or
        # a working identity request. The small client then localizes the page.
        before, main_content = content.split('<main id="wattenAccount">', 1)
        _initial, after = main_content.split("</main>", 1)
        content = (before + '<main id="wattenAccount"><h1 translate="no">Watten</h1>'
                   '<p>Watten ist noch nicht verfügbar. Dein Konto kannst du hier verwalten.</p>'
                   '<p lang="en">Watten is not available yet. You can manage your account here.</p>'
                   '<p><a href="/watten/anmelden">Anmelden / Sign in</a></p>'
                   '<p><a href="/watten/konto/einstellungen">Kontoeinstellungen / Account settings</a></p>'
                   '</main>' + after)
    return Response(account_pwa_head(content), media_type="text/html", headers=_HEADERS)


@router.get("/watten", include_in_schema=False)
def watten_account_home(request: Request):
    from .watten_access import watten_request_enabled

    if watten_request_enabled(request):
        from .watten_pages import home_page

        return home_page(request)
    return _page(request, "home")


@router.get("/watten/anmelden", include_in_schema=False)
def watten_account_login(request: Request):
    _require_local_preview(request)
    values = request.query_params.getlist("return_to")
    if values and (len(values) != 1 or safe_watten_account_path(values[0]) != values[0]):
        return RedirectResponse("/watten/anmelden?return_to=%2Fwatten", status_code=303, headers=_HEADERS)
    return _page(request, "login")


@router.get("/watten/konto", include_in_schema=False)
@router.get("/watten/konto/einstellungen", include_in_schema=False)
def watten_account_settings(request: Request):
    if not watten_account_preview_enabled(request):
        from .watten_access import require_watten_access

        require_watten_access(request, resolve_session(request))
        # This first private web preview uses the existing suite account flow.
        # Its production account emails never receive a local Watten context.
        return RedirectResponse("/konto", status_code=303, headers=_HEADERS)
    _require_local_preview(request)
    from .watten_access import watten_request_enabled

    destination = "/watten/konto/einstellungen"
    if request.url.path == "/watten/konto" and watten_request_enabled(request):
        destination = "/watten/konto/fortschritt"
    identity = resolve_session(request)
    if not identity:
        return RedirectResponse("/watten/anmelden?" + urlencode({"return_to": destination}),
                                status_code=303, headers=_HEADERS)
    if request.url.path == "/watten/konto":
        if identity.must_change_password:
            return RedirectResponse("/watten/konto/einstellungen#passwort", status_code=303, headers=_HEADERS)
        return RedirectResponse(destination, status_code=308, headers=_HEADERS)
    return _page(request, "settings")


def watten_account_action_page(request: Request, action: str) -> Response:
    _require_local_preview(request)
    if request.query_params.getlist("app") != ["watten"] or len(request.query_params.getlist("return_to")) > 1:
        raise HTTPException(status_code=400, detail="invalid_account_context", headers=_HEADERS)
    content = (_STATIC / "watten-email-action.html").read_text(encoding="utf-8").replace("{action}", action)
    return Response(account_pwa_head(_account_entry_link(content, request)), media_type="text/html",
                    headers={**_HEADERS, "Referrer-Policy": "no-referrer"})
