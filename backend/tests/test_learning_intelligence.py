import os
import sys
import unittest

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models  # noqa: E402
from database import Base  # noqa: E402
from learning_intelligence import (  # noqa: E402
    authorized_sources,
    create_grounded_quiz,
    learning_suggestion,
    readiness_payload,
    record_quiz_attempt,
)


class LearningIntelligenceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.owner = models.User(id=1, name="Owner", email="owner@example.com", role="student")
        self.other = models.User(id=2, name="Other", email="other@example.com", role="student")
        course = models.Course(id=1, code="ECO 101", name="Economics")
        note = models.LectureNote(
            id=1,
            uploaded_by=1,
            course_id=1,
            title="Algebra notes",
            content_text="Linear equations use a variable to represent an unknown quantity. Substitution replaces a variable with a known expression. A balanced equation keeps both sides equal.",
            metadata_json={"document_title": "Algebra notes", "topics_covered": ["Algebra"]},
            visibility="private",
        )
        chunk = models.ResourceChunk(
            id=1,
            resource_type="lecture_note",
            resource_id=1,
            chunk_index=0,
            chunk_text="Linear equations use a variable to represent an unknown quantity. Substitution replaces a variable with a known expression. A balanced equation keeps both sides equal.",
            topic="Algebra",
            page_from=2,
            page_to=2,
            metadata_json={"document_title": "Algebra notes"},
        )
        self.db.add_all([self.owner, self.other, course, note, chunk])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def make_quiz(self, user=None, topic="Algebra", question_type="multiple_choice", count=3):
        return create_grounded_quiz(
            self.db,
            user or self.owner,
            source_scope="resource",
            resource_type="lecture_note",
            resource_id=1,
            course_id=1,
            topic=topic,
            count=count,
            difficulty="mixed",
            question_type=question_type,
        )

    def questions(self, quiz):
        return self.db.query(models.LearningQuizQuestion).filter(
            models.LearningQuizQuestion.quiz_id == quiz.id,
        ).order_by(models.LearningQuizQuestion.position.asc()).all()

    def answers(self, quiz, value="0"):
        return [{"question_id": question.id, "answer": value} for question in self.questions(quiz)]

    def test_private_material_is_not_a_question_source_for_another_user(self):
        self.assertEqual(authorized_sources(self.db, self.other, source_scope="workspace"), [])
        with self.assertRaises(LookupError):
            self.make_quiz(self.other)

    def test_generated_questions_are_grounded_and_keep_citations(self):
        quiz = self.make_quiz()
        rows = self.questions(quiz)
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(row.citation_json["resource_id"] == 1 for row in rows))
        self.assertTrue(all(row.citation_json["page_from"] == 2 for row in rows))
        self.assertTrue(all(row.options and row.correct_answer == "0" for row in rows))

    def test_short_answer_is_only_generated_with_reliable_keywords(self):
        quiz = self.make_quiz(question_type="short_answer", count=1)
        question = self.questions(quiz)[0]
        self.assertEqual(question.question_type, "short_answer")
        self.assertGreaterEqual(len(question.grading_keywords), 2)
        attempt = record_quiz_attempt(self.db, self.owner, quiz, [{"question_id": question.id, "answer": question.correct_answer}])
        self.assertEqual(attempt.score, 1)

    def test_attempts_store_answer_evidence_and_retake_history(self):
        quiz = self.make_quiz()
        first = record_quiz_attempt(self.db, self.owner, quiz, self.answers(quiz, "1"))
        second = record_quiz_attempt(self.db, self.owner, quiz, self.answers(quiz, "0"))
        self.assertNotEqual(first.id, second.id)
        self.assertEqual(self.db.query(models.LearningQuizAttempt).filter_by(quiz_id=quiz.id).count(), 2)
        self.assertEqual(self.db.query(models.LearningEvidence).filter_by(user_id=1).count(), 6)
        self.assertEqual(len(second.review_json), 3)
        self.assertIn("citation", second.review_json[0])

    def test_passive_reading_does_not_create_readiness(self):
        payload = readiness_payload(self.db, self.owner)
        self.assertFalse(payload["available"])
        self.assertIsNone(payload["score"])
        self.assertIn("Not enough evidence yet", payload["recommended_next_action"])
        self.assertEqual(self.db.query(models.LearningEvidence).count(), 0)

    def test_readiness_is_explainable_and_classifies_weak_topic(self):
        quiz = self.make_quiz()
        record_quiz_attempt(self.db, self.owner, quiz, self.answers(quiz, "1"))
        record_quiz_attempt(self.db, self.owner, quiz, self.answers(quiz, "0"))
        payload = readiness_payload(self.db, self.owner)
        self.assertTrue(payload["available"])
        self.assertEqual(payload["score"], 50)
        self.assertEqual(payload["formula"].split(";")[0], "correct answers / answered questions x 100")
        topic = next(item for item in payload["topics"] if item["topic"] == "Algebra")
        self.assertEqual(topic["classification"], "weak")
        self.assertEqual(topic["answers"], 6)
        self.assertEqual(topic["missed"], 3)
        self.assertIn("evidence_used", payload)
        self.assertIn("last_answered_at", topic)

    def test_strong_topic_requires_observed_answers(self):
        quiz = self.make_quiz()
        record_quiz_attempt(self.db, self.owner, quiz, self.answers(quiz, "0"))
        payload = readiness_payload(self.db, self.owner)
        topic = next(item for item in payload["topics"] if item["topic"] == "Algebra")
        self.assertEqual(topic["classification"], "strong")
        self.assertEqual(topic["score"], 100)

    def test_maxe_suggestion_is_based_on_real_weak_topic_evidence(self):
        quiz = self.make_quiz()
        record_quiz_attempt(self.db, self.owner, quiz, self.answers(quiz, "1"))
        record_quiz_attempt(self.db, self.owner, quiz, self.answers(quiz, "1"))
        suggestion = learning_suggestion(self.db, self.owner, "Explain algebra")
        self.assertIsNotNone(suggestion)
        self.assertEqual(suggestion["topic"], "Algebra")
        self.assertEqual(suggestion["action"], "practice")
        self.assertEqual(suggestion["evidence"]["missed"], 6)

    def test_learning_data_is_isolated_between_users(self):
        quiz = self.make_quiz()
        record_quiz_attempt(self.db, self.owner, quiz, self.answers(quiz, "0"))
        self.assertEqual(readiness_payload(self.db, self.other)["evidence_used"]["answered_questions"], 0)
        self.assertIsNone(learning_suggestion(self.db, self.other))


if __name__ == "__main__":
    unittest.main()
