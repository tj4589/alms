"""Owner-scoped learning intelligence APIs for Phase Group F."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import auth
import models
from database import get_db
from learning_intelligence import (
    attempt_payload,
    create_grounded_quiz,
    profile_payload,
    quiz_public_payload,
    readiness_payload,
    record_quiz_attempt,
)


router = APIRouter(prefix="/learning", tags=["learning intelligence"])


class QuizCreateRequest(BaseModel):
    source_scope: Literal["workspace", "resource", "topic"] = "workspace"
    resource_type: Literal["lecture_note", "past_question", "audio"] | None = None
    resource_id: int | None = Field(default=None, gt=0)
    course_id: int | None = Field(default=None, gt=0)
    topic: str | None = Field(default=None, max_length=160)
    count: int = Field(default=5, ge=1, le=20)
    difficulty: Literal["mixed", "easy", "medium", "hard"] = "mixed"
    question_type: Literal["multiple_choice", "short_answer"] = "multiple_choice"


class QuizAnswer(BaseModel):
    question_id: int = Field(gt=0)
    answer: str | int | None = None


class QuizAttemptRequest(BaseModel):
    answers: list[QuizAnswer] = Field(min_length=1, max_length=20)


class LearningProfileUpdate(BaseModel):
    explanation_preference: Literal["concise", "step_by_step", "examples", "exam_style"] | None = None
    preferred_learning_format: Literal["multiple_choice", "short_answer", "mixed"] | None = None


def _student(current_user: models.User = Depends(auth.require_role("student"))) -> models.User:
    return current_user


def _owned_quiz(db: Session, quiz_id: int, user: models.User) -> models.LearningQuiz:
    quiz = db.query(models.LearningQuiz).filter(
        models.LearningQuiz.id == quiz_id,
        models.LearningQuiz.user_id == user.id,
    ).first()
    if quiz is None:
        raise HTTPException(status_code=404, detail="Quiz not found.")
    return quiz


@router.get("/profile")
def get_learning_profile(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_student),
):
    profile = db.query(models.LearningProfile).filter(models.LearningProfile.user_id == current_user.id).first()
    if profile is None:
        return {
            "id": None,
            "explicit_preferences": {},
            "inferred_preferences": {},
            "updated_at": None,
        }
    return profile_payload(profile)


@router.patch("/profile")
def update_learning_profile(
    request: LearningProfileUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_student),
):
    profile = db.query(models.LearningProfile).filter(models.LearningProfile.user_id == current_user.id).first()
    if profile is None:
        profile = models.LearningProfile(user_id=current_user.id, explicit_preferences={}, inferred_preferences={})
        db.add(profile)
    explicit = dict(profile.explicit_preferences or {})
    if request.explanation_preference is not None:
        explicit["explanation_preference"] = {
            "value": request.explanation_preference,
            "source": "explicit student choice",
        }
    if request.preferred_learning_format is not None:
        explicit["preferred_learning_format"] = {
            "value": request.preferred_learning_format,
            "source": "explicit student choice",
        }
    profile.explicit_preferences = explicit
    db.commit()
    db.refresh(profile)
    return profile_payload(profile)


@router.get("/readiness")
def get_readiness(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_student),
):
    return readiness_payload(db, current_user)


@router.post("/quizzes")
def create_quiz(
    request: QuizCreateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_student),
):
    try:
        quiz = create_grounded_quiz(
            db,
            current_user,
            source_scope=request.source_scope,
            resource_type=request.resource_type,
            resource_id=request.resource_id,
            course_id=request.course_id,
            topic=request.topic,
            count=request.count,
            difficulty=request.difficulty,
            question_type=request.question_type,
        )
    except LookupError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    questions = db.query(models.LearningQuizQuestion).filter(
        models.LearningQuizQuestion.quiz_id == quiz.id,
    ).order_by(models.LearningQuizQuestion.position.asc()).all()
    return quiz_public_payload(quiz, questions)


@router.get("/quizzes")
def list_quizzes(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_student),
):
    quizzes = db.query(models.LearningQuiz).filter(
        models.LearningQuiz.user_id == current_user.id,
    ).order_by(models.LearningQuiz.created_at.desc(), models.LearningQuiz.id.desc()).limit(limit).all()
    return [quiz_public_payload(quiz) for quiz in quizzes]


@router.get("/quizzes/{quiz_id}")
def get_quiz(
    quiz_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_student),
):
    quiz = _owned_quiz(db, quiz_id, current_user)
    questions = db.query(models.LearningQuizQuestion).filter(
        models.LearningQuizQuestion.quiz_id == quiz.id,
    ).order_by(models.LearningQuizQuestion.position.asc()).all()
    return quiz_public_payload(quiz, questions)


@router.post("/quizzes/{quiz_id}/attempts")
def submit_quiz_attempt(
    quiz_id: int,
    request: QuizAttemptRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_student),
):
    quiz = _owned_quiz(db, quiz_id, current_user)
    try:
        attempt = record_quiz_attempt(
            db,
            current_user,
            quiz,
            [answer.model_dump() for answer in request.answers],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    payload = attempt_payload(attempt, quiz)
    payload["readiness"] = readiness_payload(db, current_user)
    return payload


@router.get("/quizzes/{quiz_id}/attempts")
def list_quiz_attempts(
    quiz_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_student),
):
    quiz = _owned_quiz(db, quiz_id, current_user)
    attempts = db.query(models.LearningQuizAttempt).filter(
        models.LearningQuizAttempt.quiz_id == quiz.id,
        models.LearningQuizAttempt.user_id == current_user.id,
    ).order_by(models.LearningQuizAttempt.completed_at.desc(), models.LearningQuizAttempt.id.desc()).all()
    return [attempt_payload(attempt, quiz) for attempt in attempts]


@router.get("/attempts")
def list_learning_attempts(
    limit: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_student),
):
    attempts = db.query(models.LearningQuizAttempt).filter(
        models.LearningQuizAttempt.user_id == current_user.id,
    ).order_by(models.LearningQuizAttempt.completed_at.desc(), models.LearningQuizAttempt.id.desc()).limit(limit).all()
    quizzes = {
        quiz.id: quiz
        for quiz in db.query(models.LearningQuiz).filter(
            models.LearningQuiz.id.in_({attempt.quiz_id for attempt in attempts} or {-1}),
            models.LearningQuiz.user_id == current_user.id,
        ).all()
    }
    return [attempt_payload(attempt, quizzes.get(attempt.quiz_id)) for attempt in attempts if attempt.quiz_id in quizzes]
