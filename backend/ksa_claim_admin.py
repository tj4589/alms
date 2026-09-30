"""Administrative helpers for the KSA claim lifecycle."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
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


def ksa_membership_for_claim(
    db: Session,
    claim: models.KsaMember,
) -> models.LearningSpaceMembership | None:
    """Resolve the claimant's KSA membership in any status."""
    if claim.claimed_by_user_id is None:
        return None
    return (
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
    active_membership = active_ksa_membership_for_claim(db, claim)
    if active_membership is not None:
        return True
    membership = ksa_membership_for_claim(db, claim)
    if membership is None:
        return True
    return membership.status == "active" and membership.external_member_id == claim.ksa_id


def release_ksa_claim(
    db: Session,
    *,
    ksa_id: str,
    performed_by: models.User,
    reason: str,
) -> dict[str, Any]:
    """Release one owned KSA claim atomically for a global administrator.

    This deliberately does not transfer ownership. Clearing the inactive
    membership's external ID is required by the existing unique constraint so
    another user can later claim the same ID through the normal flow.
    """
    if not (reason or "").strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A release reason is required.")
    claim = db.query(models.KsaMember).filter(models.KsaMember.ksa_id == ksa_id).with_for_update().first()
    if claim is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That KSA claim was not found.")
    if claim.claimed_by_user_id is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That KSA claim is not currently owned.")
    if not claim_membership_ids_match(db, claim):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The KSA claim and membership are inconsistent; no changes were made.",
        )

    claimant = db.query(models.User).filter(models.User.id == claim.claimed_by_user_id).first()
    membership = ksa_membership_for_claim(db, claim)
    space = db.query(models.LearningSpace).filter(models.LearningSpace.slug == "ksa").first()
    if claimant is None or membership is None or space is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The KSA claim and membership are inconsistent; no changes were made.",
        )
    if membership.learning_space_id != space.id or membership.status != "active" or membership.external_member_id != ksa_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The KSA claim and membership are inconsistent; no changes were made.",
        )

    previous_active_space_id = claimant.active_learning_space_id
    try:
        claim.claimed_by_user_id = None
        claim.claimed_at = None
        claim.status = "released"

        membership.status = "inactive"
        # Preserve the membership row and its joined/onboarding history while
        # allowing another claimant through the unique external-ID constraint.
        membership.external_member_id = None

        if claimant.active_learning_space_id == space.id:
            claimant.active_learning_space_id = None

        record_claim_audit(
            db,
            ksa_id=ksa_id,
            action=RELEASED_ACTION,
            previous_user_id=claimant.id,
            current_user_id=None,
            performed_by_user_id=performed_by.id,
            reason=reason,
            metadata={
                "previous_membership_status": "active",
                "previous_active_space_id": previous_active_space_id,
            },
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The KSA claim release could not be completed safely.",
        ) from exc

    return {
        "ksa_id": ksa_id,
        "status": "released",
        "previous_user_id": claimant.id,
    }


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
