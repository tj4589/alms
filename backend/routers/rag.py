import os
import re
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import Text, and_, false, func, or_
from sqlalchemy.orm import Session

import auth
import models
from database import get_db

from ai_clients import AIProviderError, embeddings_model, generate_ai_response
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
        return citation_payload(
            resource_type=material_type,
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
        ) | {"source": source, "material_type": material_type}
    citation = metadata.get("source_citation") if isinstance(metadata, dict) else None
    if not isinstance(citation, dict):
        citation = {}
    result = {
        "source": source,
        "material_type": material_type,
        "material_id": getattr(item, "id", None),
        "page_from": citation.get("page_from"),
        "page_to": citation.get("page_to"),
        "section": citation.get("section"),
        "section_index": citation.get("section_index"),
        "evidence_status": "retrieved_source",
    }
    if material_type == "lecture_note" and not result["section"] and not result["page_from"]:
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
            section = best[1]
            result.update({
                "page_from": section.page_from,
                "page_to": section.page_to,
                "section": section.heading,
                "section_index": section.section_index,
            })
    return result


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


def run_rag_query(
    question: str,
    course_id: Optional[int],
    topic_id: Optional[int],
    db: Session,
    room_context: Optional[str] = None,
    current_user: models.User | None = None,
) -> dict:
    """Core RAG pipeline — reusable across endpoints. Raises HTTPException on failure."""
    understanding = understand_query(question, _metadata_context(db, current_user))
    if course_id is None and understanding.get("course_code"):
        compact_code = re.sub(r"\s+", "", str(understanding.get("course_code") or "")).upper()
        course = db.query(models.Course).filter(func.replace(models.Course.code, " ", "") == compact_code).first()
        if course:
            course_id = course.id
    public_view = public_understanding(understanding)
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

    notes_query = db.query(models.ResourceChunk if use_canonical_chunks else models.LectureNoteChunk)
    if current_user is not None:
        notes_query = notes_query.join(
            models.LectureNote,
            (and_(models.ResourceChunk.resource_type == "lecture_note", models.LectureNote.id == models.ResourceChunk.resource_id)
             if use_canonical_chunks else models.LectureNote.id == models.LectureNoteChunk.lecture_note_id),
        ).filter(accessible_material_filter(db, models.LectureNote, current_user))
    else:
        notes_query = notes_query.filter(false())
    if course_id is not None:
        if use_canonical_chunks:
            notes_query = notes_query.filter(models.LectureNote.course_id == course_id)
        else:
            notes_query = notes_query.filter(models.LectureNoteChunk.course_id == course_id)

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
        similar_questions = past_query.filter(
            _resource_chunk_filter(terms) if use_canonical_chunks else _past_question_filter(terms)
        ).limit(5).all()
        similar_notes = notes_query.filter(
            _resource_chunk_filter(terms) if use_canonical_chunks else _lecture_chunk_filter(terms)
        ).limit(5).all()

    no_past_questions_found = len(similar_questions) == 0
    no_lecture_notes_found = len(similar_notes) == 0

    if no_past_questions_found and no_lecture_notes_found:
        interpreted = understanding.get("interpreted_topic") or question
        related = ", ".join((understanding.get("related_terms") or [])[:5])
        return {
            "answer": (
                "I couldn't find enough information in your available materials to answer this confidently. "
                "Upload a relevant lecture note, past question, course outline, tutorial, assignment, "
                "revision slide, or exam-prep document"
                f"{f' mentioning {interpreted} or related terms like {related}' if related else ''}."
            ),
            "sources": [],
            "past_question_sources": [],
            "lecture_note_sources": [],
            "source_citations": [],
            "insufficient_sources": True,
            "no_past_questions_found": True,
            "no_lecture_notes_found": True,
            "understanding": public_view,
        }

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
        note_context.append(f"Lecture Note: {item.chunk_text}")
        source = source_from_metadata("Lecture note", None, item.metadata_json)
        if source not in note_sources:
            note_sources.append(source)
        source_citations.append(_source_citation(db, item, source, "lecture_note"))
    for item in similar_questions:
        source = source_from_metadata("Past question", getattr(item, "year", None) or (item.metadata_json or {}).get("year"), item.metadata_json)
        source_citations.append(_source_citation(db, item, source, "past_question"))

    topic_answer = _topic_list_answer(question, similar_questions, past_sources)
    if topic_answer:
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
        }

    prompt = (
        "You are ExamMind AI, an exam-intelligent tutor for Nigerian university students.\n"
        "Answer ONLY from the retrieved past questions and lecture notes below.\n"
        "Answer the student's focused question directly. Do not solve or summarize the whole past question unless the student explicitly asks for full answers.\n"
        "For critical path questions, focus on the project network diagram, path lengths, shortest completion time, and PERT duration when those appear in the source.\n"
        "For topic-list questions, return concise bullet points from detected topics and preview sections.\n"
        "When the student asks about uploaded content, do not use outside knowledge except to explain terms that appear in the retrieved material.\n"
        "Cite source names exactly as listed in the source metadata when possible, for example MIS415 Project Management Past Question 2022/2023.\n"
        "If OCR quality or extraction looks imperfect, say so briefly and answer from the usable text.\n"
        "If the retrieved sources do not contain enough information, say exactly: I couldn't find enough information in your available materials to answer this confidently. Do not invent exam content.\n\n"
        f"Room or workflow context:\n{room_context or 'No extra room context.'}\n\n"
        f"Source metadata:\n{chr(10).join(past_sources + note_sources) or 'No source metadata available.'}\n\n"
        f"Student's original wording:\n{question}\n\n"
        f"Interpreted topic:\n{understanding.get('interpreted_topic') or question}\n\n"
        f"Related search terms:\n{', '.join((understanding.get('related_terms') or [])[:8])}\n\n"
        f"Past question context:\n{chr(10).join(past_context) or 'No past questions found.'}\n\n"
        f"Lecture note context:\n{chr(10).join(note_context) or 'No lecture notes found.'}\n\n"
        f"Missing-source flags:\n"
        f"- no_past_questions_found: {str(no_past_questions_found).lower()}\n"
        f"- no_lecture_notes_found: {str(no_lecture_notes_found).lower()}\n\n"
        f"Question:\n{question}"
    )

    try:
        answer = generate_ai_response(prompt)
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

    if no_lecture_notes_found:
        answer += "\n\nNo lecture notes on this topic are uploaded yet. Be the first to upload them."
    if no_past_questions_found:
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
    if req.passage:
        where = f" (from {req.passage_source})" if req.passage_source else ""
        parts.append(
            "The student is reading this passage" + where + " and is asking about it. "
            "Answer about this passage first, then add what the archive says:"
            + NL + req.passage[:MAX_PASSAGE_CHARS]
        )
    room_context = (NL + NL).join(parts) if parts else None
    return run_rag_query(
        question,
        req.course_id,
        req.topic_id,
        db,
        room_context=room_context,
        current_user=current_user,
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
