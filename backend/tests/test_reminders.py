import os
import sys
import unittest
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from unittest.mock import patch

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import models  # noqa: E402
from database import Base  # noqa: E402
from reminders import (  # noqa: E402
    MockReminderSender,
    dispatch_study_reminder,
    reminder_settings_payload,
    subscribe_user,
    sync_legacy_notification_consent,
    unsubscribe_user,
)
from routers.reminders import ReminderSubscriptionRequest  # noqa: E402


class ReminderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session = sessionmaker(bind=self.engine)()
        self.user = models.User(
            id=1,
            name="Reminder Student",
            username="reminder_student",
            email="student@example.com",
            firebase_uid="firebase-reminder-1",
            role="student",
            account_status="active",
            onboarding_preferences={"notifications_enabled": False},
        )
        self.other = models.User(
            id=2,
            name="Other Student",
            username="other_student",
            email="other@example.com",
            firebase_uid="firebase-reminder-2",
            role="student",
            account_status="active",
            onboarding_preferences={"notifications_enabled": False},
        )
        self.session.add_all([self.user, self.other])
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()

    def test_email_consent_is_explicit_and_idempotent(self) -> None:
        subscription = subscribe_user(self.session, self.user, channel="email")
        self.session.commit()
        repeated = subscribe_user(self.session, self.user, channel="email")
        self.session.commit()

        self.assertEqual(subscription.id, repeated.id)
        self.assertTrue(self.user.onboarding_preferences["notifications_enabled"])
        self.assertEqual(self.session.query(models.ReminderSubscription).count(), 1)
        self.assertTrue(reminder_settings_payload(self.session, self.user)["channels"]["email"]["subscribed"])

    def test_push_subscription_never_returns_endpoint_or_keys(self) -> None:
        request = ReminderSubscriptionRequest(
            channel="browser_push",
            endpoint="https://push.example.test/subscription/1",
            p256dh="public-key",
            auth="auth-key",
        )
        subscription = subscribe_user(
            self.session,
            self.user,
            channel=request.channel,
            endpoint=request.endpoint,
            p256dh=request.p256dh,
            auth_key=request.auth,
        )
        self.session.commit()
        payload = reminder_settings_payload(self.session, self.user)

        self.assertEqual(subscription.channel, "browser_push")
        self.assertTrue(payload["channels"]["browser_push"]["subscribed"])
        self.assertNotIn("endpoint", payload["channels"]["browser_push"])
        self.assertNotIn("p256dh", payload["channels"]["browser_push"])
        self.assertNotIn("auth", payload["channels"]["browser_push"])

    def test_unsubscribe_one_channel_preserves_other_consent(self) -> None:
        subscribe_user(self.session, self.user, channel="email")
        subscribe_user(
            self.session,
            self.user,
            channel="browser_push",
            endpoint="https://push.example.test/subscription/1",
            p256dh="public-key",
            auth_key="auth-key",
        )
        self.session.commit()

        self.assertEqual(unsubscribe_user(self.session, self.user, "email"), 1)
        self.session.commit()
        self.assertTrue(self.user.onboarding_preferences["notifications_enabled"])
        self.assertFalse(reminder_settings_payload(self.session, self.user)["channels"]["email"]["subscribed"])
        self.assertTrue(reminder_settings_payload(self.session, self.user)["channels"]["browser_push"]["subscribed"])

        self.assertEqual(unsubscribe_user(self.session, self.user), 1)
        self.session.commit()
        self.assertFalse(self.user.onboarding_preferences["notifications_enabled"])

    def test_legacy_ksa_consent_creates_email_and_false_unsubscribes(self) -> None:
        sync_legacy_notification_consent(self.session, self.user, True)
        self.session.commit()
        sync_legacy_notification_consent(self.session, self.user, True)
        self.session.commit()
        self.assertEqual(self.session.query(models.ReminderSubscription).count(), 1)
        sync_legacy_notification_consent(self.session, self.user, False)
        self.session.commit()
        row = self.session.query(models.ReminderSubscription).one()
        self.assertEqual(row.status, "unsubscribed")
        self.assertFalse(self.user.onboarding_preferences["notifications_enabled"])

    def test_mock_delivery_is_tracked_and_duplicate_period_is_ignored(self) -> None:
        subscribe_user(self.session, self.user, channel="email")
        self.session.commit()
        sender = MockReminderSender()
        scheduled = datetime(2026, 10, 8, 9, tzinfo=timezone.utc)

        first = dispatch_study_reminder(
            self.session,
            self.user.id,
            period_key="2026-10-08",
            subject="A study check-in",
            body="Review one short section.",
            sender=sender,
            scheduled_for=scheduled,
        )
        self.session.commit()
        second = dispatch_study_reminder(
            self.session,
            self.user.id,
            period_key="2026-10-08",
            subject="A study check-in",
            body="Review one short section.",
            sender=sender,
            scheduled_for=scheduled,
        )
        self.session.commit()

        self.assertEqual(len(first), 1)
        self.assertEqual(first[0].status, "sent")
        self.assertEqual(len(second), 1)
        self.assertEqual(len(sender.sent), 1)
        self.assertEqual(self.session.query(models.ReminderDelivery).count(), 1)
        self.assertEqual(reminder_settings_payload(self.session, self.user)["delivery"][0]["status"], "sent")

    def test_disabled_provider_is_recorded_without_outbound_work(self) -> None:
        subscribe_user(self.session, self.user, channel="email")
        self.session.commit()
        with patch.dict(os.environ, {"REMINDER_DISPATCH_ENABLED": "false"}, clear=False):
            deliveries = dispatch_study_reminder(
                self.session,
                self.user.id,
                period_key="2026-10-09",
                subject="A study check-in",
                body="Review one short section.",
            )
        self.session.commit()

        self.assertEqual(deliveries[0].status, "failed")
        self.assertEqual(deliveries[0].failure_code, "dispatch_disabled")

    def test_delivery_and_subscriptions_are_owner_scoped(self) -> None:
        subscribe_user(self.session, self.user, channel="email")
        self.session.commit()
        sender = MockReminderSender()
        dispatch_study_reminder(
            self.session,
            self.user.id,
            period_key="2026-10-10",
            subject="A study check-in",
            body="Review one short section.",
            sender=sender,
        )
        self.session.commit()

        other_payload = reminder_settings_payload(self.session, self.other)
        self.assertFalse(other_payload["enabled"])
        self.assertEqual(other_payload["delivery"], [])

    def test_invalid_push_endpoint_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            subscribe_user(
                self.session,
                self.user,
                channel="browser_push",
                endpoint="http://push.example.test/subscription/1",
                p256dh="public-key",
                auth_key="auth-key",
            )


if __name__ == "__main__":
    unittest.main()
