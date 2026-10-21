from __future__ import annotations

import ast
import os
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
PRUNE_SCRIPT = BASE_DIR / "scripts" / "prune_data_backups.sh"
NGINX_CONFIG = BASE_DIR / "deploy" / "nginx" / "rollthedice.conf"


class ReleaseDeploymentTestCase(unittest.TestCase):
    def test_all_root_file_response_assets_and_manifest_routes_are_copied_into_image(self):
        # Inspect the actual route definitions without importing the application
        # or opening its database. Checkout HTTP tests cannot detect files that
        # exist locally but are omitted from the production image.
        application = ast.parse((BASE_DIR / "app" / "main.py").read_text(encoding="utf-8"))
        manifests = set()
        root_files = set()
        for node in ast.walk(application):
            if not isinstance(node, ast.Call):
                continue
            if (isinstance(node.func, ast.Attribute) and node.func.attr == "get"
                    and isinstance(node.func.value, ast.Name) and node.func.value.id == "app"
                    and node.args and isinstance(node.args[0], ast.Constant)
                    and isinstance(node.args[0].value, str) and node.args[0].value.endswith(".webmanifest")):
                manifests.add(node.args[0].value.removeprefix("/"))
            if isinstance(node.func, ast.Name) and node.func.id == "FileResponse":
                for path in ast.walk(node):
                    if (isinstance(path, ast.BinOp) and isinstance(path.op, ast.Div)
                            and isinstance(path.left, ast.Name) and path.left.id == "BASE"
                            and isinstance(path.right, ast.Constant) and isinstance(path.right.value, str)):
                        root_files.add(path.right.value)
        self.assertEqual(manifests, {
            "manifest.webmanifest", "manifest-en.webmanifest",
            "zilch-manifest.webmanifest", "zilch-manifest-en.webmanifest",
            "hausdepp-manifest.webmanifest", "hausdepp-manifest-en.webmanifest",
        })
        copies = {
            tuple(shlex.split(line)[1:])
            for line in (BASE_DIR / "Dockerfile").read_text(encoding="utf-8").splitlines()
            if line.startswith("COPY ")
        }
        for filename in sorted(root_files | manifests):
            with self.subTest(filename=filename):
                self.assertTrue((BASE_DIR / filename).is_file())
                self.assertIn((filename, f"/app/{filename}"), copies,
                              f"Root FileResponse asset is missing from the production image: {filename}")
        # All other page, worker, icon and version files live under app/.
        self.assertIn(("app", "/app/app"), copies)

    def _run_deployment(self, directory, **flags):
        source = (BASE_DIR / "scripts" / "deploy_zdwa.sh").read_text(encoding="utf-8")
        remote = source.split("<<'REMOTE_SCRIPT'\n", 1)[1].rsplit("\nREMOTE_SCRIPT", 1)[0]
        # Run the real remote shell with command doubles: no SSH, Docker,
        # production database, external notification or real wait is involved.
        doubles = r'''
git() {
  case "$1" in
    status) return 0 ;;
    rev-parse)
      if [[ "$2" == "--git-path" ]]; then printf '%s\n' .deployment-marker;
      else printf '%s\n' "$DEPLOY_HEAD"; fi ;;
    pull) DEPLOY_HEAD="$NEW_REVISION" ;;
  esac
}
sudo() {
  case "$*" in
    *"docker compose build"*) echo BUILD; return "$BUILD_FAIL" ;;
    *"docker compose up"*) echo RECREATE; echo "COMPOSE_ARGS:$*"; return "$RECREATE_FAIL" ;;
    *"docker compose ps --status running"*) echo rollthedice ;;
    *"docker compose stop"*) echo STOP >&2 ;;
    *"docker compose start"*) echo RECOVER_START >&2 ;;
    *"docker compose exec"*"python -c"*) return "$CAPABILITY_STATUS" ;;
    *"docker compose exec"*"deployment_notice announce"*) echo NOTICE; return "$ANNOUNCE_FAIL" ;;
    *"docker compose exec"*"deployment_notice clear"*) echo CLEAR ;;
    *"docker compose exec"*"app.release_push"*) echo "PUBLISH:$(cat)"; return "$QUEUE_FAIL" ;;
    *"cp -a data"*) echo BACKUP; return "$BACKUP_FAIL" ;;
    *"prune_data_backups.sh"*) echo RETENTION ;;
  esac
  return 0
}
python3() {
  if [[ "$1" == "scripts/prepare_release_notice.py" ]]; then
    echo "BASE:$3" >&2
    printf '%s\n' '{"skip":true}'
  elif [[ "$1" == "scripts/verify_public_release.py" ]]; then
    echo PUBLIC_SMOKE
    return "$PUBLIC_FAIL"
  fi
}
curl() { echo HEALTH >&2; return "$HEALTH_FAIL"; }
sleep() { echo "WAIT:$*"; if [[ "$CANCEL_WAIT" == "1" ]]; then kill -TERM "$$"; fi; }
'''
        defaults = {name: "0" for name in ("BUILD_FAIL", "RECREATE_FAIL", "HEALTH_FAIL", "PUBLIC_FAIL", "QUEUE_FAIL",
                                           "ANNOUNCE_FAIL", "BACKUP_FAIL", "CAPABILITY_STATUS", "CANCEL_WAIT")}
        return subprocess.run(["bash", "-s"], input=doubles + remote, capture_output=True, text=True,
                              env={**os.environ, **defaults, "FOUNDER_USER_ID": "2", "REMOTE_DIR": str(directory),
                                   "BRANCH": "master", "DEPLOY_HEAD": "b" * 40, "NEW_REVISION": "b" * 40, **flags})

    def test_release_is_published_only_after_build_and_health_and_marker_survives_retries(self):
        old, new = "a" * 40, "b" * 40
        for failure in ("BUILD_FAIL", "ANNOUNCE_FAIL", "BACKUP_FAIL", "RECREATE_FAIL", "HEALTH_FAIL", "PUBLIC_FAIL", "QUEUE_FAIL", None):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                marker = root / ".deployment-marker"
                marker.write_text(old + "\n", encoding="utf-8")
                (root / "data").mkdir()
                result = self._run_deployment(root, **({failure: "1"} if failure else {}))
                self.assertIn(f"BASE:{old}", result.stderr)
                self.assertEqual(result.returncode == 0, failure is None, result.stdout + result.stderr)
                self.assertEqual(marker.read_text(encoding="utf-8").strip(), new if failure is None else old)
                if failure in ("BUILD_FAIL", "ANNOUNCE_FAIL"):
                    self.assertNotIn("STOP", result.stderr)
                    self.assertNotIn("BACKUP", result.stdout)
                    self.assertNotIn("RECREATE", result.stdout)
                if failure in ("BACKUP_FAIL", "RECREATE_FAIL"):
                    self.assertIn("RECOVER_START", result.stderr)
                if failure not in (None, "QUEUE_FAIL"):
                    self.assertNotIn("PUBLISH", result.stdout)
                if failure:
                    self.assertNotIn("RETENTION", result.stdout)
                else:
                    self.assertIn("env ROLLTHEDICE_FOUNDER_USER_ID=2 docker compose up -d --no-build", result.stdout)
                    self.assertIn("STOP", result.stderr)
                    self.assertIn("HEALTH", result.stderr)
                    self.assertIn('PUBLISH:{"skip":true}', result.stdout)
                    steps = ["BUILD", "NOTICE", "WAIT:30", "BACKUP", "RECREATE", "CLEAR", "PUBLIC_SMOKE", "PUBLISH", "RETENTION"]
                    offsets = [result.stdout.index(step) for step in steps]
                    self.assertEqual(offsets, sorted(offsets))

    def test_old_notice_capability_requires_explicit_first_installation_override(self):
        for capability, bootstrap, succeeds in (("42", "0", False), ("42", "1", True), ("1", "1", False)):
            with self.subTest(capability=capability, bootstrap=bootstrap), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "data").mkdir()
                result = self._run_deployment(root, CAPABILITY_STATUS=capability, ALLOW_NOTICE_BOOTSTRAP=bootstrap)
                self.assertEqual(result.returncode == 0, succeeds, result.stdout + result.stderr)
                self.assertNotIn("NOTICE\n", result.stdout)
                if succeeds:
                    self.assertIn("old version cannot deliver rollout notices", result.stdout)
                    self.assertIn("WAIT:30", result.stdout)
                    self.assertIn("STOP", result.stderr)
                else:
                    self.assertNotIn("STOP", result.stderr)
                    self.assertNotIn("RECREATE", result.stdout)

    def test_cancelling_the_warning_clears_it_without_stopping_the_service(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "data").mkdir()
            result = self._run_deployment(root, CANCEL_WAIT="1")
            self.assertEqual(result.returncode, 143)
            self.assertIn("NOTICE", result.stdout)
            self.assertIn("CLEAR", result.stdout)
            self.assertNotIn("STOP", result.stderr)
            self.assertNotIn("RECOVER_START", result.stderr)
            self.assertNotIn("RECREATE", result.stdout)
            self.assertNotIn("PUBLISH", result.stdout)

    def test_founder_binding_rejects_names_and_shell_input_before_ssh(self):
        for invalid in ("Mani", "0", "-1", "2;exit", "2 3"):
            with self.subTest(value=invalid):
                result = subprocess.run(
                    [str(BASE_DIR / "scripts" / "deploy_zdwa.sh")], capture_output=True, text=True,
                    env={**os.environ, "FOUNDER_USER_ID": invalid},
                )
                self.assertEqual(result.returncode, 2)
                self.assertIn("FOUNDER_USER_ID must be a positive account ID", result.stderr)

    def test_notice_bootstrap_rejects_invalid_flag_before_ssh(self):
        result = subprocess.run([str(BASE_DIR / "scripts" / "deploy_zdwa.sh")], capture_output=True, text=True,
                                env={**os.environ, "ALLOW_NOTICE_BOOTSTRAP": "sometimes"})
        self.assertEqual(result.returncode, 2)
        self.assertIn("ALLOW_NOTICE_BOOTSTRAP must be 0 or 1", result.stderr)


