"""Learning-space membership and KSA access helpers.

This module owns the platform foundation only. Resource permissions and the
workspace reader remain separate phases so membership cannot be confused with
resource visibility.
"""

import re
from datetime import datetime, timezone
from typing import Iterable

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models

CU_SLUG = "cu"
KSA_SLUG = "ksa"
KSA_ID_RE = re.compile(r"^KSA-[A-Z0-9]{1,24}$")
CLAIM_FAILURE_MESSAGE = "That KSA ID could not be verified. Contact support if you believe it belongs to you."

SPACE_SEEDS = (
    {
        "slug": KSA_SLUG,
        "name": "Kora Sales Academy",
        "type": "academy",
        "description": "A focused learning space for Kora Sales Academy interns.",
    },
    {
        "slug": CU_SLUG,
        "name": "Covenant University",
        "type": "university",
        "description": "Your Covenant University study space for courses and academic materials.",
    },
)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def normalize_ksa_id(value: str) -> str:
    normalized = "-".join(str(value or "").strip().upper().split())
    if not KSA_ID_RE.fullmatch(normalized):
        raise ValueError("Enter a valid KSA ID, such as KSA-36.")
    return normalized


def seed_learning_spaces(db: Session, *, backfill_users: bool = False) -> None:
    """Create the two configured spaces without creating registry members."""
    spaces_by_slug: dict[str, models.LearningSpace] = {}
    changed = False
    for seed in SPACE_SEEDS:
        space = db.query(models.LearningSpace).filter(models.LearningSpace.slug == seed["slug"]).first()
        if space is None:
            space = models.LearningSpace(**seed)
            db.add(space)
            changed = True
        else:
            for field in ("name", "type", "description"):
                if not getattr(space, field, None):
                    setattr(space, field, seed[field])
                    changed = True
        spaces_by_slug[seed["slug"]] = space

    db.flush()
    if backfill_users:
        from firebase_tokens import is_allowed_school_email

        cu_space = spaces_by_slug[CU_SLUG]
        users = db.query(models.User).all()
        for user in users:
            # Initialization is an explicit compatibility backfill for CU
            # accounts, not a global identity-to-space bridge. Existing
            # memberships remain untouched, while non-CU identities never
            # receive a new CU membership here.
            if not is_allowed_school_email(str(user.email or "")):
                continue
            membership = (
                db.query(models.LearningSpaceMembership)
                .filter(
                    models.LearningSpaceMembership.user_id == user.id,
                    models.LearningSpaceMembership.learning_space_id == cu_space.id,
                )
                .first()
            )
            if membership is None:
                db.add(models.LearningSpaceMembership(user_id=user.id, learning_space_id=cu_space.id, onboarding_state="completed"))
                changed = True
            if user.active_learning_space_id is None:
                user.active_learning_space_id = cu_space.id
                changed = True
    if changed:
        db.commit()


def ensure_cu_membership(db: Session, user: models.User) -> models.LearningSpaceMembership | None:
    """Lazily preserve CU access for a newly linked CU Firebase account."""
    from firebase_tokens import is_allowed_school_email

    if not is_allowed_school_email(str(user.email or "")):
        return None
    space = db.query(models.LearningSpace).filter(models.LearningSpace.slug == CU_SLUG).first()
    if space is None:
        seed_learning_spaces(db)
        space = db.query(models.LearningSpace).filter(models.LearningSpace.slug == CU_SLUG).first()
    if space is None:
        return None
    membership = (
        db.query(models.LearningSpaceMembership)
        .filter(
            models.LearningSpaceMembership.user_id == user.id,
            models.LearningSpaceMembership.learning_space_id == space.id,
        )
        .first()
    )
    changed = False
    if membership is None:
        membership = models.LearningSpaceMembership(
            user_id=user.id,
            learning_space_id=space.id,
            role="member",
            status="active",
            onboarding_state="completed",
        )
        db.add(membership)
        changed = True
    if user.active_learning_space_id is None:
        user.active_learning_space_id = space.id
        changed = True
    if changed:
        db.commit()
        db.refresh(membership)
    return membership


def membership_payload(membership: models.LearningSpaceMembership) -> dict:
    return {
        "id": membership.id,
        "role": membership.role,
        "status": membership.status,
        "external_member_id": membership.external_member_id,
        "onboarding_required": membership.onboarding_state != "completed",
        "joined_at": membership.joined_at.isoformat() if membership.joined_at else None,
    }


def space_payload(space: models.LearningSpace, membership: models.LearningSpaceMembership | None = None) -> dict:
    return {
        "id": space.id,
        "slug": space.slug,
        "name": space.name,
        "type": space.type,
        "description": space.description,
        "logo": space.logo,
        "status": space.status,
        "membership": membership_payload(membership) if membership else None,
    }


