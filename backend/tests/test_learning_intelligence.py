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
        algebra_text = (
            "Linear equations use a variable to represent an unknown quantity. "
            "Substitution replaces a variable with a known expression. "
            "A balanced equation keeps both sides equal. "
            "An equation can be solved by isolating the unknown variable. "
            "A linear relationship changes at a constant rate. "
            "The coefficient multiplies the variable in an equation. "
            "A constant has a fixed value throughout the expression. "
            "Equivalent equations have the same solution set. "
            "Graphing a line displays its relationship between variables. "
            "The intercept is where a graph crosses an axis."
        )
        geometry_text = (
            "A triangle has three sides and three angles. "
            "The area of a triangle is one half of its base times its height. "
            "A right angle measures ninety degrees. "
            "Parallel lines never meet in the same plane. "
            "A circle is defined by its centre and radius."
        )
        note = models.LectureNote(
            id=1,
            uploaded_by=1,
            course_id=1,
            title="Algebra notes",
            content_text=algebra_text,
            metadata_json={"document_title": "Algebra notes", "topics_covered": ["Algebra"]},
            visibility="private",
        )
        geometry_note = models.LectureNote(
            id=2,
            uploaded_by=1,
            course_id=1,
            title="Geometry notes",
            content_text=geometry_text,
            metadata_json={"document_title": "Geometry notes", "topics_covered": ["Geometry"]},
            visibility="private",
        )
        chunk = models.ResourceChunk(
            id=1,
            resource_type="lecture_note",
            resource_id=1,
            chunk_index=0,
            chunk_text=algebra_text,
            topic="Algebra",
            page_from=2,
            page_to=2,
            metadata_json={"document_title": "Algebra notes"},
        )
        geometry_chunk = models.ResourceChunk(
            id=2,
            resource_type="lecture_note",
            resource_id=2,
            chunk_index=0,
            chunk_text=geometry_text,
            topic="Geometry",
            page_from=3,
            page_to=3,
            metadata_json={"document_title": "Geometry notes"},
        )
        self.db.add_all([self.owner, self.other, course, note, geometry_note, chunk, geometry_chunk])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def make_quiz(self, user=None, topic="Algebra", question_type="multiple_choice", count=3, resource_id=1):
        return create_grounded_quiz(
            self.db,
            user or self.owner,
            source_scope="resource",
            resource_type="lecture_note",
            resource_id=resource_id,
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

    def test_ksa_help_topics_focus_an_unscoped_quiz_when_authorized_material_matches(self):
        self.owner.onboarding_preferences = {"help_topics": ["Geometry"]}
        self.db.commit()

        quiz = create_grounded_quiz(
            self.db,
            self.owner,
            source_scope="workspace",
            resource_type=None,
            resource_id=None,
            course_id=1,
            topic=None,
            count=1,
            difficulty="mixed",
            question_type="multiple_choice",
        )

        self.assertEqual(quiz.topic, "Geometry")
        self.assertEqual(self.questions(quiz)[0].citation_json["resource_id"], 2)

    def test_short_answer_uses_reliable_concepts_and_preserves_review_model_answer(self):
        quiz = self.make_quiz(question_type="short_answer", count=1)
        question = self.questions(quiz)[0]
        self.assertGreaterEqual(len(question.grading_keywords), 2)
        attempt = record_quiz_attempt(self.db, self.owner, quiz, [{"question_id": question.id, "answer": question.correct_answer}])
        self.assertEqual(attempt.score, 1)
        self.assertEqual(attempt.graded_questions, 1)
        self.assertEqual(attempt.review_json[0]["status"], "correct")
        self.assertEqual(attempt.review_json[0]["model_answer"], question.correct_answer)

    def test_three_correct_answers_do_not_produce_readiness(self):
        quiz = self.make_quiz(count=3)
        record_quiz_attempt(self.db, self.owner, quiz, self.answers(quiz))
        payload = readiness_payload(self.db, self.owner)
        self.assertFalse(payload["available"])
        self.assertIsNone(payload["score"])
        self.assertEqual(payload["evidence_used"]["answered_questions"], 3)
        self.assertIn("7 more questions", payload["recommended_next_action"])

    def test_ten_answers_from_one_quiz_do_not_produce_readiness(self):
        quiz = self.make_quiz(count=10)
        record_quiz_attempt(self.db, self.owner, quiz, self.answers(quiz))
        payload = readiness_payload(self.db, self.owner)
        self.assertFalse(payload["available"])
        self.assertEqual(payload["evidence_used"]["answered_questions"], 10)
        self.assertEqual(payload["evidence_used"]["attempts"], 1)
        self.assertIn("another quiz attempt", payload["recommended_next_action"])

    def test_ten_answers_on_one_topic_do_not_produce_overall_readiness(self):
        quiz = self.make_quiz(count=5)
        record_quiz_attempt(self.db, self.owner, quiz, self.answers(quiz))
        record_quiz_attempt(self.db, self.owner, quiz, self.answers(quiz, "1"))
        payload = readiness_payload(self.db, self.owner)
        self.assertFalse(payload["available"])
        self.assertEqual(payload["evidence_used"]["attempts"], 2)
        self.assertIn("not enough topic coverage", payload["recommended_next_action"])

    def test_ten_answers_across_two_quizzes_and_topics_produce_readiness(self):
        algebra_quiz = self.make_quiz(count=5)
        geometry_quiz = self.make_quiz(topic="Geometry", count=5, resource_id=2)
        record_quiz_attempt(self.db, self.owner, algebra_quiz, self.answers(algebra_quiz))
        record_quiz_attempt(self.db, self.owner, geometry_quiz, self.answers(geometry_quiz, "1"))
        payload = readiness_payload(self.db, self.owner)
        self.assertTrue(payload["available"])
        self.assertEqual(payload["score"], 50)
        self.assertEqual(payload["formula"], "correct graded answers ÷ total graded answers × 100")
        self.assertEqual(payload["thresholds"]["minimum_answers_for_readiness"], 10)
        self.assertEqual(payload["thresholds"]["minimum_attempts_for_readiness"], 2)
        self.assertEqual(set(payload["assessed_topics"]), {"Algebra", "Geometry"})

    def test_topic_with_fewer_than_four_answers_has_no_percentage(self):
        quiz = self.make_quiz(count=3)
        record_quiz_attempt(self.db, self.owner, quiz, self.answers(quiz))
        topic = readiness_payload(self.db, self.owner)["topics"][0]
        self.assertIsNone(topic["score"])
        self.assertEqual(topic["classification"], "insufficient_evidence")
        self.assertEqual(topic["progress_message"], "3 of 4 answers collected for Algebra.")

    def test_insufficient_evidence_shows_progress_toward_threshold(self):
        quiz = self.make_quiz(count=4)
        record_quiz_attempt(self.db, self.owner, quiz, self.answers(quiz))
        payload = readiness_payload(self.db, self.owner)
        self.assertEqual(payload["recommended_next_action"], "Readiness is still gathering evidence. Complete 6 more questions across another quiz.")

    def test_ambiguous_short_answers_do_not_affect_readiness(self):
        quiz = self.make_quiz(question_type="short_answer", count=1)
        question = self.questions(quiz)[0]
        attempt = record_quiz_attempt(self.db, self.owner, quiz, [{"question_id": question.id, "answer": "This is about the topic."}])
        self.assertEqual(attempt.review_json[0]["status"], "needs_review")
        self.assertIsNone(attempt.review_json[0]["is_correct"])
        self.assertEqual(attempt.graded_questions, 0)
        self.assertIsNone(attempt.percentage)
        self.assertEqual(self.db.query(models.LearningEvidence).count(), 0)

    def test_retakes_preserve_immutable_history_and_add_valid_evidence(self):
        quiz = self.make_quiz(count=5)
        first = record_quiz_attempt(self.db, self.owner, quiz, self.answers(quiz))
        second = record_quiz_attempt(self.db, self.owner, quiz, self.answers(quiz, "1"))
        self.assertNotEqual(first.id, second.id)
        self.assertEqual(first.score, 5)
        self.assertEqual(second.score, 0)
        self.assertEqual(self.db.query(models.LearningQuizAttempt).filter_by(quiz_id=quiz.id).count(), 2)
        self.assertEqual(self.db.query(models.LearningEvidence).filter_by(user_id=1).count(), 10)
        self.assertEqual(len(second.review_json), 5)
        self.assertIn("citation", second.review_json[0])

    def test_strong_topic_requires_four_observed_answers(self):
        quiz = self.make_quiz(count=4)
        record_quiz_attempt(self.db, self.owner, quiz, self.answers(quiz))
        payload = readiness_payload(self.db, self.owner)
        topic = next(item for item in payload["topics"] if item["topic"] == "Algebra")
        self.assertEqual(topic["classification"], "strong")
        self.assertEqual(topic["score"], 100)
        self.assertFalse(payload["available"])

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
        record_quiz_attempt(self.db, self.owner, quiz, self.answers(quiz))
        self.assertEqual(readiness_payload(self.db, self.other)["evidence_used"]["answered_questions"], 0)
        self.assertIsNone(learning_suggestion(self.db, self.other))


if __name__ == "__main__":
    unittest.main()
