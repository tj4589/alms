import os
import re
from typing import Any, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import AliasChoices, BaseModel, Field
from sqlalchemy import Text, and_, false, func, or_
from sqlalchemy.orm import Session

import auth
import models
from database import get_db

from ai_clients import AIProviderError, embeddings_model
from maxe_context import BEYOND_MATERIALS_MODE, SOURCE_MODE, assemble_maxe_context
from maxe_provider import get_maxe_provider
from query_understanding import expanded_search_terms, public_understanding, understand_query
from material_access import accessible_material_filter
from resource_index import citation_payload

router = APIRouter(prefix="/rag", tags=["rag"])
MAX_RAG_QUESTION_CHARS = int(os.getenv("MAX_RAG_QUESTION_CHARS", "2000"))


NL = chr(10)

# A highlighted passage is an extract, not a document; past this it is being
# used to smuggle a whole note into the prompt.
MAX_PASSAGE_CHARS = 2000


class AskQuestionRequest(BaseModel):
    question: str
    topic_id: Optional[int] = None
    course_id: Optional[int] = None
    recent_context: Optional[str] = None
    # A passage the student is reading and pointing at. Carried separately from
    # recent_context because that slot is labelled as conversation history in
    # the prompt -- putting a quoted extract there tells the model someone said
    # it, rather than that it is the text on the page in front of the student.
    passage: Optional[str] = None
    passage_source: Optional[str] = None
    mode: Literal["source", "beyond_materials"] = Field(
        default=SOURCE_MODE,
        validation_alias=AliasChoices("mode", "knowledge_mode", "source_mode"),
    )
    selected_text: Optional[str] = Field(default=None, max_length=4000)
    selected_text_source: Optional[str] = Field(default=None, max_length=240)
    active_resource_type: Optional[Literal["past_question", "lecture_note", "audio"]] = None
    active_resource_id: Optional[int] = Field(default=None, gt=0)
    active_resource_title: Optional[str] = Field(default=None, max_length=240)
    active_timestamp: Optional[float] = Field(default=None, ge=0)


class AskQuestionResponse(BaseModel):
    answer: str
    sources: List[str]
    past_question_sources: List[str] = []
    lecture_note_sources: List[str] = []
    source_citations: List[dict] = []
    insufficient_sources: bool = False
    no_past_questions_found: bool = False
    no_lecture_notes_found: bool = False
    understanding: dict | None = None
    mode: Literal["source", "beyond_materials"] = SOURCE_MODE
    knowledge_gap: bool = False
    knowledge_gap_message: str | None = None
    context: dict = Field(default_factory=dict)


def source_from_metadata(prefix: str, year, metadata: dict | None):
    metadata = metadata or {}
    course_code = metadata.get("course_code", "Unknown course")
    title = metadata.get("document_title") or metadata.get("course_title") or metadata.get("source_file") or "Unknown file"
    year_label = year or metadata.get("academic_year") or metadata.get("year") or metadata.get("session") or "Unknown year"
    title = re.sub(r"\s+", " ", str(title)).strip()
    if str(course_code).lower() != "unknown course" and not title.lower().startswith(str(course_code).lower()):
        title = f"{course_code} {title}"
    if year_label and str(year_label) not in title:
        title = f"{title} {year_label}"
    return title


def _past_question_context(item: models.PastQuestion) -> str:
    metadata = item.metadata_json or {}
    year = getattr(item, "year", None) or metadata.get("year")
    source = source_from_metadata("Past question", year, metadata)
    parts = [f"Past Question Source: {source}"]
    topics = metadata.get("topics_covered") or []
    if topics:
        parts.append("Detected topics: " + ", ".join(str(topic) for topic in topics[:20]))
    preview = metadata.get("content_preview") or {}
    if isinstance(preview, dict):
        instruction = preview.get("instruction")
        scenario = preview.get("scenario")
        questions = preview.get("questions") or []
        if instruction:
            parts.append(f"Instruction: {instruction}")
        if scenario:
            parts.append(f"Scenario: {scenario}")
        if isinstance(questions, list) and questions:
            question_lines = []
            for question in questions[:8]:
                if isinstance(question, dict):
                    label = question.get("number") or "Question"
                    text = question.get("preview") or question.get("text") or ""
                    if text:
                        question_lines.append(f"- {label}: {text}")
                elif question:
                    question_lines.append(f"- {question}")
            if question_lines:
                parts.append("Detected questions:\n" + "\n".join(question_lines))
    cleaned = metadata.get("cleaned_text")
    if cleaned and len("\n".join(parts)) < 900:
        parts.append("Cleaned text excerpt: " + str(cleaned)[:900])
    elif not topics and not preview:
        parts.append("Text excerpt: " + (getattr(item, "content_text", None) or getattr(item, "chunk_text", ""))[:900])
    return "\n".join(parts)


