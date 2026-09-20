import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

import auth
from firebase_tokens import FirebaseTokenError, verify_firebase_id_token, verify_google_provider_token
import models
import schemas
from database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


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


@router.get("/me", response_model=schemas.UserResponse)
def get_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user


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
        access_token = auth.create_access_token(
            data={"sub": user.email, "firebase_uid": claims["sub"]},
            expires_delta=auth.timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES),
        )
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": user,
        }
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
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


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
