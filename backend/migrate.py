"""
ExamMind database migration script.

Run once after setting DATABASE_URL in your .env (or environment):

    cd backend
    python migrate.py

Safe to run multiple times — all operations are idempotent.
"""

import os
import sys

# ── Load .env if present ───────────────────────────────────────────────────────

_env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(_env_path):
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())

# ── Validate env ───────────────────────────────────────────────────────────────

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print(
        "ERROR: DATABASE_URL is not set.\n"
        "Copy .env.example to .env, fill in your credentials, then re-run."
    )
    sys.exit(1)

SECRET_KEY = os.getenv("SECRET_KEY", "migration-placeholder")
os.environ.setdefault("SECRET_KEY", SECRET_KEY)

# ── Imports (after env is set) ─────────────────────────────────────────────────

from sqlalchemy import text
from database import engine, Base
import models  # registers all ORM classes with Base.metadata
from init_db import seed_courses


with engine.begin() as conn:
    # Neon supports pgvector, but a new project does not have the extension
    # enabled until it is requested. This must precede any vector column DDL.
    conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    print("  OK  CREATE EXTENSION IF NOT EXISTS vector")


# ── 1. Add new columns to existing tables ─────────────────────────────────────

_ALTER_STATEMENTS = [
    # username column — added in Reading Rooms sprint; nullable so existing rows survive
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR UNIQUE;",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR;",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR;",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS level VARCHAR;",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS semester VARCHAR;",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS interests JSONB;",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_state VARCHAR(20) NOT NULL DEFAULT 'pending';",
    "UPDATE users SET onboarding_state = 'completed' WHERE onboarding_completed = TRUE AND onboarding_state <> 'completed';",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_updated_at TIMESTAMPTZ;",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status VARCHAR(24) NOT NULL DEFAULT 'active';",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_due_at TIMESTAMPTZ;",
    "CREATE INDEX IF NOT EXISTS ix_users_account_status ON users (account_status);",
    "CREATE INDEX IF NOT EXISTS ix_users_deletion_due_at ON users (deletion_due_at);",
    "ALTER TABLE discussion_threads ALTER COLUMN created_by DROP NOT NULL;",
    "ALTER TABLE study_groups ALTER COLUMN created_by DROP NOT NULL;",
    "ALTER TABLE study_group_posts ALTER COLUMN user_id DROP NOT NULL;",
    "ALTER TABLE study_group_invites ALTER COLUMN invited_by DROP NOT NULL;",
    "ALTER TABLE community_reports ALTER COLUMN reporter_id DROP NOT NULL;",
    "ALTER TABLE study_sessions ALTER COLUMN created_by DROP NOT NULL;",
    "ALTER TABLE study_session_ai_questions ALTER COLUMN asked_by DROP NOT NULL;",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_firebase_uid ON users (firebase_uid) WHERE firebase_uid IS NOT NULL;",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email_lower ON users (LOWER(email));",
    "ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS visibility VARCHAR NOT NULL DEFAULT 'public';",
    "ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'active';",
    "ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS welcome_message TEXT;",
    "ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS department VARCHAR;",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS level VARCHAR;",
    "ALTER TABLE study_group_members ADD COLUMN IF NOT EXISTS role VARCHAR NOT NULL DEFAULT 'member';",
    "ALTER TABLE study_group_members ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_study_group_member_group_user ON study_group_members (group_id, user_id);",
    "UPDATE study_group_members SET role = 'owner' FROM study_groups WHERE study_group_members.group_id = study_groups.id AND study_group_members.user_id = study_groups.created_by AND study_group_members.role = 'member';",
    "ALTER TABLE discussion_threads ADD COLUMN IF NOT EXISTS category VARCHAR;",
    "ALTER TABLE discussion_threads ADD COLUMN IF NOT EXISTS mood VARCHAR;",
    "ALTER TABLE discussion_threads ADD COLUMN IF NOT EXISTS group_id INTEGER;",
    "ALTER TABLE discussion_threads ADD COLUMN IF NOT EXISTS content TEXT;",
    "ALTER TABLE thread_messages ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(96);",
    "CREATE INDEX IF NOT EXISTS ix_discussion_threads_created_id ON discussion_threads (created_at, id);",
    "CREATE INDEX IF NOT EXISTS ix_discussion_threads_course_created ON discussion_threads (course_id, created_at, id);",
    "CREATE INDEX IF NOT EXISTS ix_discussion_threads_group_created ON discussion_threads (group_id, created_at, id);",
    "CREATE INDEX IF NOT EXISTS ix_thread_messages_client_message_id ON thread_messages (client_message_id);",
    "ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS purpose TEXT;",
    "UPDATE study_sessions SET starts_at = COALESCE(starts_at, created_at), ends_at = COALESCE(ends_at, COALESCE(starts_at, created_at) + INTERVAL '50 minutes') WHERE starts_at IS NULL OR ends_at IS NULL;",
    "ALTER TABLE study_sessions ALTER COLUMN starts_at SET NOT NULL;",
    "ALTER TABLE study_sessions ALTER COLUMN ends_at SET NOT NULL;",
    "ALTER TABLE study_session_participants ADD COLUMN IF NOT EXISTS break_until TIMESTAMPTZ;",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_study_session_participant_session_user ON study_session_participants (session_id, user_id);",
    "ALTER TABLE study_group_invites ALTER COLUMN invited_user_id DROP NOT NULL;",
    "ALTER TABLE study_group_invites ADD COLUMN IF NOT EXISTS token VARCHAR(96);",
    "ALTER TABLE study_group_invites ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;",
    "ALTER TABLE study_group_invites ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;",
    "ALTER TABLE study_group_invites ADD COLUMN IF NOT EXISTS max_uses INTEGER;",
    "ALTER TABLE study_group_invites ADD COLUMN IF NOT EXISTS use_count INTEGER NOT NULL DEFAULT 0;",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_study_group_invites_token ON study_group_invites (token) WHERE token IS NOT NULL;",
    # Vector columns are added only when absent, so repeated runs preserve
    # existing embeddings on a live database.
    "ALTER TABLE past_questions ADD COLUMN IF NOT EXISTS embedding vector(384);",
    "ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS embedding vector(384);",
    "ALTER TABLE lecture_note_chunks ADD COLUMN IF NOT EXISTS embedding vector(384);",
    "ALTER TABLE past_questions ADD COLUMN IF NOT EXISTS visibility VARCHAR(16) NOT NULL DEFAULT 'private';",
    "ALTER TABLE lecture_notes ADD COLUMN IF NOT EXISTS visibility VARCHAR(16) NOT NULL DEFAULT 'private';",
    "ALTER TABLE past_questions ADD COLUMN IF NOT EXISTS source_checksum VARCHAR(64);",
    "ALTER TABLE past_questions ADD COLUMN IF NOT EXISTS version_of_id INTEGER;",
    "ALTER TABLE past_questions ADD COLUMN IF NOT EXISTS version_number INTEGER NOT NULL DEFAULT 1;",
    "ALTER TABLE lecture_notes ADD COLUMN IF NOT EXISTS source_checksum VARCHAR(64);",
    "ALTER TABLE lecture_notes ADD COLUMN IF NOT EXISTS version_of_id INTEGER;",
    "ALTER TABLE lecture_notes ADD COLUMN IF NOT EXISTS version_number INTEGER NOT NULL DEFAULT 1;",
    "CREATE INDEX IF NOT EXISTS ix_past_questions_visibility ON past_questions (visibility);",
    "CREATE INDEX IF NOT EXISTS ix_lecture_notes_visibility ON lecture_notes (visibility);",
    "CREATE INDEX IF NOT EXISTS ix_past_questions_source_checksum ON past_questions (source_checksum);",
    "CREATE INDEX IF NOT EXISTS ix_past_questions_version_of_id ON past_questions (version_of_id);",
    "CREATE INDEX IF NOT EXISTS ix_lecture_notes_source_checksum ON lecture_notes (source_checksum);",
    "CREATE INDEX IF NOT EXISTS ix_lecture_notes_version_of_id ON lecture_notes (version_of_id);",
    "CREATE TABLE IF NOT EXISTS material_group_shares (id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, material_type VARCHAR(32) NOT NULL, material_id INTEGER NOT NULL, group_id INTEGER NOT NULL REFERENCES study_groups(id), shared_by INTEGER REFERENCES users(id), created_at TIMESTAMPTZ, CONSTRAINT uq_material_group_share UNIQUE (material_type, material_id, group_id));",
    "CREATE INDEX IF NOT EXISTS ix_material_group_shares_material ON material_group_shares (material_type, material_id);",
    "CREATE INDEX IF NOT EXISTS ix_material_group_shares_group ON material_group_shares (group_id);",
]

print("Running column migrations...")
with engine.connect() as conn:
    for stmt in _ALTER_STATEMENTS:
        try:
            conn.execute(text(stmt))
            conn.commit()
            print(f"  OK  {stmt.strip()}")
        except Exception as exc:
            print(f"  SKIP  {stmt.strip()}")
            print(f"        reason: {exc}")
            conn.rollback()

# ── 2. Create any tables that don't exist yet ──────────────────────────────────

print("Creating missing tables...")
# Feedback is additive.  Base.metadata.create_all creates its nullable
# public-visitor columns and required source/status fields without changing
# existing user, material, or community records.
Base.metadata.create_all(bind=engine)
print("  Done.")
seed_courses()
print("  Seeded initial course catalogue (existing IDs preserved).")

print("\nMigration complete.")
