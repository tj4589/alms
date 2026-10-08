import io
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import models  # noqa: E402
from routers import ingest  # noqa: E402
from storage_safety import defer_binary_column, mark_abandoned_processing  # noqa: E402


def upload(filename: str, content: bytes, mime: str | None = None) -> UploadFile:
    headers = {"content-type": mime} if mime is not None else None
    return UploadFile(filename=filename, file=io.BytesIO(content), headers=headers)


def successful_extraction() -> dict:
    return {
        "text": "Enough text for the bounded upload test.",
        "raw_extracted_text": "Enough text for the bounded upload test.",
        "cleaned_text": "Enough text for the bounded upload test.",
        "method": "embedded_text",
        "page_count": 1,
        "text_char_count": 40,
        "cleaned_text_char_count": 40,
        "ocr_used": False,
        "extraction_confidence": 0.9,
        "failure_reason": None,
        "warnings": [],
    }


class UploadValidationTests(unittest.TestCase):
    def test_exact_size_boundary_is_accepted_and_read_in_bounded_steps(self):
        content = b"%PDF-" + b"x" * 7
        with (
            patch.object(ingest, "MAX_UPLOAD_BYTES", len(content)),
            patch.object(ingest, "_extract_pdf_content", return_value=successful_extraction()),
        ):
            result = ingest.extract_pdf_text(upload("notes.pdf", content, "application/pdf"))

        self.assertEqual(result["file_bytes"], content)
        self.assertEqual(result["file_mime"], "application/pdf")

    def test_oversized_upload_is_rejected_without_reading_the_whole_payload(self):
        class TrackingFile(io.BytesIO):
            def __init__(self, value):
                super().__init__(value)
                self.read_sizes = []

            def read(self, size=-1):
                self.read_sizes.append(size)
                return super().read(size)

        tracked = TrackingFile(b"%PDF-123456")
        with patch.object(ingest, "MAX_UPLOAD_BYTES", 5):
            with self.assertRaises(HTTPException) as raised:
                ingest.extract_pdf_text(UploadFile(filename="notes.pdf", file=tracked, headers={"content-type": "application/pdf"}))

        self.assertEqual(raised.exception.status_code, 413)
        self.assertLessEqual(max(tracked.read_sizes), 5)
        self.assertNotIn(-1, tracked.read_sizes)

    def test_extension_and_signature_mismatch_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            ingest.extract_pdf_text(upload("notes.pdf", b"\x89PNG\r\n\x1a\n", "application/pdf"))

        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("valid supported file", raised.exception.detail)

    def test_explicit_mime_mismatch_is_rejected_even_when_signature_is_valid(self):
        with self.assertRaises(HTTPException) as raised:
            ingest.extract_pdf_text(upload("notes.pdf", b"%PDF-1.7", "image/png"))

        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("does not match", raised.exception.detail)

    def test_audio_signature_validation_remains_server_side(self):
        with self.assertRaises(HTTPException) as raised:
            ingest.extract_pdf_text(upload("recording.mp3", b"not-an-audio-file", "audio/mpeg"))

        self.assertEqual(raised.exception.status_code, 400)

    def test_video_webm_enters_the_video_pipeline(self):
        with patch.object(ingest, "extract_audio_for_transcription", side_effect=ingest.VideoProcessingError("ffmpeg unavailable")):
            result = ingest.extract_pdf_text(upload("recording.webm", b"\x1a\x45\xdf\xa3" + b"x" * 32, "video/webm"))

        self.assertEqual(result["resource_type"], "video")
        self.assertEqual(result["audio_extraction_status"], "failed")
        self.assertEqual(result["failure_reason"], "video_audio_extraction_failed")


class StorageCleanupTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        models.Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

    def tearDown(self):
        self.db.close()
        models.Base.metadata.drop_all(self.engine)

    def test_abandoned_processing_marks_private_audio_failed_and_keeps_bytes(self):
        now = datetime.now(timezone.utc)
        stale = models.LectureNote(
            uploaded_by=10,
            title="stale audio",
            file_data=b"retain-this-audio",
            visibility="private",
            created_at=now - timedelta(hours=2),
            metadata_json={"document_type": "audio", "processing_status": "processing"},
        )
        active = models.LectureNote(
            uploaded_by=11,
            title="active audio",
            file_data=b"active-audio",
            visibility="private",
            created_at=now,
            metadata_json={"document_type": "audio", "processing_status": "processing"},
        )
        retained = models.LectureNote(
            uploaded_by=12,
            title="approved audio",
            file_data=b"approved-audio",
            visibility="space_shared",
            created_at=now - timedelta(hours=2),
            metadata_json={"document_type": "audio", "processing_status": "processing"},
        )
        self.db.add_all([stale, active, retained])
        self.db.commit()

        result = mark_abandoned_processing(self.db, now=now, max_age_seconds=3600, batch_size=10)
        self.db.expire_all()

        self.assertEqual(result["marked_failed"], 1)
        self.assertEqual(self.db.get(models.LectureNote, stale.id).file_data, b"retain-this-audio")
        self.assertEqual(self.db.get(models.LectureNote, stale.id).metadata_json["processing_status"], "failed")
        self.assertEqual(self.db.get(models.LectureNote, active.id).metadata_json["processing_status"], "processing")
        self.assertEqual(self.db.get(models.LectureNote, retained.id).metadata_json["processing_status"], "processing")
        self.assertEqual(self.db.get(models.LectureNote, retained.id).file_data, b"approved-audio")


class MetadataQueryTests(unittest.TestCase):
    def test_metadata_query_does_not_select_binary_column(self):
        engine = create_engine("sqlite:///:memory:")
        models.Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine)
        db = Session()
        db.add(models.LectureNote(title="metadata only", file_data=b"sentinel-binary"))
        db.commit()
        statements = []

        @event.listens_for(engine, "before_cursor_execute")
        def capture(_conn, _cursor, statement, _parameters, _context, _executemany):
            if "FROM lecture_notes" in statement:
                statements.append(statement.lower())

        row = defer_binary_column(db.query(models.LectureNote), models.LectureNote).first()
        self.assertIsNotNone(row)
        self.assertNotIn("file_data", row.__dict__)
        self.assertTrue(statements)
        self.assertNotIn("lecture_notes.file_data", statements[-1])
        db.close()
        models.Base.metadata.drop_all(engine)


if __name__ == "__main__":
    unittest.main()
