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
from sqlalchemy import case, func, or_
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


class AccountDeletionPendingError(ValueError):
    """The Neon account is tombstoned until Firebase cleanup is complete."""

    code = "ACCOUNT_DELETION_PENDING"

    def __init__(self) -> None:
        super().__init__(self.code)


class AccountDeactivatedError(ValueError):
    code = "ACCOUNT_DEACTIVATED"

    def __init__(self) -> None:
        super().__init__(self.code)


class AccountPendingDeletionError(ValueError):
    code = "ACCOUNT_PENDING_DELETION"

    def __init__(self, deletion_due_at: datetime) -> None:
        self.deletion_due_at = deletion_due_at
        super().__init__(self.code)


class AccountDeletionDueError(ValueError):
    code = "ACCOUNT_DELETION_DUE"

    def __init__(self) -> None:
        super().__init__(self.code)


class AccountDeletionRecoveryExpiredError(ValueError):
    code = "DELETION_RECOVERY_EXPIRED"

    def __init__(self) -> None:
        super().__init__(self.code)


class PermanentDeletionDisabledError(ValueError):
    code = "PERMANENT_DELETION_DISABLED"

    def __init__(self) -> None:
        super().__init__(self.code)


def permanent_deletion_enabled() -> bool:
    return (
        os.getenv("PERMANENT_ACCOUNT_DELETION_ENABLED", "false").strip().lower() == "true"
        and os.getenv("FIREBASE_ADMIN_DELETE_ENABLED", "false").strip().lower() == "true"
    )


def require_permanent_deletion_enabled() -> None:
    if not permanent_deletion_enabled():
        raise PermanentDeletionDisabledError()

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)


def _account_status(user: models.User) -> str:
    # Legacy rows created before the lifecycle migration remain active.
    return str(getattr(user, "account_status", None) or "active")


def deactivate_user(user: models.User, now: Optional[datetime] = None) -> None:
    timestamp = now or datetime.now(timezone.utc)
    user.account_status = "deactivated"
    user.deactivated_at = timestamp
    user.deletion_requested_at = None
    user.deletion_due_at = None


def schedule_user_deletion(user: models.User, now: Optional[datetime] = None) -> datetime:
    timestamp = now or datetime.now(timezone.utc)
    due_at = timestamp + timedelta(days=30)
    user.account_status = "pending_deletion"
    user.deactivated_at = timestamp
    user.deletion_requested_at = timestamp
    user.deletion_due_at = due_at
    return due_at


def reactivate_user(user: models.User) -> None:
    user.account_status = "active"
    user.deactivated_at = None
    user.deletion_requested_at = None
    user.deletion_due_at = None


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
        deleted_identity = (
            db.query(models.DeletedFirebaseIdentity)
            .filter(models.DeletedFirebaseIdentity.firebase_uid == firebase_uid)
            .first()
        )
        if deleted_identity is not None:
            raise AccountDeletionPendingError()
        user = (
            db.query(models.User)
            .filter(func.lower(models.User.email) == normalised_email)
            .first()
        )

    if user is not None:
        if user.firebase_uid and user.firebase_uid != firebase_uid:
            raise ValueError("That email is already linked to another account.")
        if (
            user.firebase_uid == firebase_uid
            and _normalise_email(str(user.email or "")) != normalised_email
        ):
            raise ValueError("The verified email does not match this account.")
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


