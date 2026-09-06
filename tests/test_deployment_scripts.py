from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
PRUNE_SCRIPT = BASE_DIR / "scripts" / "prune_data_backups.sh"


class ReleaseDeploymentTestCase(unittest.TestCase):
    def test_release_is_published_only_after_build_and_health_and_marker_survives_retries(self):
        source = (BASE_DIR / "scripts" / "deploy_zdwa.sh").read_text(encoding="utf-8")
        remote = source.split("<<'REMOTE_SCRIPT'\n", 1)[1].rsplit("\nREMOTE_SCRIPT", 1)[0]
        # Execute the real remote workflow with local command doubles. No SSH,
        # Docker daemon, production database or push service is contacted.
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
    *"docker compose up"*) echo BUILD; return "$BUILD_FAIL" ;;
    *"docker compose exec"*) echo PUBLISH; return "$QUEUE_FAIL" ;;
    *"prune_data_backups.sh"*) echo RETENTION ;;
  esac
  return 0
}
python3() {
  if [[ "$1" == "scripts/prepare_release_notice.py" ]]; then
    echo "BASE:$3" >&2
    printf '%s\n' '{"skip":true}'
  fi
}
curl() { echo HEALTH >&2; return "$HEALTH_FAIL"; }
'''
        old, new = "a" * 40, "b" * 40
        for failure in ("BUILD_FAIL", "HEALTH_FAIL", "QUEUE_FAIL", None):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                marker = Path(directory) / ".deployment-marker"
                # Simulate a checkout already advanced by a failed first try.
                marker.write_text(old + "\n", encoding="utf-8")
                flags = {"BUILD_FAIL": "0", "HEALTH_FAIL": "0", "QUEUE_FAIL": "0"}
                if failure:
                    flags[failure] = "1"
                result = subprocess.run(["bash", "-s"], input=doubles + remote, capture_output=True, text=True,
                                        env={**os.environ, **flags, "REMOTE_DIR": directory, "BRANCH": "master", "DEPLOY_HEAD": new, "NEW_REVISION": new})
                self.assertIn(f"BASE:{old}", result.stderr)
                self.assertEqual(result.returncode == 0, failure is None)
                self.assertEqual(marker.read_text(encoding="utf-8").strip(), new if failure is None else old)
                if failure in ("BUILD_FAIL", "HEALTH_FAIL"):
                    self.assertNotIn("PUBLISH", result.stdout)
                if failure:
                    self.assertNotIn("RETENTION", result.stdout)
                else:
                    self.assertLess(result.stdout.index("BUILD"), result.stdout.index("PUBLISH"))
                    self.assertIn("HEALTH", result.stderr)
                    self.assertLess(result.stdout.index("PUBLISH"), result.stdout.index("RETENTION"))


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
