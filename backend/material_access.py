"""Visibility and access rules for uploaded academic materials."""

from __future__ import annotations

import json
from typing import Any, Iterable

from fastapi import HTTPException
from sqlalchemy import and_, exists, not_, or_, select, true
from sqlalchemy.orm import Session

import models


PRIVATE = "private"
PUBLIC = "public"
GROUP = "group"
SPACE_SHARED = "space_shared"
OFFICIAL = "official"
VISIBILITIES = frozenset({PRIVATE, PUBLIC, GROUP, SPACE_SHARED, OFFICIAL})
MODERATION_STATUSES = frozenset({
    "not_submitted",
    "pending_review",
    "approved",
    "rejected",
    "changes_requested",
})
MATERIAL_TYPES = frozenset({"past_question", "lecture_note"})
CU_SPACE_SLUG = "cu"


def normalize_visibility(value: Any) -> str:
    value = str(value or "").strip().lower()
    return value if value in VISIBILITIES else PRIVATE


def normalize_group_ids(value: Any) -> list[int]:
    """Turn form/JSON group IDs into a small, unique positive integer list."""
    if value in (None, "", []):
        return []
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            parsed = value.split(",")
        value = parsed
    if not isinstance(value, (list, tuple, set)):
        value = [value]

    result: list[int] = []
    for raw in value:
        try:
            group_id = int(raw)
        except (TypeError, ValueError) as exc:
            raise ValueError("group IDs must be positive integers") from exc
        if group_id <= 0:
            raise ValueError("group IDs must be positive integers")
        if group_id not in result:
            result.append(group_id)
    if len(result) > 20:
        raise ValueError("a material can be shared with at most 20 groups")
    return result


def material_type_for_model(model_or_row: Any) -> str:
    table_name = getattr(model_or_row, "__tablename__", None)
    if table_name is None:
        table_name = getattr(getattr(model_or_row, "__class__", None), "__tablename__", None)
    if table_name == "past_questions":
        return "past_question"
    if table_name == "lecture_notes":
        return "lecture_note"
    raise ValueError("unsupported material type")


def material_model(material_type: str):
    if material_type == "past_question":
        return models.PastQuestion
    if material_type == "lecture_note":
        return models.LectureNote
    raise HTTPException(status_code=400, detail="material_type must be past_question or lecture_note.")


def material_visibility(row: Any) -> str:
    # Treat pre-migration rows as private. A missing column must never widen
    # access while a deployment is rolling through its schema update.
    return normalize_visibility(getattr(row, "visibility", None))


def is_moderator(db: Session, current_user: Any, learning_space_id: int | None = None) -> bool:
    """Return whether the caller can review contributions in this space."""
    if getattr(current_user, "role", None) in {"admin", "moderator"}:
        return True
    if learning_space_id is None or not getattr(current_user, "id", None):
        return False
    return db.query(models.LearningSpaceMembership.id).filter(
        models.LearningSpaceMembership.user_id == current_user.id,
        models.LearningSpaceMembership.learning_space_id == learning_space_id,
        models.LearningSpaceMembership.status == "active",
        models.LearningSpaceMembership.role.in_(("owner", "admin", "moderator")),
    ).first() is not None


def contribution_for_material(db: Session, row_or_type: Any, material_id: int | None = None):
    try:
        material_type = row_or_type if isinstance(row_or_type, str) else material_type_for_model(row_or_type)
    except ValueError:
        # Lightweight access-test doubles may not carry a mapped SQLAlchemy
        # class.  They cannot have a contribution row, so stay private-safe.
        return None
    row_id = material_id if material_id is not None else getattr(row_or_type, "id", None)
    if row_id is None:
        return None
    return db.query(models.MaterialContribution).filter(
        models.MaterialContribution.material_type == material_type,
        models.MaterialContribution.material_id == row_id,
    ).first()


def contribution_payload(contribution: Any | None) -> dict[str, Any]:
    if contribution is None:
        return {
            "moderation_status": "not_submitted",
            "requested_visibility": None,
            "review_reason": None,
        }
    return {
        "contribution_id": contribution.id,
        "moderation_status": contribution.moderation_status,
        "requested_visibility": contribution.requested_visibility,
        "review_reason": contribution.review_reason,
        "learning_space_id": contribution.learning_space_id,
        "submitted_at": contribution.submitted_at,
        "reviewed_at": contribution.reviewed_at,
    }