def delete_user_account(db: Session, user: models.User) -> None:
    """Delete account-owned data and detach approved archive resources.

    There are no ORM cascades on this schema, deliberately. Keeping the policy
    explicit makes deletion auditable and prevents a new relationship from
    silently retaining identity data or breaking the transaction later.
    Approved space resources are the exception: they remain available to the
    learning space after the uploader is removed, with uploader references
    anonymised.
    """
    require_permanent_deletion_enabled()
    user_id = user.id
    firebase_uid = user.firebase_uid
    if not firebase_uid:
        raise ValueError("This account has no verified external identity.")

    if db.query(models.DeletedFirebaseIdentity).filter(
        models.DeletedFirebaseIdentity.firebase_uid == firebase_uid
    ).first() is None:
        db.add(models.DeletedFirebaseIdentity(firebase_uid=firebase_uid))

    # Private academic records and membership/attendance records are removed.
    private_records = (
        (models.UserCourse, models.UserCourse.user_id),
        (models.StudentProgress, models.StudentProgress.student_id),
        (models.PracticeAttempt, models.PracticeAttempt.user_id),
        (models.ReadinessScore, models.ReadinessScore.user_id),
        (models.StudyGroupMember, models.StudyGroupMember.user_id),
        (models.StudySessionParticipant, models.StudySessionParticipant.user_id),
        (models.StudySessionAttendanceInterval, models.StudySessionAttendanceInterval.user_id),
        (models.StudySessionAttendanceEvent, models.StudySessionAttendanceEvent.user_id),
    )
    for model, field in private_records:
        db.query(model).filter(field == user_id).delete(synchronize_session=False)

    # Learning intelligence is private account data. Remove child answer
    # evidence, retakes and quiz questions before the owning quiz/profile rows.
    quiz_ids = {
        row.id for row in db.query(models.LearningQuiz.id).filter(
            models.LearningQuiz.user_id == user_id
        ).all()
    }
    db.query(models.LearningEvidence).filter(
        models.LearningEvidence.user_id == user_id
    ).delete(synchronize_session=False)
    if quiz_ids:
        db.query(models.LearningQuizAttempt).filter(
            models.LearningQuizAttempt.user_id == user_id
        ).delete(synchronize_session=False)
        db.query(models.LearningQuizQuestion).filter(
            models.LearningQuizQuestion.quiz_id.in_(quiz_ids)
        ).delete(synchronize_session=False)
        db.query(models.LearningQuiz).filter(
            models.LearningQuiz.id.in_(quiz_ids)
        ).delete(synchronize_session=False)
    db.query(models.LearningProfile).filter(
        models.LearningProfile.user_id == user_id
    ).delete(synchronize_session=False)

    # Approved archive resources have space ownership, not account ownership.
    # Detach those rows from the deleted uploader while preserving their file,
    # extracted content, retrieval chunks and contribution history. Everything
    # else remains account-owned and is removed below.
    retained_questions, private_questions = _partition_uploaded_materials(
        db, models.PastQuestion, "past_question", user_id
    )
    for row in retained_questions:
        row.uploaded_by = None
    private_question_ids = {row.id for row in private_questions}

    # Discussions that pointed at a deleted private question lose only that
    # anchor, not the conversation itself.
    if private_question_ids:
        db.query(models.MaterialGroupShare).filter(
            models.MaterialGroupShare.material_type == "past_question",
            models.MaterialGroupShare.material_id.in_(private_question_ids),
        ).delete(synchronize_session=False)
        contribution_ids = [row.id for row in db.query(models.MaterialContribution.id).filter(
            models.MaterialContribution.material_type == "past_question",
            models.MaterialContribution.material_id.in_(private_question_ids),
        ).all()]
        if contribution_ids:
            db.query(models.ModerationAudit).filter(
                models.ModerationAudit.contribution_id.in_(contribution_ids),
            ).delete(synchronize_session=False)
            db.query(models.MaterialContribution).filter(
                models.MaterialContribution.id.in_(contribution_ids),
            ).delete(synchronize_session=False)
        db.query(models.SecureShareLink).filter(
            models.SecureShareLink.material_type == "past_question",
            models.SecureShareLink.material_id.in_(private_question_ids),
        ).update({models.SecureShareLink.revoked_at: datetime.now(timezone.utc)}, synchronize_session=False)
    if private_question_ids:
        db.query(models.DiscussionThread).filter(
            models.DiscussionThread.past_question_id.in_(private_question_ids)
        ).update({models.DiscussionThread.past_question_id: None}, synchronize_session=False)
        db.query(models.PastQuestion).filter(
            models.PastQuestion.version_of_id.in_(private_question_ids)
        ).update({models.PastQuestion.version_of_id: None}, synchronize_session=False)
        db.query(models.ResourceChunk).filter(
            models.ResourceChunk.resource_type == "past_question",
            models.ResourceChunk.resource_id.in_(private_question_ids),
        ).delete(synchronize_session=False)
    for row in private_questions:
        db.delete(row)

    retained_notes, private_notes = _partition_uploaded_materials(
        db, models.LectureNote, "lecture_note", user_id
    )
    for row in retained_notes:
        row.uploaded_by = None
    private_note_ids = {row.id for row in private_notes}
    if private_note_ids:
        db.query(models.MaterialGroupShare).filter(
            models.MaterialGroupShare.material_type == "lecture_note",
            models.MaterialGroupShare.material_id.in_(private_note_ids),
        ).delete(synchronize_session=False)
        contribution_ids = [row.id for row in db.query(models.MaterialContribution.id).filter(
            models.MaterialContribution.material_type == "lecture_note",
            models.MaterialContribution.material_id.in_(private_note_ids),
        ).all()]
        if contribution_ids:
            db.query(models.ModerationAudit).filter(
                models.ModerationAudit.contribution_id.in_(contribution_ids),
            ).delete(synchronize_session=False)
            db.query(models.MaterialContribution).filter(
                models.MaterialContribution.id.in_(contribution_ids),
            ).delete(synchronize_session=False)
        db.query(models.SecureShareLink).filter(
            models.SecureShareLink.material_type == "lecture_note",
            models.SecureShareLink.material_id.in_(private_note_ids),
        ).update({models.SecureShareLink.revoked_at: datetime.now(timezone.utc)}, synchronize_session=False)
    if private_note_ids:
        db.query(models.LectureNoteSection).filter(
            models.LectureNoteSection.lecture_note_id.in_(private_note_ids)
        ).delete(synchronize_session=False)
        db.query(models.LectureNoteChunk).filter(
            models.LectureNoteChunk.lecture_note_id.in_(private_note_ids)
        ).delete(synchronize_session=False)
        db.query(models.AudioTranscriptSegment).filter(
            models.AudioTranscriptSegment.resource_id.in_(private_note_ids)
        ).delete(synchronize_session=False)
        db.query(models.LectureNote).filter(
            models.LectureNote.version_of_id.in_(private_note_ids)
        ).update({models.LectureNote.version_of_id: None}, synchronize_session=False)
        db.query(models.ResourceChunk).filter(
            models.ResourceChunk.resource_type.in_(["lecture_note", "audio"]),
            models.ResourceChunk.resource_id.in_(private_note_ids),
        ).delete(synchronize_session=False)
    for row in private_notes:
        db.delete(row)

    # Links owned by a deleted account cannot remain usable, and moderation
    # history keeps no dangling actor identity. Shared resource ownership is
    # handled by the material deletion policy above; this only revokes access
    # tokens and clears audit actor references.
    db.query(models.SecureShareLink).filter(
        models.SecureShareLink.owner_id == user_id,
    ).update({
        models.SecureShareLink.owner_id: None,
        models.SecureShareLink.revoked_at: datetime.now(timezone.utc),
    }, synchronize_session=False)
    db.query(models.ModerationAudit).filter(
        models.ModerationAudit.actor_id == user_id,
    ).update({models.ModerationAudit.actor_id: None}, synchronize_session=False)
    db.query(models.MaterialContribution).filter(
        or_(
            models.MaterialContribution.submitted_by == user_id,
            models.MaterialContribution.reviewed_by == user_id,
        )
    ).update({models.MaterialContribution.submitted_by: None, models.MaterialContribution.reviewed_by: None}, synchronize_session=False)

    # Preserve community writing while removing the author identity.
    for model, field in (
        (models.DiscussionThread, models.DiscussionThread.created_by),
        (models.ThreadMessage, models.ThreadMessage.user_id),
        (models.StudyGroupPost, models.StudyGroupPost.user_id),
        (models.StudySessionMessage, models.StudySessionMessage.user_id),
        (models.StudySessionAIQuestion, models.StudySessionAIQuestion.asked_by),
        (models.CommunityReport, models.CommunityReport.reporter_id),
        (models.Feedback, models.Feedback.user_id),
        # A group grant is retained with an approved resource, but the
        # deleted uploader's identity must not remain attached to it.
        (models.MaterialGroupShare, models.MaterialGroupShare.shared_by),
    ):
        db.query(model).filter(field == user_id).update({field: None}, synchronize_session=False)

    # Remove private invitations created for or sent to this account. These
    # records are account-scoped and do not belong in the shared archive.
    db.query(models.StudyGroupInvite).filter(
        or_(
            models.StudyGroupInvite.invited_user_id == user_id,
            models.StudyGroupInvite.invited_by == user_id,
        )
    ).delete(synchronize_session=False)

    # Transfer owned groups to an admin first, then the earliest remaining
    # ordinary member. A group with no
    # member is retained as an archived shell with no creator, so shared posts
    # and links do not disappear unexpectedly.
    owned_groups = db.query(models.StudyGroup).filter(models.StudyGroup.created_by == user_id).all()
    for group in owned_groups:
        replacement = (
            db.query(models.StudyGroupMember)
            .filter(
                models.StudyGroupMember.group_id == group.id,
                models.StudyGroupMember.user_id != user_id,
            )
            .order_by(
                case(
                    (models.StudyGroupMember.role.in_(("owner", "admin")), 0),
                    else_=1,
                ),
                models.StudyGroupMember.joined_at.asc(),
                models.StudyGroupMember.id.asc(),
            )
            .first()
        )
        if replacement is not None:
            # A malformed legacy group may contain more than one owner. Make
            # the transfer deterministic and leave exactly one owner behind.
            db.query(models.StudyGroupMember).filter(
                models.StudyGroupMember.group_id == group.id,
                models.StudyGroupMember.user_id != replacement.user_id,
                models.StudyGroupMember.role == "owner",
            ).update(
                {models.StudyGroupMember.role: "admin"},
                synchronize_session=False,
            )
            group.created_by = replacement.user_id
            replacement.role = "owner"
        else:
            group.created_by = None
            group.status = "archived"
            group.archived_at = datetime.now(timezone.utc)

    # End rooms with no remaining participant; otherwise transfer ownership to
    # the earliest participant before the user's participation rows are removed.
    owned_rooms = db.query(models.StudySession).filter(models.StudySession.created_by == user_id).all()
    for room in owned_rooms:
        replacement = (
            db.query(models.StudySessionParticipant)
            .filter(
                models.StudySessionParticipant.session_id == room.id,
                models.StudySessionParticipant.user_id != user_id,
            )
            .order_by(models.StudySessionParticipant.joined_at.asc(), models.StudySessionParticipant.id.asc())
            .first()
        )
        if replacement is not None:
            room.created_by = replacement.user_id
        else:
            room.created_by = None
            room.status = "ended"
            now = datetime.now(timezone.utc)
            if room.ends_at is None or room.ends_at > now:
                room.ends_at = now

    db.delete(user)

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
    if _account_status(user) != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is not active.",
        )
    return user

