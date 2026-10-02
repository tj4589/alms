"""add shared distributed rate-limit buckets

Revision ID: 0004_rate_limit_buckets
Revises: 0003_learning_space_role_audit
"""

from alembic import op
import sqlalchemy as sa


revision = "0004_rate_limit_buckets"
down_revision = "0003_learning_space_role_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_buckets",
        sa.Column("bucket_key", sa.String(length=255), nullable=False),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("window_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("request_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("bucket_key"),
    )
    op.create_index(
        "ix_rate_limit_buckets_window_expires_at",
        "rate_limit_buckets",
        ["window_expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_rate_limit_buckets_window_expires_at", table_name="rate_limit_buckets")
    op.drop_table("rate_limit_buckets")
