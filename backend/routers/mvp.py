from collections import Counter, defaultdict
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import Text, func, or_
from sqlalchemy.orm import Session

import auth
import models
from database import get_db
from routers.rag import run_rag_query

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


def _topic_terms(topic: str | None) -> list[str]:
    if not topic:
        return []
    words = re.findall(r"[A-Za-z0-9]+", topic.lower())
    phrases = [topic.strip().lower()]
    if len(words) > 1:
        phrases.extend(" ".join(words[i : i + 2]) for i in range(len(words) - 1))
    phrases.extend(word for word in words if len(word) >= 4)
    return list(dict.fromkeys(term for term in phrases if term))


def serialize_course(row: models.Course) -> dict:
    return {
        "id": row.id,
        "code": row.code,
        "name": row.name,
        "description": row.description,
    }


def serialize_past_question(row: models.PastQuestion) -> dict:
    return {
        "id": row.id,
        "course_id": row.course_id,
        "topic_id": row.topic_id,
        "uploaded_by": row.uploaded_by,
        "year": row.year,
        "semester": row.semester,
        "difficulty": row.difficulty,
        "content_text": row.content_text,
        "file_url": row.file_url,
        "verified_status": row.verified_status,
        "created_at": row.created_at,
        "metadata_json": row.metadata_json or {},
    }


def serialize_lecture_note(row: models.LectureNote) -> dict:
    return {
        "id": row.id,
        "course_id": row.course_id,
        "uploaded_by": row.uploaded_by,
        "topic": row.topic,
        "title": row.title,
        "year": row.year,
        "semester": row.semester,
        "file_url": row.file_url,
        "verified_status": row.verified_status,
        "created_at": row.created_at,
        "metadata_json": row.metadata_json or {},
    }


def serialize_thread(row: models.DiscussionThread) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "course_id": row.course_id,
        "past_question_id": row.past_question_id,
        "created_by": row.created_by,
        "created_at": row.created_at,
    }


class ThreadCreateRequest(BaseModel):
    title: str
    course_id: Optional[int] = None
    past_question_id: Optional[int] = None


class ThreadMessageRequest(BaseModel):
    content: str


class StudyGroupCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    course_id: Optional[int] = None
    topic: Optional[str] = None


