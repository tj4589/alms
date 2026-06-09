import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import auth
import models
from database import get_db
from routers.rag import run_rag_query

router = APIRouter(prefix="/study-sessions", tags=["sessions"])

_HEARTBEAT_TIMEOUT = int(os.getenv("HEARTBEAT_TIMEOUT_SECONDS", "120"))
_MAX_AI_QUESTION_CHARS = int(os.getenv("MAX_RAG_QUESTION_CHARS", "2000"))

_DOMAIN_SCHOOL: dict[str, str] = {
    "stu.cu.edu.ng": "Covenant University",
    "covenantuniversity.edu.ng": "Covenant University",
}


def _school_from_email(email: str) -> str | None:
    return _DOMAIN_SCHOOL.get(email.split("@")[-1].lower())


# ── Request models ─────────────────────────────────────────────────────────────

class SessionCreateRequest(BaseModel):
    title: str
    description: Optional[str] = None
    course_id: Optional[int] = None
    topic: Optional[str] = None
    exam_goal: Optional[str] = None
    group_id: Optional[int] = None
    ends_at: Optional[str] = None


class ChatMessageRequest(BaseModel):
    content: str


class AskAIRequest(BaseModel):
    question: str
    course_id: Optional[int] = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _is_active(p: models.StudySessionParticipant) -> bool:
    if p.status == "left":
        return False
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=_HEARTBEAT_TIMEOUT)
    last = p.last_seen_at
    if last is None:
        return False
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return last >= cutoff


def _get_participant(session_id: int, user_id: int, db: Session):
    return (
        db.query(models.StudySessionParticipant)
        .filter(
            models.StudySessionParticipant.session_id == session_id,
            models.StudySessionParticipant.user_id == user_id,
        )
        .first()
    )


