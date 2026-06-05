import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import auth, ingest, mvp, rag

app = FastAPI(
    title="AI-Based LMS API",
    description="Backend API for the AI-Powered Learning Management System",
    version="1.0.0"
)

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

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Welcome to the AI-LMS API"}
