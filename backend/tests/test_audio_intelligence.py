import io
import json
import os
import socket
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi import HTTPException

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import models  # noqa: E402
import ai_clients  # noqa: E402
from ai_clients import AIProviderError  # noqa: E402
from resource_index import citation_payload  # noqa: E402
from routers import ingest, mvp  # noqa: E402


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


def audio_upload(filename="seminar.mp3", content=b"ID3\x04\x00\x00exam-mind-audio", mime="audio/mpeg"):
    return UploadFile(filename=filename, file=io.BytesIO(content), headers={"content-type": mime})


def audio_extraction(content=b"ID3\x04\x00\x00exam-mind-audio"):
    return {
        "text": "",
        "raw_extracted_text": "",
        "cleaned_text": "",
        "method": "audio_pending",
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
        "resource_type": "audio",
        "file_bytes": content,
        "source_checksum": "audio-checksum",
        "file_name": "seminar.mp3",
        "file_mime": "audio/mpeg",
        "page_texts": None,
    }


def metadata_result():
    return {
        "document_type": "audio",
        "document_title": "Seminar recording",
        "course_code": "UNKNOWN",
        "course_title": "",
        "instructor_names": [],
        "academic_year": "",
        "year": None,
        "semester": "Unknown",
        "department": "",
        "faculty": "",
        "college": "",
        "exam_type": "unknown",
        "topics_covered": [],
        "confidence_score": 0.5,
    }


