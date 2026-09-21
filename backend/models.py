from sqlalchemy import Boolean, Column, DateTime, Integer, LargeBinary, String, Text, ForeignKey, JSON, UniqueConstraint
from sqlalchemy.orm import relationship
from pgvector.sqlalchemy import Vector
from database import Base
from datetime import datetime, timezone

def utc_now():
    return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    role = Column(String, default="student")
    account_status = Column(String(24), nullable=False, default="active", server_default="active", index=True)
    deactivated_at = Column(DateTime(timezone=True), nullable=True)
    deletion_requested_at = Column(DateTime(timezone=True), nullable=True)
    deletion_due_at = Column(DateTime(timezone=True), nullable=True, index=True)
    name = Column(String, index=True)
    username = Column(String, unique=True, nullable=True, index=True)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)
    # Firebase is the external identity source. Nullable keeps existing
    # Neon users and their study data linkable by verified email on first sign-in.
    firebase_uid = Column(String, unique=True, nullable=True, index=True)
    department = Column(String, nullable=True, index=True)
    level = Column(String, nullable=True)
    semester = Column(String, nullable=True)
    interests = Column(JSON, nullable=True)
    onboarding_completed = Column(Boolean, nullable=False, default=False, server_default="false")
    # Pending, skipped, or completed keeps a skipped profile distinct from a
    # finished one without breaking the legacy boolean used by older clients.
    onboarding_state = Column(String(20), nullable=False, default="pending", server_default="pending", index=True)
    profile_updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class DeletedFirebaseIdentity(Base):
    """A tombstone that prevents a partial Firebase deletion from recreating an account."""

    __tablename__ = "deleted_firebase_identities"

    id = Column(Integer, primary_key=True, index=True)
    firebase_uid = Column(String, unique=True, nullable=False, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)

class Course(Base):
    __tablename__ = "courses"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True)
    name = Column(String)
    description = Column(Text, nullable=True)
    department = Column(String, nullable=True, index=True)
    level = Column(String, nullable=True, index=True)

class Topic(Base):
    __tablename__ = "topics"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"))
    name = Column(String)

class PastQuestion(Base):
    __tablename__ = "past_questions"

    id = Column(Integer, primary_key=True, index=True)
    topic_id = Column(Integer, ForeignKey("topics.id"))
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    year = Column(Integer)
    semester = Column(String, nullable=True, index=True)
    difficulty = Column(String) # E.g., easy, medium, hard
    content_text = Column(Text)
    embedding = Column(Vector(384)) # OpenAI small text embedding dimension
    file_url = Column(String, nullable=True)
    # The uploaded file itself. Ingest used to parse the bytes and drop them,
    # which left nothing for a student to download. Kept here rather than in
    # object storage so there is no second service to run; move to a bucket
    # by swapping these for a key when the archive outgrows the database.
    file_data = Column(LargeBinary, nullable=True)
    file_name = Column(String, nullable=True)
    file_mime = Column(String, nullable=True)
    file_size = Column(Integer, nullable=True)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)

class StudyMaterial(Base):
    __tablename__ = "study_materials"

    id = Column(Integer, primary_key=True, index=True)
    topic_id = Column(Integer, ForeignKey("topics.id"))
    title = Column(String)
    content_text = Column(Text)
    embedding = Column(Vector(384))
    file_url = Column(String, nullable=True)

class LectureNote(Base):
    __tablename__ = "lecture_notes"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    topic = Column(String, nullable=True)
    title = Column(String)
    year = Column(Integer, nullable=True)
    semester = Column(String, nullable=True, index=True)
    # The whole cleaned text, for reading. Chunks below are cut for retrieval
    # -- fixed width with overlap -- so they repeat text and break mid-word.
    # Reconstructing a readable note from them is not possible, hence this.
    content_text = Column(Text, nullable=True)
    file_url = Column(String, nullable=True)
    file_data = Column(LargeBinary, nullable=True)
    file_name = Column(String, nullable=True)
    file_mime = Column(String, nullable=True)
    file_size = Column(Integer, nullable=True)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)

