import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Default to the local pgvector docker instance. psycopg v3 supports current
# Python versions more reliably than the old psycopg2 binary wheel.
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://alms_user:alms_password@localhost:5432/alms_db")

engine = create_engine(DATABASE_URL, echo=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
