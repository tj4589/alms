"""Centralized access rules for the global ExamMind admin portal."""

import os
from typing import Any


def _normalise_email(value: Any) -> str:
    return str(value or "").strip().lower()


def configured_admin_emails() -> frozenset[str]:
    """Return the explicitly registered admin emails from deployment config."""
    return frozenset(
        email
        for email in (_normalise_email(item) for item in os.getenv("ADMIN_PORTAL_EMAILS", "").split(","))
        if email
    )


def has_admin_portal_access(user: Any) -> bool:
    """Require both the global role and an explicitly registered email.

    The portal fails closed when ADMIN_PORTAL_EMAILS is empty, including during
    local development, so an admin role alone never grants portal access.
    """
    if user is None or getattr(user, "role", None) != "admin":
        return False
    allowlist = configured_admin_emails()
    if not allowlist:
        return False
    return _normalise_email(getattr(user, "email", "")) in allowlist
