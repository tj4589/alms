from collections import Counter, defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import auth
import models
from database import get_db

router = APIRouter(tags=["mvp"])


class VerifyRequest(BaseModel):
    document_type: str
    action: str


class PracticeGenerateRequest(BaseModel):
    course_id: Optional[int] = None
    topic: Optional[str] = None
    count: int = 5


class PracticeSubmitRequest(BaseModel):
    course_id: Optional[int] = None
    topic: Optional[str] = None
    score: int
    total_questions: int


class ThreadCreateRequest(BaseModel):
    title: str
    course_id: Optional[int] = None
    past_question_id: Optional[int] = None


class ThreadMessageRequest(BaseModel):
    content: str


@router.get("/courses")
def list_courses(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    return db.query(models.Course).order_by(models.Course.code).all()


@router.get("/past-questions")
def list_past_questions(
    course_id: Optional[int] = None,
    year: Optional[int] = None,
    topic: Optional[str] = None,
    difficulty: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = db.query(models.PastQuestion)
    if course_id is not None:
        query = query.filter(models.PastQuestion.course_id == course_id)
    if year is not None:
        query = query.filter(models.PastQuestion.year == year)
    if difficulty:
        query = query.filter(models.PastQuestion.difficulty == difficulty)

    rows = query.order_by(models.PastQuestion.year.desc().nullslast(), models.PastQuestion.id.desc()).limit(100).all()
    if topic:
        lowered = topic.lower()
        rows = [
            row for row in rows
            if lowered in (row.content_text or "").lower()
            or lowered in " ".join((row.metadata_json or {}).get("topics_covered", [])).lower()
        ]
    return rows


@router.get("/lecture-notes")
def list_lecture_notes(
    course_id: Optional[int] = None,
    topic: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = db.query(models.LectureNote)
    if course_id is not None:
        query = query.filter(models.LectureNote.course_id == course_id)
    if topic:
        query = query.filter(models.LectureNote.topic.ilike(f"%{topic}%"))
    return query.order_by(models.LectureNote.created_at.desc()).limit(100).all()


@router.post("/verify/{document_id}")
def verify_document(
    document_id: int,
    req: VerifyRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    if req.document_type not in {"past_question", "lecture_note"}:
        raise HTTPException(status_code=400, detail="document_type must be past_question or lecture_note.")
    if req.action not in {"confirm", "flag"}:
        raise HTTPException(status_code=400, detail="action must be confirm or flag.")

    model = models.LectureNote if req.document_type == "lecture_note" else models.PastQuestion
    document = db.query(model).filter(model.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found.")

    existing = (
        db.query(models.Verification)
        .filter(
            models.Verification.document_id == document_id,
            models.Verification.document_type == req.document_type,
            models.Verification.user_id == current_user.id,
        )
        .first()
    )
    if existing:
        existing.action = req.action
    else:
        db.add(
            models.Verification(
                document_id=document_id,
                document_type=req.document_type,
                user_id=current_user.id,
                action=req.action,
            )
        )

    db.flush()
    counts = Counter(
        action for (action,) in db.query(models.Verification.action)
        .filter(models.Verification.document_id == document_id, models.Verification.document_type == req.document_type)
        .all()
    )
    if counts["flag"] >= 3:
        document.verified_status = "flagged"
    elif counts["confirm"] >= 3:
        document.verified_status = "verified"

    db.commit()
    return {"status": document.verified_status, "confirms": counts["confirm"], "flags": counts["flag"]}


@router.get("/analytics/cohort")
def cohort_analytics(db: Session = Depends(get_db), current_user: models.User = Depends(auth.require_role("lecturer"))):
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
        "active_students": db.query(models.User).filter(models.User.role == "student").count(),
        "avg_practice_score": avg_score,
        "questions_attempted": sum(a.total_questions for a in attempts),
        "notes_uploaded": db.query(models.LectureNote).count(),
        "most_challenging_topics": challenging_topics[:8],
    }


@router.get("/analytics/student/{student_id}")
def student_analytics(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if current_user.id != student_id and current_user.role not in {"admin", "lecturer"}:
        raise HTTPException(status_code=403, detail="Not enough permissions.")
    readiness = db.query(models.ReadinessScore).filter(models.ReadinessScore.user_id == student_id).all()
    attempts = db.query(models.PracticeAttempt).filter(models.PracticeAttempt.user_id == student_id).all()
    return {"readiness": readiness, "attempts": attempts}


@router.post("/practice/generate")
def generate_practice(
    req: PracticeGenerateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    query = db.query(models.PastQuestion)
    if req.course_id is not None:
        query = query.filter(models.PastQuestion.course_id == req.course_id)
    questions = query.limit(max(1, min(req.count, 30))).all()
    if req.topic:
        lowered = req.topic.lower()
        questions = [q for q in questions if lowered in (q.content_text or "").lower()] or questions
    return {
        "topic": req.topic or "Mixed revision",
        "questions": [
            {
                "id": question.id,
                "prompt": question.content_text,
                "year": question.year,
                "difficulty": question.difficulty,
            }
            for question in questions[: req.count]
        ],
    }


@router.post("/practice/submit")
def submit_practice(
    req: PracticeSubmitRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    total = max(req.total_questions, 1)
    percent = round((req.score / total) * 100)
    debrief = (
        f"You scored {percent}%. Review the questions you missed, then retry the same topic. "
        "ExamMind updates readiness from repeated practice, so improvement matters more than one score."
    )
    attempt = models.PracticeAttempt(
        user_id=current_user.id,
        course_id=req.course_id,
        topic=req.topic,
        score=percent,
        total_questions=total,
        debrief_generated=True,
        debrief=debrief,
    )
    db.add(attempt)

    readiness = (
        db.query(models.ReadinessScore)
        .filter(
            models.ReadinessScore.user_id == current_user.id,
            models.ReadinessScore.course_id == req.course_id,
            models.ReadinessScore.topic == req.topic,
        )
        .first()
    )
    if readiness:
        readiness.score = round((readiness.score + percent) / 2)
    else:
        readiness = models.ReadinessScore(user_id=current_user.id, course_id=req.course_id, topic=req.topic, score=percent)
        db.add(readiness)

    db.commit()
    db.refresh(attempt)
    return {"attempt_id": attempt.id, "readiness_score": readiness.score, "debrief": debrief}


@router.get("/threads")
def list_threads(
    course_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = db.query(models.DiscussionThread)
    if course_id is not None:
        query = query.filter(models.DiscussionThread.course_id == course_id)
    return query.order_by(models.DiscussionThread.created_at.desc()).limit(50).all()


@router.post("/threads")
def create_thread(
    req: ThreadCreateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    thread = models.DiscussionThread(
        title=req.title,
        course_id=req.course_id,
        past_question_id=req.past_question_id,
        created_by=current_user.id,
    )
    db.add(thread)
    db.commit()
    db.refresh(thread)
    return thread


@router.get("/threads/{thread_id}/messages")
def list_thread_messages(
    thread_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return (
        db.query(models.ThreadMessage)
        .filter(models.ThreadMessage.thread_id == thread_id)
        .order_by(models.ThreadMessage.created_at)
        .all()
    )


@router.post("/threads/{thread_id}/message")
def post_thread_message(
    thread_id: int,
    req: ThreadMessageRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    thread = db.query(models.DiscussionThread).filter(models.DiscussionThread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")

    message = models.ThreadMessage(thread_id=thread_id, user_id=current_user.id, content=req.content)
    db.add(message)
    if "@ai" in req.content.lower():
        db.add(
            models.ThreadMessage(
                thread_id=thread_id,
                user_id=None,
                content="I can help from the uploaded past questions and notes. Ask a specific topic question for a grounded explanation with citations.",
                is_ai_response=True,
            )
        )
    db.commit()
    return {"status": "posted", "ai_response_added": "@ai" in req.content.lower()}
