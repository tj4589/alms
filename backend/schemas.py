import re
from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional

_USERNAME_RE = re.compile(r'^[a-z0-9_]{3,24}$')


class UserCreate(BaseModel):
    name: str = Field(min_length=2)
    username: str = Field(min_length=3, max_length=24)
    email: EmailStr
    password: str = Field(min_length=8)
    role: Optional[str] = "student"

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
    role: str

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str
