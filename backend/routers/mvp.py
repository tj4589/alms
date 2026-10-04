import base64
import binascii
from collections import defaultdict
from datetime import datetime, timezone
import json
import re
from types import SimpleNamespace
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import Text, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import auth
import models
from ai_clients import AIProviderError, generate_ai_response
from database import get_db
from community_rules import classify_discussion, contains_maxe_mention, strip_maxe_mentions
from routers.rag import run_rag_query
from routers.search import _document_key
from material_access import (
    GROUP,
    OFFICIAL,
    PRIVATE,
    PUBLIC,
    SPACE_SHARED,
    accessible_material_filter,
    can_view_material,
    contribution_for_material,
    contribution_payload,
    material_model,
    material_type_for_model,
    normalize_group_ids,
    normalize_visibility,
    request_material_contribution,
    require_contribution_space,
    require_material_owner,
    set_material_visibility,
    sharing_payload,
    validate_share_groups,
)
from public_schemas import (
    PublicAudioTranscriptResponse,
    PublicLectureNoteReaderResponse,
    PublicLectureNoteResponse,
    PublicPastQuestionResponse,
    PublicReaderSection,
    public_material_metadata,
)
from learning_intelligence import (
    attempt_payload,
    create_grounded_quiz,
    quiz_public_payload,
    readiness_payload,
    record_quiz_attempt,
)
from storage_safety import defer_binary_column
from rate_limiting import user_rate_limit

router = APIRouter(tags=["mvp"])


class PracticeGenerateRequest(BaseModel):
    course_id: Optional[int] = None
    topic: Optional[str] = None
    count: int = 5
    source_scope: str = "workspace"
    resource_type: Optional[str] = None
    resource_id: Optional[int] = None
    difficulty: str = "mixed"
    question_type: str = "multiple_choice"


class PracticeAnswer(BaseModel):
    question_id: int
    answer: str | int | None = None


class PracticeSubmitRequest(BaseModel):
    quiz_id: Optional[int] = None
    answers: Optional[list[PracticeAnswer]] = None
    # Retained for older clients so validation can return a safe migration
    # message instead of silently trusting a client-provided score.
    course_id: Optional[int] = None
    topic: Optional[str] = None
    score: Optional[int] = None
    total_questions: Optional[int] = None


MAX_NOTE_PRACTICE_CHUNKS = 6
MAX_NOTE_PRACTICE_CONTEXT_CHARS = 4500


def _topic_terms(topic: str | None) -> list[str]:
    if not topic:
        return []
    words = re.findall(r"[A-Za-z0-9]+", topic.lower())
    phrases = [topic.strip().lower()]
    if len(words) > 1:
        phrases.extend(" ".join(words[i : i + 2]) for i in range(len(words) - 1))
    phrases.extend(word for word in words if len(word) >= 4)
    return list(dict.fromkeys(term for term in phrases if term))


PRACTICE_TOPIC_KEYWORDS = [
    ("project network diagram", r"\bnetwork\s+diagram\b"),
    ("critical path", r"\bcritical\s+path\b"),
    ("path lengths", r"\bpath\s+lengths?\b|\blength\s+of\s+each\s+path\b"),
    ("PERT duration", r"\bPERT\b|\bexpected\s+duration\b|optimistic|pessimistic|most\s+likely"),
    ("project scope management", r"\bscope\s+management\b"),
    ("scope management issues", r"\bscope\s+(?:management\s+)?(?:issues|problems)\b"),
    ("risk management", r"\brisk\s+management\b|\brisk\b"),
    ("risk breakdown structure", r"\brisk\s+breakdown\s+structure\b|\bRBS\b"),
    ("communication management", r"\bcommunication\s+management\b|\bcommunication\b"),
    ("procurement management", r"\bprocurement\s+management\b|\bprocurement\b"),
    ("contract pricing", r"\bcontract\s+pricing\b|\bpricing\s+contracts?\b"),
    ("cost management", r"\bcost\s+management\b"),
    ("earned value management", r"\bearned\s+value\b|\bEVM\b"),
    ("cost variance", r"\bcost\s+variance\b|\bCV\b"),
    ("schedule variance", r"\bschedule\s+variance\b|\bSV\b"),
    ("cost performance index", r"\bcost\s+performance\s+index\b|\bCPI\b"),
    ("schedule performance index", r"\bschedule\s+performance\s+index\b|\bSPI\b"),
    ("stakeholder management", r"\bstakeholder\s+management\b|\bstakeholder\b"),
    ("power/interest grid", r"\bpower\s*/?\s*interest\s+grid\b"),
]


