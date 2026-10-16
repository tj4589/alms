"""Owner-only profile counts include current, completed quiz attempts."""

import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import models
from routers.mvp import public_profile


class ProfileIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        models.Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.owner = models.User(id=1, username="owner", name="Owner", role="student")
        self.other = models.User(id=2, username="other", name="Other", role="student")
        self.db.add_all([self.owner, self.other])
        self.db.add_all([
            models.LearningQuiz(id=10, user_id=1, question_count=5),
            models.LearningQuiz(id=11, user_id=1, question_count=5),
            models.LearningQuiz(id=12, user_id=2, question_count=5),
            models.LearningQuizAttempt(id=20, quiz_id=10, user_id=1, total_questions=5),
            models.LearningQuizAttempt(id=21, quiz_id=10, user_id=1, total_questions=5),
            models.LearningQuizAttempt(id=22, quiz_id=12, user_id=2, total_questions=5),
            models.PracticeAttempt(id=30, user_id=1, total_questions=3),
        ])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_self_counts_completed_retakes_and_legacy_not_unattempted_or_other_users(self):
        payload = public_profile("owner", self.db, self.owner)
        self.assertEqual(payload["practice_attempts"], 3)
        self.assertNotIn("readiness", payload)

    def test_other_user_cannot_read_personal_quiz_count(self):
        payload = public_profile("owner", self.db, self.other)
        self.assertFalse(payload["is_self"])
        self.assertNotIn("practice_attempts", payload)
