import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Load .env from the same directory as this file (dev convenience).
# In production, env vars are injected by the host — this is a no-op if
# python-dotenv isn't installed or the file doesn't exist.
_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(_env_file, override=False)
    except ImportError:
        # python-dotenv not installed; fall back to relying on real env vars
        pass

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not configured. Set DATABASE_URL in the backend environment.")


def _normalise(url: str) -> str:
    """Managed hosts (Render, Heroku, Fly) hand out postgres:// or
    postgresql:// URLs. SQLAlchemy needs an explicit driver or it reaches for
    psycopg2, which is not in requirements -- we install psycopg 3."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


DATABASE_URL = _normalise(DATABASE_URL)

# Managed Postgres drops idle connections; pre-ping swaps a dead one rather
# than surfacing it as a 500 on the first request after a quiet spell.
engine = create_engine(
    DATABASE_URL,
    echo=os.getenv("SQL_ECHO", "false").lower() == "true",
    pool_pre_ping=True,
    # Without this a missing database makes startup hang on the TCP connect
    # instead of failing, and uvicorn never binds its port.
    connect_args={"connect_timeout": int(os.getenv("DB_CONNECT_TIMEOUT", "10"))},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
