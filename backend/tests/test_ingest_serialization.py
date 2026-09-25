import io
import json
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import UploadFile
from fastapi.encoders import jsonable_encoder

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import ai_clients  # noqa: E402
import models  # noqa: E402
from routers import ingest  # noqa: E402


TEXT = (
    "CSC 301 Lecture Note\n"
    "This document contains enough readable academic text to be indexed safely. "
    "It covers algorithms, complexity analysis, and examination revision guidance."
)


class DatabaseDouble:
    def __init__(self):
        self.added = []
        self.commits = 0
        self._next_id = 1

    def add(self, value):
        self.added.append(value)
        if getattr(value, "id", None) is None:
            value.id = self._next_id
            self._next_id += 1

    def flush(self):
        return None

    def commit(self):
        self.commits += 1


def successful_extraction(raw_bytes: bytes, method: str) -> dict:
    return {
        "text": TEXT,
        "raw_extracted_text": TEXT,
        "cleaned_text": TEXT,
        "method": method,
        "page_count": 1,
        "text_char_count": len(TEXT),
        "cleaned_text_char_count": len(TEXT),
        "ocr_used": method in {"ocr", "mixed"},
        "extraction_confidence": 0.91,
        "failure_reason": None,
        "indexed_status": "indexed",
        "searchable": True,
        "needs_review": False,
        "warnings": [],
        "file_bytes": raw_bytes,
        "file_name": "study-material.pdf",
        "file_mime": "application/pdf",
        "page_texts": [TEXT],
    }


def failed_extraction(raw_bytes: bytes) -> dict:
    return {
        "text": "",
        "raw_extracted_text": "",
        "cleaned_text": "",
        "method": "failed",
        "page_count": 1,
        "text_char_count": 0,
        "cleaned_text_char_count": 0,
        "ocr_used": True,
        "extraction_confidence": 0.0,
        "failure_reason": "file_too_blurry",
        "indexed_status": "unindexed",
        "searchable": False,
        "needs_review": True,
        "ocr_score": 0.0,
        "ocr_useful_words": 0,
        "warnings": ["The scan could not be read."],
        "file_bytes": raw_bytes,
        "file_name": "unclear-scan.pdf",
        "file_mime": "application/pdf",
        "page_texts": [""],
    }


def metadata_result(**overrides):
    result = {
        "document_type": "lecture_note",
        "document_title": "",
        "course_code": "CSC301",
        "course_title": "Algorithms",
        "instructor_names": [],
        "academic_year": "2024/2025",
        "year": 2025,
        "semester": "First",
        "department": "Computer Science",
        "faculty": "",
        "college": "",
        "exam_type": "unknown",
        "topics_covered": ["algorithms"],
        "confidence_score": 0.9,
    }
    result.update(overrides)
    return result


def upload(filename: str, content: bytes, mime: str = "application/pdf") -> UploadFile:
    return UploadFile(
        filename=filename,
        file=io.BytesIO(content),
        headers={"content-type": mime},
    )