def _source_citation(db: Session, item: Any, source: str, material_type: str) -> dict:
    """Return a concise, user-safe citation without exposing stored content."""
    metadata = getattr(item, "metadata_json", None) or {}
    if isinstance(item, models.ResourceChunk):
        canonical_type = item.resource_type
        source_label = "Audio" if canonical_type == "audio" else material_type
        return citation_payload(
            resource_type=canonical_type,
            resource_id=item.resource_id,
            chunk_id=item.id,
            metadata=metadata,
            page_from=item.page_from,
            page_to=item.page_to,
            slide_from=item.slide_from,
            slide_to=item.slide_to,
            timestamp_start=item.timestamp_start,
            timestamp_end=item.timestamp_end,
            section=item.section,
            heading=item.heading,
            resource_title=metadata.get("document_title") or metadata.get("source_file"),
        ) | {"source": source, "material_type": source_label}
    citation = metadata.get("source_citation") if isinstance(metadata, dict) else None
    if not isinstance(citation, dict):
        citation = {}
    page_from = citation.get("page_from")
    page_to = citation.get("page_to")
    section = citation.get("section")
    section_index = citation.get("section_index")
    if material_type == "lecture_note" and not section and not page_from:
        sections = (
            db.query(models.LectureNoteSection)
            .filter(models.LectureNoteSection.lecture_note_id == item.lecture_note_id)
            .order_by(models.LectureNoteSection.section_index)
            .all()
        )
        chunk_words = set(re.findall(r"[a-z0-9]{3,}", str(getattr(item, "chunk_text", "")).lower()))
        best = None
        for section in sections:
            section_words = set(re.findall(r"[a-z0-9]{3,}", str(section.body or "").lower()))
            score = len(chunk_words & section_words) / max(len(chunk_words), 1)
            if best is None or score > best[0]:
                best = (score, section)
        if best:
            best_section = best[1]
            page_from = best_section.page_from
            page_to = best_section.page_to
            section = best_section.heading
            section_index = best_section.section_index
    return citation_payload(
        resource_type=material_type,
        resource_id=getattr(item, "lecture_note_id", None) or getattr(item, "id", None),
        chunk_id=getattr(item, "id", None),
        metadata={**metadata, "source_citation": {**citation, "section_index": section_index}},
        page_from=page_from,
        page_to=page_to,
        section=section,
        resource_title=source,
    ) | {"source": source, "material_type": material_type}


def _topic_list_answer(question: str, rows: list[models.PastQuestion], sources: list[str]) -> str | None:
    if not re.search(r"\b(topic|topics|cover|appear|what.+in)\b", question, re.IGNORECASE):
        return None
    topics: list[str] = []
    for row in rows:
        metadata = row.metadata_json or {}
        for topic in metadata.get("topics_covered") or []:
            value = re.sub(r"\s+", " ", str(topic)).strip().lower()
            if value and value not in topics:
                topics.append(value)
    if not topics:
        return None
    source = sources[0] if sources else "the uploaded source"
    bullet_lines = "\n".join(f"- {topic}" for topic in topics[:24])
    return f"The uploaded {source} appears to cover:\n{bullet_lines}\n\nSource: {source}."


def _workspace_name(db: Session, current_user: models.User | None) -> str | None:
    space_id = getattr(current_user, "active_learning_space_id", None)
    if not space_id:
        return None
    try:
        space = db.query(models.LearningSpace).filter(models.LearningSpace.id == space_id).first()
    except Exception:
        return None
    return getattr(space, "name", None) if space else None


