"""Prepare a reviewed deploy announcement without guessing user-facing copy."""

from __future__ import annotations

# Operator-only, read-only Git commands. Never execute a shell or user input.
import argparse
import json
import shutil
import subprocess  # nosec B404
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.release_manifest import ReleaseNotice  # noqa: E402

NOTICE_PATH = "app/release-notice.json"


def prepare_notice(*, revision: str, changed: list[str], notes: dict) -> dict:
    runtime = [path for path in changed if path.startswith(("app/", "frontend/")) or path in {
        "Dockerfile", "requirements.txt", "docker-compose.yml",
        "manifest.webmanifest", "manifest-en.webmanifest", "zilch-manifest.webmanifest", "zilch-manifest-en.webmanifest",
    }]
    if not runtime:
        return {"skip": True}
    visible = any(path.startswith(("frontend/", "app/static/")) or path.endswith(".webmanifest") for path in runtime)
    if NOTICE_PATH in changed:
        notice = ReleaseNotice.from_payload({**notes, "revision": revision})
        if visible and notice.kind != "usability":
            raise ValueError("Visible changes need a usability release note in app/release-notice.json")
    else:
        if visible:
            raise ValueError("Update app/release-notice.json with a fresh, short DE/EN usability summary before deploying")
        # Never re-use a previous feature announcement for a backend release.
        notice = ReleaseNotice.from_payload({"revision": revision, "kind": "backend", "games": ["zdwa", "zilch"]})
    return notice.payload()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--previous", required=True)
    args = parser.parse_args()
    git = shutil.which("git")
    if git is None:
        raise RuntimeError("Git is required to prepare release notifications")
    # Fixed arguments, resolved executable, no shell.
    revision = subprocess.check_output([git, "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()  # nosec B603
    # Validate the persisted deployment marker before using it as a Git ref.
    ReleaseNotice.from_payload({"revision": args.previous, "kind": "backend", "games": ["zdwa"]})
    ReleaseNotice.from_payload({"revision": revision, "kind": "backend", "games": ["zdwa"]})
    # Both variable arguments are validated 40-hex revisions, never options.
    changed = subprocess.check_output([git, "diff", "--name-only", args.previous, revision, "--"], cwd=ROOT, text=True).splitlines()  # nosec B603
    notes = json.loads((ROOT / NOTICE_PATH).read_text(encoding="utf-8"))
    print(json.dumps(prepare_notice(revision=revision, changed=changed, notes=notes), ensure_ascii=False))


if __name__ == "__main__":
    main()
