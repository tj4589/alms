"""Add append-only KSA claim lifecycle history.

Revision ID: 0002_ksa_claim_audit
Revises: 0001_initial_schema
"""

from alembic import op
import sqlalchemy as sa


revision = "0002_ksa_claim_audit"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ksa_claim_audits",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ksa_id", sa.String(length=80), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("previous_user_id", sa.Integer(), nullable=True),
        sa.Column("current_user_id", sa.Integer(), nullable=True),
        sa.Column("performed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["previous_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["current_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["performed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ksa_claim_audits_id", "ksa_claim_audits", ["id"], unique=False)
    op.create_index("ix_ksa_claim_audits_ksa_id", "ksa_claim_audits", ["ksa_id"], unique=False)
    op.create_index("ix_ksa_claim_audits_action", "ksa_claim_audits", ["action"], unique=False)
    op.create_index("ix_ksa_claim_audits_previous_user_id", "ksa_claim_audits", ["previous_user_id"], unique=False)
    op.create_index("ix_ksa_claim_audits_current_user_id", "ksa_claim_audits", ["current_user_id"], unique=False)
    op.create_index("ix_ksa_claim_audits_performed_by_user_id", "ksa_claim_audits", ["performed_by_user_id"], unique=False)
    op.create_index("ix_ksa_claim_audits_created_at", "ksa_claim_audits", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_ksa_claim_audits_created_at", table_name="ksa_claim_audits")
    op.drop_index("ix_ksa_claim_audits_performed_by_user_id", table_name="ksa_claim_audits")
    op.drop_index("ix_ksa_claim_audits_current_user_id", table_name="ksa_claim_audits")
    op.drop_index("ix_ksa_claim_audits_previous_user_id", table_name="ksa_claim_audits")
    op.drop_index("ix_ksa_claim_audits_action", table_name="ksa_claim_audits")
    op.drop_index("ix_ksa_claim_audits_ksa_id", table_name="ksa_claim_audits")
    op.drop_index("ix_ksa_claim_audits_id", table_name="ksa_claim_audits")
    op.drop_table("ksa_claim_audits")
