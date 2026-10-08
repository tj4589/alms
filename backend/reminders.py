"""Consent, subscription and delivery primitives for study reminders.

The API owns consent and durable delivery state. A separate scheduler/worker
must decide when a study-activity reminder is due and call
``dispatch_study_reminder``. Dispatch is disabled by default; tests inject a
mock sender and production must explicitly configure a provider and worker.
"""

from __future__ import annotations

import hashlib
import json
import os
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any, Protocol

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models

SUPPORTED_CHANNELS = ("email", "browser_push")
ACTIVE_STATUS = "active"
UNSUBSCRIBED_STATUS = "unsubscribed"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ReminderProviderUnavailable(RuntimeError):
    """A safe provider/configuration failure with no sensitive detail."""


class ReminderSender(Protocol):
    def send(
        self,
        user: models.User,
        subscription: models.ReminderSubscription,
        *,
        subject: str,
        body: str,
        idempotency_key: str,
    ) -> str | None:
        """Send one reminder and return a safe provider reference."""


def _dispatch_enabled() -> bool:
    return os.getenv("REMINDER_DISPATCH_ENABLED", "false").strip().lower() == "true"


def _configured_cadence() -> str | None:
    value = os.getenv("REMINDER_CADENCE", "").strip().lower()
    return value or None


def _endpoint_key(channel: str, endpoint: str | None, user_id: int | None = None) -> str:
    if channel == "email":
        if user_id is None:
            raise ValueError("An account is required for email reminders.")
        return hashlib.sha256(f"email:{user_id}".encode("utf-8")).hexdigest()
    if not endpoint:
        raise ValueError("A browser push endpoint is required.")
    return hashlib.sha256(endpoint.encode("utf-8")).hexdigest()


def _set_preference_enabled(user: models.User, enabled: bool) -> None:
    preferences = dict(user.onboarding_preferences or {})
    preferences["notifications_enabled"] = enabled
    user.onboarding_preferences = preferences
    user.profile_updated_at = utc_now()


def _upsert_email_subscription(db: Session, user: models.User) -> models.ReminderSubscription | None:
    if not (user.email or "").strip():
        return None
    subscription = (
        db.query(models.ReminderSubscription)
        .filter(
            models.ReminderSubscription.user_id == user.id,
            models.ReminderSubscription.channel == "email",
            models.ReminderSubscription.endpoint_key == _endpoint_key("email", None, user.id),
        )
        .first()
    )
    now = utc_now()
    if subscription is None:
        subscription = models.ReminderSubscription(
            user_id=user.id,
            channel="email",
            endpoint_key=_endpoint_key("email", None, user.id),
            status=ACTIVE_STATUS,
            consented_at=now,
            last_seen_at=now,
        )
        db.add(subscription)
    else:
        subscription.status = ACTIVE_STATUS
        subscription.consented_at = subscription.consented_at or now
        subscription.unsubscribed_at = None
        subscription.last_seen_at = now
    return subscription


def sync_legacy_notification_consent(db: Session, user: models.User, enabled: bool) -> None:
    """Bridge the existing KSA checkbox into explicit email consent.

    The checkbox means the student consents to study reminders. Email is the
    account-owned channel available without another browser permission prompt;
    browser push remains separately subscribed from the settings UI.
    """

    _set_preference_enabled(user, enabled)
    if enabled:
        _upsert_email_subscription(db, user)
        return
    now = utc_now()
    for subscription in (
        db.query(models.ReminderSubscription)
        .filter(
            models.ReminderSubscription.user_id == user.id,
            models.ReminderSubscription.status == ACTIVE_STATUS,
        )
        .all()
    ):
        subscription.status = UNSUBSCRIBED_STATUS
        subscription.unsubscribed_at = now
        subscription.updated_at = now


