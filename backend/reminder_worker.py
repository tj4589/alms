"""Scheduled entry point for consented study reminders.

The API does not start this worker. A separately scheduled process invokes it
after an operator has approved a cadence and configured a delivery provider.
The durable delivery key makes concurrent runs idempotent per period.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from typing import Iterable

from sqlalchemy import distinct

import models
from database import SessionLocal
from reminders import dispatch_study_reminder, utc_now

SUPPORTED_CADENCES = {"daily", "weekly"}


def configured_cadence() -> str:
    cadence = os.getenv("REMINDER_CADENCE", "").strip().lower()
    if cadence not in SUPPORTED_CADENCES:
        raise RuntimeError("REMINDER_CADENCE must be daily or weekly before the worker can run.")
    return cadence


def period_key(now: datetime, cadence: str) -> str:
    if cadence not in SUPPORTED_CADENCES:
        raise ValueError("Unsupported reminder cadence.")
    current = now.astimezone(timezone.utc)
    if cadence == "daily":
        return current.strftime("%Y-%m-%d")
    iso_year, iso_week, _ = current.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def eligible_user_ids(db, *, limit: int) -> list[int]:
    rows: Iterable[tuple[int]] = (
        db.query(distinct(models.User.id))
        .join(models.ReminderSubscription, models.ReminderSubscription.user_id == models.User.id)
        .filter(
            models.User.account_status == "active",
            models.ReminderSubscription.status == "active",
        )
        .order_by(models.User.id.asc())
        .limit(limit)
        .all()
    )
    user_ids: list[int] = []
    for (user_id,) in rows:
        user = db.get(models.User, user_id)
        preferences = user.onboarding_preferences if user and isinstance(user.onboarding_preferences, dict) else {}
        if preferences.get("notifications_enabled") is True:
            user_ids.append(user_id)
    return user_ids


def run_once(*, now: datetime | None = None, batch_size: int | None = None) -> dict[str, int | str]:
    """Run one configured period and return redacted operational counters."""
    if os.getenv("REMINDER_WORKER_ENABLED", "false").strip().lower() != "true":
        raise RuntimeError("REMINDER_WORKER_ENABLED is not true.")
    if os.getenv("REMINDER_DISPATCH_ENABLED", "false").strip().lower() != "true":
        raise RuntimeError("REMINDER_DISPATCH_ENABLED is not true.")

    cadence = configured_cadence()
    current = now or utc_now()
    period = period_key(current, cadence)
    try:
        limit = int(batch_size if batch_size is not None else os.getenv("REMINDER_WORKER_BATCH_SIZE", "500"))
    except ValueError as exc:
        raise RuntimeError("REMINDER_WORKER_BATCH_SIZE must be an integer.") from exc
    if limit < 1 or limit > 5000:
        raise RuntimeError("REMINDER_WORKER_BATCH_SIZE must be between 1 and 5000.")

    subject = os.getenv("REMINDER_SUBJECT", "A study check-in from ExamMind").strip()
    body = os.getenv("REMINDER_BODY", "Take a few minutes to review one useful section in your ExamMind workspace.").strip()
    if not subject or not body:
        raise RuntimeError("REMINDER_SUBJECT and REMINDER_BODY must not be empty.")

    db = SessionLocal()
    try:
        user_ids = eligible_user_ids(db, limit=limit)
        deliveries = sent = failed = 0
        for user_id in user_ids:
            rows = dispatch_study_reminder(
                db,
                user_id,
                period_key=period,
                subject=subject,
                body=body,
                scheduled_for=current,
            )
            deliveries += len(rows)
            sent += sum(row.status == "sent" for row in rows)
            failed += sum(row.status == "failed" for row in rows)
        db.commit()
        return {
            "cadence": cadence,
            "period": period,
            "users_considered": len(user_ids),
            "deliveries": deliveries,
            "sent": sent,
            "failed": failed,
        }
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main() -> int:
    try:
        result = run_once()
    except RuntimeError as exc:
        print(f"Reminder worker not run: {exc}", file=sys.stderr)
        return 2
    except Exception:
        print("Reminder worker failed safely; inspect worker logs without exposing provider details.", file=sys.stderr)
        return 1
    print("Reminder worker completed:", result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
