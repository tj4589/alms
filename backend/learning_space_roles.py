"""Small, non-public foundation for scoped learning-space role changes."""

from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

import models

MEMBERSHIP_ROLES = frozenset({"owner", "admin", "moderator", "member"})
MODERATION_ROLES = frozenset({"owner", "admin", "moderator"})
KSA_SLUG = "ksa"


def _normalized_reason(reason: str) -> str:
    normalized = str(reason or "").strip()
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A role-change reason is required.",
        )
    return normalized


def _role_transition_conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _ksa_membership_for_user(
    db: Session,
    user_id: int,
) -> tuple[models.User | None, models.LearningSpace | None, models.LearningSpaceMembership | None]:
    target = (
        db.query(models.User)
        .filter(models.User.id == user_id)
        .with_for_update()
        .first()
    )
    if target is None:
        return None, None, None

    space = (
        db.query(models.LearningSpace)
        .filter(
            models.LearningSpace.slug == KSA_SLUG,
            models.LearningSpace.status == "active",
        )
        .first()
    )
    if space is None:
        return target, None, None

    membership = (
        db.query(models.LearningSpaceMembership)
        .filter(
            models.LearningSpaceMembership.user_id == target.id,
            models.LearningSpaceMembership.learning_space_id == space.id,
        )
        .with_for_update()
        .first()
    )
    return target, space, membership


def _transition_ksa_moderator_role(
    db: Session,
    *,
    target_user_id: int,
    performed_by: models.User,
    reason: str,
    expected_role: str,
    new_role: str,
    success_status: str,
) -> dict[str, int | str]:
    """Apply one audited KSA moderator transition in one transaction."""
    clean_reason = _normalized_reason(reason)
    if target_user_id == performed_by.id:
        raise _role_transition_conflict("Administrators cannot change their own KSA moderator role.")

    target, space, membership = _ksa_membership_for_user(db, target_user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That user was not found.")
    if str(getattr(target, "account_status", None) or "active") != "active":
        raise _role_transition_conflict("The target account is not active.")
    if space is None or membership is None:
        raise _role_transition_conflict("The target user does not have a KSA membership.")
    if membership.status != "active":
        raise _role_transition_conflict("The target user does not have an active KSA membership.")
    if membership.role != expected_role:
        if expected_role == "member" and membership.role == "moderator":
            raise _role_transition_conflict("That KSA member is already a moderator.")
        if expected_role == "moderator" and membership.role == "member":
            raise _role_transition_conflict("That KSA member is already a regular member.")
        raise _role_transition_conflict("The KSA membership is not eligible for this role change.")

    previous_role = membership.role
    membership.role = new_role
    try:
        record_role_audit(
            db,
            membership=membership,
            previous_role=previous_role,
            new_role=new_role,
            performed_by=performed_by,
            reason=clean_reason,
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        raise _role_transition_conflict("The KSA moderator role change could not be completed safely.") from exc

    db.refresh(membership)
    return {
        "status": success_status,
        "user_id": target.id,
        "learning_space": KSA_SLUG,
        "membership_id": membership.id,
        "previous_role": previous_role,
        "new_role": membership.role,
        "reason": clean_reason,
    }


def promote_ksa_member_to_moderator(
    db: Session,
    *,
    target_user_id: int,
    performed_by: models.User,
    reason: str,
) -> dict[str, int | str]:
    return _transition_ksa_moderator_role(
        db,
        target_user_id=target_user_id,
        performed_by=performed_by,
        reason=reason,
        expected_role="member",
        new_role="moderator",
        success_status="promoted",
    )


def demote_ksa_moderator_to_member(
    db: Session,
    *,
    target_user_id: int,
    performed_by: models.User,
    reason: str,
) -> dict[str, int | str]:
    return _transition_ksa_moderator_role(
        db,
        target_user_id=target_user_id,
        performed_by=performed_by,
        reason=reason,
        expected_role="moderator",
        new_role="member",
        success_status="demoted",
    )


def record_role_audit(
    db: Session,
    *,
    membership: models.LearningSpaceMembership,
    previous_role: str,
    new_role: str,
    performed_by: models.User | None,
    reason: str,
    created_at: datetime | None = None,
) -> models.LearningSpaceRoleAudit:
    """Stage one immutable role event; the caller owns the transaction.

    The public KSA transition functions below validate and mutate the
    membership before calling this append-only audit boundary.
    """
    previous = str(previous_role or "").strip().lower()
    new = str(new_role or "").strip().lower()
    clean_reason = str(reason or "").strip()
    if previous not in MEMBERSHIP_ROLES or new not in MEMBERSHIP_ROLES:
        raise ValueError("Unsupported learning-space membership role.")
    if previous == new:
        raise ValueError("A role audit requires a role transition.")
    if not clean_reason:
        raise ValueError("A role-change reason is required.")

    space = db.query(models.LearningSpace).filter(
        models.LearningSpace.id == membership.learning_space_id,
    ).first()
    if space is None:
        raise ValueError("The learning space for this membership was not found.")

    audit = models.LearningSpaceRoleAudit(
        learning_space_id=membership.learning_space_id,
        learning_space_slug=space.slug,
        target_user_id=membership.user_id,
        membership_id=membership.id,
        previous_role=previous,
        new_role=new,
        performed_by_user_id=performed_by.id if performed_by is not None else None,
        reason=clean_reason,
        created_at=created_at,
    )
    db.add(audit)
    return audit
