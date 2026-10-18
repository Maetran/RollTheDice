"""GitHub verifies the owner's local verification and the unchanged integration, never the suites."""

from __future__ import annotations

import hashlib
import io
import json
import re
import tempfile
import unittest
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import yaml

from scripts import ci_release_evidence as gate

BASE_DIR = Path(__file__).resolve().parents[1]
WORKFLOW = BASE_DIR / ".github" / "workflows" / "quality.yml"

OWNER = "Maetran"
REPOSITORY = "Maetran/RollTheDice"
SERVER = "https://github.com"
RUN_ID = 900
WORKFLOW_ID = 42
NOW = datetime(2026, 10, 18, 12, 0, 0, tzinfo=timezone.utc)
WAIT_SECONDS = 120
POLLS_UNTIL_TIMEOUT = 6


def load_workflow() -> dict:
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    # YAML 1.1 reads the bare ``on`` key as boolean true.
    workflow["on"] = workflow.pop(True, workflow.get("on"))
    return workflow


def render(template: str, context: dict[str, str]) -> str:
    rendered = re.sub(r"\$\{\{\s*github\.(\w+)\s*\}\}", lambda match: context[match.group(1)], template)
    assert "${{" not in rendered, rendered
    return rendered


class QualityWorkflowTestCase(unittest.TestCase):
    def setUp(self):
        self.workflow = load_workflow()

    def test_feature_branches_are_checked_once_through_their_pull_request(self):
        # Only integrated develop states and master promotions run on push, so a
        # feature branch with an open pull request is never checked twice. Tags
        # and path filters stay absent, and every pull request base is checked.
        self.assertEqual(self.workflow["on"], {"push": {"branches": ["develop", "master"]}, "pull_request": None})

    def test_superseded_runs_cancel_only_their_own_pull_request_or_branch(self):
        concurrency = self.workflow["concurrency"]
        self.assertIs(concurrency["cancel-in-progress"], True)

        def group(event_name: str, ref: str) -> str:
            return render(concurrency["group"], {"workflow": "Quality", "event_name": event_name, "ref": ref})

        pull_request_47 = group("pull_request", "refs/pull/47/merge")
        self.assertEqual(pull_request_47, group("pull_request", "refs/pull/47/merge"))
        others = [group("pull_request", "refs/pull/48/merge"), group("push", "refs/heads/develop"),
                  group("push", "refs/heads/master")]
        self.assertEqual(len({pull_request_47, *others}), 4)

    def test_github_only_verifies_evidence_and_never_runs_the_suites(self):
        self.assertEqual(self.workflow["permissions"], {"contents": "read"})
        self.assertEqual(list(self.workflow["jobs"]), ["result"])
        job = self.workflow["jobs"]["result"]
        self.assertEqual(job["name"], gate.RESULT_JOB)
        self.assertNotIn("if", job)
        self.assertEqual(job["permissions"],
                         {"actions": "read", "contents": "read", "pull-requests": "read", "statuses": "read"})
        self.assertGreater(job["timeout-minutes"] * 60, gate.WAIT_SECONDS + 60)
        checkout, verify = job["steps"]
        self.assertEqual(checkout["with"], {"persist-credentials": False,
                                            "sparse-checkout": "scripts/ci_release_evidence.py",
                                            "sparse-checkout-cone-mode": False})
        self.assertEqual(verify, {"env": {"GH_TOKEN": "${{ github.token }}"},
                                  "run": "python3 scripts/ci_release_evidence.py verify"})
        self.assertNotRegex(WORKFLOW.read_text(encoding="utf-8"), r"npm|pytest|playwright|docker")


def sha(name: str) -> str:
    return hashlib.sha1(name.encode(), usedforsecurity=False).hexdigest()


def iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def receipt_status(commit: str, tree: str, base: str, *, finished: datetime = NOW - timedelta(minutes=10),
                   created: datetime | None = None, creator: str = OWNER, state: str = "success",
                   context: str = gate.CONTEXT, description: str | None = None,
                   target_url: str | None = None) -> dict:
    return {
        "context": context, "state": state, "creator": {"login": creator},
        "target_url": f"{SERVER}/{REPOSITORY}/commit/{commit}" if target_url is None else target_url,
        "description": (json.dumps([1, tree, base, iso(finished)], separators=(",", ":"))
                        if description is None else description),
        "created_at": iso(created or finished + timedelta(minutes=2)),
    }


