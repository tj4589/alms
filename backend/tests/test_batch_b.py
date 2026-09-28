import os
import sys
import unittest
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from routers import ingest, rag  # noqa: E402


class CandidateQuery:
    def __init__(self, rows, authorized_rows):
        self.rows = list(rows)
        self.authorized_rows = list(authorized_rows)

    def filter(self, *_conditions):
        # The real predicate is built by accessible_material_filter. This
        # double models its important security effect: unauthorized rows are
        # gone before duplicate matching sees them.
        self.rows = list(self.authorized_rows)
        return self

    def limit(self, _limit):
        return self

    def all(self):
        return list(self.rows)

    def first(self):
        return self.rows[0] if self.rows else None


class DuplicateDb:
    def __init__(self, rows, authorized_rows):
        self.rows = rows
        self.authorized_rows = authorized_rows

    def query(self, _model):
        return CandidateQuery(self.rows, self.authorized_rows)


def material(material_id, *, checksum="", text="", owner=1, visibility="private"):
    return SimpleNamespace(
        id=material_id,
        uploaded_by=owner,
        source_checksum=checksum,
        version_of_id=None,
        version_number=1,
        title="Algorithms lecture note",
        file_url="algorithms.pdf",
        content_text=text,
        metadata_json={
            "document_type": "lecture_note",
            "course_code": "CSC301",
            "document_title": "Algorithms lecture note",
            "source_file": "algorithms.pdf",
            "academic_year": "2024/2025",
            "semester": "First",
        },
        visibility=visibility,
    )


class BatchBTests(unittest.TestCase):
    def test_duplicate_matching_cannot_see_an_unauthorized_private_material(self):
        private_match = material(10, checksum="private-checksum", owner=88)
        db = DuplicateDb([private_match], [])

        result = ingest.find_duplicate(
            db,
            {
                "document_type": "lecture_note",
                "course_code": "CSC301",
                "source_checksum": "private-checksum",
                "source_file": "algorithms.pdf",
            },
            SimpleNamespace(id=7, role="student"),
            "same readable text " * 80,
        )

        self.assertIsNone(result)

    def test_checksum_duplicate_is_returned_with_safe_actions(self):
        existing = material(11, checksum="same-checksum", owner=7)
        db = DuplicateDb([existing], [existing])

        result = ingest.find_duplicate(
            db,
            {
                "document_type": "lecture_note",
                "course_code": "CSC301",
                "source_checksum": "same-checksum",
                "source_file": "algorithms.pdf",
            },
            SimpleNamespace(id=7, role="student"),
        )

        self.assertEqual(result["match_type"], "exact_checksum")
        self.assertEqual(result["id"], 11)
        self.assertEqual(result["actions"], ["view", "continue", "newer_version", "cancel"])

    def test_text_similarity_duplicate_is_bounded_and_explained(self):
        original = "Algorithms and complexity analysis cover graph traversal and shortest paths. " * 12
        existing = material(12, text=original, owner=7)
        db = DuplicateDb([existing], [existing])

        result = ingest.find_duplicate(
            db,
            {
                "document_type": "lecture_note",
                "course_code": "CSC301",
                "source_file": "different-name.pdf",
            },
            SimpleNamespace(id=7, role="student"),
            original.replace("shortest paths", "shortest path algorithms"),
        )

        self.assertEqual(result["match_type"], "text_similarity")
        self.assertGreaterEqual(result["similarity"], 0.9)

    def test_version_number_uses_the_existing_logical_chain(self):
        root = material(20, owner=7)
        newer = material(21, owner=7)
        newer.version_of_id = 20
        newer.version_number = 2
        db = DuplicateDb([root, newer], [root, newer])

        self.assertEqual(ingest._next_version_number(db, SimpleNamespace(id=object()), 20), 3)

    def test_chunk_citation_preserves_page_and_section_evidence(self):
        sections = [
            SimpleNamespace(index=0, heading="Graph traversal", body="Breadth first search visits graph nodes.", page_from=2, page_to=2, cut_by="page"),
            SimpleNamespace(index=1, heading="Shortest paths", body="Dijkstra finds shortest paths in weighted graphs.", page_from=3, page_to=3, cut_by="page"),
        ]

        citation = ingest._citation_for_chunk("Dijkstra finds shortest paths in weighted graphs.", sections)

        self.assertEqual(citation["section"], "Shortest paths")
        self.assertEqual(citation["page_from"], 3)
        self.assertEqual(citation["page_to"], 3)

    def test_rag_response_exposes_citation_without_document_content(self):
        response = rag.AskQuestionResponse(
            answer="The answer is grounded in the retrieved section.",
            sources=["CSC301 Algorithms 2024/2025"],
            source_citations=[{
                "source": "CSC301 Algorithms 2024/2025",
                "material_type": "lecture_note",
                "material_id": 4,
                "page_from": 3,
                "page_to": 3,
                "section": "Shortest paths",
                "evidence_status": "retrieved_source",
            }],
        )

        self.assertEqual(response.source_citations[0]["page_from"], 3)
        self.assertNotIn("content_text", response.source_citations[0])

    def test_insufficient_source_response_is_explicit(self):
        response = rag.AskQuestionResponse(
            answer="I couldn't find enough information in your available materials to answer this confidently.",
            sources=[],
            insufficient_sources=True,
        )

        self.assertTrue(response.insufficient_sources)
        self.assertEqual(response.sources, [])


if __name__ == "__main__":
    unittest.main()