def _active_resource_context(
    db: Session,
    current_user: models.User | None,
    resource_type: str | None,
    resource_id: int | None,
    resource_title: str | None,
    active_timestamp: float | None,
) -> tuple[dict | None, str]:
    """Resolve active context only after applying the normal access predicate."""
    if not current_user or not resource_type or not resource_id:
        return None, ""
    try:
        if resource_type == "past_question":
            row = (
                db.query(models.PastQuestion)
                .filter(models.PastQuestion.id == resource_id)
                .filter(accessible_material_filter(db, models.PastQuestion, current_user))
                .first()
            )
            if not row:
                return None, ""
            metadata = row.metadata_json or {}
            title = source_from_metadata("Past question", getattr(row, "year", None), metadata)
            return (
                {"resource_type": resource_type, "resource_id": row.id, "title": title},
                _past_question_context(row),
            )

        row = (
            db.query(models.LectureNote)
            .filter(models.LectureNote.id == resource_id)
            .filter(accessible_material_filter(db, models.LectureNote, current_user))
            .first()
        )
        if not row:
            return None, ""
        metadata = row.metadata_json or {}
        is_audio = resource_type == "audio"
        if is_audio and metadata.get("document_type") != "audio" and not str(row.file_mime or "").startswith("audio/"):
            return None, ""
        title = str(resource_title or row.title or metadata.get("document_title") or row.file_name or "Uploaded source")
        text = str(row.content_text or metadata.get("cleaned_text") or metadata.get("cleaned_text_sample") or "").strip()
        if is_audio:
            segment_query = db.query(models.AudioTranscriptSegment).filter(
                models.AudioTranscriptSegment.resource_id == row.id,
            )
            if active_timestamp is not None:
                segment_query = segment_query.filter(
                    models.AudioTranscriptSegment.end_time >= active_timestamp,
                    models.AudioTranscriptSegment.start_time <= active_timestamp + 90,
                )
            segments = segment_query.order_by(models.AudioTranscriptSegment.segment_index).limit(12).all()
            if segments:
                text = "\n".join(
                    f"[{segment.start_time:.2f}-{segment.end_time:.2f}] {segment.text}"
                    for segment in segments
                )
        return (
            {"resource_type": resource_type, "resource_id": row.id, "title": title},
            text[:6000],
        )
    except Exception:
        # Context is an enhancement. A malformed or stale client pointer must
        # never bypass the normal retrieval path or turn into a data leak.
        return None, ""


def _knowledge_gap_response(question: str, mode: str, context: dict) -> dict:
    message = "I couldn't find a source in the current knowledge base that answers this."
    return {
        "answer": message,
        "sources": [],
        "past_question_sources": [],
        "lecture_note_sources": [],
        "source_citations": [],
        "insufficient_sources": True,
        "no_past_questions_found": True,
        "no_lecture_notes_found": True,
        "understanding": None,
        "mode": mode,
        "knowledge_gap": True,
        "knowledge_gap_message": message,
        "context": context,
    }


