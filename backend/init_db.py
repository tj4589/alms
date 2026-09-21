from sqlalchemy import text

from database import SessionLocal, engine, Base
import models

COURSES = [
    {"code": "CSC317", "name": "System Analysis and Design", "department": "Computer Science", "level": "300", "description": "Requirements, modelling, system design and implementation planning."},
    {"code": "CSC411", "name": "Software Engineering", "department": "Computer Science", "level": "400", "description": "Software process models, SDLC, Agile, testing and maintenance."},
    {"code": "CSC415", "name": "Artificial Intelligence", "department": "Computer Science", "level": "400", "description": "Foundations of intelligent systems, search, learning and reasoning."},
    {"code": "MIS316", "name": "Research Methods", "department": "Management Information Systems", "level": "300", "description": "Research design, evidence, data collection and academic reporting."},
    {"code": "MIS412", "name": "Knowledge Management", "department": "Management Information Systems", "level": "400", "description": "How organisations create, share and apply knowledge."},
    {"code": "MIS413", "name": "System Accounting", "department": "Management Information Systems", "level": "400", "description": "Information systems and accounting processes, controls and reporting."},
    {"code": "MIS415", "name": "Project Management", "department": "Management Information Systems", "level": "400", "description": "Project planning, scope, risk, cost, schedule and delivery."},
    {"code": "MIS418", "name": "E-Commerce Technology", "department": "Management Information Systems", "level": "400", "description": "Digital commerce platforms, transactions, security and operations."},
]

def seed_courses():
    db = SessionLocal()
    try:
        for item in COURSES:
            exists = db.query(models.Course).filter(models.Course.code == item["code"]).first()
            if not exists:
                db.add(models.Course(**item))
            else:
                # Keep existing primary keys and linked material intact while
                # allowing this small catalogue to improve over time.
                for field in ("name", "description", "department", "level"):
                    value = item.get(field)
                    if value and not getattr(exists, field, None):
                        setattr(exists, field, value)
        db.commit()
    finally:
        db.close()

if __name__ == "__main__":
    print("Creating database tables...")
    try:
        if engine.url.get_backend_name().startswith("postgresql"):
            with engine.begin() as conn:
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        Base.metadata.create_all(bind=engine)
        seed_courses()
        print("Done!")
    except Exception as e:
        print(f"Error creating tables: {e}")