def pull_request(number: int, head: str, branch: str = "develop", *, merge_commit_sha: str | None = None,
                 head_repository: str = REPOSITORY) -> dict:
    merged = merge_commit_sha is not None
    return {"number": number, "state": "closed" if merged else "open",
            "merged_at": "2026-10-18T11:55:00Z" if merged else None, "merge_commit_sha": merge_commit_sha,
            "head": {"sha": head, "repo": {"full_name": head_repository}},
            "base": {"ref": branch, "repo": {"full_name": REPOSITORY}}}


def workflow_run(commit: str, run_id: int = 800, **overrides) -> dict:
    return {"id": run_id, "run_number": run_id, "workflow_id": WORKFLOW_ID, "path": gate.WORKFLOW_PATH,
            "event": "push", "head_branch": "develop", "head_sha": commit, "status": "completed",
            "conclusion": "success", "repository": {"full_name": REPOSITORY},
            "head_repository": {"full_name": REPOSITORY}, **overrides}


def result_job(run_id: int, commit: str, **overrides) -> dict:
    return {"name": gate.RESULT_JOB, "run_id": run_id, "head_sha": commit, "status": "completed",
            "conclusion": "success", **overrides}


def environment(event_name: str, ref: str, commit: str) -> dict:
    return {"GITHUB_EVENT_NAME": event_name, "GITHUB_REF": ref, "GITHUB_SHA": commit,
            "GITHUB_REPOSITORY": REPOSITORY, "GITHUB_REPOSITORY_OWNER": OWNER, "GITHUB_RUN_ID": str(RUN_ID),
            "GITHUB_SERVER_URL": SERVER}


def push_event(previous: str, pushed: str, **overrides) -> dict:
    return {"before": previous, "after": pushed, "forced": False, "created": False, "deleted": False, **overrides}


class FakeRepository:
    """A small commit graph behind the read-only GitHub API routes the gate uses."""

    def __init__(self):
        self.commits: dict[str, tuple[str, list[str]]] = {}
        self.refs: dict[str, str] = {}
        self.statuses: dict[str, list[dict]] = {}
        self.pulls: dict[int, dict] = {}
        self.runs: list[dict] = []
        self.jobs: dict[int, list[dict]] = {}
        self.current: dict = {}
        self.calls: list[str] = []

    def commit(self, name: str, *parents: str, tree: str | None = None) -> str:
        commit = sha(name)
        self.commits[commit] = (tree or sha(f"tree:{name}"), list(parents))
        return commit

    def tree(self, commit: str) -> str:
        return self.commits[commit][0]

    def ancestors(self, commit: str) -> set[str]:
        seen, pending = set(), [commit]
        while pending:
            current = pending.pop()
            if current not in seen:
                seen.add(current)
                pending.extend(self.commits[current][1])
        return seen

    def publish(self, commit: str, base: str, **overrides) -> None:
        # GitHub lists the newest status first.
        self.statuses.setdefault(commit, []).insert(0, receipt_status(commit, self.tree(commit), base, **overrides))

    def __call__(self, path: str):
        self.calls.append(path)
        route, _, query = path.partition("?")
        params = urllib.parse.parse_qs(query)
        route = route.removeprefix(f"/repos/{REPOSITORY}")
        if match := re.fullmatch(r"/git/commits/(\w+)", route):
            tree, parents = self.commits[match[1]]
            return {"sha": match[1], "tree": {"sha": tree}, "parents": [{"sha": parent} for parent in parents]}
        if match := re.fullmatch(r"/compare/(\w+)\.\.\.(\w+)", route):
            base, head = match.groups()
            if base == head:
                return {"status": "identical", "behind_by": 0}
            if base in self.ancestors(head):
                return {"status": "ahead", "behind_by": 0}
            return {"status": "behind" if head in self.ancestors(base) else "diverged", "behind_by": 1}
        if match := re.fullmatch(r"/git/ref/heads/(.+)", route):
            return {"ref": f"refs/heads/{match[1]}", "object": {"sha": self.refs[match[1]], "type": "commit"}}
        if match := re.fullmatch(r"/commits/(\w+)/statuses", route):
            page = int(params["page"][0])
            return self.statuses.get(match[1], [])[(page - 1) * 100:page * 100]
        if match := re.fullmatch(r"/commits/(\w+)/pulls", route):
            # GitHub also lists open pull requests that merely contain the commit.
            return [pull for pull in self.pulls.values()
                    if match[1] in {pull["merge_commit_sha"], pull["head"]["sha"]}]
        if match := re.fullmatch(r"/pulls/(\d+)", route):
            return self.pulls[int(match[1])]
        if route == f"/actions/runs/{RUN_ID}":
            return self.current
        if route == f"/actions/workflows/{WORKFLOW_ID}/runs":
            # Filter only by commit, so the gate must reject other events and branches itself.
            runs = [run for run in self.runs if run["head_sha"] == params["head_sha"][0]]
            return {"total_count": len(runs), "workflow_runs": runs}
        if match := re.fullmatch(r"/actions/runs/(\d+)/jobs", route):
            jobs = self.jobs[int(match[1])]
            return {"total_count": len(jobs), "jobs": jobs}
        raise LookupError(path)


