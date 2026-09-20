import os
from pathlib import Path
from datetime import datetime, timedelta, timezone

_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(_env_file, override=False)
    except ImportError:
        pass
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
from sqlalchemy.orm import Session
from database import get_db
import models

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY is not configured. Set SECRET_KEY in the backend environment.")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 1 week

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)


def _normalise_email(value: str) -> str:
    return value.strip().lower()


def _username_candidate(email: str, preferred: Optional[str]) -> str:
    raw = (preferred or email.split("@", 1)[0]).strip().lower()
    candidate = "".join(character for character in raw if character.isalnum() or character == "_")
    if len(candidate) < 3:
        candidate = "student"
    return candidate[:24]


def _available_username(db: Session, email: str, preferred: Optional[str]) -> str:
    base = _username_candidate(email, preferred)
    candidate = base
    suffix = 2
    while db.query(models.User).filter(models.User.username == candidate).first() is not None:
        suffix_text = f"_{suffix}"
        candidate = f"{base[:24 - len(suffix_text)]}{suffix_text}"
        suffix += 1
    return candidate


def get_or_create_firebase_user(
    db: Session,
    *,
    firebase_uid: str,
    email: str,
    claims: dict,
    name: Optional[str] = None,
    username: Optional[str] = None,
) -> models.User:
    """Link a verified Firebase identity without replacing existing app data."""
    normalised_email = _normalise_email(email)
    user = db.query(models.User).filter(models.User.firebase_uid == firebase_uid).first()
    if user is None:
        user = (
            db.query(models.User)
            .filter(func.lower(models.User.email) == normalised_email)
            .first()
        )

    if user is not None:
        if user.firebase_uid and user.firebase_uid != firebase_uid:
            raise ValueError("That email is already linked to another account.")
        user.firebase_uid = firebase_uid
        # Existing name, username, password hash, and all study data remain
        # untouched. Only the missing external identity link is added.
        if _normalise_email(user.email) != normalised_email:
            user.email = normalised_email
        try:
            db.commit()
            db.refresh(user)
        except IntegrityError as exc:
            db.rollback()
            raise ValueError("That account could not be linked safely.") from exc
        return user

    claim_name = claims.get("name") if isinstance(claims.get("name"), str) else None
    display_name = (name or claim_name or normalised_email.split("@", 1)[0]).strip()
    if len(display_name) < 2:
        display_name = "ExamMind student"
    display_name = display_name[:120]

    new_user = models.User(
        name=display_name,
        username=_available_username(db, normalised_email, username),
        email=normalised_email,
        password_hash=None,
        firebase_uid=firebase_uid,
        role="student",
    )
    db.add(new_user)
    try:
        db.commit()
        db.refresh(new_user)
    except IntegrityError as exc:
        db.rollback()
        # A concurrent first sign-in may have created the row. Link only if
        # it is the same verified identity; never create a duplicate account.
        existing = db.query(models.User).filter(models.User.firebase_uid == firebase_uid).first()
        if existing is None:
            existing = (
                db.query(models.User)
                .filter(func.lower(models.User.email) == normalised_email)
                .first()
            )
        if existing is None or (existing.firebase_uid and existing.firebase_uid != firebase_uid):
            raise ValueError("That account could not be created safely.") from exc
        if not existing.firebase_uid:
            existing.firebase_uid = firebase_uid
            db.commit()
            db.refresh(existing)
        return existing
    return new_user

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        firebase_uid: str = payload.get("firebase_uid")
        if email is None or not firebase_uid:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    user = db.query(models.User).filter(models.User.email == email).first()
    if user is None or user.firebase_uid != firebase_uid:
        raise credentials_exception
    return user

def require_role(required_role: str):
    def role_checker(current_user: models.User = Depends(get_current_user)):
        if required_role == "student" and current_user.role != "student":
            raise HTTPException(status_code=403, detail="Authenticated student access is required.")
        return current_user
    return role_checker
