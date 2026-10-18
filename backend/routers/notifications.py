from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import auth
import models
from database import get_db
from learning_spaces import active_membership, authorized_active_space

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _space_or_403(db: Session, current_user: models.User) -> models.LearningSpace:
    space = authorized_active_space(db, current_user)
    if space is None or active_membership(db, current_user, space.id) is None:
        raise HTTPException(status_code=403, detail="Choose an authorized active learning space first.")
    return space


def _payload(notification: models.Notification) -> dict:
    return {
        "id": notification.id,
        "event_type": notification.event_type,
        "title": notification.title,
        "body": notification.body,
        "target_screen": notification.target_screen,
        "target_id": notification.target_id,
        "learning_space_id": notification.learning_space_id,
        "created_at": notification.created_at,
        "read_at": notification.read_at,
        "is_read": notification.read_at is not None,
    }


@router.get("")
def list_notifications(
    limit: int = Query(default=40, ge=1, le=100),
    unread_only: bool = False,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    space = _space_or_403(db, current_user)
    query = db.query(models.Notification).filter(
        models.Notification.recipient_user_id == current_user.id,
        models.Notification.learning_space_id == space.id,
    )
    if unread_only:
        query = query.filter(models.Notification.read_at.is_(None))
    items = query.order_by(
        models.Notification.created_at.desc(),
        models.Notification.id.desc(),
    ).limit(limit).all()
    unread_count = db.query(models.Notification.id).filter(
        models.Notification.recipient_user_id == current_user.id,
        models.Notification.learning_space_id == space.id,
        models.Notification.read_at.is_(None),
    ).count()
    return {
        "items": [_payload(item) for item in items],
        "unread_count": unread_count,
    }


@router.patch("/{notification_id}/read")
def mark_notification_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    space = _space_or_403(db, current_user)
    notification = db.query(models.Notification).filter(
        models.Notification.id == notification_id,
        models.Notification.recipient_user_id == current_user.id,
        models.Notification.learning_space_id == space.id,
    ).first()
    if notification is None:
        raise HTTPException(status_code=404, detail="Notification not found.")
    if notification.read_at is None:
        notification.read_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(notification)
    return _payload(notification)


@router.post("/read-all")
def mark_all_notifications_read(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    space = _space_or_403(db, current_user)
    updated = db.query(models.Notification).filter(
        models.Notification.recipient_user_id == current_user.id,
        models.Notification.learning_space_id == space.id,
        models.Notification.read_at.is_(None),
    ).update({models.Notification.read_at: datetime.now(timezone.utc)}, synchronize_session=False)
    db.commit()
    return {"updated_count": updated, "unread_count": 0}