class GateTestCase(unittest.TestCase):
    def reset(self) -> FakeRepository:
        self.repo = FakeRepository()
        self.root = self.repo.commit("root")
        self.clock = NOW
        self.sleeps: list[float] = []
        self.on_sleep = None
        return self.repo

    def setUp(self):
        self.reset()

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.clock += timedelta(seconds=seconds)
        if self.on_sleep:
            self.on_sleep(len(self.sleeps))

    def evaluate(self, scenario) -> list[str]:
        run = gate.Run.from_env(scenario.env, scenario.event)
        return gate.evaluate(run, gate.GitHub(self.repo, REPOSITORY), now=lambda: self.clock, sleep=self.sleep,
                             wait_seconds=WAIT_SECONDS, poll_seconds=20)

    def assert_passes(self, scenario, *fragments: str) -> str:
        text = "\n".join(self.evaluate(scenario))
        for fragment in fragments:
            self.assertIn(fragment, text)
        return text

    def assert_rejected(self, scenario, fragment: str, *, waits: bool) -> None:
        with self.assertRaises(gate.Rejected) as caught:
            self.evaluate(scenario)
        self.assertIn(fragment, str(caught.exception))
        # Only missing evidence is awaited; wrong evidence fails at once.
        self.assertEqual(len(self.sleeps), POLLS_UNTIL_TIMEOUT if waits else 0, str(caught.exception))

    def pull_request_scenario(self):
        repo = self.reset()
        base = repo.commit("develop", self.root)
        head = repo.commit("feature", base)
        merge = repo.commit("synthetic merge", base, head, tree=repo.tree(head))
        repo.refs["develop"] = base
        repo.pulls[47] = pull_request(47, head)
        repo.publish(head, base)
        return SimpleNamespace(base=base, head=head, merge=merge,
                               env=environment("pull_request", "refs/pull/47/merge", merge),
                               event={"pull_request": {"number": 47, "head": {"sha": head}}})

    def push_scenario(self, branch: str, previous: str, pushed: str, **event):
        self.repo.refs[branch] = pushed
        self.repo.current = workflow_run(pushed, RUN_ID, head_branch=branch, status="in_progress", conclusion=None)
        return SimpleNamespace(before=previous, after=pushed, env=environment("push", f"refs/heads/{branch}", pushed),
                               event=push_event(previous, pushed, **event))