def list_spaces(db: Session, user: models.User) -> dict:
    spaces = db.query(models.LearningSpace).filter(models.LearningSpace.status == "active").order_by(models.LearningSpace.id).all()
    memberships = (
        db.query(models.LearningSpaceMembership)
        .filter(
            models.LearningSpaceMembership.user_id == user.id,
            models.LearningSpaceMembership.status == "active",
        )
        .all()
    )
    by_space = {membership.learning_space_id: membership for membership in memberships}
    active_space = next((space for space in spaces if space.id == user.active_learning_space_id and space.id in by_space), None)
    if active_space is None and memberships:
        active_space = next((space for space in spaces if space.id == memberships[0].learning_space_id), None)
        if active_space is not None:
            user.active_learning_space_id = active_space.id
            db.commit()
    return {
        "active_space": space_payload(active_space, by_space.get(active_space.id) if active_space else None) if active_space else None,
        "memberships": [
            {"space": space_payload(space, by_space.get(space.id))}
            for space in spaces
            if space.id in by_space
        ],
        "available_spaces": [
            space_payload(space)
            for space in spaces
            if space.id not in by_space
        ],
    }


def activate_space(db: Session, user: models.User, slug: str) -> dict:
    space = db.query(models.LearningSpace).filter(models.LearningSpace.slug == slug.strip().lower(), models.LearningSpace.status == "active").first()
    membership = (
        db.query(models.LearningSpaceMembership)
        .filter(
            models.LearningSpaceMembership.user_id == user.id,
            models.LearningSpaceMembership.learning_space_id == getattr(space, "id", None),
            models.LearningSpaceMembership.status == "active",
        )
        .first()
        if space else None
    )
    if space is None or membership is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Join this learning space before entering it.")
    user.active_learning_space_id = space.id
    db.commit()
    return {"space": space_payload(space, membership)}


def claim_ksa_member(db: Session, user: models.User, raw_ksa_id: str) -> dict:
    try:
        ksa_id = normalize_ksa_id(raw_ksa_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    space = db.query(models.LearningSpace).filter(models.LearningSpace.slug == KSA_SLUG).first()
    if space is None:
        seed_learning_spaces(db)
        space = db.query(models.LearningSpace).filter(models.LearningSpace.slug == KSA_SLUG).first()
    member = (
        db.query(models.KsaMember)
        .filter(models.KsaMember.ksa_id == ksa_id)
        .with_for_update()
        .first()
        if space else None
    )
    if member is None or member.status != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=CLAIM_FAILURE_MESSAGE)
    if member.claimed_by_user_id not in (None, user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=CLAIM_FAILURE_MESSAGE)

    membership = (
        db.query(models.LearningSpaceMembership)
        .filter(
            models.LearningSpaceMembership.user_id == user.id,
            models.LearningSpaceMembership.learning_space_id == space.id,
        )
        .first()
    )
    if membership is None:
        membership = models.LearningSpaceMembership(
            user_id=user.id,
            learning_space_id=space.id,
            external_member_id=ksa_id,
            role="member",
            status="active",
            onboarding_state="pending",
        )
        db.add(membership)
    elif membership.external_member_id not in (None, ksa_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=CLAIM_FAILURE_MESSAGE)

    member.claimed_by_user_id = user.id
    member.claimed_at = member.claimed_at or now_utc()
    membership.external_member_id = ksa_id
    user.active_learning_space_id = space.id
    try:
        db.commit()
        db.refresh(membership)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=CLAIM_FAILURE_MESSAGE) from exc
    return {"space": space_payload(space, membership), "onboarding_required": membership.onboarding_state != "completed"}


def mark_ksa_onboarding_complete(db: Session, user: models.User, payload: dict) -> dict:
    membership = (
        db.query(models.LearningSpaceMembership)
        .join(models.LearningSpace, models.LearningSpace.id == models.LearningSpaceMembership.learning_space_id)
        .filter(
            models.LearningSpaceMembership.user_id == user.id,
            models.LearningSpace.slug == KSA_SLUG,
            models.LearningSpaceMembership.status == "active",
        )
        .first()
    )
    if membership is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Verify a KSA ID before completing KSA onboarding.")
    membership.onboarding_state = "completed"
    user.onboarding_preferences = payload
    user.onboarding_completed = True
    user.onboarding_state = "completed"
    user.profile_updated_at = now_utc()
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Your KSA setup could not be saved safely.") from exc
    space = db.query(models.LearningSpace).filter(models.LearningSpace.id == membership.learning_space_id).first()
    return {"space": space_payload(space, membership) if space else {"slug": KSA_SLUG}, "onboarding_required": False}


def import_ksa_members(db: Session, rows: Iterable[dict]) -> int:
    imported = 0
    for item in rows:
        try:
            ksa_id = normalize_ksa_id(item["ksa_id"])
        except (KeyError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Every imported row needs a valid KSA ID.") from exc
        member = db.query(models.KsaMember).filter(models.KsaMember.ksa_id == ksa_id).first()
        if member is None:
            member = models.KsaMember(ksa_id=ksa_id)
            db.add(member)
        member.cohort = item.get("cohort")
        member.name = item.get("name")
        member.email = item.get("email")
        member.status = item.get("status") or "active"
        imported += 1
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The KSA registry could not be imported safely.") from exc
    return imported
