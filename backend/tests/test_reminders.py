import os
import sys
import unittest
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from unittest.mock import MagicMock, patch
from types import SimpleNamespace

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
    BrowserPushReminderSender,
    ReminderProviderUnavailable,
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

    def test_push_rejects_internal_and_malformed_destinations_before_persistence(self) -> None:
        for endpoint in ("https://127.0.0.1/private", "https://[::1]/private", "https://localhost/x",
                         "https://worker.internal/x", "https://user:password@push.example.test/x",
                         "https:///missing-host", "https://push.example.test:8443/x",
                         "https://push.example.test/x#secret"):
            with self.subTest(endpoint=endpoint):
                with self.assertRaises(ValueError):
                    ReminderSubscriptionRequest(channel="browser_push", endpoint=endpoint)
                with self.assertRaises(ValueError):
                    subscribe_user(self.session, self.user, channel="browser_push", endpoint=endpoint,
                                   p256dh="public-key", auth_key="auth-key")
        self.assertEqual(self.session.query(models.ReminderSubscription).count(), 0)


class PushDeliverySafetyTests(unittest.TestCase):
    def setUp(self):
        config = patch.dict(os.environ, {
            "REMINDER_PUSH_VAPID_PUBLIC_KEY": "fixture-public", "REMINDER_PUSH_VAPID_PRIVATE_KEY": "fixture-private",
            "REMINDER_PUSH_VAPID_SUBJECT": "mailto:operator@example.test",
            "REMINDER_PUSH_ALLOWED_HOSTS": " PUSH.EXAMPLE.TEST ", "REMINDER_PROVIDER_TIMEOUT_SECONDS": "7",
        })
        config.start()
        self.addCleanup(config.stop)
        self.webpush = MagicMock(return_value=SimpleNamespace(status_code=201, headers={"x-message-id": "fixture-result"}))
        module = patch.dict(sys.modules, {"pywebpush": SimpleNamespace(webpush=self.webpush)})
        module.start()
        self.addCleanup(module.stop)
        self.subscription = SimpleNamespace(endpoint="https://push.example.test/fixture", p256dh="fixture-p256dh", auth_key="fixture-auth")

    def send(self, sender):
        return sender.send(None, self.subscription, subject="Study", body="Fixture only", idempotency_key="period-1")

    def test_sending_requires_exact_configured_service_host_and_bounds_timeout(self):
        sender = BrowserPushReminderSender()
        self.assertEqual(self.send(sender), "fixture-result")
        self.assertEqual(self.webpush.call_args.kwargs["timeout"], 7)
        self.subscription.endpoint = "https://push.example.test.attacker.test/fixture"
        self.webpush.reset_mock()
        with self.assertRaisesRegex(ReminderProviderUnavailable, "^push_destination_denied$"):
            self.send(sender)
        self.webpush.assert_not_called()
        with patch.dict(os.environ, {"REMINDER_PROVIDER_TIMEOUT_SECONDS": "999"}):
            self.assertEqual(BrowserPushReminderSender().timeout, 60)
        with patch.dict(os.environ, {"REMINDER_PROVIDER_TIMEOUT_SECONDS": "invalid"}):
            self.assertEqual(BrowserPushReminderSender().timeout, 10)

    def test_unconfigured_destinations_fail_closed(self):
        with patch.dict(os.environ, {"REMINDER_PUSH_ALLOWED_HOSTS": ""}):
            with self.assertRaisesRegex(ReminderProviderUnavailable, "^push_destinations_unconfigured$"):
                BrowserPushReminderSender()
        self.webpush.assert_not_called()

    def test_redirects_are_not_followed_and_cannot_report_success(self):
        self.webpush.side_effect = lambda **kwargs: kwargs["requests_session"].post(self.subscription.endpoint)
        with patch("requests.Session.request", return_value=SimpleNamespace(status_code=302, headers={})) as request:
            with self.assertRaisesRegex(ReminderProviderUnavailable, "^push_destination_denied$"):
                self.send(BrowserPushReminderSender())
        self.assertFalse(request.call_args.kwargs["allow_redirects"])

    def test_timeouts_and_malformed_provider_results_are_safe(self):
        self.webpush.side_effect = TimeoutError("SENSITIVE_PROVIDER_RESPONSE fixture-private")
        with self.assertRaisesRegex(ReminderProviderUnavailable, "^push_provider_failed$"):
            self.send(BrowserPushReminderSender())
        self.webpush.side_effect = None
        self.webpush.return_value = None
        with self.assertRaisesRegex(ReminderProviderUnavailable, "^push_provider_failed$"):
            self.send(BrowserPushReminderSender())


if __name__ == "__main__":
    unittest.main()
