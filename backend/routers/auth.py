import logging
import os
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

import auth
from firebase_tokens import FirebaseTokenError, verify_firebase_id_token, verify_google_provider_token
import models
import schemas
from database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)
ACCOUNT_DELETION_DISABLED_MESSAGE = "Account deletion is temporarily unavailable."


def account_deletion_enabled() -> bool:
    """Fail closed unless deletion is explicitly enabled by the API environment."""
    return os.getenv("ACCOUNT_DELETION_ENABLED", "false").strip().lower() == "true"


def require_account_deletion_enabled() -> None:
    if not account_deletion_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=ACCOUNT_DELETION_DISABLED_MESSAGE,
        )


def _verification_reason(stage: str, message: str) -> str:
    """Map internal auth failures to safe, stable log reason codes."""
    normalized = message.casefold()
    if "temporarily unavailable" in normalized or "not configured correctly" in normalized:
        return f"{stage}_certificate_fetch_failed"
    if "signature is invalid" in normalized:
        return f"{stage}_signature_invalid"
    if "audience is invalid" in normalized:
        return f"{stage}_audience_invalid"
    if "issuer is invalid" in normalized:
        return f"{stage}_issuer_invalid"
    if stage == "google" and "covenant university google account" in normalized:
        return "google_hosted_domain_invalid"
    if stage == "google" and "does not match the firebase account" in normalized:
        return "google_email_mismatch"
    if stage == "google" and "not configured" in normalized:
        return "google_configuration_invalid"
    return f"{stage}_claims_invalid"


def _log_verification_failure(stage: str, exc: FirebaseTokenError) -> None:
    logger.warning(
        "firebase_session_verification_failed stage=%s reason=%s",
        stage,
        _verification_reason(stage, str(exc)),
    )


def _verify_recent_firebase_identity(firebase_id_token: str, current_user: models.User) -> dict:
    claims = verify_firebase_id_token(firebase_id_token)
    auth_time = claims.get("auth_time")
    now = int(time.time())
    if not isinstance(auth_time, int) or auth_time > now + 60 or now - auth_time > 10 * 60:
        raise FirebaseTokenError("Recent account reauthentication is required.")
    if (
        claims.get("sub") != current_user.firebase_uid
        or str(claims.get("email", "")).strip().lower() != str(current_user.email).strip().lower()
    ):
        raise FirebaseTokenError("The verified identity does not match this account.")
    return claims


def _issue_application_session(user: models.User, firebase_uid: str) -> dict:
    return {
        "access_token": auth.create_access_token(
            data={"sub": user.email, "firebase_uid": firebase_uid},
            expires_delta=auth.timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES),
        ),
        "token_type": "bearer",
        "user": user,
    }


def _account_state_error(user: models.User) -> None:
    account_status = str(getattr(user, "account_status", None) or "active")
    if account_status == "deactivated":
        raise auth.AccountDeactivatedError()
    if account_status == "pending_deletion":
        due_at = getattr(user, "deletion_due_at", None)
        if due_at is None:
            raise auth.AccountDeletionRecoveryExpiredError()
        if due_at.tzinfo is None:
            due_at = due_at.replace(tzinfo=timezone.utc)
        if due_at <= datetime.now(timezone.utc):
            raise auth.AccountDeletionRecoveryExpiredError()
        raise auth.AccountPendingDeletionError(due_at)


def _development_environment() -> bool:
    value = str(os.getenv("APP_ENV") or os.getenv("ENV") or "production").strip().lower()
    return value in {"dev", "development", "local", "test", "testing"}


@router.get("/me", response_model=schemas.UserResponse)
def get_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user


@router.get("/account/deletion-status")
def get_account_deletion_status():
    return {"enabled": account_deletion_enabled()}


