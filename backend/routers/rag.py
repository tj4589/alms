from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import auth
import models
from database import get_db

try:
    from langchain_openai import ChatOpenAI, OpenAIEmbeddings

    embeddings_model = OpenAIEmbeddings(model="text-embedding-3-small")
    llm = ChatOpenAI(model="gpt-4o")
except Exception as e:
    embeddings_model = None
    llm = None
    print(f"Warning: OpenAI not fully configured. {e}")

router = APIRouter(prefix="/rag", tags=["rag"])


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


def source_from_metadata(prefix: str, year, metadata: dict | None):
    metadata = metadata or {}
    course_code = metadata.get("course_code", "Unknown course")
    source_file = metadata.get("source_file", "Unknown file")
    year_label = year or metadata.get("year") or "Unknown year"
    return f"{prefix}: {course_code} {year_label} - {source_file}"


@router.post("/ask", response_model=AskQuestionResponse)
def ask_question(
    req: AskQuestionRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if not embeddings_model or not llm:
        raise HTTPException(status_code=500, detail="AI models not configured.")

    question_vector = embeddings_model.embed_query(req.question)

    past_query = db.query(models.PastQuestion)
    if req.course_id is not None:
        past_query = past_query.filter(models.PastQuestion.course_id == req.course_id)
    if req.topic_id is not None:
        past_query = past_query.filter(models.PastQuestion.topic_id == req.topic_id)

    similar_questions = (
        past_query.order_by(models.PastQuestion.embedding.l2_distance(question_vector))
        .limit(5)
        .all()
    )

    notes_query = db.query(models.LectureNoteChunk)
    if req.course_id is not None:
        notes_query = notes_query.filter(models.LectureNoteChunk.course_id == req.course_id)

    similar_notes = (
        notes_query.order_by(models.LectureNoteChunk.embedding.l2_distance(question_vector))
        .limit(5)
        .all()
    )

    no_past_questions_found = len(similar_questions) == 0
    no_lecture_notes_found = len(similar_notes) == 0

    if no_past_questions_found and no_lecture_notes_found:
        return {
            "answer": "I couldn't find past questions or lecture notes on this topic yet. Upload them and they'll become available to everyone instantly.",
            "sources": [],
            "past_question_sources": [],
            "lecture_note_sources": [],
            "no_past_questions_found": True,
            "no_lecture_notes_found": True,
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

    prompt = f"""You are ExamMind AI, an exam-intelligent tutor for Nigerian university students.
Answer ONLY from the retrieved past questions and lecture notes below.
Explain clearly, cite the past-question years/course codes when available, and be honest about missing sources.

Past question context:
{"\n\n".join(past_context) or "No past questions found."}

Lecture note context:
{"\n\n".join(note_context) or "No lecture notes found."}

Missing-source flags:
- no_past_questions_found: {str(no_past_questions_found).lower()}
- no_lecture_notes_found: {str(no_lecture_notes_found).lower()}

Question:
{req.question}
"""

    try:
        response = llm.invoke(prompt)
        answer = getattr(response, "content", str(response))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate answer: {str(e)}")

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
    }
