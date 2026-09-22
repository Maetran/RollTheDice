"""Durable ownership and privilege boundaries across account administration."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import IntegrityError

from app import main
from app.api_auth import (
    AdminPasswordResetRequest,
    AdminUserCreateRequest,
    AdminUserUpdateRequest,
    admin_create_user,
    admin_grant_ownership,
    admin_list_users,
    admin_reset_password,
    admin_revoke_ownership,
    admin_update_user,
)
from app.auth import auth_identity_payload, create_user, login, reset_password, resolve_session
from app.database import configure_database, session_scope, upgrade_database
from app.models import AccountOwnership, OwnershipAudit, User, UserBan
from app.models import Session as LoginSession
from app.ownership import bind_founder, grant_ownership, ownership_flags
from app.security import utcnow
from tests.test_user_accounts import request_for


class OwnerSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/ownership.sqlite",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.founder = create_user("Mani", "secure-password-123", role="admin", must_change_password=False)
        self.owner = create_user("Owner", "secure-password-123", role="admin", must_change_password=False)
        self.admin = create_user("Admin", "secure-password-123", role="admin", must_change_password=False)
        self.player = create_user("Player", "secure-password-123", must_change_password=False)
        with session_scope() as db:
            bind_founder(db, self.founder.id)
            grant_ownership(db, self.owner.id, self.founder.id)
        self.founder_request = self.request(self.founder.username)
        self.owner_request = self.request(self.owner.username)
        self.admin_request = self.request(self.admin.username)

    def tearDown(self):
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    @staticmethod
    def request(username):
        identity, token = login(request_for(), username, "secure-password-123")
        return request_for(cookie=f"rollthedice_session={token}", csrf=identity.csrf_token)

    def test_founder_follows_id_through_rename_restart_and_reused_name(self):
        with session_scope() as db:
            user = db.get(User, self.founder.id)
            user.username = "RenamedFounder"
            user.username_normalized = "renamedfounder"
        namesake = create_user("Mani", "secure-password-123", role="admin", must_change_password=False)
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        with session_scope() as db:
            self.assertTrue(ownership_flags(db, self.founder.id)["is_founder"])
            self.assertFalse(ownership_flags(db, namesake.id)["is_owner"])
            self.assertEqual(bind_founder(db, self.founder.id).user_id, self.founder.id)
            with self.assertRaises(HTTPException) as denied:
                bind_founder(db, namesake.id)
            self.assertEqual(denied.exception.detail, "founder_already_bound")
            self.assertEqual([row.action for row in db.scalars(select(OwnershipAudit).order_by(OwnershipAudit.id))],
                             ["founder_bound", "granted"])

    def test_normal_admin_cannot_create_promote_or_modify_staff_even_noops(self):
        for mutation in [AdminUserUpdateRequest(role="admin"), AdminUserUpdateRequest(is_active=True),
                         AdminUserUpdateRequest(lobby_chat_muted=False), AdminUserUpdateRequest(lobby_chat_excluded=False)]:
            for target in [self.admin, self.owner, self.founder]:
                with self.subTest(target=target.username, mutation=mutation.model_dump()):
                    with self.assertRaises(HTTPException):
                        admin_update_user(target.id, mutation, self.admin_request)
        with self.assertRaises(HTTPException):
            admin_update_user(self.player.id, AdminUserUpdateRequest(role="admin"), self.admin_request)
        with self.assertRaises(HTTPException):
            admin_create_user(AdminUserCreateRequest(username="Escalation", temporary_password="secure-password-123", role="admin"),
                              self.admin_request)
        created = admin_create_user(AdminUserCreateRequest(username="Ordinary", temporary_password="secure-password-123"),
                                    self.admin_request)
        self.assertEqual(created["user"]["role"], "user")
        self.assertIsNotNone(resolve_session(self.admin_request))
        self.assertIsNotNone(resolve_session(self.owner_request))
        self.assertIsNotNone(resolve_session(self.founder_request))

    def test_owner_can_manage_admin_roles_but_cannot_delegate_ownership(self):
        changed = admin_update_user(self.player.id, AdminUserUpdateRequest(role="admin"), self.owner_request)
        self.assertEqual(changed["user"]["role"], "admin")
        with self.assertRaises(HTTPException) as denied:
            admin_grant_ownership(self.player.id, self.owner_request)
        self.assertEqual(denied.exception.detail, "founder_required")
        created = admin_create_user(AdminUserCreateRequest(username="Trusted", temporary_password="secure-password-123", role="admin"),
                                    self.owner_request)
        self.assertEqual(created["user"]["role"], "admin")

    def test_only_founder_grants_revokes_and_each_change_is_audited(self):
        first = admin_grant_ownership(self.admin.id, self.founder_request)
        self.assertTrue(first["user"]["is_owner"])
        admin_grant_ownership(self.admin.id, self.founder_request)
        self.assertTrue(resolve_session(self.admin_request).is_owner)
        with self.assertRaises(HTTPException):
            admin_revoke_ownership(self.owner.id, self.admin_request)
        revoked = admin_revoke_ownership(self.admin.id, self.founder_request)
        self.assertFalse(revoked["user"]["is_owner"])
        self.assertFalse(resolve_session(self.admin_request).is_owner)
        with self.assertRaises(HTTPException):
            admin_revoke_ownership(self.founder.id, self.founder_request)
        with session_scope() as db:
            audit = list(db.scalars(select(OwnershipAudit).where(OwnershipAudit.user_id == self.admin.id).order_by(OwnershipAudit.id)))
            self.assertEqual([row.action for row in audit], ["granted", "revoked"])
            self.assertEqual([row.actor_user_id for row in audit], [self.founder.id, self.founder.id])

    def test_grant_requires_eligible_admin_and_valid_csrf(self):
        with self.assertRaises(HTTPException):
            admin_grant_ownership(self.player.id, self.founder_request)
        invalid_csrf = request_for(cookie=self.founder_request.headers["cookie"])
        with self.assertRaises(HTTPException) as denied:
            admin_grant_ownership(self.admin.id, invalid_csrf)
        self.assertEqual(denied.exception.status_code, 403)
        for field in ["is_active", "lobby_chat_muted", "lobby_chat_excluded"]:
            with self.subTest(field=field):
                with session_scope() as db:
                    setattr(db.get(User, self.admin.id), field, field != "is_active")
                with self.assertRaises(HTTPException):
                    admin_grant_ownership(self.admin.id, self.founder_request)
                with session_scope() as db:
                    setattr(db.get(User, self.admin.id), field, field == "is_active")

    def test_password_reset_protects_founder_and_all_staff_from_normal_admin(self):
        payload = AdminPasswordResetRequest(temporary_password="replacement-password-456")
        with session_scope() as db:
            original_hashes = {user.id: db.get(User, user.id).password_hash for user in [self.founder, self.owner, self.admin]}
            original_sessions = list(db.scalars(select(LoginSession.id)))
        for actor in [self.admin_request, self.owner_request, self.founder_request]:
            with self.assertRaises(HTTPException):
                admin_reset_password(self.founder.id, payload, actor)
        for target in [self.owner, self.admin]:
            with self.assertRaises(HTTPException):
                admin_reset_password(target.id, payload, self.admin_request)
        with self.assertRaises(HTTPException):
            reset_password(self.owner.id, payload.temporary_password)
        with session_scope() as db:
            self.assertEqual({key: db.get(User, key).password_hash for key in original_hashes}, original_hashes)
            self.assertEqual(list(db.scalars(select(LoginSession.id))), original_sessions)
        admin_reset_password(self.owner.id, payload, self.founder_request)
        self.assertIsNone(resolve_session(self.owner_request))
        identity, _token = login(request_for(), "Owner", payload.temporary_password)
        self.assertTrue(identity.is_owner)

    def test_owner_must_be_revoked_before_moderation_even_for_founder(self):
        for actor in [self.admin_request, self.owner_request, self.founder_request]:
            for mutation in [AdminUserUpdateRequest(role="user"), AdminUserUpdateRequest(is_active=False),
                             AdminUserUpdateRequest(lobby_chat_muted=True), AdminUserUpdateRequest(lobby_chat_excluded=True)]:
                with self.subTest(mutation=mutation.model_dump()):
                    with self.assertRaises(HTTPException):
                        admin_update_user(self.owner.id, mutation, actor)
        admin_revoke_ownership(self.owner.id, self.founder_request)
        changed = admin_update_user(self.owner.id, AdminUserUpdateRequest(role="user", lobby_chat_muted=True), self.founder_request)
        self.assertEqual(changed["user"]["role"], "user")
        self.assertTrue(changed["user"]["lobby_chat_muted"])

    def test_database_guards_preserve_founder_owner_account_and_active_ban_invariants(self):
        for owner in [self.founder, self.owner]:
            for values in [{"role": "user"}, {"is_active": False}, {"lobby_chat_muted": True},
                           {"lobby_chat_excluded": True}, {"id": owner.id + 100}]:
                with self.subTest(owner=owner.id, values=values), self.assertRaises(IntegrityError):
                    with session_scope() as db:
                        db.execute(update(User).where(User.id == owner.id).values(**values))
            with self.assertRaises(IntegrityError):
                with session_scope() as db:
                    db.execute(delete(User).where(User.id == owner.id))
            with self.assertRaises(IntegrityError):
                with session_scope() as db:
                    db.add(UserBan(user_id=owner.id, scope="play", reason="must fail", created_at=utcnow()))
        for operation in [delete(AccountOwnership).where(AccountOwnership.user_id == self.founder.id),
                          update(AccountOwnership).where(AccountOwnership.user_id == self.founder.id).values(is_founder=False),
                          update(AccountOwnership).where(AccountOwnership.user_id == self.owner.id).values(user_id=self.admin.id)]:
            with self.assertRaises(IntegrityError):
                with session_scope() as db:
                    db.execute(operation)
        with self.assertRaises(IntegrityError):
            with session_scope() as db:
                db.execute(text("INSERT OR REPLACE INTO account_ownerships (user_id,is_founder,created_at) VALUES (:id,0,CURRENT_TIMESTAMP)"),
                           {"id": self.founder.id})

    def test_old_ban_cannot_be_reactivated_after_ownership_grant(self):
        with session_scope() as db:
            ban = UserBan(user_id=self.admin.id, scope="help", reason="old", created_at=utcnow(), revoked_at=utcnow())
            db.add(ban)
            db.flush()
            ban_id = ban.id
            grant_ownership(db, self.admin.id, self.founder.id)
        with self.assertRaises(IntegrityError):
            with session_scope() as db:
                db.execute(update(UserBan).where(UserBan.id == ban_id).values(revoked_at=None))

    def test_account_and_admin_projections_describe_actual_capabilities(self):
        payload = auth_identity_payload(resolve_session(self.founder_request))
        self.assertTrue(payload["is_owner"])
        self.assertTrue(payload["is_founder"])
        ordinary = admin_list_users(self.admin_request)
        self.assertFalse(ordinary["viewer"]["can_create_admin"])
        indexed = {user["id"]: user for user in ordinary["users"]}
        self.assertFalse(indexed[self.founder.id]["can_reset_password"])
        self.assertFalse(indexed[self.admin.id]["can_toggle_active"])
        self.assertTrue(indexed[self.player.id]["can_reset_password"])
        founder = {user["id"]: user for user in admin_list_users(self.founder_request)["users"]}
        self.assertTrue(founder[self.owner.id]["can_reset_password"])
        self.assertTrue(founder[self.owner.id]["can_revoke_owner"])
        self.assertFalse(founder[self.founder.id]["can_revoke_owner"])
        self.assertTrue(founder[self.admin.id]["can_grant_owner"])
