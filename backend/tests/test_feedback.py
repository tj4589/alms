import unittest
from pathlib import Path
from types import SimpleNamespace

from pydantic import ValidationError
from fastapi import HTTPException

import models
import schemas
from routers import feedback


class FakeDB:
    def __init__(self):
        self.added = []
        self.commits = 0

    def add(self, value):
        self.added.append(value)

    def commit(self):
        self.commits += 1

    def refresh(self, _value):
        return None

    def rollback(self):
        return None


def request_for(ip: str = "198.51.100.10", user_agent: str = "feedback-test"):
    return SimpleNamespace(
        client=SimpleNamespace(host=ip),
        headers={"user-agent": user_agent},
    )


class FeedbackTests(unittest.TestCase):
    def valid_public_payload(self, **overrides):
        values = {
            "category": "I have a suggestion",
            "message": "A clearer empty state would help me know what to do next.",
            "page_path": "/feedback",
            "website": "",
        }
        values.update(overrides)
        return schemas.PublicFeedbackRequest(**values)

    def test_public_submission_does_not_require_authentication(self):
        db = FakeDB()
        response = feedback.create_public_feedback(self.valid_public_payload(), request_for(), db)

        self.assertEqual(response.message, feedback.PUBLIC_FEEDBACK_SUCCESS)
        self.assertEqual(db.commits, 1)
        self.assertIsNone(db.added[0].user_id)
        self.assertEqual(db.added[0].source, "public")

    def test_public_submission_without_email_is_allowed(self):
        db = FakeDB()
        feedback.create_public_feedback(self.valid_public_payload(reply_email=None), request_for("198.51.100.11"), db)
        self.assertIsNone(db.added[0].reply_email)

    def test_optional_email_is_validated(self):
        with self.assertRaises(ValidationError):
            self.valid_public_payload(reply_email="not-an-email")

    def test_external_page_paths_are_rejected(self):
        for page_path in ("https://example.com", "//example.com", "javascript:alert(1)"):
            with self.subTest(page_path=page_path):
                with self.assertRaises(ValidationError):
                    self.valid_public_payload(page_path=page_path)

    def test_honeypot_rejects_submission(self):
        db = FakeDB()
        with self.assertRaises(HTTPException) as raised:
            feedback.create_public_feedback(self.valid_public_payload(website="bot-filled"), request_for("198.51.100.12"), db)
        self.assertEqual(raised.exception.status_code, 400)
        self.assertFalse(db.added)

    def test_rate_limiter_rejects_after_limit(self):
        limiter = feedback.FeedbackRateLimiter(limit=2, window_seconds=60)
        self.assertTrue(limiter.allow("198.51.100.13", now=100))
        self.assertTrue(limiter.allow("198.51.100.13", now=101))
        self.assertFalse(limiter.allow("198.51.100.13", now=102))
        self.assertTrue(limiter.allow("198.51.100.13", now=161))

    def test_public_payload_cannot_supply_identity_or_workflow_fields(self):
        with self.assertRaises(ValidationError):
            self.valid_public_payload(user_id=42, source="authenticated", status="closed")

    def test_authenticated_submission_derives_user_id_and_source(self):
        db = FakeDB()
        payload = schemas.AuthenticatedFeedbackRequest(
            category="Something felt confusing",
            message="The first upload screen did not explain the next step.",
            page_path="/",
        )
        response = feedback.create_authenticated_feedback(payload, db, SimpleNamespace(id=42))

        self.assertEqual(response.message, feedback.PUBLIC_FEEDBACK_SUCCESS)
        self.assertEqual(db.added[0].user_id, 42)
        self.assertEqual(db.added[0].source, "authenticated")
        self.assertIsNone(db.added[0].reply_email)

    def test_feedback_does_not_store_ip_or_user_agent_and_keeps_text_as_text(self):
        db = FakeDB()
        feedback.create_public_feedback(
            self.valid_public_payload(message="<script>alert('no')</script> is only text here."),
            request_for("198.51.100.14", "evil-browser"),
            db,
        )
        record = db.added[0]
        self.assertEqual(record.message, "<script>alert('no')</script> is only text here.")
        self.assertNotIn("ip_address", record.__dict__)
        self.assertNotIn("user_agent", record.__dict__)
        self.assertFalse(hasattr(models.Feedback, "ip_address"))
        self.assertFalse(hasattr(models.Feedback, "user_agent"))

    def test_feedback_user_id_is_nullable(self):
        column = models.Feedback.__table__.c.user_id
        self.assertTrue(column.nullable)

    def test_inbox_rendering_uses_text_nodes_not_html_injection(self):
        source = Path(__file__).parents[2].joinpath("frontend", "src", "components", "FeedbackInbox.tsx").read_text(encoding="utf-8")
        self.assertNotIn("dangerouslySetInnerHTML", source)
        self.assertNotIn("innerHTML", source)


if __name__ == "__main__":
    unittest.main()
