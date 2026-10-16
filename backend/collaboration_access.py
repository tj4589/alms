"""Space scope for collaboration. NULL ownership is quarantined, not public."""

from fastapi import HTTPException
from sqlalchemy import and_, exists, false, or_, select
from sqlalchemy.orm import Session

import models
from learning_spaces import authorized_active_space


def require_collaboration_space(db: Session, user: models.User) -> models.LearningSpace:
    space = authorized_active_space(db, user) if user is not None else None
    if space is None:
        raise HTTPException(status_code=403, detail="An authorized active learning space is required.")
    return space


def collaboration_filter(db: Session, model, user: models.User):
    """Apply before pagination/serialization; global admins use review routes."""
    space = authorized_active_space(db, user) if user is not None else None
    if space is None:
        return false()
    member = exists(select(models.StudyGroupMember.id).where(
        models.StudyGroupMember.group_id == models.StudyGroup.id,
        models.StudyGroupMember.user_id == user.id,
    ).correlate(models.StudyGroup))
    group_access = and_(models.StudyGroup.learning_space_id == space.id,
                        or_(models.StudyGroup.visibility == "public", member))
    if model is models.StudyGroup:
        return group_access
    parent = exists(select(models.StudyGroup.id).where(
        models.StudyGroup.id == model.group_id, group_access,
        *([member] if model is models.StudySession else []),
    ).correlate(model))
    return and_(model.learning_space_id == space.id, or_(model.group_id.is_(None), parent))


def require_collaboration_record(db: Session, row, user: models.User):
    # Object-level scope is separate from group membership: a valid invitation
    # may enroll a same-space user into a private group. Existing route/group
    # permissions still decide content/actions after this non-bypassable scope.
    space = authorized_active_space(db, user) if user is not None else None
    if row is None or space is None or getattr(row, "learning_space_id", None) != space.id:
        raise HTTPException(status_code=404, detail="Collaboration content is unavailable in this learning space.")
    if getattr(row, "group_id", None):
        require_group(db, row.group_id, user)
    return row


def require_group(db: Session, group_id: int, user: models.User):
    return require_collaboration_record(db, db.query(models.StudyGroup).filter_by(id=group_id).first(), user)


def require_linked_material_space(db: Session, material_type: str, material_id: int,
                                  space_id: int, actor: models.User | None = None) -> None:
    """A content link cannot silently bridge two spaces or unowned legacy data."""
    model = {"past_question": models.PastQuestion, "lecture_note": models.LectureNote}.get(material_type)
    source = db.query(model.id, model.metadata_json, model.uploaded_by).filter(model.id == material_id).first() if model else None
    contribution = db.query(models.MaterialContribution.learning_space_id).filter_by(
        material_type=material_type, material_id=material_id,
    ).first()
    metadata = (source.metadata_json or {}) if source else {}
    recorded_spaces = {value for value in (
        contribution.learning_space_id if contribution else None,
        metadata.get("learning_space_id"),
    ) if value is not None}
    if not source or (recorded_spaces and recorded_spaces != {space_id}) or (
        not recorded_spaces and not (
            actor is not None and source.uploaded_by == actor.id
            and require_collaboration_space(db, actor).id == space_id
        )
    ):
        raise HTTPException(status_code=409, detail="A linked resource has conflicting or unverified space ownership.")
