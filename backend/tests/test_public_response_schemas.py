import json
import os
import sys
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from public_schemas import (  # noqa: E402
    PublicLectureNoteReaderResponse,
    PublicResolvedResourceResponse,
    public_material_metadata,
    public_shared_content_payload,
)
from routers import collaboration, mvp, search  # noqa: E402


class PublicResponseSchemaTests(unittest.TestCase):
    def setUp(self):
        self.sensitive_metadata = {
            "document_title": "Public algorithms notes",
            "document_type": "lecture_note",
            "course_code": "CSC 301",
            "topics_covered": ["graphs"],
            "indexed_status": "indexed",
            "searchable": True,
            "file_data": b"PDF-BYTES",
            "file_bytes": b"PDF-BYTES",
            "storage_reference": "s3://private/key",
            "raw_extracted_text": "private extracted text",
            "cleaned_text": "private cleaned text",
            "page_texts": ["private page"],
            "transcript": {"provider": "secret-provider"},
            "embedding": [0.1, 0.2],
            "source_checksum": "private-checksum",
            "private_metadata": {"owner_email": "owner@example.com"},
        }

    def test_metadata_allowlist_drops_sensitive_and_unknown_nested_values(self):
        public = public_material_metadata(self.sensitive_metadata)

        self.assertEqual(public["document_title"], "Public algorithms notes")
        self.assertEqual(public["topics_covered"], ["graphs"])
        for key in (
            "file_data", "file_bytes", "storage_reference", "raw_extracted_text",
            "cleaned_text", "page_texts", "transcript", "embedding",
            "source_checksum", "private_metadata",
        ):
            self.assertNotIn(key, public)
        json.dumps(public)

    def test_archive_serializers_are_metadata_only(self):
        note = SimpleNamespace(
            id=11,
            course_id=4,
            uploaded_by=77,
            topic="Graphs",
            title="Algorithms notes",
            year=2026,
            semester="First",
            content_text="Private full note text",
            file_url="internal/storage/path",
            file_data=b"PDF-BYTES",
            file_name="algorithms.pdf",
            file_size=10,
            created_at=datetime.now(timezone.utc),
            metadata_json=self.sensitive_metadata,
            visibility="space_shared",
        )
        past_question = SimpleNamespace(
            id=12,
            course_id=4,
            topic_id=None,
            uploaded_by=77,
            year=2026,
            semester="First",
            difficulty="mixed",
            content_text="Private question text",
            file_url="internal/storage/path",
            file_data=b"PDF-BYTES",
            file_name="questions.pdf",
            file_size=10,
            created_at=datetime.now(timezone.utc),
            metadata_json={**self.sensitive_metadata, "document_type": "past_question"},
            visibility="space_shared",
        )

        note_payload = mvp.serialize_lecture_note(note)
        past_payload = mvp.serialize_past_question(past_question)
        for payload in (note_payload, past_payload):
            encoded = json.dumps(payload)
            for forbidden in ("file_data", "file_bytes", "file_url", "embedding", "uploaded_by"):
                self.assertNotIn(forbidden, encoded)
            self.assertNotIn("private-checksum", encoded)
        # Past-question rows are the existing authorized Workspace reading
        # contract; the content is present without storage or hidden fields.
        self.assertEqual(past_payload["content_text"], "Private question text")
        self.assertNotIn("content_text", note_payload)

    def test_search_and_collaboration_payloads_use_the_same_allowlist(self):
        row = SimpleNamespace(
            id=15,
            course_id=4,
            year=2026,
            semester="First",
            difficulty="mixed",
            content_text="A bounded search excerpt.",
            title="Algorithms notes",
            topic="Graphs",
            visibility="space_shared",
            metadata_json={
                **self.sensitive_metadata,
                "content_preview": {"scenario": "A bounded preview shown in search."},
            },
        )
        search_payloads = [search._pq(row), search._ln(row)]
        collaboration_metadata = collaboration._safe_metadata(row)
        for payload in [*search_payloads, {"metadata": collaboration_metadata}]:
            encoded = json.dumps(payload)
            self.assertNotIn("file_data", encoded)
            self.assertNotIn("storage_reference", encoded)
            self.assertNotIn("private-checksum", encoded)
            self.assertNotIn("private_metadata", encoded)
        self.assertIn("A bounded preview", search_payloads[0]["snippets"][0])

    def test_reader_and_selected_content_keep_only_explicit_authorized_content(self):
        reader = PublicLectureNoteReaderResponse(
            id=21,
            title="Reader note",
            visibility="space_shared",
            sections=[],
            content_text="This is intentionally authorized reader content.",
            metadata_json=public_material_metadata(self.sensitive_metadata),
        ).model_dump(mode="json")
        self.assertIn("authorized reader content", reader["content_text"])
        self.assertNotIn("file_data", json.dumps(reader))
        self.assertNotIn("file_url", json.dumps(reader))

        selected = public_shared_content_payload({
            "title": "Selected answer",
            "answer": "A source-grounded answer.",
            "token": "must-not-leak",
            "storage_reference": "must-not-leak",
            "citations": [{
                "source": "Algorithms notes",
                "resource_type": "lecture_note",
                "resource_id": 21,
                "page_from": 3,
                "storage_reference": "must-not-leak",
            }],
        })
        self.assertEqual(selected["answer"], "A source-grounded answer.")
        self.assertNotIn("must-not-leak", json.dumps(selected))
        self.assertEqual(selected["citations"][0]["page_from"], 3)

    def test_resource_share_response_has_no_storage_or_content_fields(self):
        response = PublicResolvedResourceResponse(
            content_type="resource",
            material_type="lecture_note",
            material_id=31,
            title="Shared note",
            visibility="space_shared",
            metadata=public_material_metadata(self.sensitive_metadata),
            verified_citations=[],
        ).model_dump(mode="json")
        encoded = json.dumps(response)
        self.assertNotIn("PDF-BYTES", encoded)
        self.assertNotIn("internal/storage/path", encoded)
        self.assertNotIn("private extracted text", encoded)
        self.assertNotIn("embedding", encoded)


if __name__ == "__main__":
    unittest.main()
