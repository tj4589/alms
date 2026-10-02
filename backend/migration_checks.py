"""Read-only checks used before adopting Alembic on an existing database."""

from __future__ import annotations

import importlib.util
from collections import defaultdict
from pathlib import Path
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
        "learning_space_role_audits",
        "rate_limit_buckets",
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
    "learning_space_role_audits": {"learning_space_id", "learning_space_slug", "target_user_id", "membership_id", "previous_role", "new_role", "performed_by_user_id", "reason", "created_at"},
    "rate_limit_buckets": {"bucket_key", "window_started_at", "window_expires_at", "request_count", "updated_at"},
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
        "ix_learning_space_role_audits_learning_space_id",
        "ix_learning_space_role_audits_target_user_id",
        "ix_learning_space_role_audits_membership_id",
        "ix_learning_space_role_audits_performed_by_user_id",
        "ix_rate_limit_buckets_window_expires_at",
    }
)


def _load_baseline_constraints() -> tuple[set[tuple[str, str, str, str, str]], set[tuple[str, tuple[str, ...]]]]:
    migration_path = Path(__file__).parent / "alembic" / "versions" / "0001_initial_schema.py"
    spec = importlib.util.spec_from_file_location("exam_baseline_for_checks", migration_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load migration baseline from {migration_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    foreign_keys = set()
    unique_constraints = set()
    for table in module._TABLES:
        for foreign_key_group in table["fks"]:
            for foreign_key in foreign_key_group:
                target_table, target_column = foreign_key["target"].split(".", 1)
                foreign_keys.add(
                    (
                        table["name"],
                        foreign_key["local"],
                        target_table,
                        target_column,
                        foreign_key["ondelete"] or "NO ACTION",
                    )
                )
        for columns in table["unique_constraints"]:
            unique_constraints.add((table["name"], tuple(columns)))
    return foreign_keys, unique_constraints


REQUIRED_FOREIGN_KEYS, REQUIRED_UNIQUE_CONSTRAINTS = _load_baseline_constraints()


def _inspect_postgresql_constraints(connection: Connection) -> tuple[set, set]:
    foreign_key_rows = connection.execute(
        text(
            """
            SELECT tc.table_name, kcu.column_name,
                   ccu.table_name AS foreign_table_name,
                   ccu.column_name AS foreign_column_name,
                   rc.delete_rule
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_schema = kcu.constraint_schema
             AND tc.constraint_name = kcu.constraint_name
             AND tc.table_name = kcu.table_name
            JOIN information_schema.constraint_column_usage ccu
              ON tc.constraint_schema = ccu.constraint_schema
             AND tc.constraint_name = ccu.constraint_name
            JOIN information_schema.referential_constraints rc
              ON tc.constraint_schema = rc.constraint_schema
             AND tc.constraint_name = rc.constraint_name
            WHERE tc.constraint_schema = 'public'
              AND tc.constraint_type = 'FOREIGN KEY'
            """
        )
    ).mappings()
    foreign_keys = {
        (
            row["table_name"],
            row["column_name"],
            row["foreign_table_name"],
            row["foreign_column_name"],
            row["delete_rule"],
        )
        for row in foreign_key_rows
    }

    unique_rows = connection.execute(
        text(
            """
            SELECT tc.table_name, kcu.constraint_name,
                   kcu.column_name, kcu.ordinal_position
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_schema = kcu.constraint_schema
             AND tc.constraint_name = kcu.constraint_name
             AND tc.table_name = kcu.table_name
            WHERE tc.constraint_schema = 'public'
              AND tc.constraint_type = 'UNIQUE'
            ORDER BY tc.table_name, kcu.constraint_name, kcu.ordinal_position
            """
        )
    ).mappings()
    grouped: defaultdict[tuple[str, str], list[tuple[int, str]]] = defaultdict(list)
    for row in unique_rows:
        grouped[(row["table_name"], row["constraint_name"])].append(
            (row["ordinal_position"], row["column_name"])
        )
    unique_constraints = {
        (table, tuple(column for _, column in sorted(columns)))
        for (table, _), columns in grouped.items()
    }
    return foreign_keys, unique_constraints


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
        actual_foreign_keys, actual_unique_constraints = _inspect_postgresql_constraints(connection)
        report["missing_foreign_keys"] = sorted(REQUIRED_FOREIGN_KEYS - actual_foreign_keys)
        report["missing_unique_constraints"] = sorted(REQUIRED_UNIQUE_CONSTRAINTS - actual_unique_constraints)
        report["pgvector_extension"] = bool(
            connection.execute(
                text("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
            ).scalar()
        )
    else:
        report["missing_foreign_keys"] = []
        report["missing_unique_constraints"] = []
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
    if report["missing_foreign_keys"]:
        problems.append(f"missing foreign keys: {report['missing_foreign_keys']}")
    if report["missing_unique_constraints"]:
        problems.append(f"missing unique constraints: {report['missing_unique_constraints']}")
    if report["dialect"] == "postgresql" and not report["pgvector_extension"]:
        problems.append("pgvector extension is not installed")
    if problems:
        raise RuntimeError("Existing database is not safe to stamp: " + "; ".join(problems))
    return report
