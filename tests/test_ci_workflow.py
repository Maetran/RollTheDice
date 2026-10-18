"""GitHub CI checks each change once and reuses only exactly verified release evidence."""

from __future__ import annotations

import io
import json
import re
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import patch

import yaml

from scripts import ci_release_evidence as gate

BASE_DIR = Path(__file__).resolve().parents[1]
WORKFLOW = BASE_DIR / ".github" / "workflows" / "quality.yml"
FULL_JOB_CONDITION = "${{ !cancelled() && needs.release-evidence.outputs.reuse != 'true' }}"

REPOSITORY = "Maetran/RollTheDice"
SHA = "a" * 40
OTHER_SHA = "b" * 40
WORKFLOW_ID = 42
RUN_ID = 900
EVIDENCE_ID = 800


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
        self.jobs = self.workflow["jobs"]

    def test_feature_branches_are_checked_once_through_their_pull_request(self):
        triggers = self.workflow["on"]
        self.assertEqual(set(triggers), {"push", "pull_request", "workflow_dispatch"})
        # Only integrated develop states and master promotions run on push, so a
        # feature branch with an open pull request is never checked twice. Tags
        # and path filters stay absent: nothing on those branches is skipped.
        self.assertEqual(triggers["push"], {"branches": ["develop", "master"]})
        # Every pull request is checked, whatever its base branch.
        self.assertIsNone(triggers["pull_request"])

    def test_superseded_runs_cancel_only_their_own_pull_request_or_branch(self):
        concurrency = self.workflow["concurrency"]
        self.assertIs(concurrency["cancel-in-progress"], True)
        self.assertFalse([job_id for job_id, job in self.jobs.items() if "concurrency" in job])

        def group(event_name: str, ref: str) -> str:
            return render(concurrency["group"], {"workflow": "Quality", "event_name": event_name, "ref": ref})

        pull_request_46 = group("pull_request", "refs/pull/46/merge")
        self.assertEqual(pull_request_46, group("pull_request", "refs/pull/46/merge"))
        others = [
            group("pull_request", "refs/pull/47/merge"),
            group("push", "refs/heads/develop"),
            group("push", "refs/heads/master"),
            group("workflow_dispatch", "refs/heads/develop"),
        ]
        self.assertEqual(len({pull_request_46, *others}), 5)

    def test_release_evidence_runs_only_for_master_pushes_with_read_only_access(self):
        self.assertEqual(self.workflow["permissions"], {"contents": "read"})
        job = self.jobs[gate.GATE_NEED]
        self.assertEqual(job["name"], gate.GATE_JOB)
        self.assertEqual(job["if"], "${{ github.event_name == 'push' && github.ref == 'refs/heads/master' }}")
        self.assertEqual(job["permissions"], {"actions": "read", "contents": "read"})
        checkout, verify = job["steps"]
        self.assertIs(checkout["with"]["persist-credentials"], False)
        self.assertEqual(verify["run"], "python3 scripts/ci_release_evidence.py verify")
        self.assertEqual(verify["env"], {"GH_TOKEN": "${{ github.token }}"})
        self.assertEqual(job["outputs"]["reuse"], "${{ steps.evidence.outputs.reuse }}")

    def test_full_check_runs_unless_reuse_was_verified(self):
        for job_id in gate.FULL_CHECK_NEEDS:
            with self.subTest(job=job_id):
                # A skipped or failed gate never suppresses the full check.
                self.assertEqual(self.jobs[job_id]["needs"], gate.GATE_NEED)
                self.assertEqual(self.jobs[job_id]["if"], FULL_JOB_CONDITION)

    def test_quality_result_aggregates_every_job_even_after_failures(self):
        job = self.jobs["result"]
        self.assertEqual(job["name"], gate.RESULT_JOB)
        self.assertEqual(job["needs"], [gate.GATE_NEED, *gate.FULL_CHECK_NEEDS])
        self.assertEqual(job["if"], "${{ always() }}")
        command = job["steps"][-1]
        self.assertEqual(command["run"], "python3 scripts/ci_release_evidence.py result")
        self.assertEqual(command["env"], {"NEEDS_JSON": "${{ toJSON(needs) }}"})

    def test_expected_evidence_jobs_match_the_workflow(self):
        full_jobs = {job_id: job for job_id, job in self.jobs.items() if job_id not in {gate.GATE_NEED, "result"}}
        self.assertEqual(tuple(full_jobs), gate.FULL_CHECK_NEEDS)
        names = []
        for job_id, job in full_jobs.items():
            matrix = job.get("strategy", {}).get("matrix", {"include": [{}]})
            self.assertEqual(set(matrix), {"include"})
            for entry in matrix["include"]:
                names.append(re.sub(r"\$\{\{\s*matrix\.(\w+)\s*\}\}", lambda match: str(entry[match.group(1)]),
                                    job.get("name", job_id)))
        self.assertEqual(tuple(names), gate.FULL_CHECK_JOBS)


