"""Preserve installed Hausdepp push devices as a distinct product context."""

from alembic import op

revision = "20261016_0059"
down_revision = "20261016_0058"
branch_labels = None
depends_on = None

_CONTEXTS = (
    ("web_push_subscriptions", "ck_web_push_subscriptions_product_context"),
    ("push_release_recipients", "ck_push_release_recipient_context"),
)


def _replace_context_checks(expression: str) -> None:
    # These are leaf tables: rebuilding their checks on SQLite preserves users,
    # release history, endpoint ownership, indices and frozen device identities.
    for table, constraint in _CONTEXTS:
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(constraint, type_="check")
            batch.create_check_constraint(constraint, expression)


def upgrade() -> None:
    _replace_context_checks("product_context IN ('zdwa', 'zilch', 'hausdepp')")


def downgrade() -> None:
    connection = op.get_bind()
    for table, _constraint in _CONTEXTS:
        # Fixed internal identifiers, never request-derived SQL.
        if connection.exec_driver_sql(
            f"SELECT 1 FROM {table} WHERE product_context = 'hausdepp' LIMIT 1"
        ).first():
            raise RuntimeError("Cannot downgrade while Hausdepp push devices or release recipients exist")
    _replace_context_checks("product_context IN ('zdwa', 'zilch')")
