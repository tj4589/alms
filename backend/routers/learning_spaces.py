"""Learning-space entry, membership, and KSA verification endpoints."""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy.orm import Session

import auth
import models
from database import get_db
from ksa_claim_admin import inspect_ksa_claim, release_ksa_claim
from learning_space_roles import (
    demote_ksa_moderator_to_member,
    promote_ksa_member_to_moderator,
)
from learning_spaces import (
    activate_space,
    claim_ksa_member,
    import_ksa_members,
    list_spaces,
    mark_ksa_onboarding_complete,
    normalize_ksa_id,
    update_ksa_preferences,
)
from rate_limiting import user_rate_limit

router = APIRouter(prefix="/learning-spaces", tags=["learning-spaces"])


class KsaVerificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ksa_id: str = Field(min_length=1, max_length=80)


class KsaOnboardingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preferred_name: str = Field(min_length=2, max_length=120)
    username: str = Field(min_length=3, max_length=24)
    learning_goals: list[str] = Field(default_factory=list, max_length=8)
    help_topics: list[str] = Field(default_factory=list, max_length=8)
    explanation_preference: Literal["concise", "step_by_step", "examples_first", "not_sure"] = "not_sure"
    notifications_enabled: bool = False

    @field_validator("username")
    @classmethod
    def normalise_username(cls, value: str) -> str:
        normalized = value.strip().lower().lstrip("@")
        if not 3 <= len(normalized) <= 24 or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789_" for character in normalized):
            raise ValueError("Choose a username with lowercase letters, numbers, or underscores.")
        return normalized

    @field_validator("learning_goals", "help_topics")
    @classmethod
    def clean_preferences(cls, values: list[str]) -> list[str]:
        return [item.strip()[:120] for item in values if item.strip()][:8]


class KsaPreferencesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    learning_goals: list[str] = Field(default_factory=list, max_length=8)
    help_topics: list[str] = Field(default_factory=list, max_length=8)
    explanation_preference: Literal["concise", "step_by_step", "examples_first", "not_sure"] = "not_sure"
    # Omitted preserves the existing reminder consent. Explicit false is the
    # opt-out path used by the settings/onboarding editor.
    notifications_enabled: bool | None = None

    @field_validator("learning_goals", "help_topics")
    @classmethod
    def clean_preferences(cls, values: list[str]) -> list[str]:
        return [item.strip()[:120] for item in values if item.strip()][:8]


class KsaMemberImportItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ksa_id: str = Field(min_length=1, max_length=80)
    cohort: Optional[str] = Field(default=None, max_length=80)
    name: Optional[str] = Field(default=None, max_length=160)
    email: Optional[EmailStr] = None
    status: Literal["active", "inactive"] = "active"


class KsaMemberImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    members: list[KsaMemberImportItem] = Field(min_length=1, max_length=500)


class KsaClaimReleaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def require_reason(cls, value: str) -> str:
        reason = value.strip()
        if not reason:
            raise ValueError("A release reason is required.")
        return reason


class KsaModeratorRoleChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def require_reason(cls, value: str) -> str:
        reason = value.strip()
        if not reason:
            raise ValueError("A role-change reason is required.")
        return reason


@router.get("")
def get_learning_spaces(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return list_spaces(db, current_user)


@router.post("/{slug}/activate")
def activate_learning_space(
    slug: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return activate_space(db, current_user, slug)


@router.post("/ksa/verify")
def verify_ksa_member(
    payload: KsaVerificationRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
    _rate_limit: None = Depends(user_rate_limit("ksa_verify", auth.require_role("student"))),
):
    return claim_ksa_member(db, current_user, payload.ksa_id)


@router.post("/ksa/onboarding")
def complete_ksa_onboarding(
    payload: KsaOnboardingRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    conflict = (
        db.query(models.User)
        .filter(models.User.username == payload.username, models.User.id != current_user.id)
        .first()
    )
    if conflict:
        raise HTTPException(status_code=409, detail="That username is already taken.")
    current_user.name = payload.preferred_name.strip()
    current_user.username = payload.username
    return mark_ksa_onboarding_complete(
        db,
        current_user,
        {
            "learning_goals": payload.learning_goals,
            "help_topics": payload.help_topics,
            "explanation_preference": payload.explanation_preference,
            "notifications_enabled": payload.notifications_enabled,
        },
    )


@router.put("/ksa/preferences")
def update_ksa_learning_preferences(
    payload: KsaPreferencesRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    return update_ksa_preferences(db, current_user, payload.model_dump(exclude_none=True))


@router.post("/early-access-requests", status_code=201)
def request_early_access(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
    _rate_limit: None = Depends(user_rate_limit("early_access", auth.require_role("student"))),
):
    existing = (
        db.query(models.Feedback)
        .filter(
            models.Feedback.user_id == current_user.id,
            models.Feedback.category == "I need access to a learning space",
            models.Feedback.status.in_(["new", "open", "in_progress"]),
        )
        .order_by(models.Feedback.created_at.desc())
        .first()
    )
    if existing is not None:
        return {"status": "already_requested", "request_id": existing.id}
    request = models.Feedback(
        user_id=current_user.id,
        source="authenticated",
        category="I need access to a learning space",
        message="This student requested access to an available learning space.",
        page_path="/learning-spaces",
        status="new",
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    return {"status": "requested", "request_id": request.id}


@router.post("/ksa/admin/members/import")
def import_ksa_registry_members(
    payload: KsaMemberImportRequest,
    db: Session = Depends(get_db),
    _admin: models.User = Depends(auth.require_global_admin),
):
    imported = import_ksa_members(db, [item.model_dump() for item in payload.members])
    return {"imported": imported}


@router.get("/ksa/admin/claims/{ksa_id}")
def inspect_ksa_registry_claim(
    ksa_id: str,
    db: Session = Depends(get_db),
    _admin: models.User = Depends(auth.require_global_admin),
):
    try:
        canonical_ksa_id = normalize_ksa_id(ksa_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return inspect_ksa_claim(db, canonical_ksa_id)


@router.post("/ksa/admin/claims/{ksa_id}/release")
def release_ksa_registry_claim(
    ksa_id: str,
    payload: KsaClaimReleaseRequest,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.require_global_admin),
):
    try:
        canonical_ksa_id = normalize_ksa_id(ksa_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return release_ksa_claim(
        db,
        ksa_id=canonical_ksa_id,
        performed_by=admin,
        reason=payload.reason,
    )


@router.post("/ksa/admin/moderators/{user_id}")
def promote_ksa_moderator(
    user_id: int,
    payload: KsaModeratorRoleChangeRequest,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.require_global_admin),
):
    return promote_ksa_member_to_moderator(
        db,
        target_user_id=user_id,
        performed_by=admin,
        reason=payload.reason,
    )


@router.post("/ksa/admin/moderators/{user_id}/demote")
def demote_ksa_moderator(
    user_id: int,
    payload: KsaModeratorRoleChangeRequest,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.require_global_admin),
):
    return demote_ksa_moderator_to_member(
        db,
        target_user_id=user_id,
        performed_by=admin,
        reason=payload.reason,
    )
