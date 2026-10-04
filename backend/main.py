import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from routers import auth, collaboration, community, feedback, ingest, learning, learning_spaces, maxe, mvp, rag, search, sessions, understand
from database import engine

BACKEND_HOST = os.getenv("BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8001"))

class PublicAPI(FastAPI):
    def build_middleware_stack(self):
        # Cover ServerErrorMiddleware as well as ordinary route responses.
        return CORSMiddleware(
            super().build_middleware_stack(),
            allow_origins=cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )


app = PublicAPI(
    title="AI-Based LMS API",
    description="Backend API for the AI-Powered Learning Management System",
    version="1.0.0"
)

default_cors_origins = "http://localhost:5173,http://127.0.0.1:5173,https://exammind-web.onrender.com"
cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", default_cors_origins).split(",")
    if origin.strip()
]

@app.exception_handler(Exception)
async def internal_error(request: Request, exception: Exception):
    # Never expose raw exceptions, provider bodies, paths or credentials.
    return JSONResponse(status_code=500, content={"detail": "An internal error occurred. Please try again."})


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
app.include_router(collaboration.router)
app.include_router(community.router)
app.include_router(feedback.router)
app.include_router(ingest.router)
app.include_router(learning.router)
app.include_router(learning_spaces.router)
app.include_router(rag.router)
app.include_router(maxe.router)
app.include_router(mvp.router)
app.include_router(search.router)
app.include_router(sessions.router)
app.include_router(understand.router)


@app.get("/health", tags=["health"])
def health():
    """Return process health without depending on external services."""

    return {"status": "ok", "application": "ok"}


@app.get("/health/ready", tags=["health"])
def readiness():
    """Report dependency readiness without exposing connection details."""

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except (SQLAlchemyError, OSError, TypeError, ValueError):
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "application": "ok",
                "database": "unavailable",
            },
        )
    return {"status": "ready", "application": "ok", "database": "ok"}


@app.get("/")
def read_root():
    return {"status": "ok", "message": "Welcome to the AI-LMS API"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=BACKEND_HOST, port=BACKEND_PORT, reload=True)
