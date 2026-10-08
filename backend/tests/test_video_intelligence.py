import io
import json
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import UploadFile
from fastapi.encoders import jsonable_encoder

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import models  # noqa: E402
from routers import ingest  # noqa: E402
from video_processing import extract_audio_for_transcription  # noqa: E402


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


def video_upload(content=b"xxxxftypisomvideo", mime="video/mp4"):
    return UploadFile(
        filename="lecture.mp4",
        file=io.BytesIO(content),
        headers={"content-type": mime},
    )


def video_extraction(content=b"xxxxftypisomvideo", audio=b"RIFF" + b"\x00" * 4 + b"WAVE" + b"\x00" * 32):
    return {
        "text": "",
        "raw_extracted_text": "",
        "cleaned_text": "",
        "method": "video_audio_pending",
        "page_count": 0,
        "text_char_count": 0,
        "cleaned_text_char_count": 0,
        "ocr_used": False,
        "extraction_confidence": 0.0,
        "failure_reason": None,
        "indexed_status": "processing",
        "processing_status": "uploaded",
        "searchable": False,
        "needs_review": False,
        "warnings": [],
        "resource_type": "video",
        "file_bytes": content,
        "file_name": "lecture.mp4",
        "file_mime": "video/mp4",
        "source_checksum": "video-checksum",
        "transcription_bytes": audio,
        "transcription_file_name": "extracted-audio.wav",
        "transcription_file_mime": "audio/wav",
        "audio_extraction_status": "ready",
    }


def metadata_result():
    return {
        "document_type": "video",
        "document_title": "Lecture recording",
        "course_code": "UNKNOWN",
        "course_title": "",
        "topics_covered": [],
        "instructor_names": [],
        "academic_year": "",
        "year": None,
        "semester": "Unknown",
        "department": "",
        "faculty": "",
        "college": "",
        "exam_type": "unknown",
        "confidence_score": 0.5,
    }


class VideoIntelligenceTests(unittest.TestCase):
    def test_video_extraction_is_bounded_and_uses_no_shell(self):
        wav = b"RIFF" + b"\x00" * 4 + b"WAVE" + b"\x00" * 32

        def fake_run(command, **kwargs):
            self.assertFalse(kwargs.get("shell", False))
            self.assertIn("-t", command)
            self.assertIn("-fs", command)
            Path(command[-1]).write_bytes(wav)
            return SimpleNamespace(returncode=0)

        with patch("video_processing.subprocess.run", side_effect=fake_run):
            extracted = extract_audio_for_transcription(
                b"video-bytes",
                filename="lecture.mp4",
                mime_type="video/mp4",
            )
        self.assertEqual(extracted, wav)

    def test_video_analysis_is_json_safe_and_keeps_derivative_internal(self):
        extraction = video_extraction()
        with (
            patch.object(ingest, "extract_pdf_text", return_value=extraction),
            patch.object(ingest, "find_duplicate", return_value=None),
        ):
            response = ingest.upload_document(
                file=video_upload(extraction["file_bytes"]),
                confirm=False,
                confirmed_metadata=None,
                db=DatabaseDouble(),
                current_user=SimpleNamespace(id=7, active_learning_space_id=None),
            )
        encoded = jsonable_encoder(response)
        json.dumps(encoded)
        self.assertEqual(encoded["status"], "needs_confirmation")
        self.assertEqual(encoded["metadata"]["document_type"], "video")
        self.assertNotIn("file_bytes", encoded)
        self.assertNotIn("transcription_bytes", encoded)
        self.assertNotIn("page_texts", encoded.get("extraction", {}))

    def test_video_confirmation_stores_original_and_indexes_timestamped_transcript(self):
        extraction = video_extraction()
        db = DatabaseDouble()
        with (
            patch.object(ingest, "extract_pdf_text", return_value=extraction),
            patch.object(ingest, "find_duplicate", return_value=None),
            patch.object(ingest, "match_course", return_value=None),
            patch.object(ingest, "transcribe_audio", return_value={
                "provider": "openai",
                "model": "whisper-1",
                "segments": [{"start_time": 12, "end_time": 18, "text": "The lecture explains market segmentation."}],
            }),
            patch.object(ingest, "embed_or_fail", return_value=[0.0] * 384),
        ):
            response = ingest.upload_document(
                file=video_upload(extraction["file_bytes"]),
                confirm=True,
                confirmed_metadata=None,
                db=db,
                current_user=SimpleNamespace(id=7, active_learning_space_id=None),
            )
        note = next(value for value in db.added if isinstance(value, models.LectureNote))
        segment = next(value for value in db.added if isinstance(value, models.AudioTranscriptSegment))
        chunk = next(value for value in db.added if isinstance(value, models.ResourceChunk))
        self.assertEqual(response["status"], "success")
        self.assertEqual(response["document_type"], "video")
        self.assertEqual(note.file_data, extraction["file_bytes"])
        self.assertEqual(note.file_mime, "video/mp4")
        self.assertEqual(note.metadata_json["document_type"], "video")
        self.assertEqual(segment.start_time, 12.0)
        self.assertEqual(segment.end_time, 18.0)
        self.assertEqual(chunk.resource_type, "audio")
        self.assertEqual(chunk.timestamp_start, 12.0)
        self.assertEqual(chunk.timestamp_end, 18.0)
        self.assertEqual(db.commits, 1)

    def test_video_with_no_extracted_audio_retains_original_and_fails_safely(self):
        extraction = video_extraction()
        extraction.pop("transcription_bytes")
        extraction["audio_extraction_status"] = "failed"
        db = DatabaseDouble()
        with (
            patch.object(ingest, "extract_pdf_text", return_value=extraction),
            patch.object(ingest, "find_duplicate", return_value=None),
            patch.object(ingest, "match_course", return_value=None),
            patch.object(ingest, "transcribe_audio") as transcribe,
        ):
            response = ingest.upload_document(
                file=video_upload(extraction["file_bytes"]),
                confirm=True,
                confirmed_metadata=None,
                db=db,
                current_user=SimpleNamespace(id=7, active_learning_space_id=None),
            )
        note = next(value for value in db.added if isinstance(value, models.LectureNote))
        self.assertEqual(response["status"], "audio_failed")
        self.assertEqual(note.file_data, extraction["file_bytes"])
        transcribe.assert_not_called()


if __name__ == "__main__":
    unittest.main()
