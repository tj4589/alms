from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, ForeignKey, JSON
from sqlalchemy.orm import relationship
from pgvector.sqlalchemy import Vector
from database import Base
from datetime import datetime

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    role = Column(String, default="student") # admin, lecturer, student
    name = Column(String, index=True)
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
    embedding = Column(Vector(1536)) # OpenAI small text embedding dimension
    file_url = Column(String, nullable=True)
    verified_status = Column(String, default="unverified")
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class StudyMaterial(Base):
    __tablename__ = "study_materials"

    id = Column(Integer, primary_key=True, index=True)
    topic_id = Column(Integer, ForeignKey("topics.id"))
    title = Column(String)
    content_text = Column(Text)
    embedding = Column(Vector(1536))
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
    verified_status = Column(String, default="unverified")
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class LectureNoteChunk(Base):
    __tablename__ = "lecture_note_chunks"

    id = Column(Integer, primary_key=True, index=True)
    lecture_note_id = Column(Integer, ForeignKey("lecture_notes.id"))
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    chunk_text = Column(Text)
    embedding = Column(Vector(1536))
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

class Verification(Base):
    __tablename__ = "verifications"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, index=True)
    document_type = Column(String, index=True) # past_question, lecture_note
    user_id = Column(Integer, ForeignKey("users.id"))
    action = Column(String) # confirm, flag
    created_at = Column(DateTime, default=datetime.utcnow)

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
    completed_at = Column(DateTime, default=datetime.utcnow)

class ReadinessScore(Base):
    __tablename__ = "readiness_scores"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    topic = Column(String, nullable=True, index=True)
    score = Column(Integer, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow)

class DiscussionThread(Base):
    __tablename__ = "discussion_threads"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    past_question_id = Column(Integer, ForeignKey("past_questions.id"), nullable=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class ThreadMessage(Base):
    __tablename__ = "thread_messages"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("discussion_threads.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    content = Column(Text)
    is_ai_response = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
