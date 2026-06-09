import os
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import Text, or_
from sqlalchemy.orm import Session

import auth
import models
from database import get_db

from ai_clients import embeddings_model, llm
from query_understanding import expanded_search_terms, public_understanding, understand_query

router = APIRouter(prefix="/rag", tags=["rag"])
MAX_RAG_QUESTION_CHARS = int(os.getenv("MAX_RAG_QUESTION_CHARS", "2000"))


class AskQuestionRequest(BaseModel):
    question: str
    topic_id: Optional[int] = None
    course_id: Optional[int] = None


class AskQuestionResponse(BaseModel):
    answer: str
    sources: List[str]
    past_question_sources: List[str] = []
    lecture_note_sources: List[str] = []
    no_past_questions_found: bool = False
    no_lecture_notes_found: bool = False
    understanding: dict | None = None


def source_from_metadata(prefix: str, year, metadata: dict | None):
    metadata = metadata or {}
    course_code = metadata.get("course_code", "Unknown course")
    source_file = metadata.get("source_file", "Unknown file")
    year_label = year or metadata.get("year") or "Unknown year"
    return f"{prefix}: {course_code} {year_label} - {source_file}"


def run_rag_query(
    question: str,
    course_id: Optional[int],
    topic_id: Optional[int],
    db: Session,
) -> dict:
    """Core RAG pipeline — reusable across endpoints. Raises HTTPException on failure."""
    if not llm:
        raise HTTPException(
            status_code=503,
            detail="AI is not configured. Set DEEPSEEK_API_KEY in .env and restart.",
        )

    understanding = understand_query(question, _metadata_context(db))
    public_view = public_understanding(understanding)
    if understanding.get("needs_clarification"):
        return {
            "answer": understanding.get("clarifying_question") or "Can you add a course, topic, or phrase you remember?",
            "sources": [],
            "past_question_sources": [],
            "lecture_note_sources": [],
            "no_past_questions_found": False,
            "no_lecture_notes_found": False,
            "understanding": public_view,
        }

    terms = expanded_search_terms(understanding)
    best_query = understanding.get("interpreted_topic") or question

    # ── Retrieve context: semantic if embeddings available, keyword otherwise ──
    past_query = db.query(models.PastQuestion)
    if course_id is not None:
        past_query = past_query.filter(models.PastQuestion.course_id == course_id)
    if topic_id is not None:
        past_query = past_query.filter(models.PastQuestion.topic_id == topic_id)

    notes_query = db.query(models.LectureNoteChunk)
    if course_id is not None:
        notes_query = notes_query.filter(models.LectureNoteChunk.course_id == course_id)

    use_keyword_fallback = not embeddings_model
    if embeddings_model:
        try:
            question_vector = embeddings_model.embed_query(best_query)
            similar_questions = (
                past_query
                .order_by(models.PastQuestion.embedding.l2_distance(question_vector))
                .limit(5).all()
            )
            similar_notes = (
                notes_query
                .order_by(models.LectureNoteChunk.embedding.l2_distance(question_vector))
                .limit(5).all()
            )
        except Exception:
            use_keyword_fallback = True

    if use_keyword_fallback:
        similar_questions = past_query.filter(_past_question_filter(terms)).limit(5).all()
        similar_notes = notes_query.filter(_lecture_chunk_filter(terms)).limit(5).all()

    no_past_questions_found = len(similar_questions) == 0
    no_lecture_notes_found = len(similar_notes) == 0

    if no_past_questions_found and no_lecture_notes_found:
        interpreted = understanding.get("interpreted_topic") or question
        related = ", ".join((understanding.get("related_terms") or [])[:5])
        return {
            "answer": (
                f"I could not find {interpreted} in uploaded ExamMind materials yet. "
                "To make my answer grounded, upload lecture notes, past questions, course outlines, "
                "tutorial sheets, assignment questions, revision slides, or exam prep PDFs"
                f"{f' that mention {interpreted} or related terms like {related}' if related else ''}."
            ),
            "sources": [],
            "past_question_sources": [],
            "lecture_note_sources": [],
            "no_past_questions_found": True,
            "no_lecture_notes_found": True,
            "understanding": public_view,
        }

    past_context = []
    past_sources = []
    for item in similar_questions:
        past_context.append(f"Past Question ({item.year}): {item.content_text}")
        source = source_from_metadata("Past question", item.year, item.metadata_json)
        if source not in past_sources:
            past_sources.append(source)

    note_context = []
    note_sources = []
    for item in similar_notes:
        note_context.append(f"Lecture Note: {item.chunk_text}")
        source = source_from_metadata("Lecture note", None, item.metadata_json)
        if source not in note_sources:
            note_sources.append(source)

    prompt = (
        "You are ExamMind AI, an exam-intelligent tutor for Nigerian university students.\n"
        "Answer ONLY from the retrieved past questions and lecture notes below.\n"
        "Explain clearly, cite the past-question years/course codes when available, and be honest about missing sources.\n\n"
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
        response = llm.invoke(prompt)
        answer = getattr(response, "content", str(response))
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Failed to generate AI answer: {str(e)}")

    if no_lecture_notes_found:
        answer += "\n\nNo lecture notes on this topic are uploaded yet. Be the first to upload them."
    if no_past_questions_found:
        answer += "\n\nThis topic has not appeared in any uploaded past questions yet."

    return {
        "answer": answer,
        "sources": past_sources + note_sources,
        "past_question_sources": past_sources,
        "lecture_note_sources": note_sources,
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
    return run_rag_query(question, req.course_id, req.topic_id, db)


def _metadata_context(db: Session) -> list[dict]:
    context: list[dict] = []
    for course in db.query(models.Course).limit(80).all():
        context.append({"code": course.code, "name": course.name, "description": course.description})
    for topic in db.query(models.Topic).limit(120).all():
        context.append({"topic": topic.name})
    for note in db.query(models.LectureNote).order_by(models.LectureNote.created_at.desc()).limit(120).all():
        context.append({"title": note.title, "topic": note.topic, **(note.metadata_json or {})})
    for pq in db.query(models.PastQuestion).order_by(models.PastQuestion.created_at.desc()).limit(120).all():
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
