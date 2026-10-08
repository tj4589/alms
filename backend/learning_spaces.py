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
from ksa_claim_admin import CLAIMED_ACTION, claim_membership_ids_match, record_claim_audit
from reminders import sync_legacy_notification_consent

CU_SLUG = "cu"
KSA_SLUG = "ksa"
KSA_ID_RE = re.compile(r"^KSA-\d{2}$")
CLAIM_FAILURE_MESSAGE = "That academy ID is already in use."
KSA_ALREADY_CONFIGURED_MESSAGE = "KSA access is already configured for this account. Contact support to change it."
KSA_INACTIVE_MEMBERSHIP_MESSAGE = "KSA access is not active for this account. Contact support for help."
CU_ACCESS_FAILURE_MESSAGE = "Covenant University access requires an active CU membership."

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
    normalized = str(value or "").strip().upper()
    if not KSA_ID_RE.fullmatch(normalized):
        raise ValueError("Enter an academy ID in the format KSA-##.")
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
                if user.active_learning_space_id == cu_space.id:
                    existing_membership = (
                        db.query(models.LearningSpaceMembership)
                        .filter(
                            models.LearningSpaceMembership.user_id == user.id,
                            models.LearningSpaceMembership.learning_space_id == cu_space.id,
                            models.LearningSpaceMembership.status == "active",
                        )
                        .first()
                    )
                    if existing_membership is None:
                        user.active_learning_space_id = None
                        changed = True
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
            other_active_membership = (
                db.query(models.LearningSpaceMembership)
                .filter(
                    models.LearningSpaceMembership.user_id == user.id,
                    models.LearningSpaceMembership.learning_space_id != cu_space.id,
                    models.LearningSpaceMembership.status == "active",
                )
                .first()
            )
            if user.active_learning_space_id is None and other_active_membership is None:
                user.active_learning_space_id = cu_space.id
                changed = True
    if changed:
        db.commit()


def ensure_cu_membership(db: Session, user: models.User) -> models.LearningSpaceMembership | None:
    """Provision CU membership only at the explicit CU space-entry boundary.

    Firebase identity creation deliberately does not call this helper. The
    learning-space flow calls it after authentication, so a configured CU
    domain can grant access without turning institution eligibility into a
    global identity rule. Existing inactive memberships are not silently
    reactivated.
    """
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
    if membership is not None and membership.status != "active":
        return None
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
    other_active_membership = (
        db.query(models.LearningSpaceMembership)
        .filter(
            models.LearningSpaceMembership.user_id == user.id,
            models.LearningSpaceMembership.learning_space_id != space.id,
            models.LearningSpaceMembership.status == "active",
        )
        .first()
    )
    if user.active_learning_space_id is None and other_active_membership is None:
        user.active_learning_space_id = space.id
        changed = True
    if changed:
        db.commit()
        db.refresh(membership)
    return membership


def active_membership(
    db: Session,
    user: models.User,
    space_id: int | None,
) -> models.LearningSpaceMembership | None:
    """Return the caller's active membership for one exact space."""
    if not space_id or not getattr(user, "id", None):
        return None
    return db.query(models.LearningSpaceMembership).filter(
        models.LearningSpaceMembership.user_id == user.id,
        models.LearningSpaceMembership.learning_space_id == space_id,
        models.LearningSpaceMembership.status == "active",
    ).first()


def require_cu_membership(
    db: Session,
    user: models.User,
    *,
    require_active_context: bool = True,
) -> models.LearningSpaceMembership:
    """Enforce CU membership and, by default, the selected CU context."""
    space = db.query(models.LearningSpace).filter(
        models.LearningSpace.slug == CU_SLUG,
        models.LearningSpace.status == "active",
    ).first()
    membership = active_membership(db, user, getattr(space, "id", None))
    if membership is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=CU_ACCESS_FAILURE_MESSAGE)
    if require_active_context and getattr(user, "active_learning_space_id", None) != space.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=CU_ACCESS_FAILURE_MESSAGE)
    return membership


