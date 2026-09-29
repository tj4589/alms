from sqlalchemy import Boolean, Column, DateTime, Float, Index, Integer, LargeBinary, String, Text, ForeignKey, JSON, UniqueConstraint
from sqlalchemy.orm import relationship
from pgvector.sqlalchemy import Vector
from database import Base
from datetime import datetime, timezone

def utc_now():
    return datetime.now(timezone.utc)


class LearningSpace(Base):
    """An organization or environment inside the shared ExamMind platform."""

    __tablename__ = "learning_spaces"

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String(80), unique=True, nullable=False, index=True)
    name = Column(String(160), nullable=False)
    type = Column(String(32), nullable=False, index=True)
    description = Column(Text, nullable=True)
    logo = Column(String(512), nullable=True)
    status = Column(String(24), nullable=False, default="active", server_default="active", index=True)
    settings = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)


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
    onboarding_preferences = Column(JSON, nullable=True)
    active_learning_space_id = Column(Integer, ForeignKey("learning_spaces.id"), nullable=True, index=True)
    onboarding_completed = Column(Boolean, nullable=False, default=False, server_default="false")
    # Pending, skipped, or completed keeps a skipped profile distinct from a
    # finished one without breaking the legacy boolean used by older clients.
    onboarding_state = Column(String(20), nullable=False, default="pending", server_default="pending", index=True)
    profile_updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class LearningSpaceMembership(Base):
    """The user's membership in a learning space, separate from identity."""

    __tablename__ = "learning_space_memberships"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    learning_space_id = Column(Integer, ForeignKey("learning_spaces.id", ondelete="CASCADE"), nullable=False, index=True)
    external_member_id = Column(String(80), nullable=True, index=True)
    role = Column(String(32), nullable=False, default="member", server_default="member")
    status = Column(String(24), nullable=False, default="active", server_default="active", index=True)
    onboarding_state = Column(String(20), nullable=False, default="pending", server_default="pending")
    joined_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    metadata_json = Column("metadata", JSON, nullable=True)

    __table_args__ = (
        UniqueConstraint("user_id", "learning_space_id", name="uq_learning_space_membership_user_space"),
        UniqueConstraint("learning_space_id", "external_member_id", name="uq_learning_space_membership_external_id"),
    )


class KsaMember(Base):
    """Authoritative KSA registry; rows are imported by trusted operators."""

    __tablename__ = "ksa_member_registry"

    id = Column(Integer, primary_key=True, index=True)
    ksa_id = Column(String(80), unique=True, nullable=False, index=True)
    cohort = Column(String(80), nullable=True)
    name = Column(String(160), nullable=True)
    email = Column(String(254), nullable=True)
    status = Column(String(24), nullable=False, default="active", server_default="active", index=True)
    claimed_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, unique=True, index=True)
    claimed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)


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
    source_checksum = Column(String(64), nullable=True, index=True)
    version_of_id = Column(Integer, ForeignKey("past_questions.id"), nullable=True, index=True)
    version_number = Column(Integer, nullable=False, default=1, server_default="1")
    metadata_json = Column(JSON, nullable=True)
    # Publication is deliberately private until the uploader gives explicit
    # consent. Older rows are migrated to the same safe state.
    visibility = Column(String(16), nullable=False, default="private", server_default="private", index=True)
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
    source_checksum = Column(String(64), nullable=True, index=True)
    version_of_id = Column(Integer, ForeignKey("lecture_notes.id"), nullable=True, index=True)
    version_number = Column(Integer, nullable=False, default=1, server_default="1")
    metadata_json = Column(JSON, nullable=True)
    visibility = Column(String(16), nullable=False, default="private", server_default="private", index=True)
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


class ResourceChunk(Base):
    """Canonical retrieval chunk with type-neutral provenance."""

    __tablename__ = "resource_chunks"

    id = Column(Integer, primary_key=True, index=True)
    resource_type = Column(String(32), nullable=False, index=True)
    resource_id = Column(Integer, nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    chunk_text = Column(Text, nullable=False)
    embedding = Column(Vector(384), nullable=True)
    page_from = Column(Integer, nullable=True)
    page_to = Column(Integer, nullable=True)
    slide_from = Column(Integer, nullable=True)
    slide_to = Column(Integer, nullable=True)
    timestamp_start = Column(Float, nullable=True)
    timestamp_end = Column(Float, nullable=True)
    section = Column(String, nullable=True)
    heading = Column(String, nullable=True)
    topic = Column(String, nullable=True)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)

    __table_args__ = (
        UniqueConstraint("resource_type", "resource_id", "chunk_index", name="uq_resource_chunk_position"),
        Index("ix_resource_chunks_resource", "resource_type", "resource_id"),
    )


