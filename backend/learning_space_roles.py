"""Small, non-public foundation for scoped learning-space role changes."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

import models

MEMBERSHIP_ROLES = frozenset({"owner", "admin", "moderator", "member"})
MODERATION_ROLES = frozenset({"owner", "admin", "moderator"})


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

    This helper deliberately records history only. Public promotion/demotion
    authorization and membership mutation are deferred to S5.2+.
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
