from sqlalchemy import text

from database import SessionLocal, engine, Base
import models

COURSES = [
    {"code": "CSC204", "name": "Software Engineering", "description": "Software process models, SDLC, Agile, testing and maintenance."},
    {"code": "CSC205", "name": "Object-Oriented Programming", "description": "Classes, objects, inheritance, polymorphism and design principles."},
    {"code": "CSC301", "name": "Data Structures and Algorithms", "description": "Sorting, trees, graphs, hashing, recursion and complexity analysis."},
    {"code": "CSC312", "name": "Operating Systems", "description": "Processes, scheduling, memory management, filesystems and concurrency."},
    {"code": "CSC401", "name": "Computer Networks", "description": "Network models, routing, transport protocols, addressing and security."},
]

def seed_courses():
    db = SessionLocal()
    try:
        for item in COURSES:
            exists = db.query(models.Course).filter(models.Course.code == item["code"]).first()
            if not exists:
                db.add(models.Course(**item))
        db.commit()
    finally:
        db.close()

if __name__ == "__main__":
    print("Creating database tables...")
    try:
        with engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        Base.metadata.create_all(bind=engine)
        seed_courses()
        print("Done!")
    except Exception as e:
        print(f"Error creating tables: {e}")
