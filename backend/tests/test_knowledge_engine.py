import os
import sys
import unittest
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from resource_index import citation_payload, chunk_provenance_fields, classify_workspace_relevance  # noqa: E402


class KnowledgeEngineTests(unittest.TestCase):
    def test_ksa_source_is_marked_compatible_from_explainable_signals(self):
        result = classify_workspace_relevance(
            SimpleNamespace(slug="ksa", name="Kora Sales Academy"),
            {"course_title": "Prospecting and pipeline", "topics_covered": ["discovery calls"]},
            "This lecture covers fintech sales and objection handling.",
        )

        self.assertEqual(result["status"], "compatible")
        self.assertGreaterEqual(result["confidence"], 0.7)
        self.assertIn("prospecting", result["matched_signals"])

    def test_cu_material_warns_inside_ksa_without_rejecting_upload(self):
        result = classify_workspace_relevance(
            SimpleNamespace(slug="ksa", name="Kora Sales Academy"),
            {"course_code": "CSC301", "course_title": "Algorithms", "semester": "First"},
            "Covenant University lecture notes for a computer science exam.",
        )

        self.assertEqual(result["status"], "mismatch")
        self.assertGreaterEqual(result["confidence"], 0.78)
        self.assertIn("Kora Sales Academy", result["message"])

    def test_uncertain_context_remains_uploadable(self):
        result = classify_workspace_relevance(
            SimpleNamespace(slug="ksa", name="Kora Sales Academy"),
            {"document_title": "Week 2 notes"},
            "A short set of notes with no clear organization or course signal.",
        )

        self.assertEqual(result["status"], "uncertain")
        self.assertNotEqual(result["status"], "rejected")

    def test_citation_contains_coordinates_without_chunk_text(self):
        result = citation_payload(
            resource_type="lecture_note",
            resource_id=12,
            chunk_id=44,
            metadata={"document_title": "Algorithms", "source_citation": {"section_index": 2}},
            page_from=4,
            page_to=5,
            section="Graph traversal",
        )

        self.assertEqual(result["resource_id"], 12)
        self.assertEqual(result["page_from"], 4)
        self.assertEqual(result["section"], "Graph traversal")
        self.assertEqual(result["section_index"], 2)
        self.assertNotIn("chunk_text", result)

    def test_powerpoint_coordinates_are_stored_as_slides(self):
        result = chunk_provenance_fields(
            {"source_file": "week-4-slides.pptx", "document_type": "revision_slide"},
            {"page_from": 4, "page_to": 5, "section": "Pipeline"},
        )

        self.assertIsNone(result["page_from"])
        self.assertEqual(result["slide_from"], 4)
        self.assertEqual(result["slide_to"], 5)
        self.assertEqual(result["heading"], "Pipeline")


if __name__ == "__main__":
    unittest.main()
