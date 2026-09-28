import os
import sys
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from pydantic import ValidationError
from fastapi import HTTPException

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("SECRET_KEY", "discussion-test-secret")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from routers.mvp import (  # noqa: E402
    ThreadMessageRequest,
    _parse_thread_cursor,
    _thread_cursor,
)


class DiscussionFeedTests(unittest.TestCase):
    def test_cursor_round_trips_created_at_and_id(self):
        created_at = datetime(2026, 9, 21, 10, 30, tzinfo=timezone.utc)
        cursor = _thread_cursor(SimpleNamespace(created_at=created_at, id=42))

        self.assertEqual(_parse_thread_cursor(cursor), (created_at, 42))

    def test_malformed_cursor_is_rejected(self):
        with self.assertRaises(HTTPException):
            _parse_thread_cursor("not-a-discussion-cursor")

    def test_client_message_id_is_bounded_and_safe(self):
        request = ThreadMessageRequest(content="A reply", client_message_id="reply_12345678")
        self.assertEqual(request.client_message_id, "reply_12345678")
        with self.assertRaises(ValidationError):
            ThreadMessageRequest(content="A reply", client_message_id="bad id")


if __name__ == "__main__":
    unittest.main()
