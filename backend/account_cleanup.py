"""Bounded, retryable cleanup for accounts whose recovery window expired.

The job intentionally accepts the Firebase identity deleter as a dependency.
This repository does not contain Firebase Admin credentials, so the default
deployment cannot claim to delete Firebase identities automatically.
"""

import logging
from datetime import datetime, timezone
from typing import Callable, Optional

import auth
import models
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)
DEFAULT_BATCH_SIZE = 25


def permanent_deletion_enabled() -> bool:
    return auth.permanent_deletion_enabled()


def run_cleanup_batch(
    db: Session,
    *,
    firebase_delete_identity: Optional[Callable[[str], None]] = None,
    now: Optional[datetime] = None,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> dict[str, int]:
    """Process only due pending accounts, without logging personal data."""
    if not permanent_deletion_enabled() or firebase_delete_identity is None:
        logger.info("account_cleanup_skipped reason=firebase_deletion_not_configured")
        return {"processed": 0, "failed": 0, "skipped": 1}

    timestamp = now or datetime.now(timezone.utc)
    bounded_size = max(1, min(int(batch_size), 100))
    due_accounts = (
        db.query(models.User)
        .filter(
            models.User.account_status == "pending_deletion",
            models.User.deletion_due_at <= timestamp,
        )
        .order_by(models.User.deletion_due_at.asc(), models.User.id.asc())
        .limit(bounded_size)
        .all()
    )

    processed = 0
    failed = 0
    for user in due_accounts:
        try:
            # Firebase must be removed through an explicitly configured,
            # server-authorized mechanism before Neon is permanently cleaned.
            firebase_delete_identity(user.firebase_uid)
            auth.delete_user_account(db, user)
            db.commit()
            processed += 1
            logger.info("account_cleanup_succeeded")
        except auth.PermanentDeletionDisabledError:
            db.rollback()
            failed += 1
            logger.warning("account_cleanup_skipped reason=permanent_deletion_disabled")
        except Exception:
            db.rollback()
            failed += 1
            logger.error("account_cleanup_failed reason=transaction_or_firebase_failure")

    return {"processed": processed, "failed": failed, "skipped": 0}