def subscribe_user(
    db: Session,
    user: models.User,
    *,
    channel: str,
    endpoint: str | None = None,
    p256dh: str | None = None,
    auth_key: str | None = None,
) -> models.ReminderSubscription:
    if channel not in SUPPORTED_CHANNELS:
        raise ValueError("That reminder channel is not supported.")
    if channel == "email":
        if not (user.email or "").strip():
            raise ValueError("A verified account email is required for email reminders.")
        endpoint = None
        p256dh = None
        auth_key = None
    else:
        if not endpoint or not endpoint.lower().startswith("https://"):
            raise ValueError("Browser push endpoints must use HTTPS.")
        if not p256dh or not auth_key:
            raise ValueError("Browser push subscription keys are required.")

    endpoint_key = _endpoint_key(channel, endpoint, user.id)
    existing_endpoint = (
        db.query(models.ReminderSubscription)
        .filter(
            models.ReminderSubscription.channel == channel,
            models.ReminderSubscription.endpoint_key == endpoint_key,
            models.ReminderSubscription.user_id != user.id,
        )
        .first()
    )
    if existing_endpoint is not None:
        raise ValueError("That reminder destination is already registered.")

    subscription = (
        db.query(models.ReminderSubscription)
        .filter(
            models.ReminderSubscription.user_id == user.id,
            models.ReminderSubscription.channel == channel,
            models.ReminderSubscription.endpoint_key == endpoint_key,
        )
        .first()
    )
    now = utc_now()
    if subscription is None:
        subscription = models.ReminderSubscription(
            user_id=user.id,
            channel=channel,
            endpoint=endpoint,
            endpoint_key=endpoint_key,
            p256dh=p256dh,
            auth_key=auth_key,
            status=ACTIVE_STATUS,
            consented_at=now,
            last_seen_at=now,
        )
        db.add(subscription)
    else:
        subscription.endpoint = endpoint
        subscription.p256dh = p256dh
        subscription.auth_key = auth_key
        subscription.status = ACTIVE_STATUS
        subscription.unsubscribed_at = None
        subscription.last_seen_at = now
    _set_preference_enabled(user, True)
    return subscription


def unsubscribe_user(db: Session, user: models.User, channel: str | None = None) -> int:
    if channel is not None and channel not in SUPPORTED_CHANNELS:
        raise ValueError("That reminder channel is not supported.")
    query = db.query(models.ReminderSubscription).filter(
        models.ReminderSubscription.user_id == user.id,
        models.ReminderSubscription.status == ACTIVE_STATUS,
    )
    if channel is not None:
        query = query.filter(models.ReminderSubscription.channel == channel)
    subscriptions = query.all()
    now = utc_now()
    for subscription in subscriptions:
        subscription.status = UNSUBSCRIBED_STATUS
        subscription.unsubscribed_at = now
        subscription.updated_at = now

    active_remaining = (
        db.query(models.ReminderSubscription)
        .filter(
            models.ReminderSubscription.user_id == user.id,
            models.ReminderSubscription.status == ACTIVE_STATUS,
        )
        .count()
    )
    _set_preference_enabled(user, active_remaining > 0)
    return len(subscriptions)


def subscription_payload(subscription: models.ReminderSubscription | None) -> dict[str, Any]:
    if subscription is None:
        return {"subscribed": False, "status": "not_subscribed"}
    return {
        "subscribed": subscription.status == ACTIVE_STATUS,
        "status": subscription.status,
        "consented_at": subscription.consented_at.isoformat() if subscription.consented_at else None,
        "unsubscribed_at": subscription.unsubscribed_at.isoformat() if subscription.unsubscribed_at else None,
    }


def delivery_payload(delivery: models.ReminderDelivery) -> dict[str, Any]:
    return {
        "id": delivery.id,
        "channel": delivery.channel,
        "status": delivery.status,
        "scheduled_for": delivery.scheduled_for.isoformat() if delivery.scheduled_for else None,
        "attempted_at": delivery.attempted_at.isoformat() if delivery.attempted_at else None,
        "sent_at": delivery.sent_at.isoformat() if delivery.sent_at else None,
        "attempt_count": delivery.attempt_count,
        "failure_code": delivery.failure_code,
        "created_at": delivery.created_at.isoformat() if delivery.created_at else None,
    }


