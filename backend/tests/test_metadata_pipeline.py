import json
import os
import sys
import unittest
from unittest.mock import patch

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import models  # noqa: E402
from routers import ingest  # noqa: E402


class CatalogueQuery:
    def __init__(self, course):
        self.course = course

    def filter(self, *_conditions):
        return self

    def first(self):
        return self.course


class CatalogueDb:
    def __init__(self, course=None):
        self.course = course
        self.added = []

    def query(self, _model):
        return CatalogueQuery(self.course)

    def add(self, value):
        self.added.append(value)


def structured_response(**overrides):
    value = {
        "title": "CSC301 Lecture Notes",
        "document_type": "lecture_note",
        "course_code": "CSC301",
        "course_title": "Algorithms",
        "academic_session": "2024/2025",
        "semester": "First",
        "instructor_or_author": ["Ada Lovelace"],
        "year": 2025,
        "department": "Computer Science",
        "faculty": None,
        "college": None,
        "institution": None,
        "exam_type": "unknown",
        "topics": ["graph traversal"],
        "confidence_score": 0.91,
        "evidence": {
            "course_code": {
                "value": "CSC301",
                "status": "strong_evidence",
                "source": "document_text",
                "confidence": 0.9,
                "evidence": "CSC 301",
                "page_number": 2,
                "requires_confirmation": False,
            }
        },
    }
    value.update(overrides)
    return json.dumps(value)


class MetadataPipelineTests(unittest.TestCase):
    def test_valid_structured_ai_metadata_is_accepted(self):
        with patch.object(ingest, "generate_ai_response", return_value=structured_response()):
            metadata = ingest.extract_metadata(
                "lecture.pdf",
                "CSC 301 lecture notes on graph traversal",
                ["cover", "CSC 301 lecture notes on graph traversal"],
            )

        self.assertEqual(metadata["course_code"], "CSC301")
        self.assertEqual(metadata["metadata_evidence"]["course_code"]["page_number"], 2)
        self.assertIn("metadata_proposal", metadata)

    def test_malformed_ai_metadata_is_rejected_without_arbitrary_fields(self):
        malformed = json.dumps({"document_type": "lecture_note", "unexpected_reasoning": "private chain of thought"})
        with patch.object(ingest, "generate_ai_response", return_value=malformed):
            metadata = ingest.extract_metadata("CSC301-lecture.pdf", "CSC 301 lecture notes on algorithms")

        self.assertNotIn("unexpected_reasoning", metadata)
        self.assertEqual(metadata["course_code"], "CSC301")

    def test_deterministic_metadata_wins_and_conflict_is_reviewable(self):
        ai = structured_response(course_code="MKT999", document_type="assignment")
        with patch.object(ingest, "generate_ai_response", return_value=ai):
            metadata = ingest.extract_metadata(
                "CSC301-lecture.pdf",
                "CSC 301 Lecture Note\nAlgorithms and complexity analysis.",
            )

        self.assertEqual(metadata["course_code"], "CSC301")
        self.assertEqual(metadata["document_type"], "lecture_note")
        self.assertEqual(metadata["metadata_evidence"]["course_code"]["status"], "conflict")
        self.assertTrue(metadata["needs_review"])

    def test_catalogue_derivation_does_not_create_unknown_courses(self):
        metadata = ingest.normalize_metadata_fields({
            "document_type": "lecture_note",
            "course_code": "NEW999",
            "course_title": "Uncatalogued material",
        })
        db = CatalogueDb()

        self.assertIsNone(ingest.derive_course_catalogue(db, metadata))
        self.assertEqual(metadata["course_catalogue_status"], "unmatched")
        self.assertEqual(db.added, [])

    def test_catalogue_values_override_proposals_without_fabricating_hierarchy(self):
        course = models.Course(id=12, code="CSC301", name="Algorithms", department="Computer Science")
        metadata = ingest.normalize_metadata_fields({
            "document_type": "lecture_note",
            "document_title": "CSC301 Lecture Note",
            "course_code": "CSC301",
            "course_title": "Wrong title",
            "faculty": "",
            "college": "",
        })
        ingest._attach_metadata_review(
            metadata,
            heuristic=metadata,
            ai_metadata={},
            filename="lecture.pdf",
            text="CSC 301 lecture note",
            page_texts=["CSC 301 lecture note"],
            extraction_method="embedded_text",
        )

        resolved = ingest.derive_course_catalogue(CatalogueDb(course), metadata)

        self.assertIs(resolved, course)
        self.assertEqual(metadata["course_catalogue_status"], "confirmed")
        self.assertEqual(metadata["course_title"], "Algorithms")
        self.assertEqual(metadata["metadata_evidence"]["course_code"]["status"], "catalogue_confirmed")
        self.assertEqual(metadata["faculty"], "")
        self.assertEqual(metadata["college"], "")

    def test_optional_irrelevant_fields_do_not_block_ready_metadata(self):
        metadata = ingest.normalize_metadata_fields({
            "document_type": "lecture_note",
            "document_title": "CSC301 Lecture Notes",
            "course_code": "CSC301",
            "course_title": "Algorithms",
        })
        metadata = ingest._attach_metadata_review(
            metadata,
            heuristic=metadata,
            ai_metadata={},
            filename="lecture.pdf",
            text="CSC 301 Lecture Notes",
            page_texts=["CSC 301 Lecture Notes"],
            extraction_method="embedded_text",
        )

        self.assertEqual(ingest.metadata_required_errors(metadata), [])
        self.assertEqual(metadata["metadata_evidence"]["faculty"]["status"], "optional")
        self.assertFalse(metadata["needs_review"])

    def test_user_corrections_preserve_original_and_final_values(self):
        metadata = ingest.normalize_metadata_fields({
            "document_type": "lecture_note",
            "document_title": "CSC301 Lecture Notes",
            "course_code": "CSC301",
            "course_title": "Algorithms",
        })
        metadata = ingest._attach_metadata_review(
            metadata,
            heuristic=metadata,
            ai_metadata={},
            filename="lecture.pdf",
            text="CSC 301 Lecture Notes",
            page_texts=["CSC 301 Lecture Notes"],
            extraction_method="embedded_text",
        )
        metadata["course_title"] = "Advanced Algorithms"
        ingest.record_metadata_corrections(metadata)

        correction = metadata["metadata_corrections"]["course_title"]
        self.assertEqual(correction["original"], "Algorithms")
        self.assertEqual(correction["final"], "Advanced Algorithms")
        self.assertTrue(correction["corrected"])
        self.assertEqual(correction["source"], "user_confirmed")

    def test_page_evidence_is_not_invented_when_boundaries_are_unavailable(self):
        metadata = ingest.extract_metadata("notes.docx", "CSC 301 lecture notes on algorithms", None)
        self.assertIsNone(metadata["metadata_evidence"]["course_code"]["page_number"])


if __name__ == "__main__":
    unittest.main()