@router.get("/courses")
def list_courses(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    rows = db.query(models.Course).order_by(models.Course.code).all()
    return [serialize_course(row) for row in rows]


@router.get("/past-questions")
def list_past_questions(
    course_id: Optional[int] = None,
    year: Optional[int] = None,
    topic: Optional[str] = None,
    difficulty: Optional[str] = None,
    uploaded_by: Optional[int] = None,
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
    return [serialize_past_question(row) for row in rows]


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
    rows = query.order_by(models.LectureNote.created_at.desc()).limit(100).all()
    return [serialize_lecture_note(row) for row in rows]


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


@router.get("/analytics/student/{student_id}")
def student_analytics(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if current_user.id != student_id:
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
    safe_count = max(1, min(req.count, 30))
    query = db.query(models.PastQuestion)
    if req.course_id is not None:
        query = query.filter(models.PastQuestion.course_id == req.course_id)

    warning = None
    if req.topic:
        topic_conditions = []
        for term in _topic_terms(req.topic):
            topic_pattern = f"%{term}%"
            topic_conditions.extend(
                [
                    models.PastQuestion.content_text.ilike(topic_pattern),
                    models.PastQuestion.metadata_json.cast(Text).ilike(topic_pattern),
                ]
            )
        topic_query = query.filter(
            or_(
                *(topic_conditions or [models.PastQuestion.content_text.ilike("%__never_match__%")])
            )
        )
        questions = (
            topic_query.order_by(models.PastQuestion.year.desc().nullslast(), models.PastQuestion.id.desc())
            .limit(safe_count)
            .all()
        )
        if not questions and req.course_id is not None:
            warning = (
                f"No exact topic match for '{req.topic}' yet, so ExamMind generated practice "
                "from broader past questions in the selected course."
            )
            questions = (
                query.order_by(models.PastQuestion.year.desc().nullslast(), models.PastQuestion.id.desc())
                .limit(safe_count)
                .all()
            )
    else:
        questions = (
            query.order_by(models.PastQuestion.year.desc().nullslast(), models.PastQuestion.id.desc())
        .limit(safe_count)
        .all()
        )

    return {
        "topic": req.topic or "Mixed revision",
        "warning": warning,
        "questions": [
            {
                "id": question.id,
                "prompt": question.content_text,
                "year": question.year,
                "difficulty": question.difficulty,
            }
            for question in questions
        ],
    }


@router.post("/practice/submit")
def submit_practice(
    req: PracticeSubmitRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    if req.total_questions <= 0:
        raise HTTPException(status_code=400, detail="total_questions must be greater than zero.")
    if req.score < 0 or req.score > req.total_questions:
        raise HTTPException(status_code=400, detail="score must be between 0 and total_questions.")

    total = req.total_questions
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
    threads = query.order_by(models.DiscussionThread.created_at.desc()).limit(50).all()

    user_ids = {t.created_by for t in threads if t.created_by is not None}
    user_usernames: dict[int, str] = {}
    if user_ids:
        rows = db.query(models.User.id, models.User.username).filter(models.User.id.in_(user_ids)).all()
        user_usernames = {row.id: row.username for row in rows}

    return [
        {
            "id": t.id,
            "title": t.title,
            "created_by": t.created_by,
            "created_by_username": user_usernames.get(t.created_by) if t.created_by else None,
            "course_id": t.course_id,
            "past_question_id": t.past_question_id,
            "created_at": t.created_at,
        }
        for t in threads
    ]


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
    return serialize_thread(thread)


@router.get("/threads/{thread_id}/messages")
def list_thread_messages(
    thread_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
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
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")

    message = models.ThreadMessage(thread_id=thread_id, user_id=current_user.id, content=req.content)
    db.add(message)
    if "@ai" in req.content.lower():
        ai_question = req.content.replace("@AI", "").replace("@ai", "").strip()
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
                f"- {'AI' if msg.is_ai_response else 'Student'}: {msg.content[:220]}"
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
            rag_result = run_rag_query(contextual_question, thread.course_id, None, db, room_context=thread_context)
            ai_content = rag_result["answer"]
        except HTTPException as exc:
            ai_content = str(exc.detail)
        except Exception:
            ai_content = (
                "AI answers are temporarily unavailable because the primary provider balance is low. "
                "Uploaded materials, search, and practice data are still available."
            )
        db.add(
            models.ThreadMessage(
                thread_id=thread_id,
                user_id=None,
                content=ai_content,
                is_ai_response=True,
            )
        )
    db.commit()
    return {"status": "posted", "ai_response_added": "@ai" in req.content.lower()}


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
    }


@router.get("/study-groups")
def list_study_groups(
    q: Optional[str] = None,
    course_id: Optional[int] = None,
    topic: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = db.query(models.StudyGroup)
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
        created_by=current_user.id,
    )
    db.add(group)
    db.flush()
    db.add(models.StudyGroupMember(group_id=group.id, user_id=current_user.id))
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
    already = db.query(models.StudyGroupMember).filter(
        models.StudyGroupMember.group_id == group_id,
        models.StudyGroupMember.user_id == current_user.id,
    ).first()
    if not already:
        db.add(models.StudyGroupMember(group_id=group_id, user_id=current_user.id))
        db.commit()
    count = db.query(models.StudyGroupMember).filter(models.StudyGroupMember.group_id == group_id).count()
    return {"status": "joined", "member_count": count}


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
        {"user_id": u.id, "username": u.username, "name": u.name, "joined_at": m.joined_at}
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
    if member:
        db.delete(member)
        db.commit()
    count = db.query(models.StudyGroupMember).filter(models.StudyGroupMember.group_id == group_id).count()
    return {"status": "left", "member_count": count}
