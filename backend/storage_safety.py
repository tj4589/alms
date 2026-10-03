"""Storage-safety helpers for the current database-backed file store.

This module deliberately does not move files out of Postgres.  It centralizes
the safeguards that are useful while the database remains the source of truth:
bounded binary reads, explicit deferred-column queries, and a conservative
policy for rows left in an intermediate processing state.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session, defer

import models


UPLOAD_READ_CHUNK_BYTES = max(1, int(os.getenv("UPLOAD_READ_CHUNK_BYTES", "65536")))
DEFAULT_ABANDONED_PROCESSING_AGE_SECONDS = max(
    60,
    int(os.getenv("ABANDONED_PROCESSING_AGE_SECONDS", str(24 * 60 * 60))),
)


def defer_binary_column(query: Any, model: Any) -> Any:
    """Keep a material's LargeBinary column out of metadata-only queries."""

    # A few unit-level authorization doubles intentionally expose only the
    # query methods they need. Real SQLAlchemy queries always provide options;
    # keeping those doubles transparent avoids turning a storage optimization
    # into a test-only authorization dependency.
    options = getattr(query, "options", None)
    return options(defer(model.file_data)) if callable(options) else query


def mark_abandoned_processing(
    db: Session,
    *,
    now: datetime | None = None,
    max_age_seconds: int = DEFAULT_ABANDONED_PROCESSING_AGE_SECONDS,
    batch_size: int = 100,
) -> dict[str, int]:
    """Mark stale processing rows failed without deleting their source bytes.

    Upload confirmation creates an audio row before transcription.  A process
    crash can therefore leave a row in ``processing`` indefinitely.  Only
    rows older than the explicit age are considered, and approved/non-private
    resources are skipped.  The source bytes stay available so this maintenance
    task cannot remove retained/shared material or audio that failed safely.
    """

    if max_age_seconds < 60:
        raise ValueError("max_age_seconds must be at least 60 seconds")
    if batch_size < 1:
        raise ValueError("batch_size must be positive")

    current_time = now or datetime.now(timezone.utc)
    cutoff = current_time - timedelta(seconds=max_age_seconds)
    candidates = (
        defer_binary_column(db.query(models.LectureNote), models.LectureNote)
        .filter(models.LectureNote.created_at < cutoff)
        .order_by(models.LectureNote.created_at.asc(), models.LectureNote.id.asc())
        .limit(batch_size)
        .all()
    )
    result = {"inspected": len(candidates), "marked_failed": 0, "skipped_retained": 0}

    try:
        for note in candidates:
            metadata = dict(note.metadata_json or {})
            if metadata.get("processing_status") != "processing":
                continue

            contribution = (
                db.query(models.MaterialContribution)
                .filter(
                    models.MaterialContribution.material_type == "lecture_note",
                    models.MaterialContribution.material_id == note.id,
                    models.MaterialContribution.moderation_status == "approved",
                )
                .first()
            )
            if contribution is not None or note.visibility != "private":
                result["skipped_retained"] += 1
                continue

            metadata.update(
                {
                    "processing_status": "failed",
                    "transcription_status": "failed",
                    "indexed_status": "unindexed",
                    "searchable": False,
                    "needs_review": True,
                    "transcription_error": "Processing expired before completion. The original upload was retained for review.",
                    "abandoned_processing_at": current_time.isoformat(),
                }
            )
            note.metadata_json = metadata
            result["marked_failed"] += 1

        if result["marked_failed"]:
            db.commit()
    except Exception:
        db.rollback()
        raise

    return result