def workflow_run(**overrides) -> dict:
    run = {
        "id": EVIDENCE_ID, "run_number": 10, "workflow_id": WORKFLOW_ID, "path": gate.WORKFLOW_PATH,
        "event": "push", "head_branch": "develop", "head_sha": SHA, "status": "completed", "conclusion": "success",
        "repository": {"full_name": REPOSITORY}, "head_repository": {"full_name": REPOSITORY},
    }
    run.update(overrides)
    return run


def job(name: str, conclusion: str = "success", **overrides) -> dict:
    return {"name": name, "run_id": EVIDENCE_ID, "head_sha": SHA, "status": "completed", "conclusion": conclusion,
            **overrides}


def evidence_jobs() -> list[dict]:
    return [job(gate.GATE_JOB, "skipped"), *(job(name) for name in gate.FULL_CHECK_JOBS), job(gate.RESULT_JOB)]


class FakeGitHub:
    """Serve the four read-only API answers the gate needs, and record each call."""

    def __init__(self, *, current=None, runs=None, jobs=None, comparison=None, runs_total=None, jobs_total=None):
        self.current = current or workflow_run(id=RUN_ID, run_number=11, head_branch="master",
                                               status="in_progress", conclusion=None)
        self.runs = [workflow_run()] if runs is None else runs
        self.jobs = evidence_jobs() if jobs is None else jobs
        self.comparison = {"status": "identical", "behind_by": 0} if comparison is None else comparison
        self.runs_total = len(self.runs) if runs_total is None else runs_total
        self.jobs_total = len(self.jobs) if jobs_total is None else jobs_total
        self.calls = []

    def __call__(self, path: str):
        self.calls.append(path)
        route = path.partition("?")[0]
        if route == f"/repos/{REPOSITORY}/actions/runs/{RUN_ID}":
            return self.current
        if route == f"/repos/{REPOSITORY}/actions/workflows/{WORKFLOW_ID}/runs":
            return {"total_count": self.runs_total, "workflow_runs": self.runs}
        if route == f"/repos/{REPOSITORY}/actions/runs/{EVIDENCE_ID}/jobs":
            return {"total_count": self.jobs_total, "jobs": self.jobs}
        if route == f"/repos/{REPOSITORY}/compare/{SHA}...develop":
            return self.comparison
        raise LookupError(path)


def master_push_env(**overrides) -> dict:
    env = {"GITHUB_EVENT_NAME": "push", "GITHUB_REF": "refs/heads/master", "GITHUB_SHA": SHA,
           "GITHUB_REPOSITORY": REPOSITORY, "GITHUB_RUN_ID": str(RUN_ID)}
    env.update(overrides)
    return env


def push_event(**overrides) -> dict:
    return {"forced": False, "deleted": False, "before": "c" * 40, "after": SHA, **overrides}


