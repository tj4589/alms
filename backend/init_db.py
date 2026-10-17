from database import SessionLocal
import models
from learning_spaces import seed_learning_spaces as _seed_learning_spaces

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
        cu_space = db.query(models.LearningSpace).filter(models.LearningSpace.slug == "cu").first()
        if cu_space is None:
            raise RuntimeError("Seed learning spaces before seeding the course catalogue.")
        for item in COURSES:
            exists = db.query(models.Course).filter(models.Course.code == item["code"]).first()
            if not exists:
                db.add(models.Course(**item, learning_space_id=cu_space.id))
            else:
                # Keep existing primary keys and linked material intact while
                # allowing this small catalogue to improve over time.
                for field in ("name", "description", "department", "level"):
                    value = item.get(field)
                    if value and not getattr(exists, field, None):
                        setattr(exists, field, value)
                if exists.learning_space_id is None:
                    exists.learning_space_id = cu_space.id
        db.commit()
    finally:
        db.close()


def seed_learning_spaces():
    """Seed the configured spaces and backfill existing CU users only."""
    db = SessionLocal()
    try:
        _seed_learning_spaces(db, backfill_users=True)
    finally:
        db.close()

if __name__ == "__main__":
    print("Seeding reference data; schema changes must be applied with Alembic first.")
    try:
        seed_learning_spaces()
        seed_courses()
        print("Seed complete.")
    except Exception as e:
        print(f"Error seeding reference data: {e}")
        raise