class AudioTranscriptSegment(Base):
    """Timestamped provider output for an audio-backed lecture note."""

    __tablename__ = "audio_transcript_segments"

    id = Column(Integer, primary_key=True, index=True)
    resource_id = Column(Integer, ForeignKey("lecture_notes.id", ondelete="CASCADE"), nullable=False, index=True)
    segment_index = Column(Integer, nullable=False)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    text = Column(Text, nullable=False)
    speaker = Column(String, nullable=True)
    confidence = Column(Float, nullable=True)
    topic = Column(String, nullable=True)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)

    __table_args__ = (
        UniqueConstraint("resource_id", "segment_index", name="uq_audio_transcript_segment_position"),
        Index("ix_audio_transcript_segments_resource", "resource_id", "segment_index"),
    )

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


class LearningProfile(Base):
    """Private learning preferences and behaviour-derived observations."""

    __tablename__ = "learning_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    explicit_preferences = Column(JSON, nullable=True)
    inferred_preferences = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)


class LearningQuiz(Base):
    """A generated quiz owned by one student."""

    __tablename__ = "learning_quizzes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    topic = Column(String, nullable=True, index=True)
    source_scope = Column(String(24), nullable=False, default="workspace")
    resource_type = Column(String(32), nullable=True)
    resource_id = Column(Integer, nullable=True)
    difficulty = Column(String(16), nullable=False, default="mixed")
    question_type = Column(String(24), nullable=False, default="multiple_choice")
    question_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)


class LearningQuizQuestion(Base):
    """A quiz item with private grading data and public source provenance."""

    __tablename__ = "learning_quiz_questions"

    id = Column(Integer, primary_key=True, index=True)
    quiz_id = Column(Integer, ForeignKey("learning_quizzes.id", ondelete="CASCADE"), nullable=False, index=True)
    position = Column(Integer, nullable=False)
    question_type = Column(String(24), nullable=False, default="multiple_choice")
    prompt = Column(Text, nullable=False)
    options = Column(JSON, nullable=True)
    correct_answer = Column(Text, nullable=False)
    grading_keywords = Column(JSON, nullable=True)
    explanation = Column(Text, nullable=False)
    topic = Column(String, nullable=True, index=True)
    difficulty = Column(String(16), nullable=False, default="medium")
    citation_json = Column(JSON, nullable=False)

    __table_args__ = (
        UniqueConstraint("quiz_id", "position", name="uq_learning_quiz_question_position"),
    )


