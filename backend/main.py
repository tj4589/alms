import os

from fastapi import FastAPI, Request
from sqlalchemy import text
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from routers import auth, community, feedback, ingest, mvp, rag, search, sessions, understand
import models as _models  # noqa: F401 — registers all ORM classes with Base
from database import Base, engine
from init_db import seed_courses

BACKEND_HOST = os.getenv("BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8001"))

app = FastAPI(
    title="AI-Based LMS API",
    description="Backend API for the AI-Powered Learning Management System",
    version="1.0.0"
)

def _prepare_database() -> None:
    """Idempotent, safe to run every boot.

    pgvector has to exist before create_all: models.py maps a Vector column,
    and a freshly provisioned managed database has no extensions enabled, so
    the CREATE TABLE would fail on an unknown type.
    """
    with engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(bind=engine)
    # create_all does not add columns to a table that already exists. Keep the
    # Firebase identity migration safe for an existing Neon deployment too.
    statements = [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_firebase_uid ON users (firebase_uid) WHERE firebase_uid IS NOT NULL",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS level VARCHAR",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS semester VARCHAR",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS interests JSONB",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_state VARCHAR(20) NOT NULL DEFAULT 'pending'",
        "UPDATE users SET onboarding_state = 'completed' WHERE onboarding_completed = TRUE AND onboarding_state <> 'completed'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_updated_at TIMESTAMPTZ",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status VARCHAR(24) NOT NULL DEFAULT 'active'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_due_at TIMESTAMPTZ",
        "CREATE INDEX IF NOT EXISTS ix_users_account_status ON users (account_status)",
        "CREATE INDEX IF NOT EXISTS ix_users_deletion_due_at ON users (deletion_due_at)",
        "ALTER TABLE discussion_threads ALTER COLUMN created_by DROP NOT NULL",
        "ALTER TABLE study_groups ALTER COLUMN created_by DROP NOT NULL",
        "ALTER TABLE study_group_posts ALTER COLUMN user_id DROP NOT NULL",
        "ALTER TABLE community_reports ALTER COLUMN reporter_id DROP NOT NULL",
        "ALTER TABLE study_sessions ALTER COLUMN created_by DROP NOT NULL",
        "ALTER TABLE study_session_ai_questions ALTER COLUMN asked_by DROP NOT NULL",
        "ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS visibility VARCHAR NOT NULL DEFAULT 'public'",
        "ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'active'",
        "ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS welcome_message TEXT",
        "ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ",
        "ALTER TABLE courses ADD COLUMN IF NOT EXISTS department VARCHAR",
        "ALTER TABLE courses ADD COLUMN IF NOT EXISTS level VARCHAR",
        "ALTER TABLE study_group_members ADD COLUMN IF NOT EXISTS role VARCHAR NOT NULL DEFAULT 'member'",
        "ALTER TABLE study_group_members ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_study_group_member_group_user ON study_group_members (group_id, user_id)",
        "UPDATE study_group_members SET role = 'owner' FROM study_groups WHERE study_group_members.group_id = study_groups.id AND study_group_members.user_id = study_groups.created_by AND study_group_members.role = 'member'",
        "ALTER TABLE discussion_threads ADD COLUMN IF NOT EXISTS category VARCHAR",
        "ALTER TABLE discussion_threads ADD COLUMN IF NOT EXISTS mood VARCHAR",
        "ALTER TABLE discussion_threads ADD COLUMN IF NOT EXISTS group_id INTEGER",
        "ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS purpose TEXT",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_study_session_participant_session_user ON study_session_participants (session_id, user_id)",
    ]
    for statement in statements:
        try:
            with engine.begin() as connection:
                connection.execute(text(statement))
        except Exception as exc:
            print(f"Warning: schema update skipped: {exc}")
    try:
        seed_courses()
    except Exception as exc:
        print(f"Warning: course catalogue seed skipped: {exc}")


@app.on_event("startup")
def _prepare_database_on_startup() -> None:
    """Prepare the schema without making the liveness endpoint DB-dependent."""
    try:
        _prepare_database()
    except Exception as exc:
        # Render checks /docs. Keep the process available so the health check
        # can distinguish a live API from a temporarily unavailable database;
        # database-backed requests will surface the underlying failure until
        # the configured Neon connection is fixed.
        print(f"Warning: database initialization failed: {exc}")

default_cors_origins = "http://localhost:5173,http://127.0.0.1:5173,https://exammind-web.onrender.com"
cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", default_cors_origins).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def limit_public_feedback_body(request: Request, call_next):
    """Reject oversized feedback requests before they reach body validation."""
    if request.method == "POST" and request.url.path == "/feedback/public":
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                too_large = int(content_length) > feedback.PUBLIC_FEEDBACK_MAX_BYTES
            except ValueError:
                return JSONResponse(status_code=400, content={"detail": "Invalid request size."})
            if too_large:
                return JSONResponse(status_code=413, content={"detail": "Feedback submission is too large."})
    return await call_next(request)

app.include_router(auth.router)
app.include_router(community.router)
app.include_router(feedback.router)
app.include_router(ingest.router)
app.include_router(rag.router)
app.include_router(mvp.router)
app.include_router(search.router)
app.include_router(sessions.router)
app.include_router(understand.router)

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Welcome to the AI-LMS API"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=BACKEND_HOST, port=BACKEND_PORT, reload=True)
