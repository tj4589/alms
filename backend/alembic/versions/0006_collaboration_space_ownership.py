"""Add durable collaboration ownership; all unassigned legacy rows stay restricted.

No creator-context inference, record deletion or membership rewrite.
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_collaboration_space"
down_revision = "0005_reminder_delivery"
branch_labels = None
depends_on = None

TABLES = ("study_groups", "discussion_threads", "study_sessions")


def upgrade():
    for table in TABLES:
        op.add_column(table, sa.Column("learning_space_id", sa.Integer(), nullable=True))
        op.create_foreign_key(f"fk_{table}_learning_space", table, "learning_spaces",
                              ["learning_space_id"], ["id"], ondelete="RESTRICT")
        op.create_index(f"ix_{table}_learning_space_id", table, ["learning_space_id"])
    op.create_table(
        "collaboration_space_audits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("content_type", sa.String(16), nullable=False),
        sa.Column("content_id", sa.Integer(), nullable=False),
        sa.Column("learning_space_id", sa.Integer(), sa.ForeignKey("learning_spaces.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("performed_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("content_type", "content_id", name="uq_collaboration_space_assignment"),
    )
    for column in ("id", "learning_space_id", "performed_by_user_id"):
        op.create_index(f"ix_collaboration_space_audits_{column}", "collaboration_space_audits", [column])


def downgrade():
    # Downgrading removes the authorization boundary, so it is not an automatic
    # recovery action. Retain the schema/data and deploy a compatible build.
    raise RuntimeError("Collaboration ownership requires a reviewed forward recovery; downgrade is unsafe.")
