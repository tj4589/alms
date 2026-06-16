import os

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

import auth
import models
import schemas
from database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])

_ALLOWED_DOMAINS_ENV = os.getenv("ALLOWED_SCHOOL_EMAIL_DOMAINS", "")
_ALLOWED_DOMAINS: set[str] = (
    {d.strip().lower() for d in _ALLOWED_DOMAINS_ENV.split(",") if d.strip()}
    if _ALLOWED_DOMAINS_ENV
    else set()
)


@router.get("/me", response_model=schemas.UserResponse)
def get_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user


@router.post("/register", response_model=schemas.UserResponse)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    if _ALLOWED_DOMAINS:
        domain = user.email.split("@")[-1].lower()
        if domain not in _ALLOWED_DOMAINS:
            raise HTTPException(
                status_code=400,
                detail=(
                    "ExamMind is currently available for Covenant University students only. "
                    "Please use your school email (e.g. @stu.cu.edu.ng)."
                ),
            )

    if db.query(models.User).filter(models.User.email == user.email).first():
        raise HTTPException(status_code=400, detail="Email already registered.")

    if db.query(models.User).filter(models.User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Username already taken. Try another.")

    new_user = models.User(
        name=user.name,
        username=user.username,
        email=user.email,
        password_hash=auth.get_password_hash(user.password),
        role="student",
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.post("/login", response_model=schemas.Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = auth.timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}
