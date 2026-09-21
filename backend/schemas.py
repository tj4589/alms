import re
from pydantic import BaseModel, ConfigDict, EmailStr, Field, StrictInt, field_validator
from typing import Literal, Optional
from urllib.parse import urlsplit

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
    account_status: str = "active"

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


class DeleteAccountRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirmation: Literal["DELETE"]
    firebase_id_token: str = Field(min_length=1)


class AccountLifecycleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirmation: Literal["DEACTIVATE"]
    firebase_id_token: str = Field(min_length=1)


class FirebaseIdentityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    firebase_id_token: str = Field(min_length=1)


FEEDBACK_CATEGORIES = (
    "I cannot sign in",
    "I am not a CU student",
    "I have a suggestion",
    "Something is broken",
    "Something felt confusing",
    "Something else",
)
_FEEDBACK_CATEGORY_SET = set(FEEDBACK_CATEGORIES)


def _normalise_feedback_text(value: str) -> str:
    return value.replace("\r\n", "\n").replace("\r", "\n").strip()


def _validate_feedback_page_path(value: str) -> str:
    path = value.strip()
    try:
        parsed = urlsplit(path)
    except ValueError as exc:
        raise ValueError("Page path must be a relative path.") from exc
    if (
        not path
        or not path.startswith("/")
        or path.startswith("//")
        or parsed.scheme
        or parsed.netloc
        or "\\" in path
        or any(ord(char) < 32 for char in path)
    ):
        raise ValueError("Page path must be a relative path.")
    return path


class _FeedbackFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: str = Field(max_length=80)
    message: str = Field(max_length=2000)
    rating: Optional[StrictInt] = Field(default=None, ge=1, le=5)
    page_path: str = Field(max_length=512)

    @field_validator("category")
    @classmethod
    def validate_category(cls, value: str) -> str:
        category = value.strip()
        if category not in _FEEDBACK_CATEGORY_SET:
            raise ValueError("Choose a valid feedback category.")
        return category

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        message = _normalise_feedback_text(value)
        if len(message) < 10:
            raise ValueError("Feedback message must be at least 10 characters.")
        return message

    @field_validator("page_path")
    @classmethod
    def validate_page_path(cls, value: str) -> str:
        return _validate_feedback_page_path(value)


class PublicFeedbackRequest(_FeedbackFields):
    guest_name: Optional[str] = Field(default=None, max_length=120)
    reply_email: Optional[EmailStr] = None
    website: str = Field(default="", max_length=200)

    @field_validator("guest_name", mode="before")
    @classmethod
    def normalise_guest_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        name = str(value).strip()
        return name or None

    @field_validator("reply_email", mode="before")
    @classmethod
    def normalise_reply_email(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        email = str(value).strip().lower()
        return email or None

    @field_validator("website")
    @classmethod
    def normalise_honeypot(cls, value: str) -> str:
        return value.strip()


class AuthenticatedFeedbackRequest(_FeedbackFields):
    pass


class FeedbackSubmissionResponse(BaseModel):
    message: str


class FeedbackInboxItem(BaseModel):
    id: int
    source: Literal["authenticated", "public"]
    identity_label: Literal["Verified student", "Public visitor"]
    category: str
    message: str
    rating: Optional[int] = None
    page_path: str
    status: str
    created_at: str
    updated_at: str
    user_name: Optional[str] = None
    user_email: Optional[EmailStr] = None
    guest_name: Optional[str] = None
    reply_email: Optional[EmailStr] = None