class ReleaseEvidenceTestCase(unittest.TestCase):
    def decide(self, github=None, env=None, event=None) -> gate.Decision:
        return gate.safe_decision(env or master_push_env(), push_event() if event is None else event,
                                  github or FakeGitHub())

    def assert_full_check(self, github=None, env=None, event=None, reason: str = ""):
        decision = self.decide(github, env, event)
        self.assertIs(decision.reuse, False, decision)
        self.assertIsNone(decision.evidence_run_id)
        self.assertIn(reason, decision.reason)

    def test_fast_forward_reuses_the_successful_develop_run_of_the_exact_commit(self):
        github = FakeGitHub()
        decision = self.decide(github)
        self.assertEqual(decision, gate.Decision(True, decision.reason, EVIDENCE_ID))
        self.assertEqual([call.partition("?")[0] for call in github.calls], [
            f"/repos/{REPOSITORY}/actions/runs/{RUN_ID}",
            f"/repos/{REPOSITORY}/actions/workflows/{WORKFLOW_ID}/runs",
            f"/repos/{REPOSITORY}/actions/runs/{EVIDENCE_ID}/jobs",
            f"/repos/{REPOSITORY}/compare/{SHA}...develop",
        ])
        query = urllib.parse.parse_qs(github.calls[1].partition("?")[2])
        self.assertEqual(query, {"event": ["push"], "branch": ["develop"], "head_sha": [SHA], "per_page": ["100"]})
        # A develop tip that has moved on still contains the promoted commit.
        self.assertIs(self.decide(FakeGitHub(comparison={"status": "ahead", "behind_by": 0})).reuse, True)

    def test_other_events_and_unusual_pushes_run_the_full_check_without_api_calls(self):
        cases = {
            "pull request": (master_push_env(GITHUB_EVENT_NAME="pull_request", GITHUB_REF="refs/pull/46/merge"),
                             push_event()),
            "develop push": (master_push_env(GITHUB_REF="refs/heads/develop"), push_event()),
            "manual run": (master_push_env(GITHUB_EVENT_NAME="workflow_dispatch"), push_event()),
            "forced push": (master_push_env(), push_event(forced=True)),
            "unknown force state": (master_push_env(), {"deleted": False, "after": SHA}),
            "deleted branch": (master_push_env(), push_event(deleted=True)),
            "different pushed commit": (master_push_env(), push_event(after=OTHER_SHA)),
            "invalid commit": (master_push_env(GITHUB_SHA="main"), push_event(after="main")),
            "missing run id": (master_push_env(GITHUB_RUN_ID=""), push_event()),
        }
        for name, (env, event) in cases.items():
            with self.subTest(name):
                github = FakeGitHub()
                self.assert_full_check(github, env, event)
                self.assertEqual(github.calls, [])

    def test_current_run_must_be_the_trusted_workflow_for_this_push(self):
        current = workflow_run(id=RUN_ID, head_branch="master", status="in_progress", conclusion=None)
        cases = {
            "other workflow file": {**current, "path": ".github/workflows/other.yml"},
            "other commit": {**current, "head_sha": OTHER_SHA},
            "other branch": {**current, "head_branch": "develop"},
            "fork": {**current, "head_repository": {"full_name": "someone/RollTheDice"}},
            "missing workflow": {key: value for key, value in current.items() if key != "workflow_id"},
        }
        for name, run in cases.items():
            with self.subTest(name):
                self.assert_full_check(FakeGitHub(current=run), reason="current run")
        # A workflow path suffixed with its ref is still the same file.
        suffixed = {**current, "path": f"{gate.WORKFLOW_PATH}@refs/heads/master"}
        self.assertIs(self.decide(FakeGitHub(current=suffixed)).reuse, True)

    def test_missing_unfinished_red_or_untrusted_develop_runs_require_the_full_check(self):
        cases = {
            "no develop run": ([], "no develop push run"),
            "still running": ([workflow_run(status="in_progress", conclusion=None)], "in_progress"),
            "failed": ([workflow_run(conclusion="failure")], "failure"),
            "cancelled": ([workflow_run(conclusion="cancelled")], "cancelled"),
            "pull request evidence": ([workflow_run(event="pull_request")], "not a trusted"),
            "feature branch evidence": ([workflow_run(head_branch="codex/feature")], "not a trusted"),
            "other commit": ([workflow_run(head_sha=OTHER_SHA)], "not a trusted"),
            "other workflow id": ([workflow_run(workflow_id=7)], "not a trusted"),
            "other workflow file": ([workflow_run(path=".github/workflows/other.yml")], "not a trusted"),
            "fork": ([workflow_run(head_repository={"full_name": "someone/RollTheDice"})], "not a trusted"),
            "green and red run": ([workflow_run(), workflow_run(id=801, run_number=12, conclusion="failure")],
                                  "failure"),
        }
        for name, (runs, reason) in cases.items():
            with self.subTest(name):
                self.assert_full_check(FakeGitHub(runs=runs), reason=reason)
        self.assert_full_check(FakeGitHub(runs_total=2), reason="incomplete")

    def test_evidence_must_contain_every_successful_full_check_job(self):
        def without(name: str) -> list[dict]:
            return [entry for entry in evidence_jobs() if entry["name"] != name]

        def replaced(name: str, conclusion: str, **overrides) -> list[dict]:
            return [job(name, conclusion, **overrides) if entry["name"] == name else entry
                    for entry in evidence_jobs()]

        cases = {
            "skipped browser shard": (replaced("Browser (main, 3/4)", "skipped"), "did not succeed"),
            "failed backend": (replaced("backend", "failure"), "did not succeed"),
            "missing production image": (without("production-image"), "did not succeed"),
            "missing quality result": (without(gate.RESULT_JOB), "did not succeed"),
            "reused evidence": (replaced(gate.GATE_JOB, "success"), "full check itself"),
            "unknown job": ([*evidence_jobs(), job("lint")], "unexpected jobs"),
            "duplicate job": ([*evidence_jobs(), job("backend")], "ambiguous"),
            "job from another commit": (replaced("backend", "success", head_sha=OTHER_SHA), "not a completed job"),
            "job from another run": (replaced("backend", "success", run_id=1), "not a completed job"),
            "unfinished job": (replaced("backend", None, status="in_progress"), "not a completed job"),
        }
        for name, (jobs, reason) in cases.items():
            with self.subTest(name):
                self.assert_full_check(FakeGitHub(jobs=jobs), reason=reason)
        self.assert_full_check(FakeGitHub(jobs_total=len(evidence_jobs()) + 1), reason="incomplete")
        # A gate that GitHub omits instead of listing as skipped is still acceptable.
        self.assertIs(self.decide(FakeGitHub(jobs=without(gate.GATE_JOB))).reuse, True)

    def test_develop_must_still_contain_the_promoted_commit(self):
        for comparison in ({"status": "behind", "behind_by": 3}, {"status": "diverged", "behind_by": 1}, {}):
            with self.subTest(comparison=comparison):
                self.assert_full_check(FakeGitHub(comparison=comparison), reason="no longer contains")

    def test_api_errors_and_missing_access_require_the_full_check(self):
        def unavailable(path):
            raise OSError(path)

        self.assert_full_check(unavailable, reason="OSError")
        self.assert_full_check(gate.github_getter({}), reason="no GitHub API access")
        self.assert_full_check(gate.github_getter({"GH_TOKEN": "t", "GITHUB_API_URL": "http://api"}),
                               reason="no GitHub API access")

    def test_api_requests_are_authenticated_reads_with_a_timeout(self):
        get = gate.github_getter({"GH_TOKEN": "ci-token", "GITHUB_API_URL": "https://api.example.test"})
        with patch("urllib.request.urlopen", return_value=io.BytesIO(b'{"id": 1}')) as urlopen:
            self.assertEqual(get("/repos/x/y"), {"id": 1})
        request = urlopen.call_args.args[0]
        self.assertEqual((request.full_url, request.get_method()), ("https://api.example.test/repos/x/y", "GET"))
        self.assertEqual(request.get_header("Authorization"), "Bearer ci-token")
        self.assertEqual(urlopen.call_args.kwargs, {"timeout": 20})


