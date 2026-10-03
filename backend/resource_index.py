"""Canonical resource chunks, provenance, and workspace relevance helpers.

The existing material tables remain the compatibility surface for the reader,
practice pages, and older records. This module is the single canonical index
surface for new retrieval work so each chunk has one predictable provenance
shape regardless of whether it came from a note or a past question.
"""

from __future__ import annotations

import re
from typing import Any

import models
from storage_safety import defer_binary_column


SPACE_SIGNALS = {
    "ksa": (
        "kora", "kora sales academy", "sales academy", "prospecting", "pipeline",
        "discovery call", "cold email", "objection handling", "payments", "fintech sales",
        "sales qualification", "negotiation",
    ),
    "cu": (
        "covenant university", "covenant", "university lecture", "semester", "course code",
        "department", "mis", "csc", "exam", "past question", "lecture note",
    ),
}


def _searchable_text(metadata: dict[str, Any], text: str) -> str:
    fields = [
        metadata.get("course_code"),
        metadata.get("course_title"),
        metadata.get("document_title"),
        metadata.get("document_type"),
        metadata.get("department"),
        metadata.get("source_file"),
        " ".join(str(item) for item in metadata.get("topics_covered", []) or []),
        text,
    ]
    return " ".join(str(value or "") for value in fields).lower()


def classify_workspace_relevance(space: Any, metadata: dict[str, Any], text: str) -> dict[str, Any]:
    """Classify a source without blocking uncertain uploads.

    This is intentionally deterministic and explainable. It is a warning
    signal, not an authorization decision and never deletes or rejects a file.
    """
    if not space:
        return {
            "status": "unknown",
            "confidence": 0.0,
            "active_space_slug": None,
            "active_space_name": None,
            "matched_signals": [],
            "message": "No active learning space was selected.",
        }

    slug = str(getattr(space, "slug", "") or "").strip().lower()
    source = _searchable_text(metadata, text)
    own_signals = [signal for signal in SPACE_SIGNALS.get(slug, ()) if signal in source]
    other_slug = "cu" if slug == "ksa" else "ksa" if slug == "cu" else None
    other_signals = [signal for signal in SPACE_SIGNALS.get(other_slug or "", ()) if signal in source]

    explicit_ksa = bool(re.search(r"\b(?:ksa|kora\s+sales\s+academy)\b", source))
    explicit_cu = bool(re.search(r"\b(?:covenant\s+university|stu\.cu\.edu\.ng|mis\d{3}|csc\d{3})\b", source))
    if slug == "ksa" and (explicit_cu or (len(other_signals) >= 2 and not own_signals)):
        status, confidence = "mismatch", 0.9 if explicit_cu else 0.78
        message = "This source may not belong in the Kora Sales Academy workspace."
    elif slug == "cu" and (explicit_ksa or (len(other_signals) >= 2 and not own_signals)):
        status, confidence = "mismatch", 0.9 if explicit_ksa else 0.78
        message = "This source may not belong in the Covenant University workspace."
    elif own_signals:
        status, confidence = "compatible", min(0.95, 0.58 + len(own_signals) * 0.08)
        message = "This source matches the current learning space."
    else:
        status, confidence = "uncertain", 0.42
        message = "The source context is not clear enough to classify confidently."

    return {
        "status": status,
        "confidence": round(confidence, 2),
        "active_space_slug": slug or None,
        "active_space_name": getattr(space, "name", None),
        "matched_signals": list(dict.fromkeys(own_signals + other_signals))[:12],
        "message": message,
    }


def citation_payload(
    *,
    resource_type: str,
    resource_id: int,
    chunk_id: int | None,
    metadata: dict[str, Any] | None,
    page_from: int | None = None,
    page_to: int | None = None,
    slide_from: int | None = None,
    slide_to: int | None = None,
    timestamp_start: float | None = None,
    timestamp_end: float | None = None,
    section: str | None = None,
    heading: str | None = None,
    resource_title: str | None = None,
) -> dict[str, Any]:
    """Create citation coordinates without including chunk text."""
    metadata = metadata or {}
    stored = metadata.get("source_citation") if isinstance(metadata.get("source_citation"), dict) else {}
    result = {
        "resource_type": resource_type,
        "resource_id": resource_id,
        "material_id": resource_id,
        "chunk_id": chunk_id,
        "page_from": page_from if page_from is not None else stored.get("page_from"),
        "page_to": page_to if page_to is not None else stored.get("page_to"),
        "slide_from": slide_from if slide_from is not None else stored.get("slide_from"),
        "slide_to": slide_to if slide_to is not None else stored.get("slide_to"),
        "timestamp_start": timestamp_start if timestamp_start is not None else stored.get("timestamp_start"),
        "timestamp_end": timestamp_end if timestamp_end is not None else stored.get("timestamp_end"),
        "section": section if section is not None else stored.get("section"),
        "heading": heading if heading is not None else stored.get("heading"),
        "section_index": stored.get("section_index"),
        "evidence_status": "retrieved_source",
    }
    title = resource_title or metadata.get("document_title") or metadata.get("source_file") or "Uploaded source"
    result["resource_title"] = str(title)

    if resource_type == "audio" and result["timestamp_start"] is not None:
        result["label"] = f"{title} · {format_timestamp(float(result['timestamp_start']))}"
        result["target"] = {
            "screen": "workspace",
            "resource_type": "audio",
            "resource_id": resource_id,
            "start_time": result["timestamp_start"],
            "end_time": result["timestamp_end"],
        }
    else:
        coordinate_label = None
        if result["page_from"] is not None:
            end = result["page_to"] if result["page_to"] is not None else result["page_from"]
            coordinate_label = f"Page {result['page_from']}" if end == result["page_from"] else f"Pages {result['page_from']}–{end}"
        elif result["slide_from"] is not None:
            end = result["slide_to"] if result["slide_to"] is not None else result["slide_from"]
            coordinate_label = f"Slide {result['slide_from']}" if end == result["slide_from"] else f"Slides {result['slide_from']}–{end}"
        elif result["section"] or result["heading"]:
            coordinate_label = str(result["section"] or result["heading"])
        result["label"] = f"{title} · {coordinate_label}" if coordinate_label else str(title)
        result["target"] = {
            "screen": "workspace",
            "resource_type": resource_type,
            "resource_id": resource_id,
            "page_from": result["page_from"],
            "page_to": result["page_to"],
            "slide_from": result["slide_from"],
            "slide_to": result["slide_to"],
            "section": result["section"] or result["heading"],
        }
    return result


