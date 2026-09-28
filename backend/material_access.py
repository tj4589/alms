"""Visibility and access rules for uploaded academic materials."""

from __future__ import annotations

import json
from typing import Any, Iterable

from fastapi import HTTPException
from sqlalchemy import and_, or_, select, true
from sqlalchemy.orm import Session

import models


PRIVATE = "private"
PUBLIC = "public"
GROUP = "group"
VISIBILITIES = frozenset({PRIVATE, PUBLIC, GROUP})
MATERIAL_TYPES = frozenset({"past_question", "lecture_note"})


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


def accessible_material_filter(db: Session, model: Any, current_user: Any):
    """SQL predicate for materials visible to the verified current user."""
    if getattr(current_user, "role", None) == "admin":
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
    return or_(
        model.uploaded_by == current_user.id,
        model.visibility == PUBLIC,
        and_(model.visibility == GROUP, model.id.in_(group_material_ids)),
    )


def can_view_material(db: Session, row: Any, current_user: Any) -> bool:
    if getattr(current_user, "role", None) == "admin":
        return True
    if getattr(row, "uploaded_by", None) == getattr(current_user, "id", None):
        return True
    visibility = material_visibility(row)
    if visibility == PUBLIC:
        return True
    if visibility != GROUP:
        return False
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
    if getattr(current_user, "role", None) != "admin" and getattr(row, "uploaded_by", None) != getattr(current_user, "id", None):
        raise HTTPException(status_code=403, detail="Only the uploader can change this material's sharing.")


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
