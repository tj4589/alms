"""Authenticated and public product feedback endpoints."""

from collections import defaultdict, deque
from datetime import datetime
from threading import Lock
from time import monotonic

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

import auth
import models
import schemas
from database import get_db

router = APIRouter(prefix="/feedback", tags=["feedback"])

PUBLIC_FEEDBACK_MAX_BYTES = 64 * 1024
PUBLIC_FEEDBACK_RATE_LIMIT = 5
PUBLIC_FEEDBACK_RATE_WINDOW_SECONDS = 15 * 60
PUBLIC_FEEDBACK_SUCCESS = "Thanks for helping us improve ExamMind."


class FeedbackRateLimiter:
    """Small in-process limiter; keys and timestamps are never persisted."""

    def __init__(self, limit: int = PUBLIC_FEEDBACK_RATE_LIMIT, window_seconds: int = PUBLIC_FEEDBACK_RATE_WINDOW_SECONDS):
        self.limit = limit
        self.window_seconds = window_seconds
        self._buckets: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str, now: float | None = None) -> bool:
        current = monotonic() if now is None else now
        with self._lock:
            bucket = self._buckets[key]
            while bucket and bucket[0] <= current - self.window_seconds:
                bucket.popleft()
            if len(bucket) >= self.limit:
                return False
            bucket.append(current)
            if len(self._buckets) > 2048:
                stale_keys = [name for name, values in self._buckets.items() if not values]
                for stale_key in stale_keys:
                    self._buckets.pop(stale_key, None)
            return True


public_feedback_rate_limiter = FeedbackRateLimiter()


def _request_rate_key(request: Request) -> str:
    # Render's proxy address is used transiently for abuse protection only.
    # It is not written to the Feedback row, logs, or any analytics payload.
    return request.client.host if request.client and request.client.host else "unknown-client"


def _save_feedback(db: Session, **values) -> models.Feedback:
    feedback = models.Feedback(**values)
    db.add(feedback)
    try:
        db.commit()
        db.refresh(feedback)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="We could not save your feedback. Please try again.",
        ) from exc
    return feedback


def _success() -> schemas.FeedbackSubmissionResponse:
    return schemas.FeedbackSubmissionResponse(message=PUBLIC_FEEDBACK_SUCCESS)


@router.post("/public", response_model=schemas.FeedbackSubmissionResponse, status_code=status.HTTP_201_CREATED)
def create_public_feedback(
    payload: schemas.PublicFeedbackRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    if payload.website:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="We could not accept that feedback.")
    if not public_feedback_rate_limiter.allow(_request_rate_key(request)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Please wait before sending another message.",
        )

    _save_feedback(
        db,
        user_id=None,
        guest_name=payload.guest_name,
        reply_email=str(payload.reply_email) if payload.reply_email else None,
        source="public",
        category=payload.category,
        message=payload.message,
        rating=payload.rating,
        page_path=payload.page_path,
        status="new",
    )
    return _success()


@router.post("", response_model=schemas.FeedbackSubmissionResponse, status_code=status.HTTP_201_CREATED)
def create_authenticated_feedback(
    payload: schemas.AuthenticatedFeedbackRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _save_feedback(
        db,
        user_id=current_user.id,
        guest_name=None,
        reply_email=None,
        source="authenticated",
        category=payload.category,
        message=payload.message,
        rating=payload.rating,
        page_path=payload.page_path,
        status="new",
    )
    return _success()


def _require_admin(current_user: models.User = Depends(auth.get_current_user)) -> models.User:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access is required.")
    return current_user


@router.get("/inbox", response_model=list[schemas.FeedbackInboxItem])
def get_feedback_inbox(
    db: Session = Depends(get_db),
    _admin: models.User = Depends(_require_admin),
):
    rows = db.query(models.Feedback).order_by(models.Feedback.created_at.desc()).limit(200).all()
    users = {
        user.id: user
        for user in db.query(models.User).filter(models.User.id.in_([row.user_id for row in rows if row.user_id])).all()
    }
    items = []
    for row in rows:
        user = users.get(row.user_id)
        is_public = row.source == "public"
        items.append(
            {
                "id": row.id,
                "source": row.source,
                "identity_label": "Public visitor" if is_public else "Verified student",
                "category": row.category,
                "message": row.message,
                "rating": row.rating,
                "page_path": row.page_path,
                "status": row.status,
                "created_at": row.created_at.isoformat() if isinstance(row.created_at, datetime) else str(row.created_at),
                "updated_at": row.updated_at.isoformat() if isinstance(row.updated_at, datetime) else str(row.updated_at),
                "user_name": user.name if user and not is_public else None,
                "user_email": user.email if user and not is_public else None,
                "guest_name": row.guest_name if is_public and row.guest_name else None,
                "reply_email": row.reply_email if is_public and row.reply_email else None,
            }
        )
    return items
