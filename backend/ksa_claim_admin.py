"""Administrative helpers for the KSA claim lifecycle.

Release and reassignment are deliberately deferred to S4.2. This module only
owns the shared authorization-safe audit and consistency boundaries needed by
those later workflows.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

import models

CLAIMED_ACTION = "CLAIMED"
RELEASED_ACTION = "RELEASED"
SUPPORTED_AUDIT_ACTIONS = frozenset({CLAIMED_ACTION, RELEASED_ACTION})


def record_claim_audit(
    db: Session,
    *,
    ksa_id: str,
    action: str,
    previous_user_id: int | None = None,
    current_user_id: int | None = None,
    performed_by_user_id: int | None = None,
    reason: str | None = None,
    metadata: dict[str, Any] | None = None,
    created_at: datetime | None = None,
) -> models.KsaClaimAudit:
    """Stage one immutable lifecycle event; the caller owns the transaction."""
    if action not in SUPPORTED_AUDIT_ACTIONS:
        raise ValueError(f"Unsupported KSA claim audit action: {action}")
    audit = models.KsaClaimAudit(
        ksa_id=ksa_id,
        action=action,
        previous_user_id=previous_user_id,
        current_user_id=current_user_id,
        performed_by_user_id=performed_by_user_id,
        reason=reason,
        metadata_json=metadata,
        created_at=created_at,
    )
    db.add(audit)
    return audit


def active_ksa_membership_for_claim(
    db: Session,
    claim: models.KsaMember,
) -> models.LearningSpaceMembership | None:
    """Resolve the active KSA membership associated with one claim row."""
    return (
        db.query(models.LearningSpaceMembership)
        .join(
            models.LearningSpace,
            models.LearningSpace.id == models.LearningSpaceMembership.learning_space_id,
        )
        .filter(
            models.LearningSpaceMembership.user_id == claim.claimed_by_user_id,
            models.LearningSpaceMembership.external_member_id == claim.ksa_id,
            models.LearningSpaceMembership.status == "active",
            models.LearningSpace.slug == "ksa",
        )
        .first()
    )


def claim_membership_ids_match(
    db: Session,
    claim: models.KsaMember,
) -> bool:
    """Return whether an active KSA membership agrees with the claim ID.

    A claim without a membership is not treated as a mismatch here because
    imported/unclaimed registry rows are valid before a user claims them.
    """
    if claim.claimed_by_user_id is None:
        return True
    membership = active_ksa_membership_for_claim(db, claim)
    if membership is None:
        return not db.query(models.LearningSpaceMembership).join(
            models.LearningSpace,
            models.LearningSpace.id == models.LearningSpaceMembership.learning_space_id,
        ).filter(
            models.LearningSpaceMembership.user_id == claim.claimed_by_user_id,
            models.LearningSpaceMembership.status == "active",
            models.LearningSpace.slug == "ksa",
        ).first()
    return membership.external_member_id == claim.ksa_id


def inspect_ksa_claim(db: Session, ksa_id: str) -> dict[str, Any]:
    """Build a minimal administrative view of one canonical KSA claim."""
    claim = db.query(models.KsaMember).filter(models.KsaMember.ksa_id == ksa_id).first()
    audits = (
        db.query(models.KsaClaimAudit)
        .filter(models.KsaClaimAudit.ksa_id == ksa_id)
        .order_by(models.KsaClaimAudit.created_at.asc(), models.KsaClaimAudit.id.asc())
        .all()
    )
    claimant = None
    membership = None
    if claim is not None and claim.claimed_by_user_id is not None:
        claimant = db.query(models.User).filter(models.User.id == claim.claimed_by_user_id).first()
        membership = (
            db.query(models.LearningSpaceMembership)
            .join(
                models.LearningSpace,
                models.LearningSpace.id == models.LearningSpaceMembership.learning_space_id,
            )
            .filter(
                models.LearningSpaceMembership.user_id == claim.claimed_by_user_id,
                models.LearningSpace.slug == "ksa",
            )
            .first()
        )

    return {
        "ksa_id": ksa_id,
        "claimed": bool(claim and claim.claimed_by_user_id),
        "claim_status": claim.status if claim else None,
        "claimed_at": claim.claimed_at.isoformat() if claim and claim.claimed_at else None,
        "claimant": (
            {
                "id": claimant.id,
                "name": claimant.name,
                "username": claimant.username,
                "email": claimant.email,
            }
            if claimant
            else None
        ),
        "membership": (
            {
                "status": membership.status,
                "role": membership.role,
                "onboarding_state": membership.onboarding_state,
                "external_member_id": membership.external_member_id,
            }
            if membership
            else None
        ),
        "audit_history": [
            {
                "id": audit.id,
                "action": audit.action,
                "previous_user_id": audit.previous_user_id,
                "current_user_id": audit.current_user_id,
                "performed_by_user_id": audit.performed_by_user_id,
                "reason": audit.reason,
                "created_at": audit.created_at.isoformat() if audit.created_at else None,
                "metadata": audit.metadata_json,
            }
            for audit in audits
        ],
    }
