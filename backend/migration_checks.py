"""Read-only checks used before adopting Alembic on an existing database."""

from __future__ import annotations

from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection


REQUIRED_TABLES = frozenset(
    {
        "courses",
        "deleted_firebase_identities",
        "learning_spaces",
        "resource_chunks",
        "topics",
        "users",
        "community_reports",
        "feedback",
        "ksa_member_registry",
        "learning_profiles",
        "learning_quizzes",
        "learning_space_memberships",
        "lecture_notes",
        "material_contributions",
        "past_questions",
        "practice_attempts",
        "readiness_scores",
        "student_progress",
        "study_groups",
        "study_materials",
        "user_courses",
        "audio_transcript_segments",
        "discussion_threads",
        "learning_quiz_attempts",
        "learning_quiz_questions",
        "lecture_note_chunks",
        "lecture_note_sections",
        "material_group_shares",
        "moderation_audits",
        "secure_share_links",
        "study_group_invites",
        "study_group_members",
        "study_group_posts",
        "study_sessions",
        "learning_evidence",
        "study_session_ai_questions",
        "study_session_attendance_events",
        "study_session_attendance_intervals",
        "study_session_messages",
        "study_session_participants",
        "thread_messages",
    }
)

REQUIRED_COLUMNS = {
    "users": {"username", "email", "firebase_uid", "active_learning_space_id"},
    "ksa_member_registry": {"ksa_id", "claimed_by_user_id"},
    "learning_spaces": {"slug", "status"},
    "resource_chunks": {"chunk_text", "embedding", "page_from", "slide_from"},
    "audio_transcript_segments": {"resource_id", "start_time", "end_time"},
    "material_contributions": {"moderation_status", "requested_visibility"},
    "moderation_audits": {"contribution_id", "new_state"},
    "secure_share_links": {"token_hash", "access_policy", "revoked_at"},
    "learning_quiz_attempts": {"graded_questions", "needs_review_count", "percentage"},
    "learning_quiz_questions": {"citation_json", "correct_answer"},
}

REQUIRED_INDEXES = frozenset(
    {
        "ix_users_email_lower",
        "ix_users_username",
        "ix_users_email",
        "ix_users_firebase_uid",
        "ix_resource_chunks_resource",
        "ix_audio_transcript_segments_resource",
        "ix_material_contribution_status_space",
        "ix_secure_share_links_content",
        "ix_learning_quiz_attempts_completed_at",
    }
)


def inspect_required_schema(connection: Connection) -> dict[str, Any]:
    """Return a read-only schema report without changing the database."""

    inspector = inspect(connection)
    tables = set(inspector.get_table_names())
    missing_tables = sorted(REQUIRED_TABLES - tables)

    missing_columns: dict[str, list[str]] = {}
    for table, columns in REQUIRED_COLUMNS.items():
        if table not in tables:
            missing_columns[table] = sorted(columns)
            continue
        actual = {column["name"] for column in inspector.get_columns(table)}
        missing = sorted(columns - actual)
        if missing:
            missing_columns[table] = missing

    indexes = {
        index["name"]
        for table in tables
        for index in inspector.get_indexes(table)
        if index.get("name")
    }

    report: dict[str, Any] = {
        "tables": sorted(tables),
        "missing_tables": missing_tables,
        "missing_columns": missing_columns,
        "indexes": sorted(indexes),
        "missing_indexes": sorted(REQUIRED_INDEXES - indexes),
        "dialect": connection.dialect.name,
    }
    if connection.dialect.name == "postgresql":
        report["pgvector_extension"] = bool(
            connection.execute(
                text("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
            ).scalar()
        )
    else:
        report["pgvector_extension"] = None
    return report


def verify_required_schema(connection: Connection) -> dict[str, Any]:
    """Raise a clear error when an existing database is not baseline-compatible."""

    report = inspect_required_schema(connection)
    problems = []
    if report["missing_tables"]:
        problems.append(f"missing tables: {', '.join(report['missing_tables'])}")
    if report["missing_columns"]:
        problems.append(f"missing columns: {report['missing_columns']}")
    if report["missing_indexes"]:
        problems.append(f"missing indexes: {', '.join(report['missing_indexes'])}")
    if report["dialect"] == "postgresql" and not report["pgvector_extension"]:
        problems.append("pgvector extension is not installed")
    if problems:
        raise RuntimeError("Existing database is not safe to stamp: " + "; ".join(problems))
    return report
