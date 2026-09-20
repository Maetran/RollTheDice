"""Bind one-time account confirmation to passkey, session, origin and action."""

import sqlalchemy as sa

from alembic import op

revision = "20260920_0043"
down_revision = "20260920_0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("webauthn_ceremonies") as batch:
        batch.add_column(sa.Column("action", sa.String(32), nullable=True))
        batch.add_column(sa.Column("target_hash", sa.String(64), nullable=True))
        batch.add_column(sa.Column("request_origin", sa.String(256), nullable=True))
        batch.add_column(sa.Column("authorizing_credential_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_webauthn_authorizing_credential", "passkey_credentials", ["authorizing_credential_id"], ["id"],
            ondelete="CASCADE",
        )
        batch.drop_constraint("ck_webauthn_ceremonies_purpose", type_="check")
        batch.drop_constraint("ck_webauthn_ceremonies_subject", type_="check")
        batch.create_check_constraint(
            "ck_webauthn_ceremonies_purpose",
            "purpose IN ('registration', 'authentication', 'reauthentication')",
        )
        batch.create_check_constraint(
            "ck_webauthn_ceremonies_subject",
            "(purpose IN ('registration', 'reauthentication') AND user_id IS NOT NULL AND session_id IS NOT NULL) "
            "OR (purpose = 'authentication' AND user_id IS NULL AND session_id IS NULL)",
        )
        batch.create_check_constraint(
            "ck_webauthn_ceremonies_reauthentication",
            "purpose != 'reauthentication' OR "
            "(action IS NOT NULL AND target_hash IS NOT NULL AND request_origin IS NOT NULL)",
        )


def downgrade() -> None:
    op.execute("DELETE FROM webauthn_ceremonies WHERE purpose = 'reauthentication'")
    with op.batch_alter_table("webauthn_ceremonies") as batch:
        batch.drop_constraint("ck_webauthn_ceremonies_reauthentication", type_="check")
        batch.drop_constraint("ck_webauthn_ceremonies_purpose", type_="check")
        batch.drop_constraint("ck_webauthn_ceremonies_subject", type_="check")
        batch.drop_column("action")
        batch.drop_column("target_hash")
        batch.drop_column("request_origin")
        batch.drop_constraint("fk_webauthn_authorizing_credential", type_="foreignkey")
        batch.drop_column("authorizing_credential_id")
        batch.create_check_constraint(
            "ck_webauthn_ceremonies_purpose", "purpose IN ('registration', 'authentication')",
        )
        batch.create_check_constraint(
            "ck_webauthn_ceremonies_subject",
            "(purpose = 'registration' AND user_id IS NOT NULL AND session_id IS NOT NULL) "
            "OR (purpose = 'authentication' AND user_id IS NULL AND session_id IS NULL)",
        )