class PullRequestGateTestCase(GateTestCase):
    def test_exact_head_with_receipt_for_its_tree_and_current_base_passes(self):
        scenario = self.pull_request_scenario()
        text = self.assert_passes(scenario, "Pull request #47", scenario.head, scenario.base,
                                  f"{SERVER}/{REPOSITORY}/commit/{scenario.head}")
        self.assertIn(f"published {iso(NOW - timedelta(minutes=8))} by {OWNER}", text)
        self.assertEqual(self.sleeps, [])

    def test_status_published_shortly_after_the_push_is_awaited(self):
        scenario = self.pull_request_scenario()
        receipt = self.repo.statuses.pop(scenario.head)
        self.on_sleep = lambda count: count == 2 and self.repo.statuses.setdefault(scenario.head, receipt)
        self.assert_passes(scenario, "Pull request #47")
        self.assertEqual(self.sleeps, [20, 20])

    def test_missing_status_fails_after_the_bounded_wait_with_a_local_check_request(self):
        scenario = self.pull_request_scenario()
        self.repo.statuses.clear()
        self.assert_rejected(scenario, f"no valid evidence within {WAIT_SECONDS} s", waits=True)
        # Statuses of other contexts are not evidence.
        scenario = self.pull_request_scenario()
        self.repo.statuses[scenario.head] = [
            receipt_status(scenario.head, self.repo.tree(scenario.head), scenario.base, context="Local verify")]
        self.assert_rejected(scenario, f"has no '{gate.CONTEXT}' status", waits=True)

    def test_foreign_red_or_malformed_receipts_fail_immediately(self):
        def compact(*values) -> str:
            return json.dumps(list(values), separators=(",", ":"))

        finished = iso(NOW - timedelta(minutes=10))
        cases = {
            "foreign creator": ({"creator": "someone"}, "not the repository owner"),
            "failure": ({"state": "failure"}, "'failure'"),
            "pending": ({"state": "pending"}, "'pending'"),
            "error": ({"state": "error"}, "'error'"),
            "other commit link": ({"target_url": f"{SERVER}/{REPOSITORY}/commit/{'0' * 40}"}, "does not link"),
            "no link": ({"target_url": ""}, "does not link"),
            "created before finish": ({"created": NOW - timedelta(minutes=11)}, "before the finish time"),
            "future finish": ({"finished": NOW + timedelta(seconds=1), "created": NOW + timedelta(seconds=2)},
                              "in the future"),
        }
        descriptions = {
            "not JSON": "verified",
            "spaced JSON": json.dumps([1, "TREE", "BASE", finished]),
            "version 2": compact(2, "TREE", "BASE", finished),
            "boolean version": compact(True, "TREE", "BASE", finished),
            "three fields": compact(1, "TREE", "BASE"),
            "five fields": compact(1, "TREE", "BASE", finished, "extra"),
            "object": json.dumps({"tree": "TREE", "base": "BASE"}),
            "unix time": compact(1, "TREE", "BASE", 1760786400),
            "milliseconds": compact(1, "TREE", "BASE", "2026-10-18T11:50:00.000Z"),
            "offset": compact(1, "TREE", "BASE", "2026-10-18T11:50:00+00:00"),
            "impossible date": compact(1, "TREE", "BASE", "2026-13-40T11:50:00Z"),
            "uppercase tree": compact(1, "UPPER", "BASE", finished),
            "short base": compact(1, "TREE", "abc123", finished),
        }
        for name, (overrides, fragment) in cases.items():
            with self.subTest(name):
                scenario = self.pull_request_scenario()
                self.repo.statuses[scenario.head] = []
                self.repo.publish(scenario.head, scenario.base, **overrides)
                self.assert_rejected(scenario, fragment, waits=False)
        for name, description in descriptions.items():
            with self.subTest(name):
                scenario = self.pull_request_scenario()
                tree = self.repo.tree(scenario.head)
                description = (description.replace("UPPER", tree.upper()).replace("TREE", tree)
                               .replace("BASE", scenario.base))
                self.repo.statuses[scenario.head] = [receipt_status(scenario.head, tree, scenario.base,
                                                                    description=description)]
                invalid_time = name in {"milliseconds", "offset", "impossible date"}
                self.assert_rejected(scenario, "invalid UTC timestamp" if invalid_time else "has no valid receipt",
                                     waits=False)

    def test_receipt_must_name_the_head_tree_and_the_current_base(self):
        scenario = self.pull_request_scenario()
        self.repo.statuses[scenario.head] = [receipt_status(scenario.head, sha("other tree"), scenario.base)]
        self.assert_rejected(scenario, "but GitHub has", waits=False)
        scenario = self.pull_request_scenario()
        self.repo.statuses[scenario.head] = [receipt_status(scenario.head, self.repo.tree(scenario.head), self.root)]
        self.assert_rejected(scenario, "integrate the current base locally", waits=False)

    def test_receipts_expire_after_24_hours(self):
        scenario = self.pull_request_scenario()
        self.repo.statuses[scenario.head] = []
        self.repo.publish(scenario.head, scenario.base, finished=NOW - timedelta(hours=24), created=NOW)
        self.assert_passes(scenario, "Pull request #47")
        scenario = self.pull_request_scenario()
        self.repo.statuses[scenario.head] = []
        self.repo.publish(scenario.head, scenario.base, finished=NOW - timedelta(hours=24, seconds=1), created=NOW)
        self.assert_rejected(scenario, "older than 24 hours", waits=False)

    def test_republishing_refreshes_but_ambiguous_receipts_fail(self):
        scenario = self.pull_request_scenario()
        self.repo.publish(scenario.head, scenario.base, finished=NOW - timedelta(minutes=1), created=NOW)
        self.repo.statuses[scenario.head].reverse()
        self.assert_passes(scenario, f"finished {iso(NOW - timedelta(minutes=1))}")
        # The same receipt published in the second it finished is valid.
        scenario = self.pull_request_scenario()
        self.repo.statuses[scenario.head] = []
        self.repo.publish(scenario.head, scenario.base, finished=NOW - timedelta(minutes=1),
                          created=NOW - timedelta(minutes=1))
        self.assert_passes(scenario, "Pull request #47")
        scenario = self.pull_request_scenario()
        self.repo.publish(scenario.head, self.root)
        self.assert_rejected(scenario, "different trees or bases", waits=False)
        scenario = self.pull_request_scenario()
        self.repo.publish(scenario.head, scenario.base, state="failure")
        self.assert_rejected(scenario, "'failure'", waits=False)
        scenario = self.pull_request_scenario()
        self.repo.publish(scenario.head, scenario.base, creator="someone")
        self.assert_rejected(scenario, "not the repository owner", waits=False)

    def test_moved_or_missing_base_and_changed_merge_trees_fail(self):
        scenario = self.pull_request_scenario()
        self.repo.refs["develop"] = self.repo.commit("newer develop", scenario.base)
        self.assert_rejected(scenario, "develop moved past", waits=False)

        scenario = self.pull_request_scenario()
        head = self.repo.commit("feature without base", self.root)
        merge = self.repo.commit("merge without base", scenario.base, head, tree=self.repo.tree(head))
        self.repo.pulls[47] = pull_request(47, head)
        self.repo.publish(head, scenario.base)
        scenario.env, scenario.event = (environment("pull_request", "refs/pull/47/merge", merge),
                                        {"pull_request": {"number": 47, "head": {"sha": head}}})
        self.assert_rejected(scenario, "does not contain develop", waits=False)

        scenario = self.pull_request_scenario()
        self.repo.commits[scenario.merge] = (sha("conflict resolution"), [scenario.base, scenario.head])
        self.assert_rejected(scenario, "differs from the checked head tree", waits=False)

        scenario = self.pull_request_scenario()
        self.repo.commits[scenario.merge] = (self.repo.tree(scenario.head), [scenario.head, scenario.base])
        self.assert_rejected(scenario, "is not GitHub's merge", waits=False)

    def test_forks_closed_or_moved_pull_requests_fail(self):
        cases = {
            "fork": ({"head": {"sha": None, "repo": {"full_name": "someone/RollTheDice"}}},
                     "only pull requests from this repository"),
            "deleted fork": ({"head": {"sha": None, "repo": None}}, "only pull requests from this repository"),
            "closed": ({"state": "closed"}, "is not open"),
            "moved head": ({"head": {"sha": sha("newer head"), "repo": {"full_name": REPOSITORY}}}, "moved past"),
        }
        for name, (overrides, fragment) in cases.items():
            with self.subTest(name):
                scenario = self.pull_request_scenario()
                pull = self.repo.pulls[47]
                if "head" in overrides and overrides["head"]["sha"] is None:
                    overrides["head"]["sha"] = scenario.head
                pull.update(overrides)
                self.assert_rejected(scenario, fragment, waits=False)

    def test_status_pages_are_read_completely(self):
        scenario = self.pull_request_scenario()
        tree = self.repo.tree(scenario.head)
        noise = [receipt_status(scenario.head, tree, scenario.base, context=f"other {index}") for index in range(150)]
        self.repo.statuses[scenario.head] = noise[:120] + self.repo.statuses[scenario.head] + noise[120:]
        self.assert_passes(scenario, "Pull request #47")
        self.assertTrue(any(call.endswith("page=2") for call in self.repo.calls))
        # An unreadable flood of statuses is unclear evidence, not a pass.
        self.repo.statuses[scenario.head] = noise[:100] * gate.MAX_STATUS_PAGES + self.repo.statuses[scenario.head]
        self.assert_rejected(scenario, "too many statuses", waits=False)