class LectureNoteSection(Base):
    """A note cut for reading, not for retrieval.

    Sections follow the document's own headings where it has them and fall
    back to page boundaries where it does not, so a section is something a
    student recognises -- and something specific enough to ask Maxe about.
    Separate from LectureNoteChunk on purpose: that table serves embeddings
    and is tuned for recall, this one serves eyes.
    """

    __tablename__ = "lecture_note_sections"

    id = Column(Integer, primary_key=True, index=True)
    lecture_note_id = Column(Integer, ForeignKey("lecture_notes.id"), index=True)
    section_index = Column(Integer)
    heading = Column(String, nullable=True)
    body = Column(Text)
    page_from = Column(Integer, nullable=True)
    page_to = Column(Integer, nullable=True)
    # "heading" or "page" or "length" -- how this cut was decided, so the
    # reader can be honest about sections it invented from nothing.
    cut_by = Column(String, nullable=True)

class LectureNoteChunk(Base):
    __tablename__ = "lecture_note_chunks"

    id = Column(Integer, primary_key=True, index=True)
    lecture_note_id = Column(Integer, ForeignKey("lecture_notes.id"))
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    chunk_text = Column(Text)
    embedding = Column(Vector(384))
    topic_tag = Column(String, nullable=True)
    chunk_index = Column(Integer)
    metadata_json = Column(JSON, nullable=True)

class StudentProgress(Base):
    __tablename__ = "student_progress"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"))
    topic_id = Column(Integer, ForeignKey("topics.id"))
    mastery_score = Column(Integer, default=0) # 0-100
    last_practiced = Column(String, nullable=True)

class PracticeAttempt(Base):
    __tablename__ = "practice_attempts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    topic = Column(String, nullable=True, index=True)
    score = Column(Integer, default=0)
    total_questions = Column(Integer, default=0)
    debrief_generated = Column(Boolean, default=False)
    debrief = Column(Text, nullable=True)
    completed_at = Column(DateTime(timezone=True), default=utc_now)

class ReadinessScore(Base):
    __tablename__ = "readiness_scores"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    topic = Column(String, nullable=True, index=True)
    score = Column(Integer, default=0)
    updated_at = Column(DateTime(timezone=True), default=utc_now)

class DiscussionThread(Base):
    __tablename__ = "discussion_threads"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    past_question_id = Column(Integer, ForeignKey("past_questions.id"), nullable=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    category = Column(String, nullable=True, index=True)
    mood = Column(String, nullable=True)
    group_id = Column(Integer, ForeignKey("study_groups.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)

class ThreadMessage(Base):
    __tablename__ = "thread_messages"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("discussion_threads.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    content = Column(Text)
    is_ai_response = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utc_now)


class StudyGroup(Base):
    __tablename__ = "study_groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    description = Column(Text, nullable=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    topic = Column(String, nullable=True, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    visibility = Column(String, nullable=False, default="public", server_default="public")
    status = Column(String, nullable=False, default="active", server_default="active")
    welcome_message = Column(Text, nullable=True)
    archived_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)


class StudyGroupMember(Base):
    __tablename__ = "study_group_members"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("study_groups.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    role = Column(String, nullable=False, default="member", server_default="member")
    notifications_enabled = Column(Boolean, nullable=False, default=True, server_default="true")
    joined_at = Column(DateTime(timezone=True), default=utc_now)

    __table_args__ = (
        UniqueConstraint("group_id", "user_id", name="uq_study_group_member_group_user"),
    )


class UserCourse(Base):
    __tablename__ = "user_courses"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), index=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)

    __table_args__ = (
        UniqueConstraint("user_id", "course_id", name="uq_user_course_user_course"),
    )


class StudyGroupPost(Base):
    __tablename__ = "study_group_posts"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("study_groups.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    content = Column(Text)
    post_type = Column(String, nullable=False, default="discussion", server_default="discussion")
    created_at = Column(DateTime(timezone=True), default=utc_now)


class StudyGroupInvite(Base):
    __tablename__ = "study_group_invites"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("study_groups.id"), index=True)
    invited_user_id = Column(Integer, ForeignKey("users.id"), index=True)
    invited_by = Column(Integer, ForeignKey("users.id"), index=True)
    status = Column(String, nullable=False, default="pending", server_default="pending")
    created_at = Column(DateTime(timezone=True), default=utc_now)

    __table_args__ = (
        UniqueConstraint("group_id", "invited_user_id", name="uq_study_group_invite_group_user"),
    )


class CommunityReport(Base):
    __tablename__ = "community_reports"

    id = Column(Integer, primary_key=True, index=True)
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    subject_type = Column(String, nullable=False)
    subject_id = Column(Integer, nullable=False, index=True)
    reason = Column(String, nullable=False)
    details = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="open", server_default="open")
    created_at = Column(DateTime(timezone=True), default=utc_now)


