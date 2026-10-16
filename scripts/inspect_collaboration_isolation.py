"""Non-production collaboration access diagnostic.

Uses an in-memory query fixture for route behavior only. It does not validate
PostgreSQL constraints, migrations, or live deployment.
"""
import json
import os
from pathlib import Path
import socket
import sys
from datetime import datetime, timedelta, timezone

os.environ.update({"DATABASE_URL":"postgresql+psycopg://test:test@127.0.0.1:9/isolated_tests",
                   "SECRET_KEY":"isolated-test-secret", "APP_ENV":"test", "ENV":"test",
                   "AI_PROVIDER":"disabled", "AI_FALLBACK_PROVIDER":"disabled",
                   "DEEPSEEK_API_KEY":"", "COHERE_API_KEY":"", "OPENAI_API_KEY":""})
def deny_network(*args, **kwargs):
    raise OSError("Network disabled in collaboration diagnostic")
socket.socket.connect = deny_network
socket.socket.connect_ex = deny_network
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from fastapi import HTTPException
import models
from routers import mvp, sessions

engine = create_engine("sqlite:///:memory:")
models.Base.metadata.create_all(engine)
with Session(engine) as db:
    cu = models.LearningSpace(id=1, slug="cu", name="CU", type="university", status="active")
    ksa = models.LearningSpace(id=2, slug="ksa", name="KSA", type="academy", status="active")
    viewer = models.User(id=1, username="cu_fixture", name="CU fixture", role="student", email="fixture@stu.cu.edu.ng", active_learning_space_id=1)
    creator = models.User(id=2, username="ksa_fixture", name="KSA fixture", role="student", email="fixture@example.test", active_learning_space_id=2)
    db.add_all([cu, ksa, viewer, creator,
                models.LearningSpaceMembership(user_id=1, learning_space_id=1, role="member", status="active"),
                models.LearningSpaceMembership(user_id=2, learning_space_id=2, role="member", status="active")])
    db.add_all([models.StudyGroup(id=10, name="KSA fixture group", created_by=2, learning_space_id=2, visibility="public", status="active"),
                models.DiscussionThread(id=20, title="KSA fixture discussion", content="Fixture only", created_by=2, learning_space_id=2, category="academic"),
                models.StudySession(id=30, title="KSA fixture room", created_by=2, learning_space_id=2, status="active", starts_at=datetime.now(timezone.utc), ends_at=datetime.now(timezone.utc)+timedelta(hours=1)),
                models.StudyGroup(id=11, name="Ambiguous legacy fixture", created_by=2, visibility="public", status="active")])
    db.commit()
    groups = mvp.list_study_groups(None, None, None, db, viewer)
    threads = mvp.list_threads(None, None, None, 50, db, viewer)
    rooms = sessions.list_sessions(None, None, None, False, db, viewer)
    try:
        mvp.join_study_group(10, db, viewer)
        cross_space_join_denied = False
    except HTTPException as exc:
        cross_space_join_denied = exc.status_code == 404
    try:
        mvp.join_study_group(11, db, creator)
        ambiguous_join_denied = False
    except HTTPException as exc:
        ambiguous_join_denied = exc.status_code == 404
    result = {"diagnostic_only":True, "production_access":False,
              "cu_viewer_sees_ksa_created_group":any(row["id"] == 10 for row in groups),
              "cu_viewer_sees_ksa_created_discussion":any(row["id"] == 20 for row in threads),
              "cu_viewer_sees_ksa_created_room":any(row["id"] == 30 for row in rooms),
              "cross_space_join_denied":cross_space_join_denied,
              "ambiguous_legacy_join_denied":ambiguous_join_denied,
              "durable_space_columns_present":all("learning_space_id" in model.__table__.columns for model in (models.StudyGroup, models.DiscussionThread, models.StudySession))}
    assert not any(result[key] for key in ("cu_viewer_sees_ksa_created_group", "cu_viewer_sees_ksa_created_discussion", "cu_viewer_sees_ksa_created_room"))
    assert result["cross_space_join_denied"] and result["ambiguous_legacy_join_denied"] and result["durable_space_columns_present"]
    print(json.dumps(result, indent=2))
engine.dispose()
