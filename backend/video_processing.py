"""Bounded audio extraction for video-backed study materials.

The original video remains the stored source.  This module creates only a
temporary, mono WAV derivative for the existing timestamped transcription
pipeline and never persists that derivative.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path


class VideoProcessingError(RuntimeError):
    """A safe, user-facing video processing failure."""


def _bounded_positive_float(name: str, default: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(max(value, 1.0), maximum)


FFMPEG_BINARY = (os.getenv("FFMPEG_BINARY") or "ffmpeg").strip() or "ffmpeg"
VIDEO_EXTRACTION_TIMEOUT_SECONDS = _bounded_positive_float(
    "VIDEO_EXTRACTION_TIMEOUT_SECONDS", 120.0, 600.0
)
VIDEO_MAX_DURATION_SECONDS = _bounded_positive_float(
    "VIDEO_MAX_DURATION_SECONDS", 3600.0, 24 * 60 * 60
)
VIDEO_MAX_EXTRACTED_AUDIO_BYTES = int(
    os.getenv("VIDEO_MAX_EXTRACTED_AUDIO_BYTES", str(50 * 1024 * 1024))
)
VIDEO_MAX_EXTRACTED_AUDIO_BYTES = min(
    max(VIDEO_MAX_EXTRACTED_AUDIO_BYTES, 64 * 1024), 200 * 1024 * 1024
)


def extract_audio_for_transcription(
    content: bytes,
    *,
    filename: str,
    mime_type: str,
) -> bytes:
    """Extract bounded mono WAV audio from a video container.

    FFmpeg is invoked with a temporary source/output path, no shell, an
    explicit duration cap and an output-size cap.  The derivative is read
    with one extra byte so oversized output is rejected without being
    retained in memory.
    """

    if not content:
        raise VideoProcessingError("The uploaded video is empty.")

    suffix = Path(filename).suffix.lower() or ".video"
    try:
        with tempfile.TemporaryDirectory(prefix="exammind-video-") as temp_dir:
            source_path = Path(temp_dir) / f"source{suffix}"
            output_path = Path(temp_dir) / "audio.wav"
            source_path.write_bytes(content)
            command = [
                FFMPEG_BINARY,
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(source_path),
                "-map",
                "0:a:0?",
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-t",
                str(VIDEO_MAX_DURATION_SECONDS),
                "-fs",
                str(VIDEO_MAX_EXTRACTED_AUDIO_BYTES),
                "-f",
                "wav",
                str(output_path),
            ]
            try:
                completed = subprocess.run(
                    command,
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    timeout=VIDEO_EXTRACTION_TIMEOUT_SECONDS,
                    text=True,
                )
            except FileNotFoundError as exc:
                raise VideoProcessingError(
                    "Video audio extraction is unavailable on this server."
                ) from exc
            except subprocess.TimeoutExpired as exc:
                raise VideoProcessingError(
                    "Video audio extraction timed out. Try a shorter video."
                ) from exc
            if completed.returncode != 0 or not output_path.exists():
                raise VideoProcessingError(
                    "ExamMind could not extract an audio track from this video."
                )

            with output_path.open("rb") as extracted:
                audio = extracted.read(VIDEO_MAX_EXTRACTED_AUDIO_BYTES + 1)
            if len(audio) > VIDEO_MAX_EXTRACTED_AUDIO_BYTES:
                raise VideoProcessingError(
                    "The extracted audio is too large to transcribe safely."
                )
            if len(audio) < 44 or audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
                raise VideoProcessingError(
                    "ExamMind could not produce a valid audio track from this video."
                )
            return audio
    except VideoProcessingError:
        raise
    except OSError as exc:
        raise VideoProcessingError(
            "ExamMind could not prepare this video for transcription."
        ) from exc