def _clean_practice_prompt(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip(" -:\t\r\n")
    text = re.sub(r"\b(COVENANT UNIVERSITY|COLLEGE OF|DEPARTMENT OF|COURSE CODE|COURSE TITLE|SESSION|SEMESTER)\b.*?(?=\b(question|identify|determine|calculate|discuss|explain|evaluate|state|draw)\b|$)", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^[#*=_~|\\/\W\d]{1,12}$", "", text).strip()
    text = re.sub(r"\bQuestion\s*\d+\s*[:.)-]?\s*", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"\s+", " ", text).strip(" -:")
    if text and not text.endswith("?") and not text.endswith("."):
        text += "."
    return text[:320]


def _practice_tags(text: str, metadata: dict | None = None) -> list[str]:
    tags = [tag for tag, pattern in PRACTICE_TOPIC_KEYWORDS if re.search(pattern, text, re.IGNORECASE)]
    if not tags:
        haystack = " ".join((metadata or {}).get("topics_covered") or [])
        tags = [tag for tag, pattern in PRACTICE_TOPIC_KEYWORDS if re.search(pattern, haystack, re.IGNORECASE)]
    return list(dict.fromkeys(tags))[:6]


def _practice_source_title(row: models.PastQuestion) -> str:
    metadata = row.metadata_json or {}
    title = metadata.get("document_title") or metadata.get("source_file") or metadata.get("course_title") or "Uploaded past question"
    return re.sub(r"\s+", " ", str(title)).strip()


def _preview_question_prompts(metadata: dict | None) -> list[str]:
    metadata = metadata or {}
    preview = metadata.get("content_preview") or {}
    prompts: list[str] = []
    questions = preview.get("questions") if isinstance(preview, dict) else None
    if isinstance(questions, list):
        for item in questions:
            if isinstance(item, dict):
                prompts.append(str(item.get("preview") or item.get("text") or ""))
            else:
                prompts.append(str(item or ""))
    preview_sections = metadata.get("preview_sections") or []
    if isinstance(preview_sections, list):
        for section in preview_sections:
            if isinstance(section, dict) and re.search(r"question|\b\d+[.)]", str(section.get("label") or ""), re.IGNORECASE):
                prompts.append(str(section.get("text") or section.get("preview") or ""))
    return [_clean_practice_prompt(prompt) for prompt in prompts if _clean_practice_prompt(prompt)]


def _fallback_practice_prompts(row: models.PastQuestion) -> list[str]:
    metadata = row.metadata_json or {}
    text = str(metadata.get("cleaned_text") or row.content_text or "")
    chunks = re.split(r"\b(?:Question\s*)?(?=[1-9]\s*[.)])", text)
    prompts: list[str] = []
    for chunk in chunks:
        cleaned = _clean_practice_prompt(chunk)
        if len(cleaned) < 24:
            continue
        if re.search(r"covenant university|department|course title|session|semester|#\d+", cleaned, re.IGNORECASE):
            continue
        if not re.search(r"\b(identify|determine|calculate|discuss|explain|evaluate|state|draw|prepare|develop|risk|cost|scope|critical|PERT|stakeholder|procurement|communication)\b", cleaned, re.IGNORECASE):
            continue
        prompts.append(cleaned)
    return list(dict.fromkeys(prompts))[:8]


def _practice_item_score(item: dict, topic: str | None) -> int:
    if not topic:
        return 0
    haystack = " ".join([item.get("prompt", ""), " ".join(item.get("topic_tags", []))]).lower()
    terms = _topic_terms(topic)
    score = sum(4 for term in terms if term in haystack)
    if "critical path" in topic.lower():
        score += sum(
            3
            for term in ["critical path", "network diagram", "pert", "path length", "completion time"]
            if term in haystack
        )
    return score


def _serialize_practice_items(rows: list[models.PastQuestion], topic: str | None, limit: int) -> list[dict]:
    items: list[dict] = []
    seen: set[str] = set()
    for row in rows:
        metadata = row.metadata_json or {}
        prompts = _preview_question_prompts(metadata) or _fallback_practice_prompts(row)
        source = _practice_source_title(row)
        for index, prompt in enumerate(prompts, start=1):
            key = re.sub(r"\W+", " ", prompt.lower()).strip()
            if not key or key in seen:
                continue
            seen.add(key)
            tags = _practice_tags(prompt, metadata)
            items.append(
                {
                    "id": f"pq-{row.id}-{index}",
                    "prompt": prompt,
                    "source": source,
                    "year": row.year or metadata.get("year"),
                    "difficulty": row.difficulty or "mixed",
                    "topic_tags": tags,
                    "source_type": "past_question",
                }
            )
    items.sort(key=lambda item: _practice_item_score(item, topic), reverse=True)
    return items[:limit]


def _practice_item_key(prompt: str) -> str:
    return re.sub(r"\W+", " ", str(prompt or "").lower()).strip()


def _note_source_title(metadata: dict | None, fallback: str = "Uploaded notes") -> str:
    metadata = metadata or {}
    title = metadata.get("document_title") or metadata.get("source_file") or metadata.get("course_title") or fallback
    return re.sub(r"\s+", " ", str(title)).strip()


def _relevant_note_chunks(
    db: Session,
    course_id: int | None,
    topic: str | None,
    current_user: models.User,
    limit: int = MAX_NOTE_PRACTICE_CHUNKS,
) -> list[models.LectureNoteChunk]:
    query = db.query(models.LectureNoteChunk).join(
        models.LectureNote,
        models.LectureNote.id == models.LectureNoteChunk.lecture_note_id,
    ).filter(accessible_material_filter(db, models.LectureNote, current_user))
    if course_id is not None:
        query = query.filter(models.LectureNoteChunk.course_id == course_id)

    terms = _topic_terms(topic)
    if terms:
        filters = []
        for term in terms[:8]:
            pattern = f"%{term}%"
            filters.append(models.LectureNoteChunk.chunk_text.ilike(pattern))
            filters.append(models.LectureNoteChunk.topic_tag.ilike(pattern))
        query = query.filter(or_(*filters))

    rows = query.order_by(models.LectureNoteChunk.id.desc()).limit(30).all()
    if not terms:
        return rows[:limit]

    def score(row: models.LectureNoteChunk) -> int:
        haystack = f"{row.topic_tag or ''} {row.chunk_text or ''}".lower()
        return sum(3 if term in (row.topic_tag or "").lower() else 1 for term in terms if term in haystack)

    return sorted(rows, key=score, reverse=True)[:limit]


def _strip_json_fences(value: str) -> str:
    text = str(value or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _parse_generated_practice_json(value: str) -> list[dict[str, Any]]:
    text = _strip_json_fences(value)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\[[\s\S]*\]", text)
        if not match:
            return []
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return []
    if isinstance(parsed, dict):
        parsed = parsed.get("questions") or parsed.get("items") or []
    return parsed if isinstance(parsed, list) else []


def _generated_practice_from_notes(
    chunks: list[models.LectureNoteChunk],
    topic: str | None,
    count: int,
) -> tuple[list[dict], str | None]:
    if not chunks or count <= 0:
        return [], None

    parts: list[str] = []
    source_titles: list[str] = []
    total_chars = 0
    for index, chunk in enumerate(chunks, start=1):
        metadata = chunk.metadata_json or {}
        source_title = _note_source_title(metadata)
        source_titles.append(source_title)
        chunk_text = re.sub(r"\s+", " ", str(chunk.chunk_text or "")).strip()
        if not chunk_text:
            continue
        remaining = MAX_NOTE_PRACTICE_CONTEXT_CHARS - total_chars
        if remaining <= 0:
            break
        snippet = chunk_text[:remaining]
        total_chars += len(snippet)
        parts.append(f"[Source {index}: {source_title}]\n{snippet}")

    context = "\n\n".join(parts).strip()
    if not context:
        return [], None

    source_label = ", ".join(list(dict.fromkeys(source_titles))[:3])
    prompt = f"""
You are ExamMind's practice-question generator for authenticated university students.
Use ONLY the provided uploaded lecture-note/study-material context.
Generate {count} exam-style practice questions{f" about {topic}" if topic else ""}.

Return STRICT JSON only: a list of objects.
Each object must have:
{{"prompt": "...", "topic": "...", "difficulty": "easy|medium|hard"}}

Rules:
- Do not include answers.
- Do not invent facts not supported by the context.
- Do not use markdown fences or prose outside the JSON.
- Keep each prompt clear and academically useful.

Context:
{context}
""".strip()

    try:
        raw = generate_ai_response(prompt, temperature=0.3)
    except AIProviderError:
        return [], "Practice generation from notes is temporarily unavailable."
    except Exception:
        return [], "Practice generation from notes is temporarily unavailable."

    parsed = _parse_generated_practice_json(raw)
    items: list[dict] = []
    seen: set[str] = set()
    for index, item in enumerate(parsed, start=1):
        if not isinstance(item, dict):
            continue
        question = _clean_practice_prompt(str(item.get("prompt") or ""))
        if len(question) < 20:
            continue
        key = _practice_item_key(question)
        if not key or key in seen:
            continue
        seen.add(key)
        item_topic = str(item.get("topic") or topic or "Generated practice").strip()
        difficulty = str(item.get("difficulty") or "medium").lower().strip()
        if difficulty not in {"easy", "medium", "hard"}:
            difficulty = "medium"
        items.append(
            {
                "id": f"note-gen-{index}",
                "prompt": question,
                "source": source_label or "Uploaded notes",
                "year": None,
                "difficulty": difficulty,
                "topic": item_topic,
                "topic_tags": _practice_tags(f"{question} {item_topic}") or ([item_topic] if item_topic else []),
                "source_type": "generated_from_notes",
            }
        )
        if len(items) >= count:
            break

    if not items:
        return [], "ExamMind found note material, but could not generate clean practice questions from it yet."
    return items, None


def _merge_practice_items(past_items: list[dict], generated_items: list[dict], limit: int) -> list[dict]:
    merged: list[dict] = []
    seen: set[str] = set()
    for item in [*past_items, *generated_items]:
        key = _practice_item_key(item.get("prompt", ""))
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(item)
        if len(merged) >= limit:
            break
    return merged


def serialize_course(row: models.Course) -> dict:
    return {
        "id": row.id,
        "code": row.code,
        "name": row.name,
        "description": row.description,
        "department": row.department,
        "level": row.level,
    }


def serialize_past_question(row: models.PastQuestion, current_user_id: int | None = None) -> dict:
    metadata = public_material_metadata(row.metadata_json)
    visibility = normalize_visibility(getattr(row, "visibility", None) or metadata.get("visibility"))
    return PublicPastQuestionResponse(
        id=row.id,
        course_id=row.course_id,
        topic_id=row.topic_id,
        year=row.year,
        semester=row.semester,
        difficulty=row.difficulty,
        file_name=row.file_name,
        file_size=row.file_size,
        # Uploads from before files were kept have no bytes to serve, so the
        # UI hides the download rather than offering one that cannot work.
        has_file=bool(row.file_size),
        has_text=bool(row.content_text),
        content_text=row.content_text,
        is_owner=current_user_id is not None and current_user_id == row.uploaded_by,
        visibility=visibility,
        contributor_label="Official KSA resource" if visibility == OFFICIAL else "Shared by a student contributor" if visibility in {"public", GROUP, SPACE_SHARED} else None,
        moderation_status=metadata.get("moderation_status") or "not_submitted",
        requested_visibility=metadata.get("requested_visibility"),
        created_at=row.created_at,
        metadata_json=metadata,
    ).model_dump(mode="json")


# A past-question upload writes one row per text chunk, because each chunk
# needs its own embedding to be searchable. That is correct for retrieval and
# wrong for any number shown to a person: a single twelve-chunk PDF would read
# as twelve uploads.
#
# _document_key is search.py's grouping, the one that already collapses those
# chunks into a single card in search results. Importing it rather than writing
# a second version means counting and search can never drift apart.
#
# Only the three columns the key needs are selected, so counting never pulls a
# row's stored file bytes into memory.
_DOCUMENT_KEY_COLUMNS = (
    models.PastQuestion.metadata_json,
    models.PastQuestion.year,
    models.PastQuestion.semester,
)


def _document_keys(rows) -> set:
    """Distinct uploaded documents among (metadata_json, year, semester) rows."""
    return {
        _document_key(SimpleNamespace(metadata_json=metadata, year=year, semester=semester))
        for metadata, year, semester in rows
    }


def serialize_lecture_note(row: models.LectureNote, current_user_id: int | None = None) -> dict:
    metadata = public_material_metadata(row.metadata_json)
    visibility = normalize_visibility(getattr(row, "visibility", None) or metadata.get("visibility"))
    return PublicLectureNoteResponse(
        id=row.id,
        course_id=row.course_id,
        topic=row.topic,
        title=row.title,
        year=row.year,
        semester=row.semester,
        has_file=bool(row.file_size),
        is_owner=current_user_id is not None and current_user_id == row.uploaded_by,
        file_name=row.file_name,
        file_size=row.file_size,
        visibility=visibility,
        contributor_label="Official KSA resource" if visibility == OFFICIAL else "Shared by a student contributor" if visibility in {"public", GROUP, SPACE_SHARED} else None,
        moderation_status=metadata.get("moderation_status") or "not_submitted",
        requested_visibility=metadata.get("requested_visibility"),
        created_at=row.created_at,
        metadata_json=metadata,
    ).model_dump(mode="json")


def serialize_thread(row: models.DiscussionThread, reply_count: int = 0) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "content": row.content or row.title,
        "course_id": row.course_id,
        "past_question_id": row.past_question_id,
        "created_by": row.created_by,
        "category": row.category,
        "mood": row.mood,
        "group_id": row.group_id,
        "reply_count": reply_count,
        "created_at": row.created_at,
    }


class ThreadCreateRequest(BaseModel):
    title: str = ""
    content: Optional[str] = Field(default=None, max_length=2000)
    course_id: Optional[int] = None
    past_question_id: Optional[int] = None
    group_id: Optional[int] = None


class ThreadUpdateRequest(BaseModel):
    course_id: Optional[int] = None
    past_question_id: Optional[int] = None
    group_id: Optional[int] = None


class ThreadMessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    client_message_id: Optional[str] = Field(default=None, min_length=8, max_length=96, pattern=r"^[A-Za-z0-9_-]+$")


class StudyGroupCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    course_id: Optional[int] = None
    topic: Optional[str] = None
    visibility: str = Field(default="public", pattern="^(public|unlisted|private)$")
    welcome_message: Optional[str] = None


@router.get("/courses")
def list_courses(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    rows = db.query(models.Course).order_by(models.Course.code).all()
    return [serialize_course(row) for row in rows]


@router.get("/past-questions", response_model=list[PublicPastQuestionResponse])
def list_past_questions(
    course_id: Optional[int] = None,
    year: Optional[int] = None,
    topic: Optional[str] = None,
    difficulty: Optional[str] = None,
    uploaded_by: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = defer_binary_column(db.query(models.PastQuestion), models.PastQuestion).filter(
        accessible_material_filter(db, models.PastQuestion, current_user),
    )
    if course_id is not None:
        query = query.filter(models.PastQuestion.course_id == course_id)
    if year is not None:
        query = query.filter(models.PastQuestion.year == year)
    if difficulty:
        query = query.filter(models.PastQuestion.difficulty == difficulty)
    if uploaded_by is not None:
        query = query.filter(models.PastQuestion.uploaded_by == uploaded_by)

    rows = query.order_by(models.PastQuestion.year.desc().nullslast(), models.PastQuestion.id.desc()).limit(100).all()
    if topic:
        lowered = topic.lower()
        rows = [
            row for row in rows
            if lowered in (row.content_text or "").lower()
            or lowered in " ".join((row.metadata_json or {}).get("topics_covered", [])).lower()
        ]
    return [serialize_past_question(row, current_user.id) for row in rows]


@router.get("/lecture-notes", response_model=list[PublicLectureNoteResponse])
def list_lecture_notes(
    course_id: Optional[int] = None,
    topic: Optional[str] = None,
    uploaded_by: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = defer_binary_column(db.query(models.LectureNote), models.LectureNote).filter(
        accessible_material_filter(db, models.LectureNote, current_user),
    )
    if course_id is not None:
        query = query.filter(models.LectureNote.course_id == course_id)
    if topic:
        query = query.filter(models.LectureNote.topic.ilike(f"%{topic}%"))
    if uploaded_by is not None:
        query = query.filter(models.LectureNote.uploaded_by == uploaded_by)
    rows = query.order_by(models.LectureNote.created_at.desc()).limit(100).all()
    return [serialize_lecture_note(row, current_user.id) for row in rows]


@router.get("/materials/lecture-notes/{note_id}", response_model=PublicLectureNoteReaderResponse)
def read_lecture_note(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """A note opened for reading, as ordered sections.

    The archive is shared, so any signed-in student can read any note -- the
    same rule the search and the assistant already follow. Sections come from
    lecture_note_sections, which is cut for eyes; the retrieval chunks are not
    exposed here because they overlap and break mid-word.
    """
    note = defer_binary_column(db.query(models.LectureNote), models.LectureNote).filter(models.LectureNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="That material does not exist.")
    if not can_view_material(db, note, current_user):
        raise HTTPException(status_code=404, detail="That material does not exist.")

    sections = (
        db.query(models.LectureNoteSection)
        .filter(models.LectureNoteSection.lecture_note_id == note.id)
        .order_by(models.LectureNoteSection.section_index)
        .all()
    )

    uploader = db.query(models.User).filter(models.User.id == note.uploaded_by).first()
    course = db.query(models.Course).filter(models.Course.id == note.course_id).first()

    base = serialize_lecture_note(note, current_user.id)
    reader_sections = [
        PublicReaderSection(
            id=section.id,
            index=section.section_index,
            heading=section.heading,
            body=section.body,
            page_from=section.page_from,
            page_to=section.page_to,
            cut_by=section.cut_by,
        )
        for section in sections
    ]
    payload = PublicLectureNoteReaderResponse(
        **base,
        course_code=course.code if course else None,
        course_name=course.name if course else None,
        uploaded_by_username=uploader.username if uploader else None,
        sections=reader_sections,
        # Notes uploaded before sections existed still have their text, so the
        # reader shows the whole thing rather than an empty page.
        content_text=note.content_text if not sections else None,
    ).model_dump(mode="json")
    return payload


@router.get("/materials/lecture-notes/{note_id}/download")
def download_lecture_note(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
    _rate_limit: None = Depends(user_rate_limit("download", auth.get_current_user)),
):
    note = db.query(models.LectureNote).filter(models.LectureNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="That material does not exist.")
    if not can_view_material(db, note, current_user):
        raise HTTPException(status_code=404, detail="That material does not exist.")
    if not note.file_data:
        raise HTTPException(
            status_code=404,
            detail="This material was uploaded before files were kept, so the original is not stored.",
        )
    return _file_response(note.file_data, note.file_name, note.file_mime, note.title)


def _audio_note_or_404(
    audio_id: int,
    db: Session,
    current_user: models.User,
    *,
    include_file: bool = False,
) -> models.LectureNote:
    query = db.query(models.LectureNote)
    if not include_file:
        query = defer_binary_column(query, models.LectureNote)
    note = query.filter(models.LectureNote.id == audio_id).first()
    if not note or not can_view_material(db, note, current_user):
        raise HTTPException(status_code=404, detail="That audio resource does not exist.")
    metadata = note.metadata_json or {}
    if metadata.get("document_type") != "audio" and not str(note.file_mime or "").startswith("audio/"):
        raise HTTPException(status_code=404, detail="That audio resource does not exist.")
    return note


@router.get("/materials/audio/{audio_id}/transcript", response_model=PublicAudioTranscriptResponse)
def read_audio_transcript(
    audio_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    note = _audio_note_or_404(audio_id, db, current_user)
    metadata = note.metadata_json or {}
    segments = (
        db.query(models.AudioTranscriptSegment)
        .filter(models.AudioTranscriptSegment.resource_id == note.id)
        .order_by(models.AudioTranscriptSegment.segment_index)
        .all()
    )
    return PublicAudioTranscriptResponse(
        resource_id=note.id,
        title=note.title,
        file_name=note.file_name,
        processing_status=str(metadata.get("processing_status") or "unknown"),
        transcription_status=str(metadata.get("transcription_status") or "unknown"),
        message=(
            "Transcript is ready."
            if segments
            else "A timestamped transcript is not available for this recording yet."
        ),
        segments=[
            {
                "id": segment.id,
                "segment_index": segment.segment_index,
                "start_time": segment.start_time,
                "end_time": segment.end_time,
                "text": segment.text,
                "speaker": segment.speaker,
                "confidence": segment.confidence,
                "topic": segment.topic,
            }
            for segment in segments
        ],
    )


@router.get("/materials/audio/{audio_id}/download")
def download_audio(
    audio_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
    _rate_limit: None = Depends(user_rate_limit("download", auth.get_current_user)),
):
    note = _audio_note_or_404(audio_id, db, current_user, include_file=True)
    if not note.file_data:
        raise HTTPException(status_code=404, detail="The original audio file is not stored.")
    return _file_response(note.file_data, note.file_name, note.file_mime, "audio-recording")


@router.get("/materials/past-questions/{question_id}/download")
def download_past_question(
    question_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
    _rate_limit: None = Depends(user_rate_limit("download", auth.get_current_user)),
):
    row = db.query(models.PastQuestion).filter(models.PastQuestion.id == question_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="That past question does not exist.")
    if not can_view_material(db, row, current_user):
        raise HTTPException(status_code=404, detail="That past question does not exist.")
    # A past-question upload writes one row per chunk and keeps the file on the
    # first of them, so any other chunk has to find its own document's row zero.
    # Matched on _document_key rather than on the filename: two students can
    # both upload "paper.pdf" for different courses, and a filename match would
    # hand one of them the other's file.
    if not row.file_data:
        wanted = _document_key(row)
        sibling = next(
            (
                candidate
                for candidate in db.query(models.PastQuestion)
                .filter(models.PastQuestion.uploaded_by == row.uploaded_by)
                .filter(models.PastQuestion.file_data.isnot(None))
                .all()
                if _document_key(candidate) == wanted and can_view_material(db, candidate, current_user)
            ),
            None,
        )
        if not sibling:
            raise HTTPException(
                status_code=404,
                detail="This material was uploaded before files were kept, so the original is not stored.",
            )
        row = sibling
    return _file_response(row.file_data, row.file_name, row.file_mime, "past-question")


def _file_response(data: bytes, name: str | None, mime: str | None, fallback: str) -> Response:
    filename = name or f"{fallback}.pdf"
    # A quote would close the header value early and a control character
    # would split the header outright, so the name is reduced to printable
    # non-quote characters.
    safe = "".join(char for char in filename if char.isprintable() and char != '"')
    if not safe:
        safe = f"{fallback}.pdf"
    return Response(
        content=data,
        media_type=mime or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe}"'},
    )


class MaterialVisibilityRequest(BaseModel):
    visibility: str = Field(default=PRIVATE, pattern="^(private|public|group|space_shared|official)$")
    group_ids: list[int] = Field(default_factory=list, max_length=20)
    confirm: bool = False


@router.patch("/materials/{material_type}/{material_id}/visibility")
def update_material_visibility(
    material_type: str,
    material_id: int,
    req: MaterialVisibilityRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    model = material_model(material_type)
    row = defer_binary_column(db.query(model), model).filter(model.id == material_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="That material does not exist.")
    require_material_owner(row, current_user)

    visibility = normalize_visibility(req.visibility)
    try:
        group_ids = normalize_group_ids(req.group_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if visibility != PRIVATE and not req.confirm:
        raise HTTPException(status_code=400, detail="Confirm who can access this material before sharing it.")
    if visibility == OFFICIAL:
        raise HTTPException(status_code=403, detail="Official publication is controlled by the moderation workflow.")
    rows = [row]
    if material_type == "past_question":
        wanted = _document_key(row)
        rows = [
            candidate
            for candidate in defer_binary_column(db.query(models.PastQuestion), models.PastQuestion)
            .filter(models.PastQuestion.uploaded_by == row.uploaded_by)
            .all()
            if _document_key(candidate) == wanted
        ]
    if visibility in {PUBLIC, SPACE_SHARED}:
        if group_ids:
            raise HTTPException(status_code=400, detail="Group IDs are not used for academy archive contributions.")
        space = require_contribution_space(db, current_user)
        contribution = request_material_contribution(
            db,
            rows,
            current_user,
            space.id,
            requested_visibility=SPACE_SHARED,
        )
        db.commit()
        return {
            "status": "pending_review",
            "material_type": material_type,
            "material_id": material_id,
            "sharing": {
                **sharing_payload(PRIVATE),
                **contribution_payload(contribution),
                "requested_visibility": SPACE_SHARED,
            },
        }
    if visibility == GROUP:
        group_ids = validate_share_groups(db, group_ids, current_user)
    elif group_ids:
        raise HTTPException(status_code=400, detail="Group IDs are only valid for group sharing.")

    set_material_visibility(db, rows, visibility, group_ids, current_user.id)
    if visibility == PRIVATE:
        for candidate in rows:
            contribution = contribution_for_material(db, candidate)
            if contribution and contribution.moderation_status in {"pending_review", "changes_requested", "rejected"}:
                contribution.moderation_status = "not_submitted"
                contribution.review_reason = None
    db.commit()
    return {
        "status": "updated",
        "material_type": material_type,
        "material_id": material_id,
        "sharing": sharing_payload(visibility, group_ids),
    }


@router.get("/analytics/cohort")
def cohort_analytics(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    attempts = db.query(models.PracticeAttempt).all()
    avg_score = round(sum(a.score for a in attempts) / len(attempts), 1) if attempts else 0
    by_topic = defaultdict(list)
    for attempt in attempts:
        by_topic[attempt.topic or "General"].append(attempt.score)

    challenging_topics = [
        {"topic": topic, "average_score": round(sum(scores) / len(scores), 1), "attempts": len(scores)}
        for topic, scores in by_topic.items()
    ]
    challenging_topics.sort(key=lambda item: item["average_score"])

    return {
        "active_students": db.query(models.User).count(),
        "avg_practice_score": avg_score,
        "questions_attempted": sum(a.total_questions for a in attempts),
        "notes_uploaded": db.query(models.LectureNote).count(),
        "most_challenging_topics": challenging_topics[:8],
    }


@router.get("/profiles/{username}")
def public_profile(
    username: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """A student's public record, viewable by any signed-in student.

    What is public is what a student contributes to the shared archive: the
    materials they filed, the groups they are in, the rooms they sat in. What
    stays private is how well they are doing -- readiness and practice scores
    are the student's own, and /analytics/student/{id} already refuses anyone
    but the owner. Viewing your own profile adds those private counts back.
    """
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="No student with that username.")

    is_self = user.id == current_user.id

    past_questions = len(_document_keys(
        db.query(*_DOCUMENT_KEY_COLUMNS)
        .filter(models.PastQuestion.uploaded_by == user.id)
        .filter(accessible_material_filter(db, models.PastQuestion, current_user))
        .all()
    ))
    lecture_notes = (
        db.query(func.count(models.LectureNote.id))
        .filter(models.LectureNote.uploaded_by == user.id)
        .filter(accessible_material_filter(db, models.LectureNote, current_user))
        .scalar()
    ) or 0
    groups = (
        db.query(func.count(models.StudyGroupMember.id))
        .filter(models.StudyGroupMember.user_id == user.id)
        .scalar()
    ) or 0
    # Distinct, because joining the same room twice is still one room sat in.
    rooms = (
        db.query(func.count(func.distinct(models.StudySessionParticipant.session_id)))
        .filter(models.StudySessionParticipant.user_id == user.id)
        .scalar()
    ) or 0

    # Per-course standing. Each course a student has actually worked in gets a
    # row: what they filed for it, and how many of its rooms they sat in. These
    # are absolute counts, never a ranking against other students -- the badge
    # derived from them is earned at a fixed threshold, so nobody loses one
    # because someone else filed more.
    #
    # Uploads with no course are counted in the totals above but cannot appear
    # here, because there is no course to attribute them to.
    course_rows: dict[int, dict[str, Any]] = {}

    def _bucket(course_id: int) -> dict[str, Any]:
        return course_rows.setdefault(
            course_id,
            {"course_id": course_id, "code": None, "name": None,
             "past_questions": 0, "lecture_notes": 0, "materials": 0, "rooms": 0},
        )

    # Grouped in Python rather than by SQL, because the key lives inside
    # metadata_json and has to be computed the same way search computes it.
    pq_rows_by_course: dict[int, list] = defaultdict(list)
    for course_id, metadata, year, semester in (
        db.query(models.PastQuestion.course_id, *_DOCUMENT_KEY_COLUMNS)
        .filter(models.PastQuestion.uploaded_by == user.id)
        .filter(accessible_material_filter(db, models.PastQuestion, current_user))
        .filter(models.PastQuestion.course_id.isnot(None))
        .all()
    ):
        pq_rows_by_course[course_id].append((metadata, year, semester))
    for course_id, rows in pq_rows_by_course.items():
        _bucket(course_id)["past_questions"] = len(_document_keys(rows))

    ln_by_course = (
        db.query(models.LectureNote.course_id, func.count(models.LectureNote.id))
        .filter(models.LectureNote.uploaded_by == user.id)
        .filter(accessible_material_filter(db, models.LectureNote, current_user))
        .filter(models.LectureNote.course_id.isnot(None))
        .group_by(models.LectureNote.course_id)
        .all()
    )
    for course_id, count in ln_by_course:
        _bucket(course_id)["lecture_notes"] = count

    rooms_by_course = (
        db.query(
            models.StudySession.course_id,
            func.count(func.distinct(models.StudySessionParticipant.session_id)),
        )
        .join(models.StudySession, models.StudySession.id == models.StudySessionParticipant.session_id)
        .filter(models.StudySessionParticipant.user_id == user.id)
        .filter(models.StudySession.course_id.isnot(None))
        .group_by(models.StudySession.course_id)
        .all()
    )
    for course_id, count in rooms_by_course:
        _bucket(course_id)["rooms"] = count

    if course_rows:
        for course in db.query(models.Course).filter(models.Course.id.in_(course_rows.keys())).all():
            row = course_rows[course.id]
            row["code"] = course.code
            row["name"] = course.name
        for row in course_rows.values():
            row["materials"] = row["past_questions"] + row["lecture_notes"]

    courses = sorted(
        course_rows.values(),
        key=lambda row: (-row["materials"], -row["rooms"], row["code"] or ""),
    )

    payload: dict[str, Any] = {
        "id": user.id,
        "username": user.username,
        "name": user.name,
        "is_self": is_self,
        "courses": courses,
        "joined_at": user.created_at.isoformat() if getattr(user, "created_at", None) else None,
        "past_questions_uploaded": past_questions,
        "lecture_notes_uploaded": lecture_notes,
        "materials_uploaded": past_questions + lecture_notes,
        "groups_joined": groups,
        "rooms_joined": rooms,
    }

    if is_self:
        attempts = (
            db.query(func.count(models.PracticeAttempt.id))
            .filter(models.PracticeAttempt.user_id == user.id)
            .scalar()
        ) or 0
        payload["practice_attempts"] = attempts

    return payload


@router.get("/analytics/student/{student_id}")
def student_analytics(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if current_user.id != student_id:
        raise HTTPException(status_code=403, detail="Not enough permissions.")
    learning = readiness_payload(db, current_user)
    readiness = [
        {
            "id": index,
            "user_id": student_id,
            "course_id": None,
            "topic": item["topic"],
            "score": item["score"],
        }
        for index, item in enumerate(learning["topics"], start=1)
        if item["score"] is not None
    ]
    attempts = []
    learning_attempts = db.query(models.LearningQuizAttempt).filter(
        models.LearningQuizAttempt.user_id == student_id,
    ).order_by(models.LearningQuizAttempt.completed_at.desc()).all()
    quizzes = {
        quiz.id: quiz
        for quiz in db.query(models.LearningQuiz).filter(
            models.LearningQuiz.id.in_({attempt.quiz_id for attempt in learning_attempts} or {-1}),
            models.LearningQuiz.user_id == student_id,
        ).all()
    }
    for attempt in learning_attempts:
        quiz = quizzes.get(attempt.quiz_id)
        attempts.append({
            "id": attempt.id,
            "course_id": quiz.course_id if quiz else None,
            "topic": quiz.topic if quiz else None,
            "score": attempt.percentage,
            "total_questions": attempt.total_questions,
            "completed_at": attempt.completed_at,
        })
    if not attempts:
        # Legacy direct scores remain history, not canonical quiz evidence.
        attempts = db.query(models.PracticeAttempt).filter(models.PracticeAttempt.user_id == student_id).all()
    return {"readiness": readiness, "attempts": attempts, "overall_readiness": learning}


@router.post("/practice/generate")
def generate_practice(
    req: PracticeGenerateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
    _rate_limit: None = Depends(user_rate_limit("quiz_generate", auth.require_role("student"))),
):
    try:
        quiz = create_grounded_quiz(
            db,
            current_user,
            source_scope=req.source_scope,
            resource_type=req.resource_type,
            resource_id=req.resource_id,
            course_id=req.course_id,
            topic=req.topic,
            count=req.count,
            difficulty=req.difficulty,
            question_type=req.question_type,
        )
    except LookupError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    questions = db.query(models.LearningQuizQuestion).filter(
        models.LearningQuizQuestion.quiz_id == quiz.id,
    ).order_by(models.LearningQuizQuestion.position.asc()).all()
    payload = quiz_public_payload(quiz, questions)
    return {
        "quiz_id": quiz.id,
        "topic": quiz.topic or "Mixed revision",
        "warning": None,
        "questions": payload["questions"],
    }


@router.post("/practice/submit")
def submit_practice(
    req: PracticeSubmitRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    if req.quiz_id is None or req.answers is None:
        raise HTTPException(
            status_code=400,
            detail="Practice scores are no longer accepted directly. Submit answers for the generated quiz.",
        )
    quiz = db.query(models.LearningQuiz).filter(
        models.LearningQuiz.id == req.quiz_id,
        models.LearningQuiz.user_id == current_user.id,
    ).first()
    if quiz is None:
        raise HTTPException(status_code=404, detail="Quiz not found.")
    try:
        attempt = record_quiz_attempt(
            db,
            current_user,
            quiz,
            [answer.model_dump() for answer in req.answers],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    readiness = readiness_payload(db, current_user)
    debrief = (
        f"You scored {attempt.percentage}%. Review the questions you missed, then retry the same topic. "
        "Readiness is based on your completed answers, not passive reading."
    )
    return {
        "attempt_id": attempt.id,
        "readiness_score": readiness["score"],
        "debrief": debrief,
        "review": attempt.review_json,
    }


THREAD_FEEDS = {"for-you", "latest", "my-courses", "my-groups"}
THREAD_PAGE_SIZE = 24


def _thread_cursor(row: models.DiscussionThread) -> str:
    created_at = row.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    raw = f"{created_at.isoformat()}|{row.id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def _parse_thread_cursor(value: str) -> tuple[datetime, int]:
    try:
        padded = value + ("=" * (-len(value) % 4))
        timestamp, raw_id = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8").split("|", 1)
        parsed = datetime.fromisoformat(timestamp)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        thread_id = int(raw_id)
        if thread_id < 1:
            raise ValueError
        return parsed, thread_id
    except (ValueError, UnicodeDecodeError, binascii.Error) as exc:
        raise HTTPException(status_code=400, detail="That discussion page cursor is invalid.") from exc


def _private_thread_filter(db: Session, current_user: models.User):
    member_group_ids = db.query(models.StudyGroupMember.group_id).filter(
        models.StudyGroupMember.user_id == current_user.id,
    ).subquery()
    private_group_ids = db.query(models.StudyGroup.id).filter(
        models.StudyGroup.visibility == "private",
    ).subquery()
    return or_(
        models.DiscussionThread.group_id.is_(None),
        ~models.DiscussionThread.group_id.in_(private_group_ids),
        models.DiscussionThread.created_by == current_user.id,
        models.DiscussionThread.group_id.in_(member_group_ids),
    )


def _can_view_thread(db: Session, thread: models.DiscussionThread, current_user: models.User) -> bool:
    if thread.group_id is None:
        return True
    group = db.query(models.StudyGroup).filter(models.StudyGroup.id == thread.group_id).first()
    if group is None:
        return False
    if group.visibility != "private" or thread.created_by == current_user.id:
        return True
    return db.query(models.StudyGroupMember.id).filter(
        models.StudyGroupMember.group_id == thread.group_id,
        models.StudyGroupMember.user_id == current_user.id,
    ).first() is not None


def _validate_thread_context(
    db: Session,
    course_id: int | None,
    past_question_id: int | None,
    group_id: int | None,
    current_user: models.User,
) -> None:
    if course_id is not None and not db.query(models.Course.id).filter(models.Course.id == course_id).first():
        raise HTTPException(status_code=400, detail="That course could not be found.")
    if past_question_id is not None:
        past_question = defer_binary_column(db.query(models.PastQuestion), models.PastQuestion).filter(models.PastQuestion.id == past_question_id).first()
        if not past_question or not can_view_material(db, past_question, current_user):
            raise HTTPException(status_code=400, detail="That past question could not be found.")
    if group_id is None:
        return
    group = db.query(models.StudyGroup).filter(models.StudyGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=400, detail="That study group could not be found.")
    if group.visibility == "private" and not db.query(models.StudyGroupMember.id).filter(
        models.StudyGroupMember.group_id == group_id,
        models.StudyGroupMember.user_id == current_user.id,
    ).first():
        raise HTTPException(status_code=403, detail="You cannot attach this discussion to that group.")


def _serialize_thread_rows(db: Session, threads: list[models.DiscussionThread]) -> list[dict]:
    if not threads:
        return []
    thread_ids = [thread.id for thread in threads]
    reply_counts = {
        row.thread_id: row[1]
        for row in db.query(models.ThreadMessage.thread_id, func.count(models.ThreadMessage.id).label("count"))
        .filter(models.ThreadMessage.thread_id.in_(thread_ids))
        .group_by(models.ThreadMessage.thread_id)
        .all()
    }
    user_ids = {thread.created_by for thread in threads if thread.created_by is not None}
    user_rows = db.query(models.User.id, models.User.username, models.User.name).filter(models.User.id.in_(user_ids)).all() if user_ids else []
    user_usernames = {row.id: row.username for row in user_rows}
    user_names = {row.id: row.name for row in user_rows}
    group_ids = {thread.group_id for thread in threads if thread.group_id is not None}
    group_rows = db.query(models.StudyGroup.id, models.StudyGroup.name).filter(models.StudyGroup.id.in_(group_ids)).all() if group_ids else []
    group_names = {row.id: row.name for row in group_rows}
    return [
        {
            "id": thread.id,
            "title": thread.title,
            "content": thread.content or thread.title,
            "created_by": thread.created_by,
            "created_by_username": user_usernames.get(thread.created_by) if thread.created_by else None,
            "created_by_name": user_names.get(thread.created_by) if thread.created_by else "Deleted student",
            "course_id": thread.course_id,
            "past_question_id": thread.past_question_id,
            "category": thread.category,
            "mood": thread.mood,
            "group_id": thread.group_id,
            "group_name": group_names.get(thread.group_id) if thread.group_id else None,
            "reply_count": reply_counts.get(thread.id, 0),
            "created_at": thread.created_at,
        }
        for thread in threads
    ]


@router.get("/threads")
def list_threads(
    course_id: Optional[int] = None,
    feed: Optional[str] = Query(default=None),
    cursor: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if feed is not None and feed not in THREAD_FEEDS:
        raise HTTPException(status_code=400, detail="That discussion feed is not available.")
    effective_feed = feed or "for-you"
    paginated = feed is not None or cursor is not None or limit != 50
    query = db.query(models.DiscussionThread).filter(_private_thread_filter(db, current_user))
    if course_id is not None:
        query = query.filter(models.DiscussionThread.course_id == course_id)
    if effective_feed == "for-you":
        query = query.filter(or_(models.DiscussionThread.category.is_(None), models.DiscussionThread.category == "academic"))
    elif effective_feed == "my-courses":
        course_ids = db.query(models.UserCourse.course_id).filter(models.UserCourse.user_id == current_user.id).subquery()
        query = query.filter(models.DiscussionThread.course_id.in_(course_ids))
    elif effective_feed == "my-groups":
        group_ids = db.query(models.StudyGroupMember.group_id).filter(models.StudyGroupMember.user_id == current_user.id).subquery()
        query = query.filter(models.DiscussionThread.group_id.in_(group_ids))
    if cursor:
        cursor_time, cursor_id = _parse_thread_cursor(cursor)
        query = query.filter(
            or_(
                models.DiscussionThread.created_at < cursor_time,
                (models.DiscussionThread.created_at == cursor_time) & (models.DiscussionThread.id < cursor_id),
            )
        )
    threads = query.order_by(models.DiscussionThread.created_at.desc(), models.DiscussionThread.id.desc()).limit(limit + 1).all()
    has_more = len(threads) > limit
    page = threads[:limit]
    items = _serialize_thread_rows(db, page)
    if not paginated:
        return items
    return {
        "items": items,
        "next_cursor": _thread_cursor(page[-1]) if has_more and page else None,
    }


@router.post("/threads")
def create_thread(
    req: ThreadCreateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    content = (req.content or req.title or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Write something to start the discussion.")
    _validate_thread_context(db, req.course_id, req.past_question_id, req.group_id, current_user)
    title = content.splitlines()[0][:180]
    category, mood = classify_discussion(content)
    thread = models.DiscussionThread(
        title=title,
        content=content,
        course_id=req.course_id,
        past_question_id=req.past_question_id,
        group_id=req.group_id,
        category=category,
        mood=mood,
        created_by=current_user.id,
    )
    db.add(thread)
    db.commit()
    db.refresh(thread)
    return serialize_thread(thread)


@router.get("/threads/{thread_id}")
def get_thread(
    thread_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    thread = db.query(models.DiscussionThread).filter(models.DiscussionThread.id == thread_id).first()
    if not thread or not _can_view_thread(db, thread, current_user):
        raise HTTPException(status_code=404, detail="Discussion not found.")
    return _serialize_thread_rows(db, [thread])[0]


@router.patch("/threads/{thread_id}")
def update_thread_context(
    thread_id: int,
    req: ThreadUpdateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    thread = db.query(models.DiscussionThread).filter(models.DiscussionThread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Discussion not found.")
    if thread.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Only the discussion author can update its context.")
    _validate_thread_context(db, req.course_id, req.past_question_id, req.group_id, current_user)
    thread.course_id = req.course_id
    thread.past_question_id = req.past_question_id
    thread.group_id = req.group_id
    db.commit()
    db.refresh(thread)
    return _serialize_thread_rows(db, [thread])[0]


@router.get("/threads/{thread_id}/messages")
def list_thread_messages(
    thread_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    thread = db.query(models.DiscussionThread).filter(models.DiscussionThread.id == thread_id).first()
    if not thread or not _can_view_thread(db, thread, current_user):
        raise HTTPException(status_code=404, detail="Discussion not found.")
    messages = (
        db.query(models.ThreadMessage)
        .filter(models.ThreadMessage.thread_id == thread_id)
        .order_by(models.ThreadMessage.created_at)
        .all()
    )

    user_ids = {m.user_id for m in messages if m.user_id is not None}
    user_usernames: dict[int, str] = {}
    if user_ids:
        rows = db.query(models.User.id, models.User.username).filter(models.User.id.in_(user_ids)).all()
        user_usernames = {row.id: row.username for row in rows}

    return [
        {
            "id": m.id,
            "thread_id": m.thread_id,
            "user_id": m.user_id,
            "user_username": user_usernames.get(m.user_id) if m.user_id else None,
            "content": m.content,
            "is_ai_response": m.is_ai_response,
            "created_at": m.created_at,
        }
        for m in messages
    ]


@router.post("/threads/{thread_id}/message")
def post_thread_message(
    thread_id: int,
    req: ThreadMessageRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    thread = db.query(models.DiscussionThread).filter(models.DiscussionThread.id == thread_id).first()
    if not thread or not _can_view_thread(db, thread, current_user):
        raise HTTPException(status_code=404, detail="Discussion not found.")
    content = req.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Write a reply before sending.")

    if req.client_message_id:
        duplicate = db.query(models.ThreadMessage).filter(
            models.ThreadMessage.thread_id == thread_id,
            models.ThreadMessage.client_message_id == req.client_message_id,
        ).first()
        if duplicate:
            return {
                "status": "posted",
                "ai_response_added": contains_maxe_mention(content),
                "duplicate": True,
            }

    message = models.ThreadMessage(
        thread_id=thread_id,
        user_id=current_user.id,
        content=content,
        client_message_id=req.client_message_id,
    )
    db.add(message)
    maxe_mentioned = contains_maxe_mention(content)
    if maxe_mentioned:
        ai_question = strip_maxe_mentions(req.content)
        if not ai_question:
            ai_question = thread.title
        try:
            course = db.query(models.Course).filter(models.Course.id == thread.course_id).first() if thread.course_id else None
            recent_messages = (
                db.query(models.ThreadMessage)
                .filter(models.ThreadMessage.thread_id == thread_id)
                .order_by(models.ThreadMessage.created_at.desc())
                .limit(6)
                .all()
            )
            recent_messages.reverse()
            recent_context = "\n".join(
                    f"- {'Maxe' if msg.is_ai_response else 'Student'}: {msg.content[:220]}"
                for msg in recent_messages
                if msg.content
            )
            thread_context = "\n".join(
                part
                for part in [
                    f"Discussion thread: {thread.title}",
                    f"Course: {course.code} - {course.name}" if course else "",
                    f"Recent thread messages:\n{recent_context}" if recent_context else "",
                    "Use uploaded materials linked to this course/thread first.",
                ]
                if part
            )
            contextual_question = f"{thread_context}\n\nStudent message: {ai_question}"
            rag_result = run_rag_query(
                contextual_question,
                thread.course_id,
                None,
                db,
                room_context=thread_context,
                current_user=current_user,
            )
            ai_content = rag_result["answer"]
        except HTTPException as exc:
            ai_content = str(exc.detail)
        except Exception:
            ai_content = (
                "Maxe is temporarily unavailable because the primary provider balance is low. "
                "Uploaded materials, search, and practice data are still available."
            )
        db.add(
            models.ThreadMessage(
                thread_id=thread_id,
                user_id=None,
                content=ai_content,
                client_message_id=f"{req.client_message_id[:88]}-maxe" if req.client_message_id else None,
                is_ai_response=True,
            )
        )
    db.commit()
    return {"status": "posted", "ai_response_added": maxe_mentioned, "duplicate": False}


# ── Study Groups ───────────────────────────────────────────────────────────────

def _serialize_group(g: models.StudyGroup, member_count: int, is_member: bool, creator_username: str | None) -> dict:
    return {
        "id": g.id,
        "name": g.name,
        "description": g.description,
        "course_id": g.course_id,
        "topic": g.topic,
        "created_by": g.created_by,
        "created_by_username": creator_username,
        "created_at": g.created_at,
        "member_count": member_count,
        "is_member": is_member,
        "visibility": g.visibility,
        "status": g.status,
        "welcome_message": g.welcome_message,
    }


@router.get("/study-groups")
def list_study_groups(
    q: Optional[str] = None,
    course_id: Optional[int] = None,
    topic: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = (
        db.query(models.StudyGroup)
        .outerjoin(
            models.StudyGroupMember,
            (models.StudyGroupMember.group_id == models.StudyGroup.id)
            & (models.StudyGroupMember.user_id == current_user.id),
        )
        .filter(models.StudyGroup.status == "active")
        .filter(or_(models.StudyGroup.visibility == "public", models.StudyGroupMember.user_id == current_user.id))
        .distinct()
    )
    if q:
        query = query.filter(
            or_(
                models.StudyGroup.name.ilike(f"%{q}%"),
                models.StudyGroup.description.ilike(f"%{q}%"),
                models.StudyGroup.topic.ilike(f"%{q}%"),
            )
        )
    if course_id is not None:
        query = query.filter(models.StudyGroup.course_id == course_id)
    if topic:
        query = query.filter(models.StudyGroup.topic.ilike(f"%{topic}%"))
    groups = query.order_by(models.StudyGroup.created_at.desc()).limit(20).all()

    group_ids = [g.id for g in groups]
    member_counts: dict[int, int] = {}
    my_group_ids: set[int] = set()
    if group_ids:
        count_rows = (
            db.query(models.StudyGroupMember.group_id, func.count(models.StudyGroupMember.id).label("cnt"))
            .filter(models.StudyGroupMember.group_id.in_(group_ids))
            .group_by(models.StudyGroupMember.group_id)
            .all()
        )
        member_counts = {row.group_id: row.cnt for row in count_rows}
        my_rows = (
            db.query(models.StudyGroupMember.group_id)
            .filter(
                models.StudyGroupMember.group_id.in_(group_ids),
                models.StudyGroupMember.user_id == current_user.id,
            )
            .all()
        )
        my_group_ids = {row.group_id for row in my_rows}

    creator_ids = {g.created_by for g in groups if g.created_by}
    creator_usernames: dict[int, str] = {}
    if creator_ids:
        rows = db.query(models.User.id, models.User.username).filter(models.User.id.in_(creator_ids)).all()
        creator_usernames = {r.id: r.username for r in rows}

    return [
        _serialize_group(g, member_counts.get(g.id, 0), g.id in my_group_ids, creator_usernames.get(g.created_by) if g.created_by else None)
        for g in groups
    ]


@router.post("/study-groups")
def create_study_group(
    req: StudyGroupCreateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    if not req.name or not req.name.strip():
        raise HTTPException(status_code=400, detail="Group name is required.")
    group = models.StudyGroup(
        name=req.name.strip(),
        description=req.description,
        course_id=req.course_id,
        topic=req.topic,
        visibility=req.visibility if req.visibility in {"public", "unlisted", "private"} else "public",
        welcome_message=req.welcome_message,
        created_by=current_user.id,
    )
    db.add(group)
    db.flush()
    db.add(models.StudyGroupMember(group_id=group.id, user_id=current_user.id, role="owner"))
    db.commit()
    db.refresh(group)
    return _serialize_group(group, 1, True, current_user.username)


@router.post("/study-groups/{group_id}/join")
def join_study_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    group = db.query(models.StudyGroup).filter(models.StudyGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Study group not found.")
    if group.status != "active":
        raise HTTPException(status_code=409, detail="This study group is archived.")
    already = db.query(models.StudyGroupMember).filter(
        models.StudyGroupMember.group_id == group_id,
        models.StudyGroupMember.user_id == current_user.id,
    ).first()
    if not already and group.visibility != "public":
        raise HTTPException(status_code=403, detail="This group can only be joined with an invitation.")
    if not already:
        db.add(models.StudyGroupMember(group_id=group_id, user_id=current_user.id, role="member"))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            already = db.query(models.StudyGroupMember).filter(
                models.StudyGroupMember.group_id == group_id,
                models.StudyGroupMember.user_id == current_user.id,
            ).first()
    count = db.query(models.StudyGroupMember).filter(models.StudyGroupMember.group_id == group_id).count()
    return {"status": "joined", "member_count": count, "role": already.role if already else "member"}


@router.get("/study-groups/{group_id}/members")
def list_group_members(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    group = db.query(models.StudyGroup).filter(models.StudyGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Study group not found.")
    members = (
        db.query(models.StudyGroupMember, models.User)
        .join(models.User, models.User.id == models.StudyGroupMember.user_id)
        .filter(models.StudyGroupMember.group_id == group_id)
        .order_by(models.StudyGroupMember.joined_at)
        .all()
    )
    return [
        {"user_id": u.id, "username": u.username, "name": u.name, "role": m.role, "joined_at": m.joined_at}
        for m, u in members
    ]


@router.post("/study-groups/{group_id}/leave")
def leave_study_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    member = db.query(models.StudyGroupMember).filter(
        models.StudyGroupMember.group_id == group_id,
        models.StudyGroupMember.user_id == current_user.id,
    ).first()
    if member and member.role == "owner":
        raise HTTPException(status_code=409, detail="Group owners must archive or transfer the group before leaving.")
    if member:
        db.delete(member)
        db.commit()
    count = db.query(models.StudyGroupMember).filter(models.StudyGroupMember.group_id == group_id).count()
    return {"status": "left", "member_count": count}
