"""Dependency-free release metadata validation, shared with the deploy host."""

from __future__ import annotations

import re
from dataclasses import dataclass

STABILITY_DE = "Verbesserungen an der Stabilität"
STABILITY_EN = "Stability improvements"


@dataclass(frozen=True)
class ReleaseNotice:
    revision: str
    kind: str
    games: tuple[str, ...]
    summary_de: str
    summary_en: str

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
        return cls(payload["revision"], kind, tuple(sorted(set(games))), *(summary.strip() for summary in summaries))

    def payload(self) -> dict:
        return {
            "revision": self.revision, "kind": self.kind, "games": list(self.games),
            "summary_de": self.summary_de, "summary_en": self.summary_en,
        }
