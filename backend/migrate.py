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


# ── 1. Add new columns to existing tables ─────────────────────────────────────

_ALTER_STATEMENTS = [
    # username column — added in Reading Rooms sprint; nullable so existing rows survive
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR UNIQUE;",
    # Vector columns resized 1536 → 384 (switched from OpenAI embeddings to
    # sentence-transformers all-MiniLM-L6-v2). Safe on empty tables.
    "ALTER TABLE past_questions DROP COLUMN IF EXISTS embedding;",
    "ALTER TABLE past_questions ADD COLUMN IF NOT EXISTS embedding vector(384);",
    "ALTER TABLE study_materials DROP COLUMN IF EXISTS embedding;",
    "ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS embedding vector(384);",
    "ALTER TABLE lecture_note_chunks DROP COLUMN IF EXISTS embedding;",
    "ALTER TABLE lecture_note_chunks ADD COLUMN IF NOT EXISTS embedding vector(384);",
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
Base.metadata.create_all(bind=engine)
print("  Done.")

print("\nMigration complete.")
