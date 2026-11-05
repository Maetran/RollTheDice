"""Private, disabled-by-default game observation policy and pseudonymous records."""

import sqlalchemy as sa

from alembic import op

revision = "20261105_0084"
down_revision = "20261101_0083"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("observation_policy", sa.Column("id", sa.Integer(), primary_key=True),
                    sa.Column("enabled", sa.Boolean(), nullable=False),
                    sa.Column("mode", sa.String(16), nullable=False),
                    sa.Column("version", sa.Integer(), nullable=False),
                    sa.Column("updated_at", sa.DateTime(timezone=True)),
                    sa.CheckConstraint("id = 1", name="ck_observation_policy_singleton"),
                    sa.CheckConstraint("enabled IN (true, false)", name="ck_observation_policy_enabled"),
                    sa.CheckConstraint("mode IN ('all', 'selected')", name="ck_observation_policy_mode"),
                    sa.CheckConstraint("version >= 0", name="ck_observation_policy_version"))
    op.bulk_insert(sa.table("observation_policy", sa.column("id", sa.Integer()),
                            sa.column("enabled", sa.Boolean()), sa.column("mode", sa.String()),
                            sa.column("version", sa.Integer())),
                   [{"id": 1, "enabled": False, "mode": "selected", "version": 0}])
    op.create_table("observation_selections", sa.Column("user_id", sa.Integer(),
                    sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True))
    op.create_table("observation_recordings", sa.Column("id", sa.String(32), primary_key=True),
                    sa.Column("game_type", sa.String(16), nullable=False),
                    sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
                    sa.Column("finished_at", sa.DateTime(timezone=True)),
                    sa.Column("policy_version", sa.Integer(), nullable=False),
                    sa.Column("status", sa.String(16), nullable=False), sa.Column("outcome_json", sa.Text()),
                    sa.CheckConstraint("game_type IN ('hausdepp', 'watten')", name="ck_observation_recording_game"),
                    sa.CheckConstraint("status IN ('open', 'complete', 'partial')", name="ck_observation_recording_status"))
    op.create_index("ix_observation_recording_started", "observation_recordings", ["started_at"])
    op.create_table("observation_events", sa.Column("recording_id", sa.String(32),
                    sa.ForeignKey("observation_recordings.id", ondelete="CASCADE"), primary_key=True),
                    sa.Column("sequence", sa.Integer(), primary_key=True),
                    sa.Column("actor_seat", sa.Integer(), nullable=False),
                    sa.Column("actor_kind", sa.String(8), nullable=False),
                    sa.Column("actor_selected", sa.Boolean(), nullable=False),
                    sa.Column("action_json", sa.Text(), nullable=False), sa.Column("context_json", sa.Text(), nullable=False),
                    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
                    sa.CheckConstraint("sequence >= 0 AND actor_seat >= 0 AND actor_seat <= 7", name="ck_observation_event_indices"),
                    sa.CheckConstraint("actor_kind IN ('human', 'cpu')", name="ck_observation_event_actor"))
    op.create_table("observation_audit", sa.Column("id", sa.Integer(), primary_key=True),
                    sa.Column("actor_user_id", sa.Integer(), nullable=False),
                    sa.Column("actor_username", sa.String(32), nullable=False),
                    sa.Column("action", sa.String(16), nullable=False),
                    sa.Column("summary_json", sa.Text(), nullable=False),
                    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))


def downgrade():
    op.drop_table("observation_audit")
    op.drop_table("observation_events")
    op.drop_index("ix_observation_recording_started", table_name="observation_recordings")
    op.drop_table("observation_recordings")
    op.drop_table("observation_selections")
    op.drop_table("observation_policy")
