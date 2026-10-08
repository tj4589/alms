"""Add consented reminder subscriptions and delivery tracking.

Revision ID: 0005_reminder_delivery
Revises: 0004_rate_limit_buckets
"""

from alembic import op
import sqlalchemy as sa


revision = "0005_reminder_delivery"
down_revision = "0004_rate_limit_buckets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reminder_subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("channel", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="active"),
        sa.Column("endpoint", sa.Text(), nullable=True),
        sa.Column("endpoint_key", sa.String(length=64), nullable=False),
        sa.Column("p256dh", sa.String(length=255), nullable=True),
        sa.Column("auth_key", sa.String(length=255), nullable=True),
        sa.Column("consented_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("unsubscribed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "channel", "endpoint_key", name="uq_reminder_subscription_destination"),
        sa.UniqueConstraint("channel", "endpoint_key", name="uq_reminder_subscription_endpoint"),
    )
    op.create_index("ix_reminder_subscriptions_id", "reminder_subscriptions", ["id"], unique=False)
    op.create_index("ix_reminder_subscriptions_user_id", "reminder_subscriptions", ["user_id"], unique=False)
    op.create_index("ix_reminder_subscriptions_channel", "reminder_subscriptions", ["channel"], unique=False)
    op.create_index("ix_reminder_subscriptions_status", "reminder_subscriptions", ["status"], unique=False)

    op.create_table(
        "reminder_deliveries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("subscription_id", sa.Integer(), nullable=True),
        sa.Column("channel", sa.String(length=24), nullable=False),
        sa.Column("dedupe_key", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="queued"),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("provider_reference", sa.String(length=255), nullable=True),
        sa.Column("failure_code", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subscription_id"], ["reminder_subscriptions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dedupe_key", name="uq_reminder_delivery_dedupe_key"),
    )
    op.create_index("ix_reminder_deliveries_id", "reminder_deliveries", ["id"], unique=False)
    op.create_index("ix_reminder_deliveries_user_id", "reminder_deliveries", ["user_id"], unique=False)
    op.create_index("ix_reminder_deliveries_subscription_id", "reminder_deliveries", ["subscription_id"], unique=False)
    op.create_index("ix_reminder_deliveries_channel", "reminder_deliveries", ["channel"], unique=False)
    op.create_index("ix_reminder_deliveries_status", "reminder_deliveries", ["status"], unique=False)
    op.create_index("ix_reminder_deliveries_scheduled_for", "reminder_deliveries", ["scheduled_for"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_reminder_deliveries_scheduled_for", table_name="reminder_deliveries")
    op.drop_index("ix_reminder_deliveries_status", table_name="reminder_deliveries")
    op.drop_index("ix_reminder_deliveries_channel", table_name="reminder_deliveries")
    op.drop_index("ix_reminder_deliveries_subscription_id", table_name="reminder_deliveries")
    op.drop_index("ix_reminder_deliveries_user_id", table_name="reminder_deliveries")
    op.drop_index("ix_reminder_deliveries_id", table_name="reminder_deliveries")
    op.drop_table("reminder_deliveries")
    op.drop_index("ix_reminder_subscriptions_status", table_name="reminder_subscriptions")
    op.drop_index("ix_reminder_subscriptions_channel", table_name="reminder_subscriptions")
    op.drop_index("ix_reminder_subscriptions_user_id", table_name="reminder_subscriptions")
    op.drop_index("ix_reminder_subscriptions_id", table_name="reminder_subscriptions")
    op.drop_table("reminder_subscriptions")