def authorized_active_space(db: Session, user: models.User) -> models.LearningSpace | None:
    """Resolve the selected space only when the user actually belongs to it."""
    space_id = getattr(user, "active_learning_space_id", None)
    if not space_id:
        return None
    space = db.query(models.LearningSpace).filter(
        models.LearningSpace.id == space_id,
        models.LearningSpace.status == "active",
    ).first()
    if space is None or active_membership(db, user, space.id) is None:
        return None
    return space


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
    # This is the explicit CU authorization boundary. Identity creation and
    # normal application startup do not grant a learning-space membership.
    ensure_cu_membership(db, user)
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
    context_changed = False
    if active_space is None and user.active_learning_space_id is not None:
        # Treat a manually supplied or stale pointer as unauthorised. This
        # clears only the pointer; it never removes a membership or resource.
        # Do not silently choose another membership: a multi-space account
        # must use its learning-space-specific entry/support recovery path.
        user.active_learning_space_id = None
        context_changed = True
    if active_space is None and len(memberships) == 1:
        # A single active membership is an unambiguous context. Restore it on
        # return so ordinary CU/KSA users do not have to pass through a
        # cross-space chooser. Multi-space accounts remain explicit: they
        # never get an arbitrary context selected for them.
        sole_membership = memberships[0]
        active_space = next((space for space in spaces if space.id == sole_membership.learning_space_id), None)
        if active_space is not None:
            user.active_learning_space_id = active_space.id
            context_changed = True
    if context_changed:
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
    normalized_slug = slug.strip().lower()
    if normalized_slug == CU_SLUG:
        # Direct activation is also an explicit learning-space entry boundary;
        # it still provisions only configured CU identities.
        ensure_cu_membership(db, user)
    space = db.query(models.LearningSpace).filter(models.LearningSpace.slug == normalized_slug, models.LearningSpace.status == "active").first()
    membership = active_membership(db, user, getattr(space, "id", None)) if space else None
    if space is None or membership is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Join this learning space before entering it.")
    user.active_learning_space_id = space.id
    db.commit()
    return {"space": space_payload(space, membership)}


def _ksa_membership(db: Session, user: models.User, space_id: int) -> models.LearningSpaceMembership | None:
    return db.query(models.LearningSpaceMembership).filter(
        models.LearningSpaceMembership.user_id == user.id,
        models.LearningSpaceMembership.learning_space_id == space_id,
    ).first()


def _ksa_claim_for_user(db: Session, user: models.User) -> models.KsaMember | None:
    return db.query(models.KsaMember).filter(
        models.KsaMember.claimed_by_user_id == user.id,
    ).first()


def _ksa_claim_result(
    db: Session,
    user: models.User,
    space: models.LearningSpace,
    membership: models.LearningSpaceMembership,
) -> dict:
    return {
        "space": space_payload(space, membership),
        "onboarding_required": membership.onboarding_state != "completed",
    }


