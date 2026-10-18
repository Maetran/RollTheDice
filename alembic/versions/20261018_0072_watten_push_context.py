"""Retain local Watten device identity without enabling notification delivery."""

import sqlalchemy as sa

from alembic import op

revision = "20261018_0072"
down_revision = "20261018_0071"
branch_labels = None
depends_on = None

_CONTEXTS = (
    ("web_push_subscriptions", "ck_web_push_subscriptions_product_context"),
    ("push_release_recipients", "ck_push_release_recipient_context"),
)


def _replace_context_checks(expression: str) -> None:
    # Both tables are leaves. As in0059, SQLite can rebuild their CHECKs while
    # retaining users, ownership, frozen release devices and all foreign keys.
    for table, constraint in _CONTEXTS:
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(constraint, type_="check")
            batch.create_check_constraint(constraint, expression)


def upgrade() -> None:
    _replace_context_checks("product_context IN ('zdwa', 'zilch', 'hausdepp', 'watten')")


def downgrade() -> None:
    connection = op.get_bind()
    for table, _constraint in _CONTEXTS:
        stored = sa.table(table, sa.column("product_context"))
        if connection.execute(sa.select(sa.literal(1)).select_from(stored)
                              .where(stored.c.product_context == "watten").limit(1)).first():
            raise RuntimeError("Cannot downgrade while Watten devices or release recipients exist")
    _replace_context_checks("product_context IN ('zdwa', 'zilch', 'hausdepp')")