def _contribution_exists(model: Any, *, status: str | None = None):
    material_type = material_type_for_model(model)
    conditions = [
        models.MaterialContribution.material_type == material_type,
        models.MaterialContribution.material_id == model.id,
    ]
    if status is not None:
        conditions.append(models.MaterialContribution.moderation_status == status)
    return exists(select(models.MaterialContribution.id).where(*conditions))


def _space_member_exists(model: Any, current_user: Any):
    material_type = material_type_for_model(model)
    return exists(
        select(models.LearningSpaceMembership.id)
        .join(
            models.MaterialContribution,
            models.MaterialContribution.learning_space_id == models.LearningSpaceMembership.learning_space_id,
        )
        .join(
            models.LearningSpace,
            models.LearningSpace.id == models.LearningSpaceMembership.learning_space_id,
        )
        .where(
            models.MaterialContribution.material_type == material_type,
            models.MaterialContribution.material_id == model.id,
            models.LearningSpaceMembership.user_id == current_user.id,
            models.LearningSpaceMembership.status == "active",
            or_(
                models.LearningSpace.slug != CU_SPACE_SLUG,
                models.LearningSpace.id == getattr(current_user, "active_learning_space_id", None),
            ),
        )
    )


def _cu_contribution_exists(model: Any):
    material_type = material_type_for_model(model)
    return exists(
        select(models.MaterialContribution.id)
        .join(
            models.LearningSpace,
            models.LearningSpace.id == models.MaterialContribution.learning_space_id,
        )
        .where(
            models.MaterialContribution.material_type == material_type,
            models.MaterialContribution.material_id == model.id,
            models.LearningSpace.slug == CU_SPACE_SLUG,
        )
    )


def _moderator_contribution_exists(model: Any, current_user: Any):
    material_type = material_type_for_model(model)
    return exists(
        select(models.LearningSpaceMembership.id)
        .join(
            models.MaterialContribution,
            models.MaterialContribution.learning_space_id == models.LearningSpaceMembership.learning_space_id,
        )
        .where(
            models.MaterialContribution.material_type == material_type,
            models.MaterialContribution.material_id == model.id,
            models.MaterialContribution.moderation_status != "not_submitted",
            models.LearningSpaceMembership.user_id == current_user.id,
            models.LearningSpaceMembership.status == "active",
            models.LearningSpaceMembership.role.in_(("owner", "admin", "moderator")),
        )
    )


def accessible_material_filter(db: Session, model: Any, current_user: Any):
    """SQL predicate for materials visible to the verified current user."""
    if getattr(current_user, "role", None) in {"admin", "moderator"}:
        return true()

    material_type = material_type_for_model(model)
    group_material_ids = (
        select(models.MaterialGroupShare.material_id)
        .join(
            models.StudyGroup,
            models.StudyGroup.id == models.MaterialGroupShare.group_id,
        )
        .join(
            models.StudyGroupMember,
            models.StudyGroupMember.group_id == models.MaterialGroupShare.group_id,
        )
        .where(
            models.MaterialGroupShare.material_type == material_type,
            models.StudyGroup.status == "active",
            models.StudyGroupMember.user_id == current_user.id,
        )
    )
    shared_visibility = and_(
        model.visibility.in_((SPACE_SHARED, OFFICIAL)),
        _contribution_exists(model, status="approved"),
        _space_member_exists(model, current_user),
    )
    moderator_visibility = and_(
        model.visibility.in_((PRIVATE, SPACE_SHARED, OFFICIAL)),
        _moderator_contribution_exists(model, current_user),
    )
    public_visibility = and_(
        model.visibility == PUBLIC,
        or_(
            not_(_cu_contribution_exists(model)),
            _space_member_exists(model, current_user),
        ),
    )
    return or_(
        model.uploaded_by == current_user.id,
        public_visibility,
        and_(model.visibility == GROUP, model.id.in_(group_material_ids)),
        shared_visibility,
        moderator_visibility,
    )