def assert_no_binary(value):
    if isinstance(value, (bytes, bytearray, memoryview)):
        raise AssertionError("binary data leaked into the API response")
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {"file_bytes", "file_data", "page_texts"}:
                raise AssertionError(f"internal field {key!r} leaked into the API response")
            assert_no_binary(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            assert_no_binary(item)


class UploadSerializationTests(unittest.TestCase):
    def analyze(self, filename, extraction):
        db = DatabaseDouble()
        with (
            patch.object(ingest, "extract_pdf_text", return_value=extraction),
            patch.object(ingest, "extract_metadata", return_value=metadata_result()),
            patch.object(ingest, "find_duplicate", return_value=None),
        ):
            return ingest.upload_document(
                file=upload(filename, extraction["file_bytes"]),
                confirm=False,
                confirmed_metadata=None,
                db=db,
                current_user=SimpleNamespace(id=7),
            )

    def assert_json_serializable_analysis(self, response):
        encoded = jsonable_encoder(response)
        json.dumps(encoded)
        assert_no_binary(encoded)
        self.assertNotIn("file_bytes", encoded.get("extraction", {}))
        self.assertNotIn("page_texts", encoded.get("extraction", {}))
        return encoded

    def test_pdf_analysis_response_is_json_serializable(self):
        response = self.analyze("study-material.pdf", successful_extraction(b"%PDF\x00\xff", "embedded_text"))

        self.assertEqual(response["status"], "needs_confirmation")
        self.assert_json_serializable_analysis(response)

    def test_powerpoint_analysis_response_is_json_serializable(self):
        extraction = successful_extraction(b"PK\x03\x04\x00\xff", "pptx_text")
        extraction.update({"file_name": "revision-slides.pptx", "file_mime": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "page_texts": None})

        response = self.analyze("revision-slides.pptx", extraction)

        self.assertEqual(response["status"], "needs_confirmation")
        self.assert_json_serializable_analysis(response)

    def test_file_bytes_are_never_present_in_analysis_response(self):
        response = self.analyze("study-material.pdf", successful_extraction(b"\x00\xffbinary", "embedded_text"))

        self.assert_json_serializable_analysis(response)
        self.assertNotIn("file_bytes", response)
        self.assertNotIn("file_bytes", response["metadata"])

    def test_raw_bytes_remain_available_for_database_storage_after_confirmation(self):
        raw_bytes = b"\x00\xffuploaded-neon-payload"
        db = DatabaseDouble()
        extraction = successful_extraction(raw_bytes, "embedded_text")

        with (
            patch.object(ingest, "extract_pdf_text", return_value=extraction),
            patch.object(ingest, "extract_metadata", return_value=metadata_result()),
            patch.object(ingest, "find_duplicate", return_value=None),
            patch.object(ingest, "match_course", return_value=None),
            patch.object(ingest, "embed_or_fail", return_value=[0.0] * 384),
            patch.object(ingest, "split_into_sections", return_value=[]),
        ):
            response = ingest.upload_document(
                file=upload("study-material.pdf", raw_bytes),
                confirm=True,
                confirmed_metadata=None,
                db=db,
                current_user=SimpleNamespace(id=7),
            )

        note = next(value for value in db.added if isinstance(value, models.LectureNote))
        self.assertEqual(note.file_data, raw_bytes)
        self.assertEqual(note.file_size, len(raw_bytes))
        self.assertEqual(db.commits, 1)
        self.assertEqual(response["status"], "success")
        json.dumps(jsonable_encoder(response))
        assert_no_binary(response)

    def test_manual_metadata_required_response_contains_no_binary_data(self):
        response = self.analyze("unclear-scan.pdf", failed_extraction(b"\x89PNG\x00\xff"))

        self.assertEqual(response["status"], "manual_metadata_required")
        self.assert_json_serializable_analysis(response)

    def test_cohere_fallback_metadata_succeeds_when_deepseek_fails(self):
        class FailingDeepSeek:
            def invoke(self, _prompt):
                raise RuntimeError("DeepSeek unavailable")

        cohere_metadata = json.dumps(
            {
                "document_type": "lecture_note",
                "course_code": "CSC301",
                "course_title": "Algorithms",
                "topics_covered": ["graph traversal"],
                "confidence_score": 0.88,
            }
        )
        with (
            patch.object(ai_clients, "llm", FailingDeepSeek()),
            patch.object(ai_clients, "_cohere_api_key", "test-key"),
            patch.object(ai_clients, "AI_FALLBACK_PROVIDER", "cohere"),
            patch.object(ai_clients, "_cohere_chat", return_value=cohere_metadata),
        ):
            metadata = ingest.extract_metadata(
                "study-material.pdf",
                "CSC 301\nThis academic material covers graph traversal and complexity analysis.",
            )

        self.assertEqual(metadata["document_type"], "lecture_note")
        self.assertEqual(metadata["course_code"], "CSC301")
        self.assertIn("graph traversal", metadata["topics_covered"])


if __name__ == "__main__":
    unittest.main()