def format_timestamp(seconds: float) -> str:
    """Format stored seconds for citations without rounding away the position."""
    total_seconds = max(0, int(seconds))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, remaining = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{remaining:02d}" if hours else f"{minutes:02d}:{remaining:02d}"


def chunk_provenance_fields(metadata: dict[str, Any] | None, citation: dict[str, Any] | None) -> dict[str, Any]:
    """Normalize extractor coordinates into the canonical chunk columns."""
    metadata = metadata or {}
    citation = citation or {}
    source_file = str(metadata.get("source_file") or "").lower()
    is_slide_deck = source_file.endswith((".ppt", ".pptx")) or metadata.get("document_type") == "revision_slide"
    page_from = citation.get("page_from")
    page_to = citation.get("page_to")
    slide_from = citation.get("slide_from")
    slide_to = citation.get("slide_to")
    if is_slide_deck:
        slide_from = slide_from if slide_from is not None else page_from
        slide_to = slide_to if slide_to is not None else page_to
        page_from = None
        page_to = None
    return {
        "page_from": page_from,
        "page_to": page_to,
        "slide_from": slide_from,
        "slide_to": slide_to,
        "timestamp_start": citation.get("timestamp_start"),
        "timestamp_end": citation.get("timestamp_end"),
        "section": citation.get("section"),
        "heading": citation.get("heading") or citation.get("section"),
    }


def backfill_resource_chunks(db) -> int:
    """Copy legacy retrieval rows into the canonical index once.

    Existing records are preserved. The operation is idempotent and only runs
    when a matching canonical chunk is absent.
    """
    created = 0
    note_rows = db.query(models.LectureNoteChunk).all()
    for row in note_rows:
        exists = db.query(models.ResourceChunk.id).filter(
            models.ResourceChunk.resource_type == "lecture_note",
            models.ResourceChunk.resource_id == row.lecture_note_id,
            models.ResourceChunk.chunk_index == row.chunk_index,
        ).first()
        if exists:
            continue
        metadata = dict(row.metadata_json or {})
        citation = metadata.get("source_citation") if isinstance(metadata.get("source_citation"), dict) else {}
        coordinates = chunk_provenance_fields(metadata, citation)
        db.add(models.ResourceChunk(
            resource_type="lecture_note", resource_id=row.lecture_note_id,
            chunk_index=row.chunk_index, chunk_text=row.chunk_text,
            embedding=row.embedding, topic=row.topic_tag, metadata_json=metadata, **coordinates,
        ))
        created += 1

    grouped: dict[str, list[Any]] = {}
    for row in defer_binary_column(db.query(models.PastQuestion), models.PastQuestion).all():
        metadata = row.metadata_json or {}
        key = "|".join(str(value or "").strip().lower() for value in (
            getattr(row, "source_checksum", None) or metadata.get("source_checksum"),
            metadata.get("source_file"), metadata.get("document_title"), row.course_id,
            row.year, row.semester,
        ))
        grouped.setdefault(key, []).append(row)
    for rows in grouped.values():
        resource_id = min(row.id for row in rows if row.id is not None)
        for fallback_index, row in enumerate(sorted(rows, key=lambda item: item.id or 0)):
            metadata = dict(row.metadata_json or {})
            index = int(metadata.get("chunk_index", fallback_index) or fallback_index)
            exists = db.query(models.ResourceChunk.id).filter(
                models.ResourceChunk.resource_type == "past_question",
                models.ResourceChunk.resource_id == resource_id,
                models.ResourceChunk.chunk_index == index,
            ).first()
            if exists:
                continue
            citation = metadata.get("source_citation") if isinstance(metadata.get("source_citation"), dict) else {}
            coordinates = chunk_provenance_fields(metadata, citation)
            db.add(models.ResourceChunk(
                resource_type="past_question", resource_id=resource_id,
                chunk_index=index, chunk_text=row.content_text or "", embedding=row.embedding,
                topic=", ".join(metadata.get("topics_covered", [])[:2]), metadata_json=metadata,
                **coordinates,
            ))
            created += 1
    if created:
        db.commit()
    return created
