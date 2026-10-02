"""Shared, database-backed rate limiting for high-risk API operations.

The application database is the shared counter store.  This is deliberately
not backed by a process-local cache: every Render instance participates in the
same PostgreSQL atomic upsert.  Local development can explicitly disable the
limiter with ``RATE_LIMIT_ENABLED=false``; it never silently falls back to an
in-memory limiter.
"""

from __future__ import annotations

import hashlib
import math
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import case, or_, select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.orm import Session

import models
from database import SessionLocal


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _positive_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a positive integer.") from exc
    if parsed < 1:
        raise RuntimeError(f"{name} must be a positive integer.")
    return parsed


@dataclass(frozen=True)
class RateLimitRule:
    name: str
    limit: int
    window_seconds: int


_DEFAULT_RULES: dict[str, tuple[str, int, int]] = {
    "auth_session": ("AUTH_SESSION", 10, 15 * 60),
    "ksa_verify": ("KSA_VERIFY", 5, 15 * 60),
    "upload": ("UPLOAD", 20, 60 * 60),
    "maxe": ("MAXE", 30, 60),
    "session_ai": ("SESSION_AI", 20, 60),
    "quiz_generate": ("QUIZ_GENERATE", 10, 15 * 60),
    "share_create": ("SHARE_CREATE", 20, 60 * 60),
    "download": ("DOWNLOAD", 60, 60 * 60),
    "export": ("EXPORT", 30, 60 * 60),
    "share_read": ("SHARE_READ", 120, 15 * 60),
    "public_feedback": ("PUBLIC_FEEDBACK", 5, 15 * 60),
}


def _load_rules() -> dict[str, RateLimitRule]:
    return {
        name: RateLimitRule(
            name=name,
            limit=_positive_int(f"RATE_LIMIT_{prefix}_LIMIT", default_limit),
            window_seconds=_positive_int(
                f"RATE_LIMIT_{prefix}_WINDOW_SECONDS",
                default_window,
            ),
        )
        for name, (prefix, default_limit, default_window) in _DEFAULT_RULES.items()
    }


RATE_LIMIT_RULES = _load_rules()
RATE_LIMIT_ENABLED = _env_bool("RATE_LIMIT_ENABLED", True)
RATE_LIMIT_FAILURE_MODE = os.getenv("RATE_LIMIT_FAILURE_MODE", "closed").strip().lower()
if RATE_LIMIT_FAILURE_MODE != "closed":
    raise RuntimeError("RATE_LIMIT_FAILURE_MODE must be 'closed'; fail-open is not supported.")


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    retry_after_seconds: int


class DatabaseRateLimitStore:
    """Atomic PostgreSQL fixed-window counter store."""

    def consume(self, session: Session, key: str, rule: RateLimitRule, now: datetime) -> RateLimitDecision:
        bind = session.get_bind()
        if bind is None or bind.dialect.name != "postgresql":
            raise RuntimeError("The distributed rate-limit store requires PostgreSQL.")

        expires_at = now + timedelta(seconds=rule.window_seconds)
        bucket = models.RateLimitBucket
        expired = bucket.window_expires_at <= now
        statement = postgresql_insert(bucket).values(
            bucket_key=key,
            window_started_at=now,
            window_expires_at=expires_at,
            request_count=1,
            updated_at=now,
        )
        statement = statement.on_conflict_do_update(
            index_elements=[bucket.bucket_key],
            set_={
                "window_started_at": case((expired, now), else_=bucket.window_started_at),
                "window_expires_at": case((expired, expires_at), else_=bucket.window_expires_at),
                "request_count": case((expired, 1), else_=bucket.request_count + 1),
                "updated_at": now,
            },
            where=or_(expired, bucket.request_count < rule.limit),
        ).returning(bucket.request_count, bucket.window_expires_at)

        row = session.execute(statement).mappings().first()
        if row is not None:
            return RateLimitDecision(allowed=True, retry_after_seconds=0)

        current = session.execute(
            select(bucket.window_expires_at).where(bucket.bucket_key == key)
        ).scalar_one_or_none()
        if current is None:
            raise RuntimeError("The distributed rate-limit bucket was not readable after rejection.")
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        retry_after = max(1, math.ceil((current - now).total_seconds()))
        return RateLimitDecision(allowed=False, retry_after_seconds=retry_after)


def _default_store_factory(_session: Session) -> DatabaseRateLimitStore:
    return DatabaseRateLimitStore()


class RateLimitService:
    """Policy wrapper that turns store decisions into safe HTTP behavior."""

    def __init__(
        self,
        *,
        session_factory: Callable[[], Session] = SessionLocal,
        store_factory: Callable[[Session], DatabaseRateLimitStore] = _default_store_factory,
        rules: dict[str, RateLimitRule] | None = None,
        enabled: bool = RATE_LIMIT_ENABLED,
        failure_mode: str = RATE_LIMIT_FAILURE_MODE,
        clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ):
        self.session_factory = session_factory
        self.store_factory = store_factory
        self.rules = rules or RATE_LIMIT_RULES
        self.enabled = enabled
        self.failure_mode = failure_mode
        self.clock = clock

    def check(self, rule_name: str, identity: str) -> None:
        if not self.enabled:
            return
        rule = self.rules[rule_name]
        key = f"{rule.name}:{identity}"
        session: Session | None = None
        try:
            session = self.session_factory()
            decision = self.store_factory(session).consume(
                session,
                key,
                rule,
                self.clock(),
            )
            session.commit()
        except Exception as exc:
            if session is not None:
                session.rollback()
            if self.failure_mode != "closed":
                raise RuntimeError("Unsupported rate-limit failure mode.") from exc
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="This service is temporarily unable to accept the request. Please try again.",
                headers={"Retry-After": "60"},
            ) from exc
        finally:
            if session is not None:
                session.close()

        if not decision.allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please try again later.",
                headers={"Retry-After": str(decision.retry_after_seconds)},
            )


rate_limit_service = RateLimitService()


def enforce_rate_limit(rule_name: str, identity: str) -> None:
    rate_limit_service.check(rule_name, identity)


def client_identity(request: Request) -> str:
    """Use the direct socket peer; forwarded headers are intentionally ignored."""
    host = request.client.host if request.client and request.client.host else "unknown"
    return f"client:{host}"


def user_identity(user: models.User) -> str:
    return f"user:{user.id}"


def share_link_identity(token: str) -> str:
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return f"share:{digest}"


def client_rate_limit(rule_name: str):
    """Build a FastAPI dependency for unauthenticated client-scoped routes."""

    def dependency(request: Request) -> None:
        enforce_rate_limit(rule_name, client_identity(request))

    return dependency


def user_rate_limit(rule_name: str, user_dependency):
    """Build a dependency that runs after the route's auth dependency."""

    def dependency(current_user=Depends(user_dependency)) -> None:
        enforce_rate_limit(rule_name, user_identity(current_user))

    return dependency


def share_read_rate_limit(token: str) -> None:
    enforce_rate_limit("share_read", share_link_identity(token))
