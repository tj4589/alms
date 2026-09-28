"""Learning-space entry, membership, and KSA verification endpoints."""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy.orm import Session

import auth
import models
from database import get_db
from learning_spaces import (
    activate_space,
    claim_ksa_member,
    import_ksa_members,
    list_spaces,
    mark_ksa_onboarding_complete,
)

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


@router.post("/ksa/admin/members/import")
def import_ksa_registry_members(
    payload: KsaMemberImportRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Administrator access is required.")
    imported = import_ksa_members(db, [item.model_dump() for item in payload.members])
    return {"imported": imported}
