"""Explicit, audited attribution of quarantined collaboration; never auto-backfill."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

import auth
import models
from database import get_db
from collaboration_access import require_linked_material_space

router = APIRouter(prefix="/collaboration/admin", tags=["collaboration administration"])
KINDS = {"group": models.StudyGroup, "thread": models.DiscussionThread, "room": models.StudySession}
ContentKind = Literal["group", "thread", "room"]


class AssignmentRequest(BaseModel):
    learning_space_id: int = Field(gt=0)
    reason: str = Field(min_length=3, max_length=1000)

    @field_validator("reason")
    @classmethod
    def meaningful_reason(cls, value):
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Explain the evidence for this assignment.")
        return value


def _summary(kind, row):
    # No messages, personal learning content, files, tokens or inferred identity.
    return {"content_type": kind, "id": row.id,
            "title": row.name if kind == "group" else row.title,
            "group_id": getattr(row, "group_id", None), "created_at": row.created_at}


@router.get("/quarantine")
def list_quarantine(kind: ContentKind = "group", offset: int = Query(0, ge=0),
                    limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db),
                    current_user: models.User = Depends(auth.require_global_admin)):
    auth.require_global_admin_user(current_user)
    model = KINDS[kind]
    query = db.query(model).filter(model.learning_space_id.is_(None))
    return {"items": [_summary(kind, row) for row in query.order_by(model.id).offset(offset).limit(limit).all()],
            "total": query.count(), "offset": offset, "limit": limit}


@router.get("/spaces")
def assignment_spaces(db: Session = Depends(get_db), current_user: models.User = Depends(auth.require_global_admin)):
    auth.require_global_admin_user(current_user)
    return [{"id": space.id, "name": space.name, "slug": space.slug} for space in
            db.query(models.LearningSpace).filter_by(status="active").order_by(models.LearningSpace.id).all()]


@router.post("/quarantine/{kind}/{content_id}/assign")
def assign_quarantined(kind: ContentKind, content_id: int, req: AssignmentRequest,
                       db: Session = Depends(get_db), current_user: models.User = Depends(auth.require_global_admin)):
    auth.require_global_admin_user(current_user)
    try:
        space = db.query(models.LearningSpace).filter_by(id=req.learning_space_id, status="active").with_for_update().first()
        if not space:
            raise HTTPException(status_code=404, detail="An active learning space is required.")
        model = KINDS[kind]
        row = db.query(model).filter_by(id=content_id).with_for_update().first()
        if not row:
            raise HTTPException(status_code=404, detail="Review item not found.")
        if row.learning_space_id is not None:
            raise HTTPException(status_code=409, detail="This item is already assigned. Refresh the review list.")
        if getattr(row, "group_id", None):
            parent = db.query(models.StudyGroup).filter_by(id=row.group_id).with_for_update().first()
            if parent is None or parent.learning_space_id != space.id:
                raise HTTPException(status_code=409, detail="Assign the parent group to this space first.")
        if kind == "group":
            for child in (models.DiscussionThread, models.StudySession):
                if db.query(child.id).filter(child.group_id == row.id, child.learning_space_id.isnot(None),
                                            child.learning_space_id != space.id).first():
                    raise HTTPException(status_code=409, detail="A linked record belongs to a different space.")
            for link in db.query(models.MaterialGroupShare).filter_by(group_id=row.id).all():
                require_linked_material_space(db, link.material_type, link.material_id, space.id)
            if db.query(models.SecureShareLink.id).filter(
                models.SecureShareLink.group_id == row.id, models.SecureShareLink.learning_space_id.isnot(None),
                models.SecureShareLink.learning_space_id != space.id,
            ).first():
                raise HTTPException(status_code=409, detail="A share link belongs to a different space.")
        if getattr(row, "past_question_id", None):
            require_linked_material_space(db, "past_question", row.past_question_id, space.id)
        row.learning_space_id = space.id
        db.add(models.CollaborationSpaceAudit(content_type=kind, content_id=row.id, learning_space_id=space.id,
                                             performed_by_user_id=current_user.id, reason=req.reason))
        db.commit()
        return {"status": "assigned", "content_type": kind, "id": row.id, "learning_space_id": space.id}
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=503, detail="Assignment could not be saved. Refresh before retrying.") from None
