from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
PRUNE_SCRIPT = BASE_DIR / "scripts" / "prune_data_backups.sh"


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