class ReleaseEvidenceCommandTestCase(unittest.TestCase):
    def run_verify(self, env: dict, event, github) -> tuple[dict, str]:
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            if event is not None:
                (folder / "event.json").write_text(json.dumps(event), encoding="utf-8")
            env = {**env, "GITHUB_EVENT_PATH": str(folder / "event.json"),
                   "GITHUB_OUTPUT": str(folder / "output"), "GITHUB_STEP_SUMMARY": str(folder / "summary")}
            self.assertEqual(gate.verify(env, github), 0)
            lines = (folder / "output").read_text(encoding="utf-8").splitlines()
            outputs = dict(line.split("=", 1) for line in lines)
            return outputs, (folder / "summary").read_text(encoding="utf-8")

    def test_verify_publishes_reuse_and_its_evidence_link(self):
        outputs, summary = self.run_verify(master_push_env(GITHUB_SERVER_URL="https://github.com"), push_event(),
                                           FakeGitHub())
        evidence_url = f"https://github.com/{REPOSITORY}/actions/runs/{EVIDENCE_ID}"
        self.assertEqual(outputs["reuse"], "true")
        self.assertEqual(outputs["evidence_run_id"], str(EVIDENCE_ID))
        self.assertEqual(outputs["evidence_url"], evidence_url)
        self.assertIn(evidence_url, summary)
        self.assertIn(SHA, summary)

    def test_verify_selects_the_full_check_without_evidence(self):
        def unused(path):
            raise AssertionError(path)

        cases = {
            "pull request": (master_push_env(GITHUB_EVENT_NAME="pull_request"), push_event(), unused),
            "missing event payload": (master_push_env(), None, unused),
            "red develop run": (master_push_env(), push_event(), FakeGitHub(runs=[workflow_run(conclusion="failure")])),
        }
        for name, (env, event, github) in cases.items():
            with self.subTest(name):
                outputs, summary = self.run_verify(env, event, github)
                self.assertEqual((outputs["reuse"], outputs["evidence_run_id"], outputs["evidence_url"]),
                                 ("false", "", ""))
                self.assertIn("Full check required", summary)

    def test_quality_result_passes_only_after_a_full_check_or_verified_reuse(self):
        def needs(gate_result="skipped", reuse="", evidence_run_id="", **results):
            values = {
                gate.GATE_NEED: {"result": gate_result,
                                 "outputs": {"reuse": reuse, "evidence_run_id": evidence_run_id}},
            }
            for name in gate.FULL_CHECK_NEEDS:
                values[name] = {"result": results.get(name.replace("-", "_"), "success"), "outputs": {}}
            return values

        skipped = {"production_image": "skipped", "backend": "skipped", "browser": "skipped"}
        passing = {
            "full pull request check": needs(),
            "full master check without evidence": needs("success", "false"),
            "verified reuse": needs("success", "true", str(EVIDENCE_ID), **skipped),
        }
        failing = {
            "failed browser shard": needs(browser="failure"),
            "cancelled backend": needs(backend="cancelled"),
            "skipped without reuse": needs(**skipped),
            "reuse without evidence run": needs("success", "true", "", **skipped),
            "reuse from a failed gate": needs("failure", "true", str(EVIDENCE_ID), **skipped),
            "reuse with a failed job": needs("success", "true", str(EVIDENCE_ID), **{**skipped, "backend": "failure"}),
            "partially skipped": needs("success", "true", str(EVIDENCE_ID), browser="skipped"),
            "missing needs": {},
        }
        for name, value in [*passing.items(), *failing.items()]:
            with self.subTest(name):
                expected = name in passing
                self.assertIs(gate.decide_result(value)[0], expected)
                self.assertEqual(gate.result({"NEEDS_JSON": json.dumps(value)}), 0 if expected else 1)
        self.assertEqual(gate.result({"NEEDS_JSON": "not json"}), 1)

    def test_main_rejects_unknown_commands(self):
        self.assertEqual(gate.main(["ci_release_evidence.py"]), 2)
        self.assertEqual(gate.main(["ci_release_evidence.py", "skip"]), 2)


if __name__ == "__main__":
    unittest.main()
