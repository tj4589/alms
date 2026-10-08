"""Owner-scoped reminder consent, subscriptions and delivery status."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

import auth
import models
from database import get_db
from reminders import (
    SUPPORTED_CHANNELS,
    reminder_settings_payload,
    subscribe_user,
    unsubscribe_user,
)

router = APIRouter(prefix="/reminders", tags=["reminders"])


class ReminderSubscriptionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    channel: Literal["email", "browser_push"]
    endpoint: str | None = Field(default=None, max_length=2048)
    p256dh: str | None = Field(default=None, max_length=255)
    auth: str | None = Field(default=None, max_length=255)

    @field_validator("endpoint")
    @classmethod
    def validate_endpoint(cls, value: str | None) -> str | None:
        if value is not None and not value.strip().lower().startswith("https://"):
            raise ValueError("Browser push endpoints must use HTTPS.")
        return value.strip() if value else value


def _student(current_user: models.User = Depends(auth.require_role("student"))) -> models.User:
    return current_user


@router.get("")
def get_reminder_settings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_student),
):
    return reminder_settings_payload(db, current_user)


@router.post("/subscriptions", status_code=status.HTTP_201_CREATED)
def create_reminder_subscription(
    payload: ReminderSubscriptionRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_student),
):
    try:
        subscription = subscribe_user(
            db,
            current_user,
            channel=payload.channel,
            endpoint=payload.endpoint,
            p256dh=payload.p256dh,
            auth_key=payload.auth,
        )
        db.commit()
        db.refresh(subscription)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"channel": subscription.channel, "subscription": {"subscribed": True, "status": subscription.status}}


@router.delete("/subscriptions/{channel}")
def delete_reminder_subscription(
    channel: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_student),
):
    if channel not in SUPPORTED_CHANNELS:
        raise HTTPException(status_code=404, detail="Reminder channel not found.")
    removed = unsubscribe_user(db, current_user, channel)
    db.commit()
    return {"channel": channel, "unsubscribed": True, "subscriptions_updated": removed}


@router.post("/unsubscribe")
def unsubscribe_all_reminders(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_student),
):
    removed = unsubscribe_user(db, current_user)
    db.commit()
    return {"unsubscribed": True, "subscriptions_updated": removed}


@router.get("/deliveries")
def list_reminder_deliveries(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_student),
):
    payload = reminder_settings_payload(db, current_user, delivery_limit=limit)
    return {"delivery": payload["delivery"]}