class DevelopPushGateTestCase(GateTestCase):
    def setUp(self):
        super().setUp()
        self.before = self.repo.commit("develop", self.root)

    def merge_scenario(self, **pull_overrides):
        head = self.repo.commit("feature", self.before)
        merge = self.repo.commit("merge", self.before, head, tree=self.repo.tree(head))
        self.repo.pulls[47] = {**pull_request(47, head, merge_commit_sha=merge), **pull_overrides}
        self.repo.publish(head, self.before)
        scenario = self.push_scenario("develop", self.before, merge)
        scenario.head = head
        return scenario

    def test_directly_pushed_verified_commit_passes(self):
        commit = self.repo.commit("direct", self.before)
        self.repo.publish(commit, self.before)
        self.assert_passes(self.push_scenario("develop", self.before, commit), "Direct push", commit)

    def test_direct_push_waits_for_the_status_published_after_it(self):
        commit = self.repo.commit("direct", self.before)
        self.on_sleep = lambda count: count == 3 and self.repo.publish(commit, self.before)
        self.assert_passes(self.push_scenario("develop", self.before, commit), "Direct push")
        self.assertEqual(len(self.sleeps), 3)

    def test_direct_push_against_another_base_fails_immediately(self):
        # Someone else pushed between the local check and this push.
        newer = self.repo.commit("other push", self.before)
        commit = self.repo.commit("direct", newer)
        self.repo.publish(commit, self.before)
        self.assert_rejected(self.push_scenario("develop", newer, commit), "integrate the current base", waits=False)

    def test_normal_pull_request_merge_of_the_verified_head_passes(self):
        scenario = self.merge_scenario()
        self.assert_passes(scenario, "pull request #47", scenario.head, f"base `{self.before}`")
        self.assertEqual(self.sleeps, [])

    def test_unverifiable_merges_fail_after_waiting_for_a_direct_status(self):
        def stale_receipt(scenario):
            self.repo.statuses[scenario.head] = [receipt_status(scenario.head, self.repo.tree(scenario.head),
                                                                self.root)]

        def changed_tree(scenario):
            tree, parents = self.repo.commits[scenario.after]
            self.repo.commits[scenario.after] = (sha("other tree"), parents)

        def swapped_parents(scenario):
            self.repo.commits[scenario.after] = (self.repo.tree(scenario.head), [scenario.head, self.before])

        def second_pull(scenario):
            self.repo.pulls[48] = {**self.repo.pulls[47], "number": 48}

        def head_without_base(scenario):
            head = self.repo.commit("feature without base", self.root)
            self.repo.commits[scenario.after] = (self.repo.tree(head), [self.before, head])
            self.repo.pulls[47] = pull_request(47, head, merge_commit_sha=scenario.after)
            self.repo.publish(head, self.before)

        def unverified_head(scenario):
            self.repo.statuses.pop(scenario.head)

        cases = {
            "stale head receipt": (stale_receipt, "checked against base"),
            "changed merge tree": (changed_tree, "differs from the checked head tree"),
            "swapped parents": (swapped_parents, "not a merge commit on top of"),
            "no pull request": (lambda scenario: self.repo.pulls.clear(), "0 pull requests"),
            "two pull requests": (second_pull, "2 pull requests"),
            "merged into master": (lambda scenario: self.repo.pulls[47]["base"].update(ref="master"),
                                   "no merge of"),
            "not merged": (lambda scenario: self.repo.pulls[47].update(merged_at=None), "no merge of"),
            "other head": (lambda scenario: self.repo.pulls[47]["head"].update(sha=sha("x")), "no merge of"),
            "fork head": (lambda scenario: self.repo.pulls[47]["head"].update(repo={"full_name": "a/b"}),
                          "no merge of"),
            "head without base": (head_without_base, "does not contain"),
            "unverified head": (unverified_head, f"has no '{gate.CONTEXT}' status"),
        }
        for name, (change, fragment) in cases.items():
            with self.subTest(name):
                self.reset()
                self.before = self.repo.commit("develop", self.root)
                scenario = self.merge_scenario()
                change(scenario)
                self.assert_rejected(scenario, fragment, waits=True)

    def test_squash_merges_are_not_accepted(self):
        head = self.repo.commit("feature", self.before)
        squash = self.repo.commit("squash", self.before, tree=self.repo.tree(head))
        self.repo.pulls[47] = pull_request(47, head, merge_commit_sha=squash)
        self.repo.publish(head, self.before)
        self.assert_rejected(self.push_scenario("develop", self.before, squash), "not a merge commit", waits=True)

    def test_only_plain_pushes_of_integration_branches_are_verified(self):
        commit = self.repo.commit("direct", self.before)
        self.repo.publish(commit, self.before)
        cases = {
            "forced": {"forced": True},
            "created": {"created": True},
            "deleted": {"deleted": True},
            "other pushed commit": {"after": self.before},
            "new branch": {"before": "0" * 40},
            "unknown force state": {"forced": None},
        }
        for name, overrides in cases.items():
            with self.subTest(name):
                self.sleeps.clear()
                self.assert_rejected(self.push_scenario("develop", self.before, commit, **overrides),
                                     "only plain fast-forward pushes", waits=False)
        rewritten = self.repo.commit("rewritten", self.root)
        self.repo.publish(rewritten, self.before)
        self.assert_rejected(self.push_scenario("develop", self.before, rewritten), "does not descend", waits=False)
        for ref in ("refs/heads/codex/feature", "refs/tags/v3.9.0"):
            with self.subTest(ref):
                scenario = self.push_scenario("develop", self.before, commit)
                scenario.env["GITHUB_REF"] = ref
                self.assert_rejected(scenario, "not integration pushes", waits=False)
        scenario = self.push_scenario("develop", self.before, commit)
        scenario.env["GITHUB_EVENT_NAME"] = "workflow_dispatch"
        self.assert_rejected(scenario, "carry no verifiable integration", waits=False)