class LearningQuizAttempt(Base):
    """One immutable retake; previous attempts are never overwritten."""

    __tablename__ = "learning_quiz_attempts"

    id = Column(Integer, primary_key=True, index=True)
    quiz_id = Column(Integer, ForeignKey("learning_quizzes.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    score = Column(Integer, nullable=False, default=0)
    total_questions = Column(Integer, nullable=False, default=0)
    graded_questions = Column(Integer, nullable=False, default=0)
    needs_review_count = Column(Integer, nullable=False, default=0)
    percentage = Column(Integer, nullable=True)
    review_json = Column(JSON, nullable=False, default=list)
    completed_at = Column(DateTime(timezone=True), nullable=False, default=utc_now, index=True)


class LearningEvidence(Base):
    """One observable answer event used for topic evidence and readiness."""

    __tablename__ = "learning_evidence"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    attempt_id = Column(Integer, ForeignKey("learning_quiz_attempts.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id = Column(Integer, ForeignKey("learning_quiz_questions.id", ondelete="CASCADE"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    topic = Column(String, nullable=True, index=True)
    evidence_type = Column(String(32), nullable=False, default="quiz_answer")
    is_correct = Column(Boolean, nullable=False)
    answered_at = Column(DateTime(timezone=True), nullable=False, default=utc_now, index=True)

class DiscussionThread(Base):
    __tablename__ = "discussion_threads"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    content = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    past_question_id = Column(Integer, ForeignKey("past_questions.id"), nullable=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    category = Column(String, nullable=True, index=True)
    mood = Column(String, nullable=True)
    group_id = Column(Integer, ForeignKey("study_groups.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)

    __table_args__ = (
        Index("ix_discussion_threads_created_id", "created_at", "id"),
        Index("ix_discussion_threads_course_created", "course_id", "created_at", "id"),
        Index("ix_discussion_threads_group_created", "group_id", "created_at", "id"),
    )

class ThreadMessage(Base):
    __tablename__ = "thread_messages"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("discussion_threads.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    content = Column(Text)
    client_message_id = Column(String(96), nullable=True, index=True)
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


class MaterialGroupShare(Base):
    """Group grants for a private-to-a-group academic material.

    Material IDs are polymorphic because past-question uploads are stored as
    several retrieval rows while lecture notes have one row. The material
    router always validates the type and owner before writing a grant.
    """

    __tablename__ = "material_group_shares"

    id = Column(Integer, primary_key=True, index=True)
    material_type = Column(String(32), nullable=False, index=True)
    material_id = Column(Integer, nullable=False, index=True)
    group_id = Column(Integer, ForeignKey("study_groups.id"), nullable=False, index=True)
    shared_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)

    __table_args__ = (
        UniqueConstraint("material_type", "material_id", "group_id", name="uq_material_group_share"),
        Index("ix_material_group_share_lookup", "material_type", "material_id", "group_id"),
    )


class MaterialContribution(Base):
    """A deliberate contribution request, kept separate from publication state.

    A material can remain private while it is waiting for review.  The
    requested visibility records the uploader's consent without allowing the
    retrieval layer to treat a pending contribution as published.
    """

    __tablename__ = "material_contributions"

    id = Column(Integer, primary_key=True, index=True)
    material_type = Column(String(32), nullable=False, index=True)
    material_id = Column(Integer, nullable=False, index=True)
    learning_space_id = Column(Integer, ForeignKey("learning_spaces.id"), nullable=False, index=True)
    submitted_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    requested_visibility = Column(String(16), nullable=False, default="space_shared", server_default="space_shared")
    requested_group_ids = Column(JSON, nullable=True)
    moderation_status = Column(String(32), nullable=False, default="not_submitted", server_default="not_submitted", index=True)
    review_reason = Column(Text, nullable=True)
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    __table_args__ = (
        UniqueConstraint("material_type", "material_id", name="uq_material_contribution_material"),
        Index("ix_material_contribution_status_space", "moderation_status", "learning_space_id"),
    )


class ModerationAudit(Base):
    """Append-only moderation history; no content or storage bytes are copied."""

    __tablename__ = "moderation_audits"

    id = Column(Integer, primary_key=True, index=True)
    contribution_id = Column(Integer, ForeignKey("material_contributions.id"), nullable=True, index=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    action = Column(String(48), nullable=False)
    material_type = Column(String(32), nullable=False)
    material_id = Column(Integer, nullable=False, index=True)
    learning_space_id = Column(Integer, ForeignKey("learning_spaces.id"), nullable=True, index=True)
    previous_state = Column(JSON, nullable=True)
    new_state = Column(JSON, nullable=True)
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)


class SecureShareLink(Base):
    """A revocable, policy-bound link to one explicitly shared item."""

    __tablename__ = "secure_share_links"

    id = Column(Integer, primary_key=True, index=True)
    token_hash = Column(String(64), unique=True, nullable=False, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    content_type = Column(String(40), nullable=False, index=True)
    content_id = Column(String(160), nullable=True)
    material_type = Column(String(32), nullable=True)
    material_id = Column(Integer, nullable=True, index=True)
    learning_space_id = Column(Integer, ForeignKey("learning_spaces.id"), nullable=True, index=True)
    group_id = Column(Integer, ForeignKey("study_groups.id"), nullable=True, index=True)
    access_policy = Column(String(24), nullable=False, default="owner", server_default="owner")
    payload_json = Column(JSON, nullable=True)
    settings_json = Column(JSON, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True, index=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)

    __table_args__ = (
        Index("ix_secure_share_links_content", "content_type", "content_id"),
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
    invited_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    invited_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    token = Column(String(96), unique=True, nullable=True, index=True)
    status = Column(String, nullable=False, default="pending", server_default="pending")
    expires_at = Column(DateTime(timezone=True), nullable=True, index=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    max_uses = Column(Integer, nullable=True)
    use_count = Column(Integer, nullable=False, default=0, server_default="0")
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
    starts_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    ends_at = Column(DateTime(timezone=True), nullable=False)
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
    break_until = Column(DateTime(timezone=True), nullable=True)
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