def reminder_settings_payload(db: Session, user: models.User, *, delivery_limit: int = 10) -> dict[str, Any]:
    subscriptions = (
        db.query(models.ReminderSubscription)
        .filter(models.ReminderSubscription.user_id == user.id)
        .order_by(models.ReminderSubscription.updated_at.desc(), models.ReminderSubscription.id.desc())
        .all()
    )
    latest: dict[str, models.ReminderSubscription] = {}
    for subscription in subscriptions:
        latest.setdefault(subscription.channel, subscription)
    deliveries = (
        db.query(models.ReminderDelivery)
        .filter(models.ReminderDelivery.user_id == user.id)
        .order_by(models.ReminderDelivery.created_at.desc(), models.ReminderDelivery.id.desc())
        .limit(delivery_limit)
        .all()
    )
    preferences = user.onboarding_preferences if isinstance(user.onboarding_preferences, dict) else {}
    return {
        "enabled": bool(preferences.get("notifications_enabled")) or any(
            item.status == ACTIVE_STATUS for item in subscriptions
        ),
        "channels": {
            channel: subscription_payload(latest.get(channel))
            for channel in SUPPORTED_CHANNELS
        },
        "delivery": [delivery_payload(item) for item in deliveries],
        "dispatch": {
            "enabled": _dispatch_enabled(),
            "cadence": _configured_cadence(),
            "scheduled_worker_required": True,
        },
    }


