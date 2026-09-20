import re
from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Literal, Optional

_USERNAME_RE = re.compile(r'^[a-z0-9_]{3,24}$')


class UserCreate(BaseModel):
    name: str = Field(min_length=2)
    username: str = Field(min_length=3, max_length=24)
    email: EmailStr
    password: str = Field(min_length=8)

    @field_validator('username')
    @classmethod
    def validate_username(cls, v: str) -> str:
        if not _USERNAME_RE.match(v):
            raise ValueError(
                'Username must be 3-24 characters: lowercase letters, numbers, and underscores only.'
            )
        return v


class UserResponse(BaseModel):
    id: int
    name: str
    username: Optional[str] = None
    email: EmailStr
    role: str = "student"

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str


class FirebaseSessionRequest(BaseModel):
    firebase_id_token: str = Field(min_length=1)
    google_id_token: Optional[str] = None
    provider: Literal["password", "google"] = "password"
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    username: Optional[str] = Field(default=None, min_length=3, max_length=24)

    @field_validator("username")
    @classmethod
    def validate_optional_username(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and not _USERNAME_RE.match(value):
            raise ValueError(
                "Username must be 3-24 characters: lowercase letters, numbers, and underscores only."
            )
        return value


class FirebaseSessionResponse(Token):
    user: UserResponse
