"""Add the locally guarded Watten chat label, retaining fixed audiences."""

from alembic import op

revision = "20261018_0070"
down_revision = "20261018_0069"
branch_labels = None
depends_on = None


def _replace_check(expression: str) -> None:
    connection = op.get_bind()
    sqlite = connection.dialect.name == "sqlite"
    if sqlite:
        # The parent rebuild fires enabled ON DELETE CASCADE. Preserve its
        # existing audience in the same transaction, as in migration0061.
        connection.exec_driver_sql(
            "CREATE TEMP TABLE watten_chat_audience_backup AS "
            "SELECT message_id, user_id FROM lobby_chat_message_recipients"
        )
    with op.batch_alter_table("lobby_chat_messages") as batch:
        batch.drop_constraint("ck_lobby_chat_messages_game_type", type_="check")
        batch.create_check_constraint("ck_lobby_chat_messages_game_type", expression)
    if sqlite:
        connection.exec_driver_sql(
            "INSERT INTO lobby_chat_message_recipients (message_id, user_id) "
            "SELECT message_id, user_id FROM watten_chat_audience_backup "
            "WHERE NOT EXISTS (SELECT 1 FROM lobby_chat_message_recipients current "
            "WHERE current.message_id = watten_chat_audience_backup.message_id "
            "AND current.user_id = watten_chat_audience_backup.user_id)"
        )
        connection.exec_driver_sql("DROP TABLE watten_chat_audience_backup")


def upgrade() -> None:
    _replace_check("game_type IN ('zdwa', 'zilch', 'hausdepp', 'watten')")


def downgrade() -> None:
    if op.get_bind().exec_driver_sql(
        "SELECT 1 FROM lobby_chat_messages WHERE game_type = 'watten' LIMIT 1"
    ).first():
        raise RuntimeError("Cannot downgrade while Watten chat messages exist")
    _replace_check("game_type IN ('zdwa', 'zilch', 'hausdepp')")