class MasterPushGateTestCase(GateTestCase):
    def setUp(self):
        super().setUp()
        self.before = self.repo.commit("master", self.root)
        self.develop = self.repo.commit("develop", self.before)
        self.repo.refs["develop"] = self.develop

    def verified_on_develop(self, commit: str, run_id: int = 800, **overrides) -> None:
        self.repo.runs.append(workflow_run(commit, run_id, **overrides))
        self.repo.jobs[run_id] = [result_job(run_id, commit)]

    def test_fast_forward_reuses_the_passed_develop_run_of_the_same_commit(self):
        self.verified_on_develop(self.develop)
        self.assert_passes(self.push_scenario("master", self.before, self.develop), "Fast-forward",
                           f"{SERVER}/{REPOSITORY}/actions/runs/800")
        self.assertEqual(self.sleeps, [])

    def test_fast_forward_waits_for_a_running_develop_run(self):
        self.verified_on_develop(self.develop, status="in_progress", conclusion=None)
        self.on_sleep = lambda count: count == 2 and self.repo.runs[0].update(status="completed",
                                                                                conclusion="success")
        self.assert_passes(self.push_scenario("master", self.before, self.develop), "Fast-forward")
        self.assertEqual(len(self.sleeps), 2)

    def test_fast_forward_without_passed_develop_evidence_fails(self):
        self.assert_rejected(self.push_scenario("master", self.before, self.develop), "no develop push run",
                             waits=True)
        self.sleeps.clear()
        self.verified_on_develop(self.develop, conclusion="failure")
        self.assert_rejected(self.push_scenario("master", self.before, self.develop), "did not succeed", waits=True)
        self.sleeps.clear()
        self.repo.runs.append(workflow_run(self.develop, 801))
        self.repo.jobs[801] = [result_job(801, self.develop)]
        self.assert_rejected(self.push_scenario("master", self.before, self.develop), "did not succeed", waits=True)

    def test_untrusted_or_inconsistent_develop_evidence_fails_immediately(self):
        cases = {
            "pull request run": ({"event": "pull_request"}, "is not a develop push run"),
            "feature branch run": ({"head_branch": "codex/feature"}, "is not a develop push run"),
            "other workflow": ({"workflow_id": 7}, "is not a develop push run"),
            "other workflow file": ({"path": ".github/workflows/other.yml"}, "is not a develop push run"),
            "fork": ({"head_repository": {"full_name": "someone/RollTheDice"}}, "is not a develop push run"),
        }
        for name, (overrides, fragment) in cases.items():
            with self.subTest(name):
                self.repo.runs.clear()
                self.verified_on_develop(self.develop, **overrides)
                self.assert_rejected(self.push_scenario("master", self.before, self.develop), fragment, waits=False)
        jobs = {
            "failed result": [result_job(800, self.develop, conclusion="failure")],
            "skipped result": [result_job(800, self.develop, conclusion="skipped")],
            "extra job": [result_job(800, self.develop), result_job(800, self.develop, name="backend")],
            "other commit": [result_job(800, sha("other"))],
            "no jobs": [],
        }
        for name, job_list in jobs.items():
            with self.subTest(name):
                self.repo.runs.clear()
                self.verified_on_develop(self.develop)
                self.repo.jobs[800] = job_list
                self.assert_rejected(self.push_scenario("master", self.before, self.develop),
                                     "no single successful", waits=False)
        self.repo.runs.clear()
        self.verified_on_develop(self.develop)
        scenario = self.push_scenario("master", self.before, self.develop)
        self.repo.refs["develop"] = self.repo.commit("rewritten develop", self.root)
        self.assert_rejected(scenario, "develop no longer contains", waits=False)
        scenario = self.push_scenario("master", self.before, self.develop)
        self.repo.current["path"] = ".github/workflows/other.yml"
        self.assert_rejected(scenario, "current run is not", waits=False)

    def test_release_merge_reproducing_the_develop_tree_reuses_its_evidence(self):
        self.verified_on_develop(self.develop)
        release = self.repo.commit("release", self.before, self.develop, tree=self.repo.tree(self.develop))
        self.assert_passes(self.push_scenario("master", self.before, release), "Release merge", self.develop)

    def test_release_merge_with_another_tree_needs_local_verification_of_the_actual_merge(self):
        hotfix = self.repo.commit("hotfix", self.before)
        self.verified_on_develop(self.develop)
        release = self.repo.commit("release", hotfix, self.develop)
        self.assert_rejected(self.push_scenario("master", hotfix, release), "needs its own local verification",
                             waits=True)
        self.sleeps.clear()
        self.repo.publish(release, hotfix)
        self.assert_passes(self.push_scenario("master", hotfix, release), "Direct push", release)

    def test_verified_hotfix_pull_request_merge_into_master_passes(self):
        head = self.repo.commit("hotfix", self.before)
        merge = self.repo.commit("hotfix merge", self.before, head, tree=self.repo.tree(head))
        self.repo.pulls[50] = pull_request(50, head, "master", merge_commit_sha=merge)
        self.repo.publish(head, self.before)
        self.assert_passes(self.push_scenario("master", self.before, merge), "pull request #50", head)


