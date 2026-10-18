"""Small, durable in-app notification primitives.

This module deliberately covers only events that already exist in the product:
replies to a discussion thread. Delivery through email or browser push remains
separate and disabled.
"""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from learning_spaces import active_membership, authorized_active_space


def _active_space_id(db: Session, user: models.User) -> int | None:
    space = authorized_active_space(db, user)
    return space.id if space is not None else None


def create_notification(
    db: Session,
    *,
    recipient_user_id: int,
    learning_space_id: int,
    event_type: str,
    event_key: str,
    title: str,
    body: str,
    target_screen: str,
    target_id: int | None = None,
) -> models.Notification | None:
    """Insert one recipient-scoped event, safely ignoring a duplicate.

    The unique constraint is the source of truth for concurrent duplicate
    prevention. A savepoint keeps a duplicate from rolling back the parent
    discussion transaction.
    """

    if active_membership(db, db.get(models.User, recipient_user_id), learning_space_id) is None:
        return None
    notification = models.Notification(
        recipient_user_id=recipient_user_id,
        learning_space_id=learning_space_id,
        event_type=event_type,
        event_key=event_key,
        title=title,
        body=body,
        target_screen=target_screen,
        target_id=target_id,
    )
    try:
        with db.begin_nested():
            db.add(notification)
            db.flush()
    except IntegrityError:
        return db.query(models.Notification).filter(
            models.Notification.recipient_user_id == recipient_user_id,
            models.Notification.learning_space_id == learning_space_id,
            models.Notification.event_type == event_type,
            models.Notification.event_key == event_key,
        ).first()
    return notification


def notify_discussion_reply(
    db: Session,
    *,
    thread: models.DiscussionThread,
    message: models.ThreadMessage,
    actor: models.User,
) -> models.Notification | None:
    """Notify a thread author about a human reply in their active space."""

    recipient_id = thread.created_by
    if not recipient_id or recipient_id == actor.id:
        return None

    space_id = _active_space_id(db, actor)
    if space_id is None:
        return None

    explicit_thread_space = getattr(thread, "learning_space_id", None)
    # Legacy collaboration rows are intentionally not assigned to a space.
    # Do not manufacture a notification scope for those rows from the actor's
    # current membership; an administrator must assign them first.
    if explicit_thread_space is None or explicit_thread_space != space_id:
        return None

    return create_notification(
        db,
        recipient_user_id=recipient_id,
        learning_space_id=space_id,
        event_type="discussion_reply",
        event_key=f"thread-reply:{thread.id}:message:{message.id}",
        title="New reply in your discussion",
        body="A student replied to a discussion you started.",
        target_screen="discussions",
        target_id=thread.id,
    )