def run_rag_query(
    question: str,
    course_id: Optional[int],
    topic_id: Optional[int],
    db: Session,
    room_context: Optional[str] = None,
    current_user: models.User | None = None,
    mode: Literal["source", "beyond_materials"] = SOURCE_MODE,
    selected_text: Optional[str] = None,
    selected_text_source: Optional[str] = None,
    active_resource_type: Optional[str] = None,
    active_resource_id: Optional[int] = None,
    active_resource_title: Optional[str] = None,
    active_timestamp: Optional[float] = None,
) -> dict:
    """Core RAG pipeline — reusable across endpoints. Raises HTTPException on failure."""
    understanding = understand_query(question, _metadata_context(db, current_user))
    if course_id is None and understanding.get("course_code"):
        compact_code = re.sub(r"\s+", "", str(understanding.get("course_code") or "")).upper()
        course = db.query(models.Course).filter(func.replace(models.Course.code, " ", "") == compact_code).first()
        if course:
            course_id = course.id
    public_view = public_understanding(understanding)
    active_resource, active_resource_text = _active_resource_context(
        db,
        current_user,
        active_resource_type,
        active_resource_id,
        active_resource_title,
        active_timestamp,
    )
    maxe_context = assemble_maxe_context(
        mode=mode,
        workspace_name=_workspace_name(db, current_user),
        active_resource=active_resource,
        active_resource_text=active_resource_text,
        selected_text=selected_text,
        selected_text_source=selected_text_source,
        recent_context=room_context,
    )
    mode = maxe_context.mode
    if understanding.get("needs_clarification"):
        return {
            "answer": understanding.get("clarifying_question") or "Can you add a course, topic, or phrase you remember?",
            "sources": [],
            "past_question_sources": [],
            "lecture_note_sources": [],
            "source_citations": [],
            "insufficient_sources": True,
            "no_past_questions_found": False,
            "no_lecture_notes_found": False,
            "understanding": public_view,
            "mode": mode,
            "knowledge_gap": False,
            "context": maxe_context.public_payload(),
        }

    terms = expanded_search_terms(understanding)
    best_query = understanding.get("interpreted_topic") or question

    # ── Retrieve context: semantic if embeddings available, keyword otherwise ──
    use_canonical_chunks = db.query(models.ResourceChunk.id).first() is not None
    past_query = db.query(models.ResourceChunk if use_canonical_chunks else models.PastQuestion)
    if current_user is not None:
        if use_canonical_chunks:
            past_query = past_query.join(
                models.PastQuestion,
                and_(models.ResourceChunk.resource_type == "past_question", models.PastQuestion.id == models.ResourceChunk.resource_id),
            ).filter(accessible_material_filter(db, models.PastQuestion, current_user))
        else:
            past_query = past_query.filter(accessible_material_filter(db, models.PastQuestion, current_user))
    else:
        past_query = past_query.filter(false())
    if course_id is not None:
        past_query = past_query.filter(models.PastQuestion.course_id == course_id)
    if topic_id is not None:
        past_query = past_query.filter(models.PastQuestion.topic_id == topic_id)
    if active_resource and active_resource["resource_type"] == "past_question":
        past_query = past_query.filter(models.PastQuestion.id == active_resource["resource_id"])
    elif active_resource and active_resource["resource_type"] in {"lecture_note", "audio"}:
        past_query = past_query.filter(false())

    notes_query = db.query(models.ResourceChunk if use_canonical_chunks else models.LectureNoteChunk)
    if current_user is not None:
        notes_query = notes_query.join(
            models.LectureNote,
            (and_(models.ResourceChunk.resource_type.in_(["lecture_note", "audio"]), models.LectureNote.id == models.ResourceChunk.resource_id)
             if use_canonical_chunks else models.LectureNote.id == models.LectureNoteChunk.lecture_note_id),
        ).filter(accessible_material_filter(db, models.LectureNote, current_user))
    else:
        notes_query = notes_query.filter(false())
    if course_id is not None:
        if use_canonical_chunks:
            notes_query = notes_query.filter(models.LectureNote.course_id == course_id)
        else:
            notes_query = notes_query.filter(models.LectureNoteChunk.course_id == course_id)
    if active_resource and active_resource["resource_type"] in {"lecture_note", "audio"}:
        notes_query = notes_query.filter(models.LectureNote.id == active_resource["resource_id"])
        if use_canonical_chunks:
            notes_query = notes_query.filter(
                models.ResourceChunk.resource_type == active_resource["resource_type"]
            )
    elif active_resource and active_resource["resource_type"] == "past_question":
        notes_query = notes_query.filter(false())

    use_keyword_fallback = not embeddings_model
    if embeddings_model:
        try:
            question_vector = embeddings_model.embed_query(best_query)
            similar_questions = (
                past_query
                .filter((models.ResourceChunk.embedding if use_canonical_chunks else models.PastQuestion.embedding).isnot(None))
                .order_by((models.ResourceChunk.embedding if use_canonical_chunks else models.PastQuestion.embedding).l2_distance(question_vector))
                .limit(5).all()
            )
            similar_notes = (
                notes_query
                .filter((models.ResourceChunk.embedding if use_canonical_chunks else models.LectureNoteChunk.embedding).isnot(None))
                .order_by((models.ResourceChunk.embedding if use_canonical_chunks else models.LectureNoteChunk.embedding).l2_distance(question_vector))
                .limit(5).all()
            )
        except Exception:
            use_keyword_fallback = True

    if use_keyword_fallback:
        if active_resource:
            similar_questions = past_query.limit(5).all()
            similar_notes = notes_query.limit(5).all()
        else:
            similar_questions = past_query.filter(
                _resource_chunk_filter(terms) if use_canonical_chunks else _past_question_filter(terms)
            ).limit(5).all()
            similar_notes = notes_query.filter(
                _resource_chunk_filter(terms) if use_canonical_chunks else _lecture_chunk_filter(terms)
            ).limit(5).all()

    no_past_questions_found = len(similar_questions) == 0
    no_lecture_notes_found = len(similar_notes) == 0

    has_retrieved_material = not (no_past_questions_found and no_lecture_notes_found)
    if not has_retrieved_material and not maxe_context.active_resource_text and not maxe_context.selected_text and mode == SOURCE_MODE:
        response = _knowledge_gap_response(question, mode, maxe_context.public_payload())
        response["understanding"] = public_view
        return response

    past_context = []
    past_sources = []
    for item in similar_questions:
        past_context.append(_past_question_context(item))
        source = source_from_metadata("Past question", getattr(item, "year", None) or (item.metadata_json or {}).get("year"), item.metadata_json)
        if source not in past_sources:
            past_sources.append(source)

    note_context = []
    note_sources = []
    source_citations = []
    for item in similar_notes:
        is_audio = isinstance(item, models.ResourceChunk) and item.resource_type == "audio"
        note_context.append(f"Audio transcript: {item.chunk_text}" if is_audio else f"Lecture Note: {item.chunk_text}")
        source = source_from_metadata("Audio", None, item.metadata_json) if is_audio else source_from_metadata("Lecture note", None, item.metadata_json)
        if source not in note_sources:
            note_sources.append(source)
        source_citations.append(_source_citation(db, item, source, "audio" if is_audio else "lecture_note"))
    for item in similar_questions:
        source = source_from_metadata("Past question", getattr(item, "year", None) or (item.metadata_json or {}).get("year"), item.metadata_json)
        source_citations.append(_source_citation(db, item, source, "past_question"))

    topic_answer = _topic_list_answer(question, similar_questions, past_sources)
    if topic_answer and mode == SOURCE_MODE:
        return {
            "answer": topic_answer,
            "sources": past_sources + note_sources,
            "past_question_sources": past_sources,
            "lecture_note_sources": note_sources,
            "source_citations": source_citations,
            "insufficient_sources": False,
            "no_past_questions_found": no_past_questions_found,
            "no_lecture_notes_found": no_lecture_notes_found,
            "understanding": public_view,
            "mode": mode,
            "knowledge_gap": False,
            "context": maxe_context.public_payload(),
        }

    if mode == BEYOND_MATERIALS_MODE:
        mode_instruction = (
            "The student explicitly enabled BEYOND MATERIALS mode. You may use general model knowledge, "
            "but never present general knowledge as if it came from an uploaded source. "
            "Use exactly these headings in your answer: FROM YOUR MATERIALS: and BEYOND YOUR MATERIALS:. "
            "If no material directly supports a point, say so under BEYOND YOUR MATERIALS."
        )
    else:
        mode_instruction = (
            "SOURCE MODE is active. Answer only from the authorized retrieved material, active source context, "
            "or student-selected passage below. Do not use outside knowledge to fill gaps. "
            "If the context is insufficient, say that clearly instead of guessing."
        )
    prompt = "\n\n".join(
        [
            "You are Maxe, ExamMind's calm, context-aware study tutor.",
            mode_instruction,
            "Answer the student's focused question directly. Do not solve or summarize a whole past question unless requested.",
            "Explain difficult ideas clearly without inventing facts, speakers, timestamps, pages, slides, or citations.",
            f"Maxe context envelope:\n{maxe_context.prompt_block()}",
            f"Verified source labels:\n{chr(10).join(past_sources + note_sources) or '(none)'}",
            f"Past-question retrieval context:\n{chr(10).join(past_context) or '(none)'}",
            f"Lecture/audio retrieval context:\n{chr(10).join(note_context) or '(none)'}",
            f"Missing-source flags: past_questions={str(no_past_questions_found).lower()}, notes={str(no_lecture_notes_found).lower()}",
            f"Student question:\n{question}",
        ]
    )

    try:
        answer = get_maxe_provider().generate(prompt)
    except AIProviderError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception:
        raise HTTPException(
            status_code=503,
            detail=(
                "AI answers are temporarily unavailable because the primary provider balance is low. "
                "Uploaded materials, search, and practice data are still available."
            ),
        )

    if mode == BEYOND_MATERIALS_MODE and not answer.lstrip().startswith("FROM YOUR MATERIALS:"):
        material_summary = "The authorized workspace did not contain a directly relevant source." if not has_retrieved_material else "The answer may include relevant workspace material."
        answer = f"FROM YOUR MATERIALS:\n{material_summary}\n\nBEYOND YOUR MATERIALS:\n{answer.strip()}"
    if no_lecture_notes_found and mode == SOURCE_MODE and has_retrieved_material:
        answer += "\n\nNo lecture notes on this topic are uploaded yet. Be the first to upload them."
    if no_past_questions_found and mode == SOURCE_MODE and has_retrieved_material:
        answer += "\n\nThis topic has not appeared in any uploaded past questions yet."

    return {
        "answer": answer,
        "sources": past_sources + note_sources,
        "past_question_sources": past_sources,
        "lecture_note_sources": note_sources,
        "source_citations": source_citations,
        "insufficient_sources": False,
        "no_past_questions_found": no_past_questions_found,
        "no_lecture_notes_found": no_lecture_notes_found,
        "understanding": public_view,
        "mode": mode,
        "knowledge_gap": False,
        "context": maxe_context.public_payload(),
    }