def claim_ksa_member(db: Session, user: models.User, raw_ksa_id: str) -> dict:
    """Claim an unused KSA-## identifier and create KSA membership atomically.

    KsaMember is retained as the claim table for compatibility with existing
    deployments. An imported row is optional: a valid unused identifier is
    created and claimed on first use. Its unique KSA ID and unique claiming
    user constraints are the final race-safe authority.
    """
    try:
        ksa_id = normalize_ksa_id(raw_ksa_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    space = db.query(models.LearningSpace).filter(models.LearningSpace.slug == KSA_SLUG).first()
    if space is None:
        seed_learning_spaces(db)
        space = db.query(models.LearningSpace).filter(models.LearningSpace.slug == KSA_SLUG).first()
    if space is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="The KSA learning space is not available yet.")

    existing_claim = _ksa_claim_for_user(db, user)
    if existing_claim is not None and existing_claim.ksa_id != ksa_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=KSA_ALREADY_CONFIGURED_MESSAGE)

    membership = _ksa_membership(db, user, space.id)
    membership_was_inactive = False
    if membership is not None:
        if membership.status != "active":
            if membership.external_member_id not in (None, ksa_id):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=KSA_ALREADY_CONFIGURED_MESSAGE)
            membership_was_inactive = True
        if membership.external_member_id not in (None, ksa_id):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=KSA_ALREADY_CONFIGURED_MESSAGE)

    # Lock an existing row when the database supports row locks. The unique
    # constraint remains necessary for the unused-ID insert race.
    member = db.query(models.KsaMember).filter(
        models.KsaMember.ksa_id == ksa_id,
    ).with_for_update().first()
    if member is not None and member.claimed_by_user_id not in (None, user.id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=CLAIM_FAILURE_MESSAGE)
    previous_claimed_user_id = member.claimed_by_user_id if member is not None else None
    claim_is_new = member is None or member.claimed_by_user_id is None
    if member is None:
        member = models.KsaMember(
            ksa_id=ksa_id,
            status="active",
            claimed_by_user_id=user.id,
            claimed_at=now_utc(),
        )
        db.add(member)
    else:
        member.status = "active"
        member.claimed_by_user_id = user.id
        member.claimed_at = member.claimed_at or now_utc()

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
    membership.status = "active"
    if membership_was_inactive:
        membership.onboarding_state = "pending"
    membership.external_member_id = ksa_id
    user.active_learning_space_id = space.id
    if not claim_membership_ids_match(db, member):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="KSA membership could not be synchronized safely.",
        )
    if claim_is_new:
        record_claim_audit(
            db,
            ksa_id=ksa_id,
            action=CLAIMED_ACTION,
            previous_user_id=previous_claimed_user_id,
            current_user_id=user.id,
            performed_by_user_id=user.id,
            reason="self_service_claim",
            metadata={"source": "ksa_verification"},
        )
    try:
        db.commit()
        db.refresh(membership)
    except IntegrityError as exc:
        db.rollback()
        # A concurrent claim may have won the unique KSA-ID or one-user
        # constraint. Re-read only enough state to return a safe, stable API
        # response; never disclose the competing account.
        configured_claim = _ksa_claim_for_user(db, user)
        if configured_claim is not None and configured_claim.ksa_id != ksa_id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=KSA_ALREADY_CONFIGURED_MESSAGE) from exc
        winner = db.query(models.KsaMember).filter(models.KsaMember.ksa_id == ksa_id).first()
        if winner is not None and winner.claimed_by_user_id == user.id:
            current_membership = _ksa_membership(db, user, space.id)
            if current_membership is not None and current_membership.status == "active":
                return _ksa_claim_result(db, user, space, current_membership)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=CLAIM_FAILURE_MESSAGE) from exc
    return _ksa_claim_result(db, user, space, membership)


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
    sync_legacy_notification_consent(db, user, bool(payload.get("notifications_enabled", False)))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Your KSA setup could not be saved safely.") from exc
    space = db.query(models.LearningSpace).filter(models.LearningSpace.id == membership.learning_space_id).first()
    return {"space": space_payload(space, membership) if space else {"slug": KSA_SLUG}, "onboarding_required": False}


def update_ksa_preferences(db: Session, user: models.User, payload: dict) -> dict:
    """Update KSA preferences without changing identity or membership state."""
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
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=KSA_INACTIVE_MEMBERSHIP_MESSAGE)
    preferences = dict(user.onboarding_preferences or {})
    preferences.update(payload)
    user.onboarding_preferences = preferences
    user.profile_updated_at = now_utc()
    if "notifications_enabled" in payload:
        sync_legacy_notification_consent(db, user, bool(payload["notifications_enabled"]))
    try:
        db.commit()
        db.refresh(user)
        db.refresh(membership)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Your KSA preferences could not be saved safely.") from exc
    space = db.query(models.LearningSpace).filter(models.LearningSpace.id == membership.learning_space_id).first()
    return {
        "space": space_payload(space, membership) if space else {"slug": KSA_SLUG},
        "preferences": user.onboarding_preferences or {},
    }


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