class MockReminderSender:
    """Deterministic sender used by isolated tests; never contacts a provider."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    def send(
        self,
        user: models.User,
        subscription: models.ReminderSubscription,
        *,
        subject: str,
        body: str,
        idempotency_key: str,
    ) -> str:
        self.sent.append({
            "user_id": user.id,
            "channel": subscription.channel,
            "subject": subject,
            "body": body,
            "idempotency_key": idempotency_key,
        })
        return f"mock-{len(self.sent)}"


class SmtpReminderSender:
    def __init__(self) -> None:
        self.host = os.getenv("REMINDER_EMAIL_SMTP_HOST", "").strip()
        self.port = int(os.getenv("REMINDER_EMAIL_SMTP_PORT", "587"))
        self.username = os.getenv("REMINDER_EMAIL_SMTP_USERNAME", "")
        self.password = os.getenv("REMINDER_EMAIL_SMTP_PASSWORD", "")
        self.sender = os.getenv("REMINDER_EMAIL_FROM", "").strip()
        self.timeout = max(1, min(int(os.getenv("REMINDER_PROVIDER_TIMEOUT_SECONDS", "10")), 60))
        if not self.host or not self.sender:
            raise ReminderProviderUnavailable("email_provider_unconfigured")

    def send(self, user, subscription, *, subject, body, idempotency_key):
        message = EmailMessage()
        message["From"] = self.sender
        message["To"] = user.email
        message["Subject"] = subject
        message["X-ExamMind-Idempotency-Key"] = idempotency_key
        message.set_content(body)
        context = ssl.create_default_context()
        try:
            with smtplib.SMTP(self.host, self.port, timeout=self.timeout) as client:
                client.starttls(context=context)
                if self.username:
                    client.login(self.username, self.password)
                client.send_message(message)
        except (OSError, smtplib.SMTPException, TimeoutError) as exc:
            raise ReminderProviderUnavailable("email_provider_failed") from exc
        return None


class BrowserPushReminderSender:
    def __init__(self) -> None:
        self.public_key = os.getenv("REMINDER_PUSH_VAPID_PUBLIC_KEY", "").strip()
        self.private_key = os.getenv("REMINDER_PUSH_VAPID_PRIVATE_KEY", "").strip()
        self.subject = os.getenv("REMINDER_PUSH_VAPID_SUBJECT", "").strip()
        if not self.public_key or not self.private_key or not self.subject:
            raise ReminderProviderUnavailable("push_provider_unconfigured")
        try:
            from pywebpush import webpush
        except ImportError as exc:
            raise ReminderProviderUnavailable("push_provider_unavailable") from exc
        self._webpush = webpush

    def send(self, user, subscription, *, subject, body, idempotency_key):
        try:
            result = self._webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth_key},
                },
                data=json.dumps({"title": subject, "body": body, "url": "/"}),
                vapid_private_key=self.private_key,
                vapid_claims={"sub": self.subject},
                ttl=3600,
            )
        except Exception as exc:  # provider libraries expose several exception types
            raise ReminderProviderUnavailable("push_provider_failed") from exc
        return getattr(result, "headers", {}).get("x-message-id") if result is not None else None


def configured_sender(channel: str) -> ReminderSender:
    if not _dispatch_enabled():
        raise ReminderProviderUnavailable("dispatch_disabled")
    if channel == "email" and os.getenv("REMINDER_EMAIL_PROVIDER", "none").strip().lower() == "smtp":
        return SmtpReminderSender()
    if channel == "browser_push":
        return BrowserPushReminderSender()
    raise ReminderProviderUnavailable("reminder_provider_unconfigured")


def _failure_code(error: Exception) -> str:
    if isinstance(error, ReminderProviderUnavailable):
        return str(error) or "provider_unavailable"
    if isinstance(error, (TimeoutError, smtplib.SMTPException)):
        return "provider_timeout"
    return "provider_failed"


def _new_delivery(
    db: Session,
    *,
    user: models.User,
    subscription: models.ReminderSubscription,
    dedupe_key: str,
    scheduled_for: datetime,
) -> tuple[models.ReminderDelivery, bool]:
    existing = db.query(models.ReminderDelivery).filter(models.ReminderDelivery.dedupe_key == dedupe_key).first()
    if existing is not None:
        return existing, False
    delivery = models.ReminderDelivery(
        user_id=user.id,
        subscription_id=subscription.id,
        channel=subscription.channel,
        dedupe_key=dedupe_key,
        status="queued",
        scheduled_for=scheduled_for,
    )
    try:
        with db.begin_nested():
            db.add(delivery)
            db.flush()
    except IntegrityError:
        existing = db.query(models.ReminderDelivery).filter(models.ReminderDelivery.dedupe_key == dedupe_key).first()
        if existing is not None:
            return existing, False
        raise
    return delivery, True


def dispatch_study_reminder(
    db: Session,
    user_id: int,
    *,
    period_key: str,
    subject: str,
    body: str,
    sender: ReminderSender | None = None,
    scheduled_for: datetime | None = None,
) -> list[models.ReminderDelivery]:
    """Deliver one cadence period to every active destination exactly once.

    This function is intentionally not called from request handlers or app
    startup. A scheduler/worker owns cadence decisions and invokes it with a
    stable period key. The unique database key is the final duplicate guard.
    """

    if not period_key or len(period_key) > 120 or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_:" for character in period_key):
        raise ValueError("The reminder period key is invalid.")
    user = db.get(models.User, user_id)
    if user is None or user.account_status != "active":
        return []
    preferences = user.onboarding_preferences if isinstance(user.onboarding_preferences, dict) else {}
    if preferences.get("notifications_enabled") is not True:
        return []
    subscriptions = (
        db.query(models.ReminderSubscription)
        .filter(
            models.ReminderSubscription.user_id == user.id,
            models.ReminderSubscription.status == ACTIVE_STATUS,
        )
        .order_by(models.ReminderSubscription.id.asc())
        .all()
    )
    when = scheduled_for or utc_now()
    deliveries: list[models.ReminderDelivery] = []
    for subscription in subscriptions:
        dedupe_key = f"study-activity:{user.id}:{subscription.id}:{period_key}"
        delivery, created = _new_delivery(
            db,
            user=user,
            subscription=subscription,
            dedupe_key=dedupe_key,
            scheduled_for=when,
        )
        if not created:
            deliveries.append(delivery)
            continue
        delivery.attempted_at = utc_now()
        delivery.attempt_count = 1
        try:
            active_sender = sender or configured_sender(subscription.channel)
            delivery.provider_reference = active_sender.send(
                user,
                subscription,
                subject=subject,
                body=body,
                idempotency_key=dedupe_key,
            )
            delivery.status = "sent"
            delivery.sent_at = utc_now()
        except Exception as exc:
            delivery.status = "failed"
            delivery.failure_code = _failure_code(exc)
        db.flush()
        deliveries.append(delivery)
    return deliveries