def can_view_material(db: Session, row: Any, current_user: Any) -> bool:
    if getattr(current_user, "role", None) in {"admin", "moderator"}:
        return True
    if getattr(row, "uploaded_by", None) == getattr(current_user, "id", None):
        return True
    contribution = contribution_for_material(db, row)
    if contribution is not None and is_moderator(db, current_user, contribution.learning_space_id):
        return True
    visibility = material_visibility(row)
    if visibility == PUBLIC:
        cu_space = db.query(models.LearningSpace).filter(
            models.LearningSpace.id == contribution.learning_space_id,
            models.LearningSpace.slug == CU_SPACE_SLUG,
        ).first() if contribution is not None else None
        if cu_space is not None:
            return db.query(models.LearningSpaceMembership.id).filter(
                models.LearningSpaceMembership.user_id == current_user.id,
                models.LearningSpaceMembership.learning_space_id == cu_space.id,
                models.LearningSpaceMembership.status == "active",
            ).first() is not None and getattr(current_user, "active_learning_space_id", None) == cu_space.id
        return True
    if visibility != GROUP:
        if visibility not in {SPACE_SHARED, OFFICIAL}:
            return False
        if contribution is None:
            return False
        if contribution.moderation_status != "approved":
            return False
        return db.query(models.LearningSpaceMembership.id).filter(
            models.LearningSpaceMembership.user_id == current_user.id,
            models.LearningSpaceMembership.learning_space_id == contribution.learning_space_id,
            models.LearningSpaceMembership.status == "active",
        ).first() is not None and (
            db.query(models.LearningSpace).filter(
                models.LearningSpace.id == contribution.learning_space_id,
                models.LearningSpace.slug == CU_SPACE_SLUG,
            ).first() is None
            or getattr(current_user, "active_learning_space_id", None) == contribution.learning_space_id
        )
    material_type = material_type_for_model(row)
    return (
        db.query(models.MaterialGroupShare)
        .join(
            models.StudyGroup,
            models.StudyGroup.id == models.MaterialGroupShare.group_id,
        )
        .join(
            models.StudyGroupMember,
            models.StudyGroupMember.group_id == models.MaterialGroupShare.group_id,
        )
        .filter(
            models.MaterialGroupShare.material_type == material_type,
            models.MaterialGroupShare.material_id == row.id,
            models.StudyGroup.status == "active",
            models.StudyGroupMember.user_id == current_user.id,
        )
        .first()
        is not None
    )


def require_material_owner(row: Any, current_user: Any) -> None:
    if getattr(current_user, "role", None) not in {"admin", "moderator"} and getattr(row, "uploaded_by", None) != getattr(current_user, "id", None):
        raise HTTPException(status_code=403, detail="Only the uploader can change this material's sharing.")


def request_material_contribution(
    db: Session,
    rows: Iterable[Any],
    current_user: Any,
    learning_space_id: int,
    requested_visibility: str = SPACE_SHARED,
    group_ids: Iterable[int] = (),
):
    """Record explicit contribution consent while keeping material private."""
    rows = list(rows)
    if not rows:
        raise ValueError("At least one material row is required.")
    requested_visibility = normalize_visibility(requested_visibility)
    if requested_visibility not in {SPACE_SHARED, OFFICIAL, PUBLIC}:
        raise ValueError("Only shared archive contributions can be submitted for review.")
    material_type = material_type_for_model(rows[0])
    material_ids = [row.id for row in rows if getattr(row, "id", None) is not None]
    primary_id = material_ids[0]
    contribution = None
    from datetime import datetime, timezone
    submitted_at = datetime.now(timezone.utc)
    for row in rows:
        row_contribution = db.query(models.MaterialContribution).filter(
            models.MaterialContribution.material_type == material_type,
            models.MaterialContribution.material_id == row.id,
        ).first()
        if row_contribution is None:
            row_contribution = models.MaterialContribution(
                material_type=material_type,
                material_id=row.id,
                learning_space_id=learning_space_id,
                submitted_by=getattr(current_user, "id", None),
            )
            db.add(row_contribution)
        if contribution is None:
            contribution = row_contribution
        row_contribution.learning_space_id = learning_space_id
        row_contribution.submitted_by = getattr(current_user, "id", None)
        row_contribution.requested_visibility = SPACE_SHARED if requested_visibility == PUBLIC else requested_visibility
        row_contribution.requested_group_ids = list(group_ids)
        row_contribution.moderation_status = "pending_review"
        row_contribution.review_reason = None
        row_contribution.reviewed_by = None
        row_contribution.reviewed_at = None
        row_contribution.submitted_at = submitted_at
        row.visibility = PRIVATE
        metadata = dict(getattr(row, "metadata_json", None) or {})
        metadata["visibility"] = PRIVATE
        metadata["requested_visibility"] = row_contribution.requested_visibility
        metadata["moderation_status"] = "pending_review"
        row.metadata_json = metadata
    return contribution


