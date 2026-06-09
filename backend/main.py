import os

from fastapi import FastAPI
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

# Auto-create any new tables on startup (idempotent — safe to run every time)
Base.metadata.create_all(bind=engine)

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
