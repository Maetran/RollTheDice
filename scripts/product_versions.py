#!/usr/bin/env python3
"""Check or deliberately advance the shared ZDWA/Zilch product version."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess  # nosec B404
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.versioning import next_version, version_tuple  # noqa: E402

CURRENT = ROOT / "app/version.json"
HISTORY = ROOT / "app/version-history.json"
DOCUMENT = ROOT / "docs/VERSION_HISTORY.md"


def git(*arguments: str) -> str:
    executable = shutil.which("git")
    if not executable:
        raise ValueError("Git is required for release version checks")
    return subprocess.check_output([executable, *arguments], cwd=ROOT, text=True).strip()  # nosec B603


def validate(current: dict, history: list[dict]) -> None:
    if not history:
        raise ValueError("Keep the recorded version history")
    seen = set()
    previous = "0.0.0"
    for entry in history:
        revision = entry["revision"]
        if not re.fullmatch(r"[0-9a-f]{40}", revision) or revision in seen:
            raise ValueError("Every historical change needs one unique full Git revision")
        seen.add(revision)
        if entry["version"] != next_version(previous, entry["bump"]):
            raise ValueError(f"Incorrect {entry['bump']} increment after {previous}")
        date.fromisoformat(entry["date"])
        if not entry["summary"].strip():
            raise ValueError("Historical changes need a summary")
        previous = entry["version"]
    if current["version"] != next_version(previous, current["bump"]):
        raise ValueError(f"Current version must be the next {current['bump']} after {previous}")
    if current["previous_revision"] != history[-1]["revision"]:
        raise ValueError("Current version must point to the last recorded change")
    date.fromisoformat(current["date"])
    if any(not isinstance(current["summary"].get(lang), str) or not current["summary"][lang].strip() for lang in ("de", "en")):
        raise ValueError("The current version needs German and English summaries")


def history_document(current: dict, history: list[dict]) -> str:
    lines = [
        "# Versionen / Versions", "",
        f"Aktuelle gemeinsame Produktversion / Current shared product version: **{current['version']}**.", "",
        "ZDWA und Zilch werden gemeinsam versioniert. Major steht für einen großen",
        "Produktmeilenstein, Minor für neue Funktionen und Patch für Fehlerkorrekturen",
        "oder Wartung. Ein Major-Schritt setzt Minor und Patch zurück; Minor setzt Patch zurück.", "",
        "ZDWA and Zilch share one version stream. Major marks a major product milestone,",
        "Minor adds features, and Patch covers fixes or maintenance. Major resets Minor",
        "and Patch; Minor resets Patch.", "",
        "Die ersten 264 Einträge bis einschließlich 2.35.1 wurden am 20.09.2026 rückwirkend",
        "aus den Integrationen auf dem Hauptzweig zugeordnet. Daten sind Commitdaten,",
        "keine behaupteten Veröffentlichungsdaten. Frühere Tags oder Benachrichtigungen",
        "werden dadurch nicht erzeugt. Die Originaltitel bleiben zur Nachvollziehbarkeit erhalten.", "",
        "The first 264 entries through 2.35.1 were retrospectively assigned on 2026-09-20",
        "from main-branch integrations. Dates are commit dates, not claimed deployment dates.",
        "This creates no historical tags or notifications. Original commit titles are kept for traceability.", "",
        "1.0.0 bezeichnet das erste spielbare ZDWA, 2.0.0 die öffentliche Zilch-Beta als zweites Spiel.",
        "1.0.0 identifies the first playable ZDWA; 2.0.0 introduces the public Zilch beta as a second game.", "",
        "Die ausführlichen Beschreibungen stehen im [Changelog](../CHANGELOG.md).",
        "Detailed player-facing descriptions are in the [changelog](../CHANGELOG.md).", "",
        "| Version | Datum / Date | Art / Type | Änderung / Change | Commit |",
        "| --- | --- | --- | --- | --- |",
    ]
    for entry in reversed(history):
        summary = entry["summary"].replace("|", "\\|").replace("\n", " ")
        revision = entry["revision"]
        lines.append(f"| {entry['version']} | {entry['date']} | {entry['bump']} | {summary} | [{revision[:7]}](https://github.com/Maetran/RollTheDice/commit/{revision}) |")
    return "\n".join(lines) + "\n"


def validate_deploy(current: dict, history: list[dict], previous: str, head: str, previous_version: str) -> None:
    if previous == head:
        return  # A healthy version may be deployed again without inventing a release.
    if version_tuple(current["version"]) <= version_tuple(previous_version):
        raise ValueError("Advance app/version.json before deploying a new revision, including silent releases")
    recorded = {entry["revision"]: entry["version"] for entry in history}
    if recorded.get(previous) != previous_version:
        raise ValueError("Record the previously deployed revision and its unchanged version in version-history.json")


def check(current: dict, history: list[dict], previous: str | None) -> None:
    validate(current, history)
    if DOCUMENT.read_text(encoding="utf-8") != history_document(current, history):
        raise ValueError("Version history document is stale; run scripts/product_versions.py history")
    if f"## {current['version']} " not in (ROOT / "CHANGELOG.md").read_text(encoding="utf-8"):
        raise ValueError("Add the current product version to CHANGELOG.md")
    if previous:
        if not re.fullmatch(r"[0-9a-f]{40}", previous):
            raise ValueError("Previous deployment must be a full Git revision")
        exists = subprocess.run([shutil.which("git"), "cat-file", "-e", f"{previous}:app/version.json"], cwd=ROOT, capture_output=True, check=False).returncode == 0  # nosec B603
        if exists:
            old_version = json.loads(git("show", f"{previous}:app/version.json"))["version"]
        else:
            old_version = next((entry["version"] for entry in history if entry["revision"] == previous), None)
            if old_version is None:
                raise ValueError("The previous unversioned deployment needs an explicit historical mapping")
        validate_deploy(current, history, previous, git("rev-parse", "HEAD"), old_version)
    print(f"Product version {current['version']}: history and release sequence valid")


def bump(current: dict, history: list[dict], kind: str, summary_de: str, summary_en: str) -> tuple[dict, list[dict]]:
    revision = git("rev-parse", "HEAD")
    if revision == current["previous_revision"]:
        raise ValueError("The current version is still being prepared; do not increment it twice")
    committed = json.loads(git("show", "HEAD:app/version.json"))
    if committed != current:
        raise ValueError("Current version metadata already has uncommitted changes")
    history = [*history, {"version": current["version"], "revision": revision,
                         "date": git("show", "-s", "--format=%cs", "HEAD"), "bump": current["bump"],
                         "summary": f"{current['summary']['de']} / {current['summary']['en']}"}]
    current = {"version": next_version(current["version"], kind), "bump": kind, "date": date.today().isoformat(),
               "previous_revision": revision, "summary": {"de": summary_de, "en": summary_en}}
    validate(current, history)
    return current, history


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    checker = commands.add_parser("check")
    checker.add_argument("--previous")
    commands.add_parser("history")
    bumper = commands.add_parser("bump")
    bumper.add_argument("kind", choices=("major", "minor", "patch"))
    bumper.add_argument("--summary-de", required=True)
    bumper.add_argument("--summary-en", required=True)
    args = parser.parse_args()
    current = json.loads(CURRENT.read_text(encoding="utf-8"))
    history = json.loads(HISTORY.read_text(encoding="utf-8"))
    if args.command == "check":
        check(current, history, args.previous)
    else:
        if args.command == "bump":
            current, history = bump(current, history, args.kind, args.summary_de, args.summary_en)
            CURRENT.write_text(json.dumps(current, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            HISTORY.write_text(json.dumps(history, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        validate(current, history)
        DOCUMENT.write_text(history_document(current, history), encoding="utf-8")
        print(f"Product version {current['version']}; add its bilingual CHANGELOG entry before deploying")


if __name__ == "__main__":
    main()
