#!/usr/bin/env python3
"""Verify on GitHub that a change was fully checked locally and integrated unchanged.

The complete lint, backend, browser, tool and image suites run on the developer's
machine before every push. Afterwards the local publisher posts a commit status:

* context exactly ``Local verification``, state ``success``, created by the
  repository owner;
* ``target_url`` exactly ``<server>/<repository>/commit/<sha>``;
* description, as compact JSON,
  ``[1,"<tree sha>","<tested base sha>","<finished at, YYYY-MM-DDTHH:MM:SSZ>"]``.

Every status with that context on a commit must meet these rules and name the
same tree and base, otherwise the evidence is foreign, red or ambiguous. No
status may predate its claimed finish time, and the newest finish time must be
at most 24 hours old.

The single ``Quality result`` job then accepts only:

pull_request
    an open pull request from this repository whose exact head carries a receipt
    for its own tree and the current base tip; that base is an ancestor of the
    head and GitHub's synthetic merge has exactly the head's tree.
push to develop or master (never forced, created or deleted; ``before`` is an ancestor)
    A. a receipt on the pushed commit for its tree with base ``before``; or
    B. a normal pull request merge with parents ``before`` and a head that
       contains ``before``, whose receipt names ``before`` and the merge's tree,
       matched by exactly one merged pull request from this repository into this
       branch with that merge commit.
push to master, before A and B
    C. a fast-forward to a commit that develop contains and whose develop push
       runs of this workflow all passed; or
    D. a release merge with parents ``before`` and such a develop commit, whose
       tree it reproduces exactly.

Evidence that may still appear after the push (the status, a running develop
run, the pull request association) is awaited for a bounded time. Anything else,
including API errors, foreign, red, stale or ambiguous receipts, moved bases and
changed trees, fails with a request to verify locally. GitHub never falls back
to running the suites itself. Only the standard library is used, so the system
``python3`` of a runner works.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

CONTEXT = "Local verification"
RECEIPT_VERSION = 1
MAX_AGE = timedelta(hours=24)
WAIT_SECONDS = 600
POLL_SECONDS = 20
MAX_STATUS_PAGES = 10
WORKFLOW_PATH = ".github/workflows/quality.yml"
RESULT_JOB = "Quality result"
EVIDENCE_BRANCH = "develop"
RELEASE_BRANCH = "master"
SHA_PATTERN = re.compile(r"[0-9a-f]{40}")
TIMESTAMP_PATTERN = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")
LOCAL_HINT = (f"Run the complete local verification for this exact state, publish its '{CONTEXT}' "
              "status, then re-run this job. GitHub does not run the suites itself.")

Get = Callable[[str], Any]
Clock = Callable[[], datetime]


class Rejected(Exception):
    """The evidence is wrong or missing for good; waiting cannot change that."""


class Pending(Exception):
    """Evidence that may still appear shortly after the push is missing."""


def _require(condition: Any, reason: str) -> None:
    if not condition:
        raise Rejected(reason)


def _is_sha(value: Any) -> bool:
    return isinstance(value, str) and bool(SHA_PATTERN.fullmatch(value))


def parse_timestamp(value: Any) -> datetime:
    _require(isinstance(value, str) and TIMESTAMP_PATTERN.fullmatch(value), f"invalid UTC timestamp {value!r}")
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        raise Rejected(f"invalid UTC timestamp {value!r}") from None


def _iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _repository_of(side: Any) -> Any:
    return ((side or {}).get("repo") or {}).get("full_name")


@dataclass(frozen=True)
class Run:
    event_name: str
    ref: str
    sha: str
    repository: str
    owner: str
    run_id: str
    server: str
    event: Mapping[str, Any]

    @classmethod
    def from_env(cls, env: Mapping[str, str], event: Any) -> Run:
        run = cls(env.get("GITHUB_EVENT_NAME", ""), env.get("GITHUB_REF", ""), env.get("GITHUB_SHA", ""),
                  env.get("GITHUB_REPOSITORY", ""), env.get("GITHUB_REPOSITORY_OWNER", ""),
                  env.get("GITHUB_RUN_ID", ""), env.get("GITHUB_SERVER_URL", "https://github.com"),
                  event if isinstance(event, dict) else {})
        owner, _, name = run.repository.partition("/")
        _require(_is_sha(run.sha) and run.run_id.isdigit() and run.server.startswith("https://")
                 and run.owner and owner == run.owner and name and "/" not in name, "incomplete run context")
        return run

    def url(self, path: str) -> str:
        return f"{self.server}/{self.repository}/{path}"


@dataclass(frozen=True)
class Receipt:
    tree: str
    base: str
    finished_at: datetime
    created_at: datetime
    url: str


class GitHub:
    """Read-only API access that caches only immutable answers."""

    def __init__(self, get: Get, repository: str) -> None:
        self.get = get
        self.repository = repository
        self._commits: dict[str, tuple[str, tuple[str, ...]]] = {}
        self._ancestry: dict[tuple[str, str], bool] = {}
        self._current_run: dict | None = None

    def repo(self, path: str) -> Any:
        return self.get(f"/repos/{self.repository}{path}")

    def commit(self, sha: str) -> tuple[str, tuple[str, ...]]:
        """Return the tree and parents of a commit."""
        if sha not in self._commits:
            data = self.repo(f"/git/commits/{sha}")
            tree = (data.get("tree") or {}).get("sha")
            parents = tuple((parent or {}).get("sha") for parent in data.get("parents") or [])
            _require(data.get("sha") == sha and _is_sha(tree) and all(_is_sha(parent) for parent in parents),
                     f"commit {sha} could not be read")
            self._commits[sha] = (tree, parents)
        return self._commits[sha]

    def contains(self, ancestor: str, descendant: str) -> bool:
        """Whether ``ancestor`` is ``descendant`` or one of its ancestors."""
        key = (ancestor, descendant)
        if key not in self._ancestry:
            data = self.repo(f"/compare/{ancestor}...{descendant}?per_page=1")
            self._ancestry[key] = data.get("status") in {"identical", "ahead"} and data.get("behind_by") == 0
        return self._ancestry[key]

    def branch_tip(self, branch: str) -> str:
        data = self.repo(f"/git/ref/heads/{urllib.parse.quote(branch)}")
        target = data.get("object") or {}
        _require(data.get("ref") == f"refs/heads/{branch}" and target.get("type") == "commit"
                 and _is_sha(target.get("sha")), f"branch {branch} could not be read")
        return target["sha"]

    def statuses(self, sha: str) -> list[dict]:
        statuses: list[dict] = []
        for page in range(1, MAX_STATUS_PAGES + 1):
            batch = self.repo(f"/commits/{sha}/statuses?per_page=100&page={page}")
            _require(isinstance(batch, list), f"statuses of {sha} could not be read")
            statuses.extend(batch)
            if len(batch) < 100:
                return statuses
        raise Rejected(f"{sha} has too many statuses to evaluate")

    def pull(self, number: int) -> dict:
        return self.repo(f"/pulls/{number}")

    def merged_pulls(self, sha: str) -> list[dict]:
        pulls = self.repo(f"/commits/{sha}/pulls?per_page=100")
        _require(isinstance(pulls, list) and len(pulls) < 100, f"pull requests of {sha} could not be read")
        return [pull for pull in pulls if pull.get("merge_commit_sha") == sha]

    def current_run(self, run_id: str) -> dict:
        if self._current_run is None:
            self._current_run = self.repo(f"/actions/runs/{run_id}")
        return self._current_run


class Gate:
    """One evaluation of the evidence; ``evaluate`` repeats it while evidence is pending."""

    def __init__(self, run: Run, github: GitHub, now: Clock) -> None:
        self.run = run
        self.github = github
        self.now = now
        self.notes: list[str] = []

    def receipt(self, sha: str) -> Receipt:
        """Return the newest valid receipt on ``sha``; pending while none exists."""
        statuses = [status for status in self.github.statuses(sha) if status.get("context") == CONTEXT]
        if not statuses:
            raise Pending(f"{sha} has no '{CONTEXT}' status")
        receipts = [self._receipt(status, sha) for status in statuses]
        _require(len({(receipt.tree, receipt.base) for receipt in receipts}) == 1,
                 f"the '{CONTEXT}' statuses on {sha} name different trees or bases")
        return max(receipts, key=lambda receipt: (receipt.finished_at, receipt.created_at))

    def _receipt(self, status: Mapping[str, Any], sha: str) -> Receipt:
        label = f"'{CONTEXT}' status on {sha}"
        creator = (status.get("creator") or {}).get("login")
        _require(creator == self.run.owner, f"{label} was created by {creator!r}, not the repository owner")
        _require(status.get("state") == "success", f"{label} is {status.get('state')!r}")
        url = self.run.url(f"commit/{sha}")
        _require(status.get("target_url") == url, f"{label} does not link {url}")
        description = status.get("description")
        try:
            data = json.loads(description) if isinstance(description, str) else None
        except ValueError:
            data = None
        _require(isinstance(data, list) and len(data) == 4 and type(data[0]) is int and data[0] == RECEIPT_VERSION
                 and _is_sha(data[1]) and _is_sha(data[2]) and isinstance(data[3], str)
                 and json.dumps(data, separators=(",", ":")) == description,
                 f"{label} has no valid receipt")
        finished_at = parse_timestamp(data[3])
        created_at = parse_timestamp(status.get("created_at"))
        _require(created_at >= finished_at, f"{label} was created before the finish time it claims")
        _require(finished_at <= self.now(), f"{label} claims a finish time in the future")
        return Receipt(data[1], data[2], finished_at, created_at, url)

    def check(self, receipt: Receipt, sha: str, *, tree: str, base: str) -> list[str]:
        _require(receipt.tree == tree, f"the receipt on {sha} names tree {receipt.tree}, but GitHub has {tree}")
        _require(receipt.base == base, f"the receipt on {sha} was checked against base {receipt.base}, not {base}; "
                                       "integrate the current base locally and verify again")
        _require(self.now() - receipt.finished_at <= MAX_AGE, f"the receipt on {sha} is older than 24 hours")
        return [f"[Local verification]({receipt.url}) of `{sha}`: tree `{tree}`, base `{base}`, "
                f"finished {_iso(receipt.finished_at)}, published {_iso(receipt.created_at)} by {self.run.owner}."]

    def pull_request(self) -> list[str]:
        event_pull = self.run.event.get("pull_request") or {}
        number = event_pull.get("number")
        head = (event_pull.get("head") or {}).get("sha")
        _require(isinstance(number, int) and _is_sha(head), "the pull request event is incomplete")
        pull = self.github.pull(number)
        _require(_repository_of(pull.get("head")) == self.run.repository
                 and _repository_of(pull.get("base")) == self.run.repository,
                 "only pull requests from this repository can carry local verification")
        _require(pull.get("state") == "open", f"pull request #{number} is not open")
        _require((pull.get("head") or {}).get("sha") == head,
                 f"pull request #{number} moved past {head}; the newer run checks it")
        branch = (pull.get("base") or {}).get("ref")
        _require(isinstance(branch, str) and branch, f"pull request #{number} has no base branch")
        merge_tree, merge_parents = self.github.commit(self.run.sha)
        _require(len(merge_parents) == 2 and merge_parents[1] == head,
                 f"{self.run.sha} is not GitHub's merge of head {head}")
        base = merge_parents[0]
        _require(self.github.branch_tip(branch) == base,
                 f"{branch} moved past {base}; integrate it locally and verify again")
        _require(self.github.contains(base, head),
                 f"head {head} does not contain {branch} {base}; integrate it locally and verify again")
        head_tree = self.github.commit(head)[0]
        _require(merge_tree == head_tree, f"GitHub's merge tree {merge_tree} differs from the checked head tree")
        evidence = self.check(self.receipt(head), head, tree=head_tree, base=base)
        return [f"[Pull request #{number}]({self.run.url(f'pull/{number}')}) into `{branch}`: head `{head}` "
                f"contains base `{base}`, and GitHub's merge `{self.run.sha}` has exactly its tree.", *evidence]

    def push(self) -> list[str]:
        branch = self.run.ref.removeprefix("refs/heads/")
        _require(self.run.ref.startswith("refs/heads/") and branch in {EVIDENCE_BRANCH, RELEASE_BRANCH},
                 f"pushes to {self.run.ref} are not integration pushes")
        event = self.run.event
        before = event.get("before")
        sha = self.run.sha
        _require(event.get("forced") is False and event.get("created") is False and event.get("deleted") is False
                 and event.get("after") == sha and _is_sha(before) and before != "0" * 40,
                 "only plain fast-forward pushes of an existing branch can be verified")
        tree, parents = self.github.commit(sha)
        _require(self.github.contains(before, sha), f"{sha} does not descend from {before}")
        prefix = f"Push to `{branch}` from `{before}` to `{sha}`."
        if branch == RELEASE_BRANCH and (reuse := self.release(before, sha, tree, parents)):
            return [prefix, *reuse]
        return [prefix, *self.integration(branch, before, sha, tree, parents)]

    def release(self, before: str, sha: str, tree: str, parents: tuple[str, ...]) -> list[str] | None:
        evidence = self.develop_evidence(sha)
        if evidence:
            return [f"Fast-forward to a commit that develop contains: {evidence}"]
        if len(parents) == 2 and parents[0] == before:
            source = parents[1]
            evidence = self.develop_evidence(source)
            if evidence:
                if self.github.commit(source)[0] == tree:
                    return [f"Release merge with exactly the tree of develop commit `{source}`: {evidence}"]
                self.notes.append(f"the release merge tree differs from develop commit {source}, "
                                  "so the actual merge needs its own local verification")
        return None

    def develop_evidence(self, sha: str) -> str | None:
        """Describe the passed develop push runs of this workflow for ``sha``, if all passed."""
        current = self.github.current_run(self.run.run_id)
        workflow_id = current.get("workflow_id")
        _require(isinstance(workflow_id, int) and self._trusted(current, self.run.sha, RELEASE_BRANCH, workflow_id),
                 "the current run is not this repository's quality workflow for this push")
        query = urllib.parse.urlencode({"event": "push", "branch": EVIDENCE_BRANCH, "head_sha": sha, "per_page": 100})
        listing = self.github.repo(f"/actions/workflows/{workflow_id}/runs?{query}")
        runs = listing.get("workflow_runs")
        _require(isinstance(runs, list) and listing.get("total_count") == len(runs),
                 f"the develop runs of {sha} could not be listed completely")
        if not runs:
            self.notes.append(f"{sha} has no develop push run of this workflow")
            return None
        for run in runs:
            _require(self._trusted(run, sha, EVIDENCE_BRANCH, workflow_id),
                     f"run {run.get('id')} is not a develop push run of this workflow for {sha}")
        if any(run.get("status") != "completed" for run in runs):
            raise Pending(f"the develop run of {sha} has not finished")
        if any(run.get("conclusion") != "success" for run in runs):
            self.notes.append(f"a develop run of {sha} did not succeed")
            return None
        evidence = max(runs, key=lambda run: (run.get("run_number") or 0, run.get("id") or 0))
        run_id = evidence.get("id")
        jobs_listing = self.github.repo(f"/actions/runs/{run_id}/jobs?filter=latest&per_page=100")
        jobs = jobs_listing.get("jobs")
        _require(isinstance(jobs, list) and jobs_listing.get("total_count") == len(jobs) == 1
                 and jobs[0].get("name") == RESULT_JOB and jobs[0].get("run_id") == run_id
                 and jobs[0].get("head_sha") == sha and jobs[0].get("status") == "completed"
                 and jobs[0].get("conclusion") == "success",
                 f"develop run {run_id} has no single successful {RESULT_JOB} job")
        tip = self.github.branch_tip(EVIDENCE_BRANCH)
        _require(self.github.contains(sha, tip), f"develop no longer contains {sha}")
        return f"[develop run {run_id}]({self.run.url(f'actions/runs/{run_id}')}) verified `{sha}`."

    def _trusted(self, run: Mapping[str, Any], sha: str, branch: str, workflow_id: int) -> bool:
        return (run.get("workflow_id") == workflow_id and str(run.get("path") or "").partition("@")[0] == WORKFLOW_PATH
                and run.get("event") == "push" and run.get("head_branch") == branch and run.get("head_sha") == sha
                and (run.get("repository") or {}).get("full_name") == self.run.repository
                and (run.get("head_repository") or {}).get("full_name") == self.run.repository)

    def integration(self, branch: str, before: str, sha: str, tree: str, parents: tuple[str, ...]) -> list[str]:
        try:
            receipt = self.receipt(sha)
        except Pending:
            receipt = None
        if receipt is not None:
            return ["Direct push of a locally verified commit.", *self.check(receipt, sha, tree=tree, base=before)]
        try:
            return self.merge(branch, before, sha, tree, parents)
        except Rejected as rejection:
            # A locally merged commit may still publish its own status.
            raise Pending(f"{sha} has no '{CONTEXT}' status, and it is no verified pull request merge: "
                          f"{rejection}") from None

    def merge(self, branch: str, before: str, sha: str, tree: str, parents: tuple[str, ...]) -> list[str]:
        _require(len(parents) == 2 and parents[0] == before, f"it is not a merge commit on top of {before}")
        head = parents[1]
        pulls = self.github.merged_pulls(sha)
        _require(len(pulls) == 1, f"{len(pulls)} pull requests name it as their merge commit")
        pull = pulls[0]
        number = pull.get("number")
        _require(pull.get("merged_at") and (pull.get("base") or {}).get("ref") == branch
                 and (pull.get("head") or {}).get("sha") == head
                 and _repository_of(pull.get("base")) == self.run.repository
                 and _repository_of(pull.get("head")) == self.run.repository,
                 f"pull request #{number} is no merge of {head} from this repository into {branch}")
        _require(self.github.contains(before, head), f"head {head} does not contain {before}")
        head_tree = self.github.commit(head)[0]
        _require(tree == head_tree, f"the merge tree {tree} differs from the checked head tree {head_tree}")
        evidence = self.check(self.receipt(head), head, tree=head_tree, base=before)
        return [f"Merge of [pull request #{number}]({self.run.url(f'pull/{number}')}) with exactly the tree "
                f"of its head `{head}`.", *evidence]


def evaluate(run: Run, github: GitHub, *, now: Clock, sleep: Callable[[float], None],
             wait_seconds: int = WAIT_SECONDS, poll_seconds: int = POLL_SECONDS) -> list[str]:
    """Return the evidence lines, or raise Rejected once nothing valid appeared in time."""
    deadline = now() + timedelta(seconds=wait_seconds)
    while True:
        gate = Gate(run, github, now)
        try:
            if run.event_name == "pull_request":
                return gate.pull_request()
            if run.event_name == "push":
                return gate.push()
            raise Rejected(f"{run.event_name!r} events carry no verifiable integration")
        except Pending as pending:
            if now() + timedelta(seconds=poll_seconds) > deadline:
                details = "".join(f"; {note}" for note in gate.notes)
                raise Rejected(f"no valid evidence within {wait_seconds} s: {pending}{details}") from None
            sleep(poll_seconds)


def github_getter(env: Mapping[str, str]) -> Get:
    api_url = env.get("GITHUB_API_URL", "https://api.github.com")
    token = env.get("GH_TOKEN", "")

    def get(path: str) -> Any:
        _require(api_url.startswith("https://") and token, "no GitHub API access")
        request = urllib.request.Request(api_url + path, headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "rollthedice-quality-gate",
            "X-GitHub-Api-Version": "2022-11-28",
        })
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)

    return get


def verify(env: Mapping[str, str], get: Get | None = None, now: Clock | None = None,
           sleep: Callable[[float], None] = time.sleep, wait_seconds: int = WAIT_SECONDS) -> int:
    clock = now or (lambda: datetime.now(timezone.utc))
    try:
        try:
            event = json.loads(Path(env["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
        except (KeyError, OSError, ValueError):
            raise Rejected("the event payload could not be read") from None
        run = Run.from_env(env, event)
        lines = evaluate(run, GitHub(get or github_getter(env), run.repository), now=clock, sleep=sleep,
                         wait_seconds=wait_seconds)
        passed, headline = True, "Passed: locally verified and integrated unchanged."
    except Rejected as rejection:
        passed, headline, lines = False, f"Failed: {rejection}.", [LOCAL_HINT]
    except Exception as error:
        # API and data errors never pass; a re-run can retry them.
        passed, headline = False, f"Failed: the evidence could not be read ({type(error).__name__}: {error})."
        lines = ["Re-run this job once GitHub is reachable; it never passes without verified evidence."]
    summary = "\n".join([f"### {RESULT_JOB}", "", f"**{headline}**", "", *(f"- {line}" for line in lines), "",
                         "The full suites run locally before every push; GitHub verifies only that evidence "
                         "and the unchanged remote integration.", ""])
    if path := env.get("GITHUB_STEP_SUMMARY"):
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(summary)
    print(summary)
    return 0 if passed else 1


def main(argv: list[str]) -> int:
    if argv[1:] != ["verify"]:
        print("usage: ci_release_evidence.py verify", file=sys.stderr)
        return 2
    return verify(os.environ)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