class BackupRetentionTestCase(unittest.TestCase):
    def test_pruning_keeps_latest_five_deployment_backups(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            backup_root = Path(temporary_directory)
            backup_names = [f"data.backup-202608{day:02d}-120000" for day in range(1, 8)]
            for backup_name in backup_names:
                (backup_root / backup_name).mkdir()
            manual_archive = backup_root / "data.backup-20260801-manual"
            manual_archive.mkdir()

            environment = {**os.environ, "BACKUP_ROOT": str(backup_root)}
            dry_run = subprocess.run(
                [str(PRUNE_SCRIPT)],
                check=True,
                capture_output=True,
                text=True,
                env=environment,
            )
            self.assertIn("Dry run only", dry_run.stdout)
            self.assertTrue(all((backup_root / name).is_dir() for name in backup_names))

            applied = subprocess.run(
                [str(PRUNE_SCRIPT)],
                check=True,
                capture_output=True,
                text=True,
                env={**environment, "APPLY": "1"},
            )
            self.assertIn("Removed 2 old backups; kept the newest 5", applied.stdout)
            self.assertFalse((backup_root / backup_names[0]).exists())
            self.assertFalse((backup_root / backup_names[1]).exists())
            self.assertTrue(all((backup_root / name).is_dir() for name in backup_names[2:]))
            self.assertTrue(manual_archive.is_dir())

    def test_pruning_rejects_invalid_retention(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            result = subprocess.run(
                [str(PRUNE_SCRIPT)],
                capture_output=True,
                text=True,
                env={**os.environ, "BACKUP_ROOT": temporary_directory, "KEEP": "0"},
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("KEEP must be a positive integer", result.stderr)


class NginxAvatarUploadLimitTestCase(unittest.TestCase):
    def test_proxy_limit_cannot_be_lower_than_the_avatar_source_limit(self):
        source = NGINX_CONFIG.read_text(encoding="utf-8")
        self.assertIn("client_max_body_size 10m;", source)