class AudioIntelligenceTests(unittest.TestCase):
    def upload_document(self, *, confirm=False, db=None, transcribe=None, embed=None):
        content = b"ID3\x04\x00\x00exam-mind-audio"
        db = db or DatabaseDouble()
        with (
            patch.object(ingest, "extract_pdf_text", return_value=audio_extraction(content)),
            patch.object(ingest, "extract_metadata", return_value=metadata_result()),
            patch.object(ingest, "find_duplicate", return_value=None),
            patch.object(ingest, "transcribe_audio", side_effect=transcribe) if transcribe is not None else patch.object(ingest, "transcribe_audio", return_value={"provider": "openai", "model": "whisper-1", "segments": [{"start_time": 2.0, "end_time": 5.0, "text": "Graph traversal"}]}),
            patch.object(ingest, "embed_or_fail", side_effect=embed) if embed is not None else patch.object(ingest, "embed_or_fail", return_value=[0.0] * 384),
        ):
            response = ingest.upload_document(
                file=audio_upload(),
                confirm=confirm,
                confirmed_metadata=None,
                db=db,
                current_user=SimpleNamespace(id=7, active_learning_space_id=None),
            )
        return response, db

    def test_audio_analysis_response_is_json_serializable_and_has_no_binary(self):
        response, _ = self.upload_document()
        encoded = jsonable_encoder(response)
        json.dumps(encoded)
        self.assertEqual(encoded["status"], "needs_confirmation")
        self.assertNotIn("file_bytes", encoded)
        self.assertNotIn("file_bytes", encoded["extraction"])
        self.assertNotIn("page_texts", encoded["extraction"])

    def test_audio_confirmation_keeps_raw_bytes_and_timestamped_chunks(self):
        response, db = self.upload_document(confirm=True)
        note = next(value for value in db.added if isinstance(value, models.LectureNote))
        segments = [value for value in db.added if isinstance(value, models.AudioTranscriptSegment)]
        chunks = [value for value in db.added if isinstance(value, models.ResourceChunk)]

        self.assertEqual(response["status"], "success")
        self.assertEqual(note.file_data, b"ID3\x04\x00\x00exam-mind-audio")
        self.assertEqual(segments[0].start_time, 2.0)
        self.assertEqual(segments[0].end_time, 5.0)
        self.assertEqual(chunks[0].resource_type, "audio")
        self.assertEqual(chunks[0].timestamp_start, 2.0)
        self.assertEqual(chunks[0].timestamp_end, 5.0)
        self.assertEqual(db.commits, 1)
        public_note = mvp.serialize_lecture_note(note)
        self.assertNotIn("storage_reference", public_note["metadata_json"])
        self.assertNotIn("transcript", public_note["metadata_json"])
        self.assertNotIn("complete_transcript", public_note["metadata_json"])
        self.assertNotIn("file_bytes", jsonable_encoder(public_note))
        json.dumps(jsonable_encoder(response))

    def test_provider_failure_saves_original_audio_without_false_success(self):
        response, db = self.upload_document(confirm=True, transcribe=AIProviderError("provider unavailable"))
        note = next(value for value in db.added if isinstance(value, models.LectureNote))
        chunks = [value for value in db.added if isinstance(value, models.ResourceChunk)]

        self.assertEqual(response["status"], "audio_failed")
        self.assertEqual(response["searchable"], False)
        self.assertEqual(note.file_data, b"ID3\x04\x00\x00exam-mind-audio")
        self.assertEqual(chunks, [])
        self.assertNotIn("file_data", jsonable_encoder(response))

    def test_embedding_failure_preserves_transcript_and_returns_warning(self):
        response, db = self.upload_document(confirm=True, embed=RuntimeError("embedding unavailable"))
        segments = [value for value in db.added if isinstance(value, models.AudioTranscriptSegment)]
        chunks = [value for value in db.added if isinstance(value, models.ResourceChunk)]

        self.assertEqual(response["status"], "audio_warning")
        self.assertEqual(len(segments), 1)
        self.assertEqual(chunks, [])
        self.assertFalse(response["searchable"])

    def test_audio_provider_segments_are_sorted_and_speakers_preserved(self):
        _, _, segments = ingest._normalise_audio_transcription({
            "provider": "openai",
            "model": "whisper-1",
            "segments": [
                {"start": 8, "end": 10, "text": "second", "speaker": "B"},
                {"start": 1, "end": 4, "text": "first", "speaker": "A", "confidence": 0.8},
            ],
        })
        self.assertEqual([segment["text"] for segment in segments], ["first", "second"])
        self.assertEqual(segments[0]["speaker"], "A")
        self.assertEqual(segments[0]["confidence"], 0.8)

    def test_configured_openai_provider_returns_timestamped_segments(self):
        with (
            patch.object(ai_clients, "TRANSCRIPTION_PROVIDER", "openai"),
            patch.object(ai_clients, "OPENAI_API_KEY", "test-key"),
            patch.object(ai_clients, "OPENAI_TRANSCRIPTION_MODEL", "whisper-1"),
            patch.object(ai_clients, "OPENAI_TRANSCRIPTION_BASE_URL", "https://api.openai.com/v1"),
            patch.object(ai_clients, "TRANSCRIPTION_TIMEOUT_SECONDS", 90.0),
            patch.object(ai_clients, "_openai_transcription_request", return_value={"segments": [{"start": 1, "end": 2, "text": "configured"}]}),
        ):
            result = ai_clients.transcribe_audio("seminar.mp3", "audio/mpeg", b"audio")

        self.assertEqual(result["provider"], "openai")
        self.assertEqual(result["model"], "whisper-1")
        self.assertEqual(result["segments"][0]["start_time"], 1.0)

    def test_missing_api_key_is_reported_without_exposing_configuration(self):
        with (
            patch.object(ai_clients, "TRANSCRIPTION_PROVIDER", "openai"),
            patch.object(ai_clients, "OPENAI_API_KEY", ""),
        ):
            status = ai_clients.transcription_configuration_status()
            with self.assertRaisesRegex(AIProviderError, "OPENAI_API_KEY"):
                ai_clients.transcribe_audio("seminar.mp3", "audio/mpeg", b"audio")

        self.assertFalse(status["configured"])
        self.assertNotIn("test-key", json.dumps(status))

    def test_invalid_provider_response_is_rejected(self):
        with (
            patch.object(ai_clients, "TRANSCRIPTION_PROVIDER", "openai"),
            patch.object(ai_clients, "OPENAI_API_KEY", "test-key"),
            patch.object(ai_clients, "_openai_transcription_request", return_value={"text": "no segments"}),
        ):
            with self.assertRaisesRegex(AIProviderError, "timestamped segments"):
                ai_clients.transcribe_audio("seminar.mp3", "audio/mpeg", b"audio")

    def test_provider_timeout_is_cleanly_reported(self):
        with (
            patch.object(ai_clients, "TRANSCRIPTION_PROVIDER", "openai"),
            patch.object(ai_clients, "OPENAI_API_KEY", "test-key"),
            patch.object(ai_clients, "OPENAI_TRANSCRIPTION_BASE_URL", "https://api.openai.com/v1"),
            patch.object(ai_clients, "TRANSCRIPTION_TIMEOUT_SECONDS", 1.0),
            patch.object(ai_clients.urllib.request, "urlopen", side_effect=socket.timeout()),
        ):
            with self.assertRaisesRegex(AIProviderError, "timed out"):
                ai_clients.transcribe_audio("seminar.mp3", "audio/mpeg", b"audio")

    def test_invalid_timestamps_are_rejected(self):
        for segment in (
            {"start": -1, "end": 2, "text": "negative"},
            {"start": 3, "end": 2, "text": "reversed"},
            {"start": "nan", "end": 2, "text": "non-finite"},
        ):
            with self.subTest(segment=segment):
                with self.assertRaisesRegex(AIProviderError, "invalid timestamps"):
                    ai_clients.normalize_transcript_segments({"segments": [segment]})

    def test_invalid_timestamps_from_normalised_fixture_are_rejected(self):
        with self.assertRaisesRegex(AIProviderError, "invalid timestamps"):
            ingest._normalise_audio_transcription({
                "provider": "openai",
                "model": "whisper-1",
                "segments": [{"start_time": float("nan"), "end_time": 2, "text": "invalid"}],
            })

    def test_invalid_audio_signature_is_rejected(self):
        with self.assertRaises(HTTPException) as error:
            ingest.extract_pdf_text(audio_upload(content=b"not-audio"))
        self.assertEqual(error.exception.status_code, 400)

    def test_audio_citation_contains_timestamp_target_without_chunk_text(self):
        citation = citation_payload(
            resource_type="audio",
            resource_id=42,
            chunk_id=9,
            metadata={"document_title": "Seminar recording"},
            timestamp_start=65.0,
            timestamp_end=82.0,
        )
        self.assertEqual(citation["resource_title"], "Seminar recording")
        self.assertEqual(citation["label"], "Seminar recording · 01:05")
        self.assertEqual(citation["target"]["start_time"], 65.0)
        self.assertNotIn("chunk_text", citation)


if __name__ == "__main__":
    unittest.main()
