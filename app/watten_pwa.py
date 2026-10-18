"""Installation metadata for the explicitly opted-in local account preview."""

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from .http_cache import read_static_asset_version
from .watten_readiness import watten_account_preview_enabled

router = APIRouter()
_STATIC = Path(__file__).resolve().parent / "static"
_HEADERS = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"}


def _require_local_preview(request: Request) -> None:
    if not watten_account_preview_enabled(request):
        raise HTTPException(status_code=404, detail="not_found", headers=_HEADERS)


@router.api_route("/watten-manifest.webmanifest", methods=["GET", "HEAD"], include_in_schema=False)
@router.api_route("/watten-manifest-en.webmanifest", methods=["GET", "HEAD"], include_in_schema=False)
def watten_manifest(request: Request):
    _require_local_preview(request)
    filename = "watten-manifest-en.webmanifest" if request.url.path.endswith("-en.webmanifest") else "watten-manifest.webmanifest"
    return FileResponse(_STATIC / filename, media_type="application/manifest+json", headers=_HEADERS)


@router.api_route("/watten-sw.js", methods=["GET", "HEAD"], include_in_schema=False)
def watten_worker(request: Request):
    _require_local_preview(request)
    return FileResponse(_STATIC / "watten-sw.js", media_type="text/javascript",
                        headers={**_HEADERS, "Service-Worker-Allowed": "/watten"})


def account_pwa_head(content: str) -> str:
    """Only guarded account renderers may add these local install resources."""
    version = read_static_asset_version(_STATIC)
    suffix = f"?v={version}" if version else ""
    return content.replace('<html lang="de"', '<html lang="de" data-watten-pwa-preview="true"', 1).replace(
        "</head>",
        '<meta name="theme-color" content="#26583e">'
        '<meta name="apple-mobile-web-app-capable" content="yes">'
        '<meta name="apple-mobile-web-app-title" content="Watten">'
        f'<link rel="manifest" data-pwa-product="watten" href="/watten-manifest.webmanifest{suffix}">'
        f'<link rel="icon" type="image/png" sizes="32x32" href="/static/watten/icons/watten-icon-32.png{suffix}">'
        f'<link rel="apple-touch-icon" type="image/png" sizes="180x180" href="/static/watten/icons/watten-icon-180.png{suffix}">'
        '</head>', 1,
    )
