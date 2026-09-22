"""Founder binding is explicit, persistent and completed before serving traffic."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import func, select

from app.auth import create_user
from app.database import configure_database, session_scope, upgrade_database
from app.models import AccountOwnership, OwnershipAudit, User
from app.owner_bootstrap import ensure_configured_founder


class OwnerBootstrapTestCase(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.environment = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{directory.name}/ownership.sqlite3",
            "ROLLTHEDICE_FOUNDER_USER_ID": "",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        configure_database(Path(directory.name))
        upgrade_database(Path(__file__).resolve().parents[1])
        self.founder = create_user("InitialFounder", "password-founder-123", role="admin")
        self.other = create_user("AnotherAdmin", "password-another-123", role="admin")

    def test_binding_survives_rename_and_removed_configuration_without_rebinding(self):
        ensure_configured_founder()
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(AccountOwnership)), 0)
        os.environ["ROLLTHEDICE_FOUNDER_USER_ID"] = str(self.founder.id)
        ensure_configured_founder()
        with session_scope() as db:
            user = db.get(User, self.founder.id)
            user.username = "RenamedFounder"
            user.username_normalized = "renamedfounder"
        ensure_configured_founder()
        os.environ["ROLLTHEDICE_FOUNDER_USER_ID"] = ""
        ensure_configured_founder()
        with session_scope() as db:
            self.assertTrue(db.get(AccountOwnership, self.founder.id).is_founder)
            self.assertEqual(db.scalar(select(func.count()).select_from(OwnershipAudit)), 1)
        os.environ["ROLLTHEDICE_FOUNDER_USER_ID"] = str(self.other.id)
        with self.assertRaises(HTTPException) as caught:
            ensure_configured_founder()
        self.assertEqual(caught.exception.detail, "founder_already_bound")

    def test_invalid_and_ineligible_ids_fail_instead_of_guessing_by_name(self):
        for invalid in ("Mani", "0", "-1", "1e3", "1;exit"):
            with self.subTest(value=invalid):
                os.environ["ROLLTHEDICE_FOUNDER_USER_ID"] = invalid
                with self.assertRaises(ValueError):
                    ensure_configured_founder()
        player = create_user("OrdinaryPlayer", "password-player-123")
        os.environ["ROLLTHEDICE_FOUNDER_USER_ID"] = str(player.id)
        with self.assertRaises(HTTPException) as caught:
            ensure_configured_founder()
        self.assertEqual(caught.exception.detail, "ownership_requires_eligible_admin")
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(AccountOwnership)), 0)
