"""Persist explicit account ownership and protect the immutable founder binding."""

import sqlalchemy as sa

from alembic import op

revision = "20260922_0047"
down_revision = "20260922_0046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "account_ownerships",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True),
        sa.Column("is_founder", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("granted_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("is_founder IN (true, false)", name="ck_account_ownership_founder_boolean"),
    )
    op.create_index("ix_account_ownership_single_founder", "account_ownerships", ["is_founder"], unique=True,
                    sqlite_where=sa.text("is_founder = 1"), postgresql_where=sa.text("is_founder = true"))
    op.create_table(
        "ownership_audit",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("action IN ('founder_bound', 'granted', 'revoked')", name="ck_ownership_audit_action"),
    )
    if op.get_bind().dialect.name == "sqlite":
        _sqlite_guards()
    elif op.get_bind().dialect.name == "postgresql":
        _postgresql_guards()
    else:
        raise RuntimeError("Ownership guards require SQLite or PostgreSQL")


def _sqlite_guards() -> None:
    statements = [
        """CREATE TRIGGER ownership_no_replace BEFORE INSERT ON account_ownerships
           WHEN EXISTS (SELECT 1 FROM account_ownerships WHERE user_id = NEW.user_id)
             OR (NEW.is_founder = 1 AND EXISTS (SELECT 1 FROM account_ownerships WHERE is_founder = 1))
           BEGIN SELECT RAISE(ABORT, 'ownership_immutable'); END""",
        """CREATE TRIGGER ownership_no_update BEFORE UPDATE ON account_ownerships
           BEGIN SELECT RAISE(ABORT, 'ownership_immutable'); END""",
        """CREATE TRIGGER ownership_founder_no_delete BEFORE DELETE ON account_ownerships
           WHEN OLD.is_founder = 1 BEGIN SELECT RAISE(ABORT, 'founder_protected'); END""",
        """CREATE TRIGGER ownership_eligible BEFORE INSERT ON account_ownerships
           WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND role = 'admin' AND is_active = 1
                            AND lobby_chat_muted = 0 AND lobby_chat_excluded = 0)
             OR EXISTS (SELECT 1 FROM user_bans WHERE user_id = NEW.user_id AND revoked_at IS NULL
                        AND (expires_at IS NULL OR julianday(expires_at) > julianday('now')))
           BEGIN SELECT RAISE(ABORT, 'ownership_requires_eligible_admin'); END""",
        """CREATE TRIGGER ownership_user_no_replace BEFORE INSERT ON users
           WHEN EXISTS (SELECT 1 FROM account_ownerships WHERE user_id = NEW.id)
           BEGIN SELECT RAISE(ABORT, 'owner_protected'); END""",
        """CREATE TRIGGER ownership_user_no_delete BEFORE DELETE ON users
           WHEN EXISTS (SELECT 1 FROM account_ownerships WHERE user_id = OLD.id)
           BEGIN SELECT RAISE(ABORT, 'owner_protected'); END""",
        """CREATE TRIGGER ownership_user_guard BEFORE UPDATE ON users
           WHEN EXISTS (SELECT 1 FROM account_ownerships WHERE user_id = OLD.id)
             AND (NEW.id != OLD.id OR NEW.role != 'admin' OR NEW.is_active != 1
                  OR NEW.lobby_chat_muted != 0 OR NEW.lobby_chat_excluded != 0)
           BEGIN SELECT RAISE(ABORT, 'owner_protected'); END""",
        """CREATE TRIGGER ownership_ban_insert BEFORE INSERT ON user_bans
           WHEN EXISTS (SELECT 1 FROM account_ownerships WHERE user_id = NEW.user_id)
             AND NEW.revoked_at IS NULL AND (NEW.expires_at IS NULL OR julianday(NEW.expires_at) > julianday('now'))
           BEGIN SELECT RAISE(ABORT, 'owner_protected'); END""",
        """CREATE TRIGGER ownership_ban_update BEFORE UPDATE ON user_bans
           WHEN EXISTS (SELECT 1 FROM account_ownerships WHERE user_id = NEW.user_id)
             AND NEW.revoked_at IS NULL AND (NEW.expires_at IS NULL OR julianday(NEW.expires_at) > julianday('now'))
           BEGIN SELECT RAISE(ABORT, 'owner_protected'); END""",
        """CREATE TRIGGER ownership_audit_no_update BEFORE UPDATE ON ownership_audit
           BEGIN SELECT RAISE(ABORT, 'ownership_audit_immutable'); END""",
        """CREATE TRIGGER ownership_audit_no_replace BEFORE INSERT ON ownership_audit
           WHEN EXISTS (SELECT 1 FROM ownership_audit WHERE id = NEW.id)
           BEGIN SELECT RAISE(ABORT, 'ownership_audit_immutable'); END""",
        """CREATE TRIGGER ownership_audit_no_delete BEFORE DELETE ON ownership_audit
           BEGIN SELECT RAISE(ABORT, 'ownership_audit_immutable'); END""",
    ]
    for statement in statements:
        op.execute(statement)


def _postgresql_guards() -> None:
    op.execute("""CREATE FUNCTION guard_account_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'UPDATE' THEN
                RAISE EXCEPTION 'ownership_immutable' USING ERRCODE = '23514';
            ELSIF TG_OP = 'DELETE' THEN
                IF OLD.is_founder THEN RAISE EXCEPTION 'founder_protected' USING ERRCODE = '23514'; END IF;
                RETURN OLD;
            END IF;
            PERFORM id FROM users WHERE id = NEW.user_id FOR UPDATE;
            IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND role = 'admin' AND is_active
                           AND NOT lobby_chat_muted AND NOT lobby_chat_excluded)
               OR EXISTS (SELECT 1 FROM user_bans WHERE user_id = NEW.user_id AND revoked_at IS NULL
                          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)) THEN
                RAISE EXCEPTION 'ownership_requires_eligible_admin' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END $$""")
    op.execute("""CREATE TRIGGER ownership_guard BEFORE INSERT OR UPDATE OR DELETE ON account_ownerships
                  FOR EACH ROW EXECUTE FUNCTION guard_account_ownership()""")
    op.execute("""CREATE FUNCTION guard_owner_user() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF EXISTS (SELECT 1 FROM account_ownerships WHERE user_id = OLD.id) THEN
                IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'owner_protected' USING ERRCODE = '23514'; END IF;
                IF NEW.id != OLD.id OR NEW.role != 'admin' OR NOT NEW.is_active OR NEW.lobby_chat_muted OR NEW.lobby_chat_excluded THEN
                    RAISE EXCEPTION 'owner_protected' USING ERRCODE = '23514';
                END IF;
            END IF;
            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END $$""")
    op.execute("""CREATE TRIGGER ownership_user_guard BEFORE UPDATE OR DELETE ON users
                  FOR EACH ROW EXECUTE FUNCTION guard_owner_user()""")
    op.execute("""CREATE FUNCTION guard_owner_ban() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            PERFORM id FROM users WHERE id = NEW.user_id FOR UPDATE;
            IF EXISTS (SELECT 1 FROM account_ownerships WHERE user_id = NEW.user_id)
               AND NEW.revoked_at IS NULL AND (NEW.expires_at IS NULL OR NEW.expires_at > CURRENT_TIMESTAMP) THEN
                RAISE EXCEPTION 'owner_protected' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END $$""")
    op.execute("""CREATE TRIGGER ownership_ban_guard BEFORE INSERT OR UPDATE ON user_bans
                  FOR EACH ROW EXECUTE FUNCTION guard_owner_ban()""")
    op.execute("""CREATE FUNCTION guard_ownership_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'ownership_audit_immutable' USING ERRCODE = '23514'; END $$""")
    op.execute("""CREATE TRIGGER ownership_audit_guard BEFORE UPDATE OR DELETE ON ownership_audit
                  FOR EACH ROW EXECUTE FUNCTION guard_ownership_audit()""")


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        for name in ["ownership_no_replace", "ownership_no_update", "ownership_founder_no_delete", "ownership_eligible",
                     "ownership_user_no_replace", "ownership_user_no_delete", "ownership_user_guard",
                     "ownership_ban_insert", "ownership_ban_update", "ownership_audit_no_update", "ownership_audit_no_delete",
                     "ownership_audit_no_replace"]:
            op.execute(f"DROP TRIGGER {name}")
    elif op.get_bind().dialect.name == "postgresql":
        for name, table in [("ownership_guard", "account_ownerships"), ("ownership_user_guard", "users"),
                            ("ownership_ban_guard", "user_bans"), ("ownership_audit_guard", "ownership_audit")]:
            op.execute(f"DROP TRIGGER {name} ON {table}")
        for name in ["guard_account_ownership", "guard_owner_user", "guard_owner_ban", "guard_ownership_audit"]:
            op.execute(f"DROP FUNCTION {name}()")
    op.drop_table("ownership_audit")
    op.drop_table("account_ownerships")
