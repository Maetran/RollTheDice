#!/usr/bin/env python3
"""Decide whether a master promotion may reuse the develop check of the same commit.

The quality workflow checks every integrated develop state in full. When master
is fast-forwarded to such a commit, ``verify`` lets the master run reuse that
evidence only if all of the following hold:

* the run is a non-forced push to ``refs/heads/master`` whose ``after`` commit is
  the checked-out ``GITHUB_SHA``;
* the current run belongs to ``.github/workflows/quality.yml`` in this repository;
* at least one push run of that same workflow on ``develop`` exists for exactly
  this commit in this repository, and every such run completed with ``success``;
* in the newest of those runs every full-check job and the result job succeeded,
  its own evidence gate was skipped and no unknown job exists;
* ``develop`` still contains the commit.

Anything else, including API errors, truncated listings and running, failed,
cancelled or partial runs, selects the full check. ``result`` turns the job
results into the one meaningful check: skipped jobs never pass on their own.
Only the standard library is used, so the system ``python3`` of a runner works.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

WORKFLOW_PATH = ".github/workflows/quality.yml"
RELEASE_REF = "refs/heads/master"
EVIDENCE_BRANCH = "develop"
GATE_NEED = "release-evidence"
GATE_JOB = "Release evidence"
RESULT_JOB = "Quality result"
# Job ids aggregated by the result job and the check names they produce.
# tests/test_ci_workflow.py keeps both in sync with the workflow.
FULL_CHECK_NEEDS = ("production-image", "backend", "browser")
FULL_CHECK_JOBS = (
    "production-image",
    "backend",
    "Browser (main, 1/4)",
    "Browser (main, 2/4)",
    "Browser (main, 3/4)",
    "Browser (main, 4/4)",
    "Browser (username, 1/1)",
    "Browser (passkeys, 1/1)",
    "Browser (hausdepp-passkeys, 1/1)",
)
SHA_PATTERN = re.compile(r"[0-9a-f]{40}")

Get = Callable[[str], Any]


@dataclass(frozen=True)
class Decision:
    reuse: bool
    reason: str
    evidence_run_id: int | None = None


class EvidenceRejected(Exception):
    """The available evidence does not prove that this exact commit passed in full."""


def _require(condition: bool, reason: str) -> None:
    if not condition:
        raise EvidenceRejected(reason)


def _workflow_path(run: Mapping[str, Any]) -> str:
    # Some API responses append "@<ref>" to the workflow file path.
    return str(run.get("path") or "").partition("@")[0]


def _from_repository(run: Mapping[str, Any], repository: str) -> bool:
    return ((run.get("repository") or {}).get("full_name") == repository
            and (run.get("head_repository") or {}).get("full_name") == repository)


def decide_reuse(env: Mapping[str, str], event: Mapping[str, Any], get: Get) -> Decision:
    """Return a reuse decision, raising for anything that requires the full check."""
    sha = env.get("GITHUB_SHA", "")
    repository = env.get("GITHUB_REPOSITORY", "")
    run_id = env.get("GITHUB_RUN_ID", "")
    _require(env.get("GITHUB_EVENT_NAME") == "push" and env.get("GITHUB_REF") == RELEASE_REF,
             "only a push to master can reuse develop evidence")
    _require(bool(SHA_PATTERN.fullmatch(sha)) and "/" in repository and run_id.isdigit(),
             "incomplete run context")
    _require(event.get("forced") is False and event.get("deleted") is False and event.get("after") == sha,
             "not a plain fast-forward push of this commit")

    current = get(f"/repos/{repository}/actions/runs/{run_id}")
    workflow_id = current.get("workflow_id")
    _require(isinstance(workflow_id, int) and _workflow_path(current) == WORKFLOW_PATH
             and _from_repository(current, repository) and current.get("event") == "push"
             and current.get("head_branch") == "master" and current.get("head_sha") == sha,
             "current run is not the trusted quality workflow for this push")

    query = urllib.parse.urlencode({"event": "push", "branch": EVIDENCE_BRANCH, "head_sha": sha, "per_page": 100})
    listing = get(f"/repos/{repository}/actions/workflows/{workflow_id}/runs?{query}")
    runs = listing.get("workflow_runs")
    _require(isinstance(runs, list) and listing.get("total_count") == len(runs), "develop run listing is incomplete")
    _require(bool(runs), "no develop push run exists for this commit")
    for run in runs:
        _require(run.get("head_sha") == sha and run.get("event") == "push"
                 and run.get("head_branch") == EVIDENCE_BRANCH and run.get("workflow_id") == workflow_id
                 and _workflow_path(run) == WORKFLOW_PATH and _from_repository(run, repository),
                 f"run {run.get('id')} is not a trusted develop push run of this commit")
        _require(run.get("status") == "completed" and run.get("conclusion") == "success",
                 f"develop run {run.get('id')} is {run.get('status')}/{run.get('conclusion')}")
    evidence = max(runs, key=lambda run: (run.get("run_number") or 0, run.get("id") or 0))
    evidence_id = evidence.get("id")
    _require(isinstance(evidence_id, int) and str(evidence_id) != run_id, "evidence run has no usable id")

    jobs_listing = get(f"/repos/{repository}/actions/runs/{evidence_id}/jobs?filter=latest&per_page=100")
    jobs = jobs_listing.get("jobs")
    _require(isinstance(jobs, list) and jobs_listing.get("total_count") == len(jobs),
             "evidence job listing is incomplete")
    conclusions: dict[str, str | None] = {}
    for job in jobs:
        name = job.get("name")
        _require(job.get("run_id") == evidence_id and job.get("head_sha") == sha and job.get("status") == "completed",
                 f"job {name!r} is not a completed job of the evidence run")
        _require(isinstance(name, str) and name not in conclusions, f"job {name!r} is ambiguous")
        conclusions[name] = job.get("conclusion")
    for name in (*FULL_CHECK_JOBS, RESULT_JOB):
        _require(conclusions.pop(name, None) == "success", f"evidence job {name!r} did not succeed")
    # A develop run never reuses evidence itself, so its gate must not have run.
    _require(conclusions.pop(GATE_JOB, "skipped") == "skipped", "evidence run did not run the full check itself")
    _require(not conclusions, f"evidence run has unexpected jobs: {sorted(conclusions)}")

    comparison = get(f"/repos/{repository}/compare/{sha}...{EVIDENCE_BRANCH}?per_page=1")
    _require(comparison.get("status") in {"identical", "ahead"} and comparison.get("behind_by") == 0,
             "develop no longer contains this commit")
    return Decision(True, f"develop run {evidence_id} passed every full-check job for this exact commit", evidence_id)


def safe_decision(env: Mapping[str, str], event: Mapping[str, Any], get: Get) -> Decision:
    try:
        return decide_reuse(env, event, get)
    except EvidenceRejected as rejection:
        return Decision(False, str(rejection))
    except Exception as error:
        # Any doubt runs the full check instead of failing open.
        return Decision(False, f"evidence could not be verified ({type(error).__name__})")


def github_getter(env: Mapping[str, str]) -> Get:
    api_url = env.get("GITHUB_API_URL", "https://api.github.com")
    token = env.get("GH_TOKEN", "")

    def get(path: str) -> Any:
        _require(api_url.startswith("https://") and bool(token), "no GitHub API access")
        request = urllib.request.Request(api_url + path, headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "rollthedice-quality-gate",
            "X-GitHub-Api-Version": "2022-11-28",
        })
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)

    return get


def _append(env: Mapping[str, str], variable: str, text: str) -> None:
    if path := env.get(variable):
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(text)


def verify(env: Mapping[str, str], get: Get | None = None) -> int:
    try:
        event = json.loads(Path(env["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    except (KeyError, OSError, ValueError):
        event = {}
    decision = safe_decision(env, event, get or github_getter(env))
    reason = " ".join(decision.reason.split())
    evidence_url = ""
    if decision.reuse:
        server = env.get("GITHUB_SERVER_URL", "https://github.com")
        evidence_url = f"{server}/{env['GITHUB_REPOSITORY']}/actions/runs/{decision.evidence_run_id}"
        message = (f"Reusing [develop run {decision.evidence_run_id}]({evidence_url}) for commit "
                   f"`{env['GITHUB_SHA']}`: {reason}. The full-check jobs are skipped, not marked as passed; "
                   f"{RESULT_JOB} records this evidence.")
    else:
        message = f"Full check required: {reason}."
    _append(env, "GITHUB_OUTPUT", f"reuse={str(decision.reuse).lower()}\n"
                                  f"evidence_run_id={decision.evidence_run_id or ''}\n"
                                  f"evidence_url={evidence_url}\nreason={reason}\n")
    _append(env, "GITHUB_STEP_SUMMARY", f"### {GATE_JOB}\n\n{message}\n")
    print(message)
    return 0


def decide_result(needs: Mapping[str, Any]) -> tuple[bool, str]:
    results = {name: (needs.get(name) or {}).get("result") for name in FULL_CHECK_NEEDS}
    if all(result == "success" for result in results.values()):
        return True, "Full check passed: every full-check job succeeded."
    gate = needs.get(GATE_NEED) or {}
    outputs = gate.get("outputs") or {}
    evidence_run_id = str(outputs.get("evidence_run_id") or "")
    if (gate.get("result") == "success" and outputs.get("reuse") == "true" and evidence_run_id.isdigit()
            and all(result == "skipped" for result in results.values())):
        return True, (f"Reused verified evidence: develop run {evidence_run_id} passed every full-check job "
                      f"for this exact commit ({outputs.get('evidence_url') or 'no link'}).")
    states = ", ".join(f"{name}={result}" for name, result in results.items())
    return False, f"Quality check incomplete: {states}, {GATE_NEED}={gate.get('result')}."


def result(env: Mapping[str, str]) -> int:
    try:
        needs = json.loads(env.get("NEEDS_JSON") or "{}")
    except ValueError:
        needs = {}
    passed, message = decide_result(needs if isinstance(needs, dict) else {})
    _append(env, "GITHUB_STEP_SUMMARY", f"### {RESULT_JOB}\n\n{message}\n")
    print(message)
    return 0 if passed else 1


def main(argv: list[str]) -> int:
    commands = {"verify": verify, "result": result}
    if len(argv) != 2 or argv[1] not in commands:
        print("usage: ci_release_evidence.py verify|result", file=sys.stderr)
        return 2
    return commands[argv[1]](os.environ)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
