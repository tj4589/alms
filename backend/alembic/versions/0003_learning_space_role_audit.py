"""Add append-only learning-space membership role history.

Revision ID: 0003_learning_space_role_audit
Revises: 0002_ksa_claim_audit
"""

from alembic import op
import sqlalchemy as sa


revision = "0003_learning_space_role_audit"
down_revision = "0002_ksa_claim_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "learning_space_role_audits",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("learning_space_id", sa.Integer(), nullable=True),
        sa.Column("learning_space_slug", sa.String(length=80), nullable=False),
        sa.Column("target_user_id", sa.Integer(), nullable=True),
        sa.Column("membership_id", sa.Integer(), nullable=True),
        sa.Column("previous_role", sa.String(length=32), nullable=False),
        sa.Column("new_role", sa.String(length=32), nullable=False),
        sa.Column("performed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["learning_space_id"], ["learning_spaces.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["membership_id"], ["learning_space_memberships.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["performed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_learning_space_role_audits_id", "learning_space_role_audits", ["id"], unique=False)
    op.create_index("ix_learning_space_role_audits_learning_space_id", "learning_space_role_audits", ["learning_space_id"], unique=False)
    op.create_index("ix_learning_space_role_audits_learning_space_slug", "learning_space_role_audits", ["learning_space_slug"], unique=False)
    op.create_index("ix_learning_space_role_audits_target_user_id", "learning_space_role_audits", ["target_user_id"], unique=False)
    op.create_index("ix_learning_space_role_audits_membership_id", "learning_space_role_audits", ["membership_id"], unique=False)
    op.create_index("ix_learning_space_role_audits_performed_by_user_id", "learning_space_role_audits", ["performed_by_user_id"], unique=False)
    op.create_index("ix_learning_space_role_audits_created_at", "learning_space_role_audits", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_learning_space_role_audits_created_at", table_name="learning_space_role_audits")
    op.drop_index("ix_learning_space_role_audits_performed_by_user_id", table_name="learning_space_role_audits")
    op.drop_index("ix_learning_space_role_audits_membership_id", table_name="learning_space_role_audits")
    op.drop_index("ix_learning_space_role_audits_target_user_id", table_name="learning_space_role_audits")
    op.drop_index("ix_learning_space_role_audits_learning_space_slug", table_name="learning_space_role_audits")
    op.drop_index("ix_learning_space_role_audits_learning_space_id", table_name="learning_space_role_audits")
    op.drop_index("ix_learning_space_role_audits_id", table_name="learning_space_role_audits")
    op.drop_table("learning_space_role_audits")