@router.post("/firebase/session", response_model=schemas.FirebaseSessionResponse)
def firebase_session(
    payload: schemas.FirebaseSessionRequest,
    db: Session = Depends(get_db),
):
    try:
        try:
            claims = verify_firebase_id_token(payload.firebase_id_token)
        except FirebaseTokenError as exc:
            _log_verification_failure("firebase", exc)
            raise
        firebase_claim = claims.get("firebase")
        provider = (
            firebase_claim.get("sign_in_provider")
            if isinstance(firebase_claim, dict)
            else None
        )

        if payload.provider == "google":
            try:
                if provider != "google.com" or not payload.google_id_token:
                    raise FirebaseTokenError("Google provider verification is required.")
                verify_google_provider_token(
                    payload.google_id_token,
                    expected_email=claims["email"],
                )
            except FirebaseTokenError as exc:
                _log_verification_failure("google", exc)
                raise
        elif provider == "google.com":
            exc = FirebaseTokenError("Google provider verification is required.")
            _log_verification_failure("google", exc)
            raise exc

        user = auth.get_or_create_firebase_user(
            db,
            firebase_uid=claims["sub"],
            email=claims["email"],
            claims=claims,
            name=payload.name,
            username=payload.username,
        )
        _account_state_error(user)
        return _issue_application_session(user, claims["sub"])
    except FirebaseTokenError as exc:
        message = str(exc)
        if "Email verification" in message:
            detail = "Verify your email before entering ExamMind."
        elif "Covenant" in message or "school email" in message:
            detail = "Use a Covenant University school email to continue."
        elif "Google" in message:
            detail = "Google sign-in could not be verified. Try again with your Covenant University account."
        else:
            detail = "We could not verify that sign-in. Please try again."
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except auth.AccountDeletionPendingError as exc:
        # This is only reachable after a valid, verified Firebase token has
        # passed the identity checks above. The stable code lets the client
        # offer recovery without exposing any personal data.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=auth.AccountDeletionPendingError.code,
        ) from exc
    except auth.AccountDeactivatedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=auth.AccountDeactivatedError.code,
        ) from exc
    except auth.AccountPendingDeletionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{auth.AccountPendingDeletionError.code}:{exc.deletion_due_at.isoformat()}",
        ) from exc
    except auth.AccountDeletionRecoveryExpiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=auth.AccountDeletionRecoveryExpiredError.code,
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/account/restart-onboarding", response_model=schemas.UserResponse)
def restart_onboarding(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if current_user.role != "admin" and not _development_environment():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Onboarding restart is not available.")
    current_user.onboarding_state = "pending"
    current_user.onboarding_completed = False
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/account/deactivate")
def deactivate_account(
    payload: schemas.AccountLifecycleRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        _verify_recent_firebase_identity(payload.firebase_id_token, current_user)
        auth.deactivate_user(current_user)
        db.commit()
    except FirebaseTokenError as exc:
        _log_verification_failure("firebase", exc)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="We could not verify that account action. Sign in again and try once more.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except Exception as exc:
        db.rollback()
        logger.error("account_deactivation_failed reason=database_transaction_failed")
        raise HTTPException(status_code=500, detail="We could not deactivate your account. Please try again.") from exc
    return {"detail": "Your account has been deactivated."}


@router.post("/account/reactivate", response_model=schemas.FirebaseSessionResponse)
def reactivate_account(
    payload: schemas.FirebaseIdentityRequest,
    db: Session = Depends(get_db),
):
    try:
        claims = verify_firebase_id_token(payload.firebase_id_token)
        user = db.query(models.User).filter(models.User.firebase_uid == claims["sub"]).first()
        if user is None or str(user.email).strip().lower() != str(claims.get("email", "")).strip().lower():
            raise FirebaseTokenError("The verified identity does not match this account.")
        if str(getattr(user, "account_status", None) or "active") == "pending_deletion":
            due_at = getattr(user, "deletion_due_at", None)
            if due_at is None:
                raise auth.AccountDeletionRecoveryExpiredError()
            if due_at.tzinfo is None:
                due_at = due_at.replace(tzinfo=timezone.utc)
            if due_at <= datetime.now(timezone.utc):
                raise auth.AccountDeletionRecoveryExpiredError()
        auth.reactivate_user(user)
        db.commit()
        db.refresh(user)
        return _issue_application_session(user, claims["sub"])
    except FirebaseTokenError as exc:
        _log_verification_failure("firebase", exc)
        db.rollback()
        raise HTTPException(status_code=401, detail="We could not verify that account action. Sign in again and try once more.", headers={"WWW-Authenticate": "Bearer"}) from exc
    except auth.AccountDeletionDueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=auth.AccountDeletionDueError.code) from exc
    except auth.AccountDeletionRecoveryExpiredError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=auth.AccountDeletionRecoveryExpiredError.code) from exc
    except Exception as exc:
        db.rollback()
        logger.error("account_reactivation_failed reason=database_transaction_failed")
        raise HTTPException(status_code=500, detail="We could not reactivate your account. Please try again.") from exc

    raise HTTPException(status_code=409, detail="That account cannot be reactivated.")


@router.delete("/account", dependencies=[Depends(require_account_deletion_enabled)])
def delete_account(
    payload: schemas.DeleteAccountRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Schedule permanent deletion after a thirty-day recovery period."""
    # The decorator dependency protects the HTTP route. Keep this explicit
    # guard too because direct callers and tests must fail closed as well.
    require_account_deletion_enabled()
    try:
        _verify_recent_firebase_identity(payload.firebase_id_token, current_user)
        due_at = auth.schedule_user_deletion(current_user)
        db.commit()
    except FirebaseTokenError as exc:
        _log_verification_failure("firebase", exc)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="We could not verify that account deletion request. Sign in again and try once more.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        logger.error("account_deletion_failed reason=database_transaction_failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="We could not finish deleting your account. Your data was not intentionally removed; please try again.",
        ) from exc

    return {
        "detail": "Your account is scheduled for permanent deletion after 30 days.",
        "deletion_due_at": due_at.isoformat(),
    }


@router.post("/register", response_model=schemas.UserResponse, deprecated=True)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Email/password registration is handled by Firebase Authentication.",
    )


@router.post("/login", response_model=schemas.Token, deprecated=True)
def login():
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Email/password sign-in is handled by Firebase Authentication.",
    )
