import os
import sys
import unittest
from unittest.mock import MagicMock, patch
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from learning_intelligence import ksa_learning_preferences, learner_prompt_preferences  # noqa: E402
import models  # noqa: E402
from maxe_context import assemble_maxe_context, normalize_maxe_mode  # noqa: E402
from maxe_provider import MaxeProvider  # noqa: E402
from resource_index import citation_payload  # noqa: E402
from routers.rag import AskQuestionRequest, _knowledge_gap_response  # noqa: E402


class MaxeTests(unittest.TestCase):
    def test_explicit_profile_preferences_override_onboarding_and_are_owner_scoped(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = SimpleNamespace(
            explicit_preferences={"explanation_preference": {"value": "concise"},
                                  "preferred_learning_format": {"value": "short_answer"}},
            inferred_preferences={"explanation_preference": {"value": "exam_style"}},
        )
        user = SimpleNamespace(id=17, onboarding_preferences={"explanation_preference": "examples_first"})
        preferences = learner_prompt_preferences(db, user)
        self.assertEqual(preferences["explanation_style"], "concise")
        self.assertEqual(preferences["preferred_learning_format"], "short_answer")
        db.query.assert_called_once_with(models.LearningProfile)
        predicate = db.query.return_value.filter.call_args.args[0]
        self.assertEqual(predicate.right.value, user.id)
        db.add.assert_not_called()
        db.commit.assert_not_called()
        self.assertIn("explanation_style=concise", assemble_maxe_context(learner_preferences=preferences).prompt_block())

    def test_missing_or_malformed_profile_keeps_onboarding_without_inferred_overrides(self):
        db = MagicMock()
        user = SimpleNamespace(id=18, onboarding_preferences={"explanation_preference": "step_by_step"})
        for row in (None, SimpleNamespace(explicit_preferences={"explanation_preference": "sensitive sentinel"})):
            db.query.return_value.filter.return_value.first.return_value = row
            self.assertEqual(learner_prompt_preferences(db, user), {"explanation_style": "step_by_step"})

    def test_source_mode_is_the_safe_default_and_beyond_mode_is_explicit(self):
        self.assertEqual(normalize_maxe_mode(None), "source")
        self.assertEqual(normalize_maxe_mode("beyond-materials"), "beyond_materials")
        request = AskQuestionRequest(question="Explain this")
        self.assertEqual(request.mode, "source")
        beyond = AskQuestionRequest(question="Explain this", knowledge_mode="beyond_materials")
        self.assertEqual(beyond.mode, "beyond_materials")

    def test_context_is_bounded_and_does_not_return_selected_text(self):
        context = assemble_maxe_context(
            mode="source",
            workspace_name="Kora Sales Academy",
            active_resource={"resource_type": "lecture_note", "resource_id": 8, "title": "Week 4"},
            active_resource_text="active source",
            selected_text="selected text " * 1000,
            selected_text_source="Week 4",
            recent_context="recent conversation",
        )
        self.assertLessEqual(len(context.selected_text), 4000)
        self.assertTrue(context.public_payload()["selected_text_used"])
        self.assertNotIn("selected text", str(context.public_payload()))
        self.assertIn("Kora Sales Academy", context.prompt_block())

    def test_ksa_preferences_are_available_to_the_internal_prompt_context(self):
        class User:
            onboarding_preferences = {
                "learning_goals": ["prospecting"],
                "help_topics": ["objection handling"],
                "explanation_preference": "examples_first",
            }

        preferences = ksa_learning_preferences(User())
        context = assemble_maxe_context(learner_preferences=preferences)

        self.assertIn("goal=prospecting", context.prompt_block())
        self.assertIn("help_topics=objection handling", context.prompt_block())
        self.assertIn("explanation_style=examples_first", context.prompt_block())

    def test_provider_adapter_delegates_to_existing_fallback_chain(self):
        with patch("ai_clients.generate_ai_response", return_value="grounded answer") as generate:
            answer = MaxeProvider().generate("prompt")
        self.assertEqual(answer, "grounded answer")
        generate.assert_called_once_with("prompt", temperature=0.3)

    def test_knowledge_gap_has_no_citations_or_sources(self):
        response = _knowledge_gap_response("What is missing?", "source", {"mode": "source"})
        self.assertTrue(response["knowledge_gap"])
        self.assertEqual(response["sources"], [])
        self.assertEqual(response["source_citations"], [])

    def test_citations_include_only_stored_coordinates_and_workspace_target(self):
        audio = citation_payload(
            resource_type="audio",
            resource_id=12,
            chunk_id=44,
            metadata={"document_title": "Week 4 recording"},
            timestamp_start=842.0,
            timestamp_end=906.0,
        )
        self.assertEqual(audio["label"], "Week 4 recording · 14:02")
        self.assertEqual(audio["target"]["start_time"], 842.0)
        self.assertEqual(audio["evidence_status"], "retrieved_source")
        self.assertNotIn("chunk_text", audio)

        slide = citation_payload(
            resource_type="lecture_note",
            resource_id=4,
            chunk_id=9,
            metadata={"document_title": "Week 4 slides"},
            slide_from=8,
            slide_to=8,
        )
        self.assertEqual(slide["label"], "Week 4 slides · Slide 8")
        self.assertEqual(slide["target"]["slide_from"], 8)


if __name__ == "__main__":
    unittest.main()
