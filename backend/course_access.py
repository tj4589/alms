"""Learning-space ownership rules for the course catalogue.

Course rows used to be global.  New rows are now assigned to the caller's
authorized active learning space, while legacy rows without an owner remain
hidden from student-space responses until an administrator can classify them.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import exists, false, or_, select
from sqlalchemy.orm import Session

import models
from learning_spaces import authorized_active_space


def active_course_query(db: Session, user: models.User):
    """Return only courses owned by the user's verified active space."""
    space = authorized_active_space(db, user)
    query = db.query(models.Course)
    if space is None:
        return query.filter(false())
    return query.filter(models.Course.learning_space_id == space.id)


def active_course(db: Session, user: models.User, course_id: int | None) -> models.Course | None:
    if course_id is None:
        return None
    return active_course_query(db, user).filter(models.Course.id == course_id).first()


def require_active_course(db: Session, user: models.User, course_id: int | None) -> models.Course:
    course = active_course(db, user, course_id)
    if course is None:
        raise HTTPException(status_code=400, detail="That course is unavailable in this learning space.")
    return course


def course_matches_active_space(db: Session, user: models.User, course_id: int | None) -> bool:
    """Return whether an optional course link is safe for this active space."""
    return course_id is None or active_course(db, user, course_id) is not None


def course_link_filter(db: Session, user: models.User, model):
    """Scope rows with optional course links to the active learning space."""
    space = authorized_active_space(db, user)
    if space is None:
        return false()
    return or_(
        model.course_id.is_(None),
        exists(select(models.Course.id).where(
            models.Course.id == model.course_id,
            models.Course.learning_space_id == space.id,
        )),
    )