def require_role(required_role: str):
    def role_checker(current_user: models.User = Depends(get_current_user)):
        if required_role == "student" and current_user.role != "student":
            raise HTTPException(status_code=403, detail="Authenticated student access is required.")
        return current_user
    return role_checker


GLOBAL_ADMIN_REQUIRED_MESSAGE = "Administrator access is required."

# Account deletion retains only resources that have crossed the moderation
# boundary into the shared archive.  Visibility alone is not enough: a
# share-link, a group grant, or a legacy visibility value must never turn a
# private upload into archival content.
APPROVED_SHARED_VISIBILITIES = frozenset({"space_shared", "official"})


def _partition_uploaded_materials(
    db: Session,
    model: type,
    material_type: str,
    user_id: int,
) -> tuple[list, list]:
    """Separate approved archive rows from account-owned material.

    The contribution is the moderation/source-of-truth record.  A material
    is retained only when that record is approved and the material is in one
    of the two archive visibility states.  This intentionally does not use a
    share link or a visibility value by itself as proof of community
    ownership.
    """
    rows = db.query(model).filter(model.uploaded_by == user_id).all()
    retained = []
    private = []
    for row in rows:
        contribution = db.query(models.MaterialContribution).filter(
            models.MaterialContribution.material_type == material_type,
            models.MaterialContribution.material_id == row.id,
        ).first()
        if (
            contribution is not None
            and contribution.moderation_status == "approved"
            and getattr(row, "visibility", None) in APPROVED_SHARED_VISIBILITIES
        ):
            retained.append(row)
        else:
            private.append(row)
    return retained, private


def require_global_admin_user(current_user: models.User) -> models.User:
    """Authorize operations reserved for global ExamMind administrators."""
    if current_user is None or current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=GLOBAL_ADMIN_REQUIRED_MESSAGE)
    return current_user


def require_global_admin(current_user: models.User = Depends(get_current_user)) -> models.User:
    """FastAPI dependency for global, cross-learning-space administration."""
    return require_global_admin_user(current_user)
