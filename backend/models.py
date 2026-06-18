from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, ForeignKey, JSON
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
    name = Column(String, index=True)
    username = Column(String, unique=True, nullable=True, index=True)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)

class Course(Base):
    __tablename__ = "courses"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True)
    name = Column(String)
    description = Column(Text, nullable=True)

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
    file_url = Column(String, nullable=True)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)

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
    created_by = Column(Integer, ForeignKey("users.id"))
    past_question_id = Column(Integer, ForeignKey("past_questions.id"), nullable=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
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
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=utc_now)


class StudyGroupMember(Base):
    __tablename__ = "study_group_members"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("study_groups.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    joined_at = Column(DateTime(timezone=True), default=utc_now)


class StudySession(Base):
    __tablename__ = "study_sessions"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    description = Column(Text, nullable=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    topic = Column(String, nullable=True, index=True)
    exam_goal = Column(String, nullable=True)
    group_id = Column(Integer, ForeignKey("study_groups.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"))
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
    asked_by = Column(Integer, ForeignKey("users.id"))
    question = Column(Text)
    answer = Column(Text)
    sources = Column(JSON, nullable=True)
    past_question_sources = Column(JSON, nullable=True)
    lecture_note_sources = Column(JSON, nullable=True)
    no_past_questions_found = Column(Boolean, default=False)
    no_lecture_notes_found = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utc_now)