class Feedback(Base):
    """A product feedback submission from a verified student or visitor.

    Public submissions intentionally have no user foreign key.  The source
    column is written by the endpoint, never accepted from the browser, so an
    optional guest email cannot become an account identity by accident.
    """

    __tablename__ = "feedback"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    guest_name = Column(String(120), nullable=True)
    reply_email = Column(String(254), nullable=True)
    source = Column(String(20), nullable=False, index=True)
    category = Column(String(80), nullable=False, index=True)
    message = Column(Text, nullable=False)
    rating = Column(Integer, nullable=True)
    page_path = Column(String(512), nullable=False)
    status = Column(String(20), nullable=False, default="new", server_default="new", index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now, index=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)


class StudySession(Base):
    __tablename__ = "study_sessions"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    description = Column(Text, nullable=True)
    purpose = Column(Text, nullable=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    topic = Column(String, nullable=True, index=True)
    exam_goal = Column(String, nullable=True)
    group_id = Column(Integer, ForeignKey("study_groups.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    school_name = Column(String, nullable=True)
    starts_at = Column(DateTime(timezone=True), nullable=True)
    ends_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, default="active")  # active, ended
    created_at = Column(DateTime(timezone=True), default=utc_now)


class StudySessionParticipant(Base):
    __tablename__ = "study_session_participants"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("study_sessions.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    joined_at = Column(DateTime(timezone=True), default=utc_now)
    last_seen_at = Column(DateTime(timezone=True), default=utc_now)
    status = Column(String, default="studying")  # studying, on_break, left
    left_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("session_id", "user_id", name="uq_study_session_participant_session_user"),
    )


class StudySessionAttendanceInterval(Base):
    __tablename__ = "study_session_attendance_intervals"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("study_sessions.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    kind = Column(String, nullable=False, default="studying", server_default="studying")
    started_at = Column(DateTime(timezone=True), default=utc_now)
    ended_at = Column(DateTime(timezone=True), nullable=True)


class StudySessionAttendanceEvent(Base):
    __tablename__ = "study_session_attendance_events"

    id = Column(Integer, primary_key=True, index=True)
    event_key = Column(String, unique=True, index=True)
    session_id = Column(Integer, ForeignKey("study_sessions.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    event_type = Column(String, nullable=False)
    occurred_at = Column(DateTime(timezone=True), default=utc_now)
    metadata_json = Column(JSON, nullable=True)


class StudySessionMessage(Base):
    __tablename__ = "study_session_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("study_sessions.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    content = Column(Text)
    created_at = Column(DateTime(timezone=True), default=utc_now)
    message_type = Column(String, default="chat")  # chat, ai_event


class StudySessionAIQuestion(Base):
    __tablename__ = "study_session_ai_questions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("study_sessions.id"), index=True)
    asked_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    question = Column(Text)
    answer = Column(Text)
    sources = Column(JSON, nullable=True)
    past_question_sources = Column(JSON, nullable=True)
    lecture_note_sources = Column(JSON, nullable=True)
    no_past_questions_found = Column(Boolean, default=False)
    no_lecture_notes_found = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utc_now)