@router.post("/ask", response_model=AskQuestionResponse)
def ask_question(
    req: AskQuestionRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question is required.")
    if len(question) > MAX_RAG_QUESTION_CHARS:
        raise HTTPException(
            status_code=413,
            detail=f"Question is too long. Limit it to {MAX_RAG_QUESTION_CHARS} characters.",
        )
    parts: list[str] = []
    if req.recent_context:
        parts.append("Recent conversation:" + NL + req.recent_context[:1200])
    room_context = (NL + NL).join(parts) if parts else None
    return run_rag_query(
        question,
        req.course_id,
        req.topic_id,
        db,
        room_context=room_context,
        current_user=current_user,
        mode=req.mode,
        selected_text=req.selected_text or req.passage,
        selected_text_source=req.selected_text_source or req.passage_source,
        active_resource_type=req.active_resource_type,
        active_resource_id=req.active_resource_id,
        active_resource_title=req.active_resource_title,
        active_timestamp=req.active_timestamp,
    )


def _metadata_context(db: Session, current_user: models.User | None = None) -> list[dict]:
    context: list[dict] = []
    for course in db.query(models.Course).limit(80).all():
        context.append({"code": course.code, "name": course.name, "description": course.description})
    for topic in db.query(models.Topic).limit(120).all():
        context.append({"topic": topic.name})
    notes_query = db.query(models.LectureNote)
    past_query = db.query(models.PastQuestion)
    if current_user is not None:
        notes_query = notes_query.filter(accessible_material_filter(db, models.LectureNote, current_user))
        past_query = past_query.filter(accessible_material_filter(db, models.PastQuestion, current_user))
    if current_user is not None:
        for note in notes_query.order_by(models.LectureNote.created_at.desc()).limit(120).all():
            context.append({"title": note.title, "topic": note.topic, **(note.metadata_json or {})})
        for pq in past_query.order_by(models.PastQuestion.created_at.desc()).limit(120).all():
            context.append({"content": (pq.content_text or "")[:180], **(pq.metadata_json or {})})
    return context


def _term_conditions(terms: list[str], *columns):
    conditions = []
    for term in terms:
        if not term:
            continue
        pattern = f"%{term}%"
        conditions.extend(column.ilike(pattern) for column in columns)
    return conditions or [columns[0].ilike("%__never_match__%")]


def _past_question_filter(terms: list[str]):
    return or_(*_term_conditions(terms, models.PastQuestion.content_text, models.PastQuestion.metadata_json.cast(Text)))


def _lecture_chunk_filter(terms: list[str]):
    return or_(*_term_conditions(terms, models.LectureNoteChunk.chunk_text, models.LectureNoteChunk.topic_tag, models.LectureNoteChunk.metadata_json.cast(Text)))


def _resource_chunk_filter(terms: list[str]):
    return or_(*_term_conditions(terms, models.ResourceChunk.chunk_text, models.ResourceChunk.topic, models.ResourceChunk.metadata_json.cast(Text)))