def _serialize_session(
    s: models.StudySession,
    participants: list,
    creator_username: str | None,
    my_status: str | None,
    include_participants: bool = False,
    usernames: dict | None = None,
) -> dict:
    active = [p for p in participants if _is_active(p)]
    studying = [p for p in active if p.status == "studying"]
    on_break = [p for p in active if p.status == "on_break"]
    result = {
        "id": s.id,
        "title": s.title,
        "description": s.description,
        "course_id": s.course_id,
        "topic": s.topic,
        "exam_goal": s.exam_goal,
        "group_id": s.group_id,
        "created_by": s.created_by,
        "creator_username": creator_username,
        "school_name": s.school_name,
        "starts_at": s.starts_at,
        "ends_at": s.ends_at,
        "status": s.status,
        "created_at": s.created_at,
        "participant_count": len(active),
        "studying_count": len(studying),
        "on_break_count": len(on_break),
        "my_status": my_status,
    }
    if include_participants and usernames is not None:
        result["participants"] = [
            {
                "user_id": p.user_id,
                "username": usernames.get(p.user_id),
                "joined_at": p.joined_at,
                "last_seen_at": p.last_seen_at,
                "status": p.status,
                "is_active": _is_active(p),
            }
            for p in participants
            if _is_active(p)
        ]
    return result


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("")
def list_sessions(
    q: Optional[str] = None,
    course_id: Optional[int] = None,
    topic: Optional[str] = None,
    active_only: bool = False,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    from sqlalchemy import or_
    query = db.query(models.StudySession)
    if active_only:
        query = query.filter(models.StudySession.status == "active")
    if q:
        query = query.filter(
            or_(
                models.StudySession.title.ilike(f"%{q}%"),
                models.StudySession.topic.ilike(f"%{q}%"),
                models.StudySession.description.ilike(f"%{q}%"),
                models.StudySession.exam_goal.ilike(f"%{q}%"),
            )
        )
    if course_id:
        query = query.filter(models.StudySession.course_id == course_id)
    if topic:
        query = query.filter(models.StudySession.topic.ilike(f"%{topic}%"))
    sessions = query.order_by(models.StudySession.created_at.desc()).limit(20).all()

    session_ids = [s.id for s in sessions]
    all_parts: dict[int, list] = {sid: [] for sid in session_ids}
    if session_ids:
        parts = (
            db.query(models.StudySessionParticipant)
            .filter(models.StudySessionParticipant.session_id.in_(session_ids))
            .all()
        )
        for p in parts:
            all_parts[p.session_id].append(p)

    creator_ids = {s.created_by for s in sessions if s.created_by}
    creator_usernames: dict[int, str] = {}
    if creator_ids:
        rows = (
            db.query(models.User.id, models.User.username)
            .filter(models.User.id.in_(creator_ids))
            .all()
        )
        creator_usernames = {r.id: r.username for r in rows}

    result = []
    for s in sessions:
        my_part = next((p for p in all_parts[s.id] if p.user_id == current_user.id), None)
        result.append(
            _serialize_session(
                s,
                all_parts[s.id],
                creator_usernames.get(s.created_by),
                my_part.status if my_part else None,
            )
        )
    return result


@router.post("")
def create_session(
    req: SessionCreateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    if not req.title or not req.title.strip():
        raise HTTPException(status_code=400, detail="Title is required.")

    ends_at = None
    if req.ends_at:
        try:
            ends_at = datetime.fromisoformat(req.ends_at)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid ends_at format. Use ISO 8601.")

    session = models.StudySession(
        title=req.title.strip(),
        description=req.description,
        course_id=req.course_id,
        topic=req.topic,
        exam_goal=req.exam_goal,
        group_id=req.group_id,
        created_by=current_user.id,
        school_name=_school_from_email(current_user.email),
        starts_at=datetime.now(timezone.utc),
        ends_at=ends_at,
        status="active",
    )
    db.add(session)
    db.flush()
    participant = models.StudySessionParticipant(
        session_id=session.id,
        user_id=current_user.id,
        status="studying",
        last_seen_at=datetime.now(timezone.utc),
    )
    db.add(participant)
    db.commit()
    db.refresh(session)
    return _serialize_session(session, [participant], current_user.username, "studying")


@router.get("/{session_id}")
def get_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    session = db.query(models.StudySession).filter(models.StudySession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Reading room not found.")

    participants = (
        db.query(models.StudySessionParticipant)
        .filter(models.StudySessionParticipant.session_id == session_id)
        .all()
    )
    user_ids = {p.user_id for p in participants}
    usernames: dict[int, str] = {}
    if user_ids:
        rows = db.query(models.User.id, models.User.username).filter(models.User.id.in_(user_ids)).all()
        usernames = {r.id: r.username for r in rows}

    creator_username = None
    if session.created_by:
        row = db.query(models.User.username).filter(models.User.id == session.created_by).first()
        if row:
            creator_username = row.username

    my_part = next((p for p in participants if p.user_id == current_user.id), None)
    return _serialize_session(
        session,
        participants,
        creator_username,
        my_part.status if my_part else None,
        include_participants=True,
        usernames=usernames,
    )


@router.post("/{session_id}/join")
def join_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    session = db.query(models.StudySession).filter(models.StudySession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Reading room not found.")
    if session.status != "active":
        raise HTTPException(status_code=400, detail="This reading room has ended.")

    now = datetime.now(timezone.utc)
    existing = _get_participant(session_id, current_user.id, db)
    if existing:
        existing.status = "studying"
        existing.last_seen_at = now
        existing.left_at = None
    else:
        db.add(
            models.StudySessionParticipant(
                session_id=session_id,
                user_id=current_user.id,
                status="studying",
                last_seen_at=now,
            )
        )
    db.commit()
    return {"status": "joined", "my_status": "studying"}


@router.post("/{session_id}/break")
def take_break(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    p = _get_participant(session_id, current_user.id, db)
    if not p or p.status == "left":
        raise HTTPException(status_code=400, detail="You are not in this room.")
    p.status = "on_break"
    p.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    return {"status": "on_break"}


@router.post("/{session_id}/back")
def back_to_study(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    p = _get_participant(session_id, current_user.id, db)
    if not p or p.status == "left":
        raise HTTPException(status_code=400, detail="You are not in this room.")
    p.status = "studying"
    p.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    return {"status": "studying"}


@router.post("/{session_id}/leave")
def leave_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    p = _get_participant(session_id, current_user.id, db)
    if p:
        p.status = "left"
        p.left_at = datetime.now(timezone.utc)
        p.last_seen_at = datetime.now(timezone.utc)
        db.commit()
    return {"status": "left"}


@router.post("/{session_id}/heartbeat")
def heartbeat(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    p = _get_participant(session_id, current_user.id, db)
    if p and p.status != "left":
        p.last_seen_at = datetime.now(timezone.utc)
        db.commit()
    return {"ok": True}


@router.get("/{session_id}/messages")
def get_messages(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    messages = (
        db.query(models.StudySessionMessage)
        .filter(models.StudySessionMessage.session_id == session_id)
        .order_by(models.StudySessionMessage.created_at)
        .limit(200)
        .all()
    )
    user_ids = {m.user_id for m in messages if m.user_id}
    usernames: dict[int, str] = {}
    if user_ids:
        rows = db.query(models.User.id, models.User.username).filter(models.User.id.in_(user_ids)).all()
        usernames = {r.id: r.username for r in rows}

    return [
        {
            "id": m.id,
            "session_id": m.session_id,
            "user_id": m.user_id,
            "username": usernames.get(m.user_id) if m.user_id else None,
            "content": m.content,
            "message_type": m.message_type,
            "created_at": m.created_at,
        }
        for m in messages
    ]


@router.post("/{session_id}/messages")
def post_message(
    session_id: int,
    req: ChatMessageRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    session = db.query(models.StudySession).filter(models.StudySession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Reading room not found.")

    content = req.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message content is required.")

    msg = models.StudySessionMessage(
        session_id=session_id,
        user_id=current_user.id,
        content=content,
        message_type="chat",
    )
    db.add(msg)

    p = _get_participant(session_id, current_user.id, db)
    if p and p.status != "left":
        p.last_seen_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(msg)
    return {
        "id": msg.id,
        "session_id": msg.session_id,
        "user_id": msg.user_id,
        "username": current_user.username,
        "content": msg.content,
        "message_type": msg.message_type,
        "created_at": msg.created_at,
    }


@router.get("/{session_id}/ai-board")
def get_ai_board(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    cards = (
        db.query(models.StudySessionAIQuestion)
        .filter(models.StudySessionAIQuestion.session_id == session_id)
        .order_by(models.StudySessionAIQuestion.created_at)
        .all()
    )
    user_ids = {c.asked_by for c in cards if c.asked_by}
    usernames: dict[int, str] = {}
    if user_ids:
        rows = db.query(models.User.id, models.User.username).filter(models.User.id.in_(user_ids)).all()
        usernames = {r.id: r.username for r in rows}

    return [
        {
            "id": c.id,
            "session_id": c.session_id,
            "asked_by": c.asked_by,
            "asked_by_username": usernames.get(c.asked_by) if c.asked_by else None,
            "question": c.question,
            "answer": c.answer,
            "sources": c.sources or [],
            "past_question_sources": c.past_question_sources or [],
            "lecture_note_sources": c.lecture_note_sources or [],
            "no_past_questions_found": c.no_past_questions_found,
            "no_lecture_notes_found": c.no_lecture_notes_found,
            "created_at": c.created_at,
        }
        for c in cards
    ]


@router.post("/{session_id}/ask-ai")
def ask_ai(
    session_id: int,
    req: AskAIRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    session = db.query(models.StudySession).filter(models.StudySession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Reading room not found.")

    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question is required.")
    if len(question) > _MAX_AI_QUESTION_CHARS:
        raise HTTPException(status_code=413, detail="Question is too long.")

    course_id = req.course_id or session.course_id
    rag_result = run_rag_query(question, course_id, None, db)

    card = models.StudySessionAIQuestion(
        session_id=session_id,
        asked_by=current_user.id,
        question=question,
        answer=rag_result["answer"],
        sources=rag_result["sources"],
        past_question_sources=rag_result["past_question_sources"],
        lecture_note_sources=rag_result["lecture_note_sources"],
        no_past_questions_found=rag_result["no_past_questions_found"],
        no_lecture_notes_found=rag_result["no_lecture_notes_found"],
    )
    db.add(card)

    short_q = question[:80] + ("…" if len(question) > 80 else "")
    db.add(
        models.StudySessionMessage(
            session_id=session_id,
            user_id=current_user.id,
            content=f"asked ExamMind AI: {short_q}",
            message_type="ai_event",
        )
    )

    p = _get_participant(session_id, current_user.id, db)
    if p and p.status != "left":
        p.last_seen_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(card)
    return {
        "id": card.id,
        "session_id": card.session_id,
        "asked_by": card.asked_by,
        "asked_by_username": current_user.username,
        "question": card.question,
        "answer": card.answer,
        "sources": card.sources or [],
        "past_question_sources": card.past_question_sources or [],
        "lecture_note_sources": card.lecture_note_sources or [],
        "no_past_questions_found": card.no_past_questions_found,
        "no_lecture_notes_found": card.no_lecture_notes_found,
        "created_at": card.created_at,
    }
