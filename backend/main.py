import os

from fastapi import FastAPI
from sqlalchemy import text
from fastapi.middleware.cors import CORSMiddleware
from routers import auth, ingest, mvp, rag, search, sessions, understand
import models as _models  # noqa: F401 — registers all ORM classes with Base
from database import Base, engine

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
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR"))
        connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_firebase_uid "
                "ON users (firebase_uid) WHERE firebase_uid IS NOT NULL"
            )
        )


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

default_cors_origins = "http://localhost:5173,http://127.0.0.1:5173"
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

app.include_router(auth.router)
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
