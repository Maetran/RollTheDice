"""Public game labels; presentation never grants or removes access."""

import json
import re
from html import escape
from pathlib import Path

from fastapi.responses import Response

from .database import database_schema_ready, session_scope
from .feature_flags import game_beta
from .game_types import GAME_TYPES


def game_presentation_payload() -> dict:
    if not database_schema_ready():
        return {game: {"beta": game == "watten"} for game in GAME_TYPES}
    with session_scope() as db:
        return {game: {"beta": game_beta(db, game)} for game in GAME_TYPES}


def game_presentation_markup(content: str) -> str:
    """Provide the initial public labels before the account request finishes."""
    settings = escape(json.dumps(game_presentation_payload(), separators=(",", ":")), quote=True)
    return re.sub(r"<html(?=[\s>])", f'<html data-game-presentation="{settings}"', content, count=1)


def game_manifest_response(path: Path, game: str, *, headers: dict | None = None) -> Response:
    """Project the label without changing installed-app identity or scope."""
    manifest = json.loads(path.read_text(encoding="utf-8"))
    beta = game_presentation_payload()[game]["beta"]
    manifest["name"] = manifest["name"].replace(" [BETA]", "") + (" [BETA]" if beta else "")
    description = manifest.get("description", "").replace(" Öffentliche Beta.", "").replace(" Public beta.", "")
    if beta:
        description += " Public beta." if manifest.get("lang") == "en" else " Öffentliche Beta."
    manifest["description"] = description
    return Response(json.dumps(manifest, ensure_ascii=False), media_type="application/manifest+json",
                    headers={**(headers or {}), "Cache-Control": "no-store"})