class VerifyCommandTestCase(GateTestCase):
    def run_verify(self, scenario, get=None, event=True) -> tuple[int, str]:
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            if event:
                (folder / "event.json").write_text(json.dumps(scenario.event), encoding="utf-8")
            env = {**scenario.env, "GITHUB_EVENT_PATH": str(folder / "event.json"),
                   "GITHUB_STEP_SUMMARY": str(folder / "summary.md")}
            with patch("builtins.print"):
                code = gate.verify(env, get or self.repo, now=lambda: self.clock, sleep=self.sleep,
                                   wait_seconds=WAIT_SECONDS)
            return code, (folder / "summary.md").read_text(encoding="utf-8")

    def test_summary_explains_and_links_the_evidence(self):
        scenario = self.pull_request_scenario()
        code, summary = self.run_verify(scenario)
        self.assertEqual(code, 0)
        self.assertIn(f"### {gate.RESULT_JOB}", summary)
        self.assertIn("**Passed: locally verified and integrated unchanged.**", summary)
        self.assertIn(f"({SERVER}/{REPOSITORY}/pull/47)", summary)
        self.assertIn(f"({SERVER}/{REPOSITORY}/commit/{scenario.head})", summary)

    def test_rejections_and_api_errors_never_pass(self):
        scenario = self.pull_request_scenario()
        self.repo.publish(scenario.head, scenario.base, creator="someone")
        code, summary = self.run_verify(scenario)
        self.assertEqual(code, 1)
        self.assertIn("not the repository owner", summary)
        self.assertIn(gate.LOCAL_HINT, summary)

        def unavailable(path):
            raise OSError("GitHub unavailable")

        code, summary = self.run_verify(self.pull_request_scenario(), get=unavailable)
        self.assertEqual(code, 1)
        self.assertIn("could not be read (OSError", summary)
        self.assertEqual(self.sleeps, [])
        code, summary = self.run_verify(self.pull_request_scenario(), event=False)
        self.assertEqual(code, 1)
        self.assertIn("event payload could not be read", summary)
        scenario = self.pull_request_scenario()
        scenario.env["GITHUB_REPOSITORY_OWNER"] = "someone"
        self.assertEqual(self.run_verify(scenario)[0], 1)

    def test_api_requests_are_authenticated_reads_with_a_timeout(self):
        get = gate.github_getter({"GH_TOKEN": "ci-token", "GITHUB_API_URL": "https://api.example.test"})
        with patch("urllib.request.urlopen", return_value=io.BytesIO(b'{"id": 1}')) as urlopen:
            self.assertEqual(get("/repos/x/y"), {"id": 1})
        request = urlopen.call_args.args[0]
        self.assertEqual((request.full_url, request.get_method()), ("https://api.example.test/repos/x/y", "GET"))
        self.assertEqual(request.get_header("Authorization"), "Bearer ci-token")
        self.assertEqual(urlopen.call_args.kwargs, {"timeout": 20})
        for env in ({}, {"GH_TOKEN": "t", "GITHUB_API_URL": "http://api.example.test"}):
            with self.subTest(env=env), self.assertRaises(gate.Rejected):
                gate.github_getter(env)("/repos/x/y")

    def test_main_accepts_only_verify(self):
        with patch("sys.stderr"):
            self.assertEqual(gate.main(["ci_release_evidence.py"]), 2)
            self.assertEqual(gate.main(["ci_release_evidence.py", "result"]), 2)


if __name__ == "__main__":
    unittest.main()
