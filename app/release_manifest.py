"""Dependency-free release metadata validation, shared with the deploy host."""

from __future__ import annotations

import re
from dataclasses import dataclass

STABILITY_DE = "Verbesserungen an der Stabilität"
STABILITY_EN = "Stability improvements"


def validate_player_notes(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("Release notes need German and English player notes")
    result = {}
    for language in ("de", "en"):
        notes = value.get(language)
        if not isinstance(notes, dict):
            raise ValueError("Release notes need German and English player notes")
        title, changes = notes.get("title"), notes.get("changes")
        if not isinstance(title, str) or not 1 <= len(title.strip()) <= 100:
            raise ValueError("Release note titles must contain 1–100 characters")
        if not isinstance(changes, list) or not 1 <= len(changes) <= 8:
            raise ValueError("Release notes need 1–8 clear changes per language")
        if any(not isinstance(item, str) or not 1 <= len(item.strip()) <= 300 for item in changes):
            raise ValueError("Each release note must contain 1–300 characters")
        if any(ord(char) < 32 for text in [title, *changes] for char in text):
            raise ValueError("Release notes must be plain single-line text")
        result[language] = {"title": title.strip(), "changes": [item.strip() for item in changes]}
    if len(result["de"]["changes"]) != len(result["en"]["changes"]):
        raise ValueError("Translate every release note into both languages")
    return result


@dataclass(frozen=True)
class ReleaseNotice:
    revision: str
    kind: str
    games: tuple[str, ...]
    summary_de: str
    summary_en: str
    player_notes: dict

    @classmethod
    def from_payload(cls, payload: dict) -> ReleaseNotice:
        if not isinstance(payload, dict) or not re.fullmatch(r"[0-9a-f]{40}", str(payload.get("revision", ""))):
            raise ValueError("A full Git revision is required for release notifications")
        kind = payload.get("kind")
        if kind not in ("backend", "usability"):
            raise ValueError("Release kind must be backend or usability")
        games = payload.get("games")
        if not isinstance(games, list) or not games or any(game not in ("zdwa", "zilch") for game in games):
            raise ValueError("Release games must contain zdwa and/or zilch")
        summaries = (STABILITY_DE, STABILITY_EN) if kind == "backend" else (
            payload.get("summary_de"), payload.get("summary_en"),
        )
        for summary in summaries:
            if not isinstance(summary, str) or not 1 <= len(summary.strip()) <= 140 or any(ord(char) < 32 for char in summary):
                raise ValueError("Usability releases need one short DE/EN summary each (1–140 characters, no newlines)")
        player_notes = payload.get("player_notes") if kind == "usability" else {
            "de": {"title": STABILITY_DE, "changes": ["Wir haben die Zuverlässigkeit der App verbessert, damit deine Partien rund laufen."]},
            "en": {"title": STABILITY_EN, "changes": ["We've improved the app's reliability to help your games run smoothly."]},
        }
        return cls(payload["revision"], kind, tuple(sorted(set(games))), *(summary.strip() for summary in summaries), validate_player_notes(player_notes))

    def payload(self) -> dict:
        return {
            "revision": self.revision, "kind": self.kind, "games": list(self.games),
            "summary_de": self.summary_de, "summary_en": self.summary_en,
            "player_notes": self.player_notes,
        }