def require_contribution_space(db: Session, current_user: Any) -> models.LearningSpace:
    """Contributions are currently anchored to a verified active KSA space."""
    space = db.query(models.LearningSpace).filter(
        models.LearningSpace.id == getattr(current_user, "active_learning_space_id", None),
        models.LearningSpace.status == "active",
    ).first()
    if space is None or space.slug != "ksa":
        raise HTTPException(
            status_code=403,
            detail="Verify your Kora Sales Academy membership before contributing to the academy archive.",
        )
    membership = db.query(models.LearningSpaceMembership.id).filter(
        models.LearningSpaceMembership.user_id == current_user.id,
        models.LearningSpaceMembership.learning_space_id == space.id,
        models.LearningSpaceMembership.status == "active",
    ).first()
    if membership is None:
        raise HTTPException(status_code=403, detail="Join the Kora Sales Academy space before contributing material.")
    return space


def validate_share_groups(db: Session, group_ids: Iterable[int], current_user: Any) -> list[int]:
    group_ids = list(group_ids)
    if not group_ids:
        raise HTTPException(status_code=400, detail="Choose at least one study group.")
    groups = (
        db.query(models.StudyGroup)
        .join(models.StudyGroupMember, models.StudyGroupMember.group_id == models.StudyGroup.id)
        .filter(
            models.StudyGroup.id.in_(group_ids),
            models.StudyGroup.status == "active",
            models.StudyGroupMember.user_id == current_user.id,
        )
        .all()
    )
    found = {group.id for group in groups}
    if found != set(group_ids):
        raise HTTPException(status_code=403, detail="You can share materials only with active groups you belong to.")
    return group_ids


def set_material_visibility(
    db: Session,
    rows: Iterable[Any],
    visibility: str,
    group_ids: Iterable[int],
    shared_by: int,
) -> list[int]:
    """Set visibility for all rows belonging to one logical material."""
    rows = list(rows)
    visibility = normalize_visibility(visibility)
    group_ids = list(group_ids)
    material_type = material_type_for_model(rows[0]) if rows else None
    material_ids = [row.id for row in rows if getattr(row, "id", None) is not None]
    if material_type and material_ids and hasattr(db, "query"):
        db.query(models.MaterialGroupShare).filter(
            models.MaterialGroupShare.material_type == material_type,
            models.MaterialGroupShare.material_id.in_(material_ids),
        ).delete(synchronize_session=False)

    for row in rows:
        row.visibility = visibility
        metadata = dict(getattr(row, "metadata_json", None) or {})
        metadata["visibility"] = visibility
        if visibility == GROUP:
            metadata["shared_group_ids"] = group_ids
        else:
            metadata.pop("shared_group_ids", None)
        row.metadata_json = metadata
        if material_type and visibility == GROUP:
            for group_id in group_ids:
                db.add(
                    models.MaterialGroupShare(
                        material_type=material_type,
                        material_id=row.id,
                        group_id=group_id,
                        shared_by=shared_by,
                    )
                )
    return material_ids


def sharing_payload(visibility: str, group_ids: Iterable[int] = ()) -> dict[str, Any]:
    visibility = normalize_visibility(visibility)
    return {
        "visibility": visibility,
        "group_ids": list(group_ids) if visibility == GROUP else [],
    }
