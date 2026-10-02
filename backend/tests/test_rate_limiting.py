import threading
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from rate_limiting import (
    DatabaseRateLimitStore,
    RateLimitRule,
    RateLimitService,
    client_identity,
)


class FakeSession:
    def __init__(self):
        self.commits = 0
        self.rollbacks = 0
        self.closed = False

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed = True


class SharedAtomicFakeStore:
    """Test double for two service instances sharing one atomic store."""

    def __init__(self):
        self.buckets = {}
        self.lock = threading.Lock()

    def consume(self, _session, key, rule, now):
        with self.lock:
            bucket = self.buckets.get(key)
            if bucket is None or bucket[1] <= now:
                bucket = [0, now + timedelta(seconds=rule.window_seconds)]
                self.buckets[key] = bucket
            if bucket[0] >= rule.limit:
                retry_after = max(1, int((bucket[1] - now).total_seconds()))
                from rate_limiting import RateLimitDecision

                return RateLimitDecision(False, retry_after)
            bucket[0] += 1
            from rate_limiting import RateLimitDecision

            return RateLimitDecision(True, 0)


class BrokenStore:
    def consume(self, *_args, **_kwargs):
        raise ConnectionError("shared store unavailable")


class RateLimitingTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
        self.rule = RateLimitRule("TEST", limit=2, window_seconds=10)
        self.shared_store = SharedAtomicFakeStore()

    def service(self, store=None, enabled=True):
        return RateLimitService(
            session_factory=FakeSession,
            store_factory=lambda _session: store or self.shared_store,
            rules={"test": self.rule},
            enabled=enabled,
            clock=lambda: self.now,
        )

    def test_below_and_at_limit_are_allowed_and_above_limit_has_retry_after(self):
        service = self.service()
        service.check("test", "user:1")
        service.check("test", "user:1")
        with self.assertRaises(HTTPException) as raised:
            service.check("test", "user:1")
        self.assertEqual(raised.exception.status_code, 429)
        self.assertGreaterEqual(int(raised.exception.headers["Retry-After"]), 1)

    def test_window_expiry_resets_the_counter(self):
        service = self.service()
        service.check("test", "user:1")
        service.check("test", "user:1")
        self.now += timedelta(seconds=11)
        service.check("test", "user:1")

    def test_identities_are_separate(self):
        service = self.service()
        service.check("test", "user:1")
        service.check("test", "user:1")
        service.check("test", "user:2")
        with self.assertRaises(HTTPException):
            service.check("test", "user:1")

    def test_two_limiter_instances_share_atomic_enforcement(self):
        first = self.service()
        second = self.service()
        first.check("test", "user:1")
        second.check("test", "user:1")
        with self.assertRaises(HTTPException):
            first.check("test", "user:1")

    def test_concurrent_requests_cannot_exceed_shared_limit(self):
        services = [self.service() for _ in range(20)]
        allowed = []
        lock = threading.Lock()

        def call(service):
            try:
                service.check("test", "user:concurrent")
                with lock:
                    allowed.append(True)
            except HTTPException as exc:
                self.assertEqual(exc.status_code, 429)

        threads = [threading.Thread(target=call, args=(service,)) for service in services]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(len(allowed), self.rule.limit)

    def test_shared_store_outage_fails_closed_before_protected_operation(self):
        service = self.service(store=BrokenStore())
        protected_operation = Mock()
        with self.assertRaises(HTTPException) as raised:
            service.check("test", "user:1")
            protected_operation()
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.headers["Retry-After"], "60")
        protected_operation.assert_not_called()

    def test_local_explicit_disable_is_not_a_process_local_fallback(self):
        service = self.service(store=BrokenStore(), enabled=False)
        service.check("test", "user:1")

    def test_forwarded_headers_do_not_change_client_identity(self):
        first = SimpleNamespace(
            client=SimpleNamespace(host="203.0.113.10"),
            headers={"x-forwarded-for": "198.51.100.3"},
        )
        second = SimpleNamespace(
            client=SimpleNamespace(host="203.0.113.10"),
            headers={"x-forwarded-for": "198.51.100.4"},
        )
        self.assertEqual(client_identity(first), client_identity(second))
        self.assertEqual(client_identity(first), "client:203.0.113.10")

    def test_postgresql_store_rejects_sqlite_instead_of_faking_distributed_state(self):
        engine = create_engine("sqlite:///:memory:")
        with Session(engine) as session:
            with self.assertRaises(RuntimeError):
                DatabaseRateLimitStore().consume(session, "TEST:user:1", self.rule, self.now)


if __name__ == "__main__":
    unittest.main()
