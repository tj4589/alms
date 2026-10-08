"""Read-only checks used before adopting Alembic on an existing database."""

from __future__ import annotations

import importlib.util
from collections import defaultdict
from pathlib import Path
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection


REVISION_ORDER = (
    "0001_initial_schema",
    "0002_ksa_claim_audit",
    "0003_learning_space_role_audit",
    "0004_rate_limit_buckets",
    "0005_reminder_delivery",
)


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
        "ksa_claim_audits",
        "learning_space_role_audits",
        "rate_limit_buckets",
        "reminder_subscriptions",
        "reminder_deliveries",
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
    "ksa_claim_audits": {
        "ksa_id",
        "action",
        "previous_user_id",
        "current_user_id",
        "performed_by_user_id",
        "reason",
        "metadata",
        "created_at",
    },
    "learning_space_role_audits": {"learning_space_id", "learning_space_slug", "target_user_id", "membership_id", "previous_role", "new_role", "performed_by_user_id", "reason", "created_at"},
    "rate_limit_buckets": {"bucket_key", "window_started_at", "window_expires_at", "request_count", "updated_at"},
    "reminder_subscriptions": {"user_id", "channel", "status", "endpoint_key", "consented_at", "unsubscribed_at", "last_seen_at"},
    "reminder_deliveries": {"user_id", "subscription_id", "channel", "dedupe_key", "status", "scheduled_for", "attempted_at", "sent_at", "attempt_count", "failure_code"},
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
        "ix_ksa_claim_audits_ksa_id",
        "ix_ksa_claim_audits_previous_user_id",
        "ix_ksa_claim_audits_current_user_id",
        "ix_ksa_claim_audits_performed_by_user_id",
        "ix_learning_space_role_audits_learning_space_id",
        "ix_learning_space_role_audits_target_user_id",
        "ix_learning_space_role_audits_membership_id",
        "ix_learning_space_role_audits_performed_by_user_id",
        "ix_rate_limit_buckets_window_expires_at",
        "ix_reminder_subscriptions_user_id",
        "ix_reminder_subscriptions_channel",
        "ix_reminder_subscriptions_status",
        "ix_reminder_deliveries_user_id",
        "ix_reminder_deliveries_subscription_id",
        "ix_reminder_deliveries_channel",
        "ix_reminder_deliveries_status",
        "ix_reminder_deliveries_scheduled_for",
    }
)


def _load_baseline_module():
    migration_path = Path(__file__).parent / "alembic" / "versions" / "0001_initial_schema.py"
    spec = importlib.util.spec_from_file_location("exam_baseline_for_checks", migration_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load migration baseline from {migration_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_baseline_constraints() -> tuple[set[tuple[str, str, str, str, str]], set[tuple[str, tuple[str, ...]]]]:
    module = _load_baseline_module()

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


def _baseline_schema() -> tuple[set[str], dict[str, set[str]], set[str]]:
    module = _load_baseline_module()
    tables = {table["name"] for table in module._TABLES}
    columns = {
        table["name"]: {column["name"] for column in table["columns"]}
        for table in module._TABLES
    }
    indexes = {
        index["name"]
        for table in module._TABLES
        for index in table["indexes"]
    }
    # This expression index is created explicitly after the generated table
    # indexes in 0001 and therefore is not present in _TABLES.
    indexes.add("ix_users_email_lower")
    return tables, columns, indexes


BASELINE_TABLES, BASELINE_COLUMNS, BASELINE_INDEXES = _baseline_schema()

_ADDITIONAL_REVISION_TABLES = {
    "0002_ksa_claim_audit": {
        "ksa_claim_audits": {
            "columns": {
                "id",
                "ksa_id",
                "action",
                "previous_user_id",
                "current_user_id",
                "performed_by_user_id",
                "reason",
                "metadata",
                "created_at",
            },
            "indexes": {
                "ix_ksa_claim_audits_id",
                "ix_ksa_claim_audits_ksa_id",
                "ix_ksa_claim_audits_previous_user_id",
                "ix_ksa_claim_audits_current_user_id",
                "ix_ksa_claim_audits_performed_by_user_id",
            },
        }
    },
    "0003_learning_space_role_audit": {
        "learning_space_role_audits": {
            "columns": {
                "id",
                "learning_space_id",
                "learning_space_slug",
                "target_user_id",
                "membership_id",
                "previous_role",
                "new_role",
                "performed_by_user_id",
                "reason",
                "created_at",
            },
            "indexes": {
                "ix_learning_space_role_audits_id",
                "ix_learning_space_role_audits_learning_space_id",
                "ix_learning_space_role_audits_target_user_id",
                "ix_learning_space_role_audits_membership_id",
                "ix_learning_space_role_audits_performed_by_user_id",
            },
        }
    },
    "0004_rate_limit_buckets": {
        "rate_limit_buckets": {
            "columns": {
                "bucket_key",
                "window_started_at",
                "window_expires_at",
                "request_count",
                "updated_at",
            },
            "indexes": {"ix_rate_limit_buckets_window_expires_at"},
        }
    },
    "0005_reminder_delivery": {
        "reminder_subscriptions": {
            "columns": {
                "id",
                "user_id",
                "channel",
                "status",
                "endpoint",
                "endpoint_key",
                "p256dh",
                "auth_key",
                "consented_at",
                "unsubscribed_at",
                "last_seen_at",
                "created_at",
                "updated_at",
            },
            "indexes": {
                "ix_reminder_subscriptions_id",
                "ix_reminder_subscriptions_user_id",
                "ix_reminder_subscriptions_channel",
                "ix_reminder_subscriptions_status",
            },
        },
        "reminder_deliveries": {
            "columns": {
                "id",
                "user_id",
                "subscription_id",
                "channel",
                "dedupe_key",
                "status",
                "scheduled_for",
                "attempted_at",
                "sent_at",
                "attempt_count",
                "provider_reference",
                "failure_code",
                "created_at",
            },
            "indexes": {
                "ix_reminder_deliveries_id",
                "ix_reminder_deliveries_user_id",
                "ix_reminder_deliveries_subscription_id",
                "ix_reminder_deliveries_channel",
                "ix_reminder_deliveries_status",
                "ix_reminder_deliveries_scheduled_for",
            },
        },
    },
}

_ADDITIONAL_REVISION_FOREIGN_KEYS = {
    "0002_ksa_claim_audit": {
        ("ksa_claim_audits", "previous_user_id", "users", "id", "SET NULL"),
        ("ksa_claim_audits", "current_user_id", "users", "id", "SET NULL"),
        ("ksa_claim_audits", "performed_by_user_id", "users", "id", "SET NULL"),
    },
    "0003_learning_space_role_audit": {
        ("learning_space_role_audits", "learning_space_id", "learning_spaces", "id", "SET NULL"),
        ("learning_space_role_audits", "target_user_id", "users", "id", "SET NULL"),
        ("learning_space_role_audits", "membership_id", "learning_space_memberships", "id", "SET NULL"),
        ("learning_space_role_audits", "performed_by_user_id", "users", "id", "SET NULL"),
    },
    "0004_rate_limit_buckets": set(),
    "0005_reminder_delivery": {
        ("reminder_subscriptions", "user_id", "users", "id", "CASCADE"),
        ("reminder_deliveries", "user_id", "users", "id", "CASCADE"),
        ("reminder_deliveries", "subscription_id", "reminder_subscriptions", "id", "SET NULL"),
    },
}

_ADDITIONAL_REVISION_UNIQUE_CONSTRAINTS = {
    "0005_reminder_delivery": {
        ("reminder_subscriptions", ("user_id", "channel", "endpoint_key")),
        ("reminder_subscriptions", ("channel", "endpoint_key")),
        ("reminder_deliveries", ("dedupe_key",)),
    },
}


def _revision_index(revision: str) -> int:
    try:
        return REVISION_ORDER.index(revision)
    except ValueError as exc:
        raise ValueError(
            f"Unknown migration revision {revision!r}; expected one of {', '.join(REVISION_ORDER)}"
        ) from exc


def revision_requirements(revision: str) -> dict[str, Any]:
    """Return the expected additive schema through one exact Alembic revision."""

    revision_index = _revision_index(revision)
    tables = set(BASELINE_TABLES)
    columns = {table: set(values) for table, values in BASELINE_COLUMNS.items()}
    indexes = set(BASELINE_INDEXES)
    foreign_keys = set(REQUIRED_FOREIGN_KEYS)
    unique_constraints = set(REQUIRED_UNIQUE_CONSTRAINTS)

    for additional_revision in REVISION_ORDER[1 : revision_index + 1]:
        for table, specification in _ADDITIONAL_REVISION_TABLES[additional_revision].items():
            tables.add(table)
            columns[table] = set(specification["columns"])
            indexes.update(specification["indexes"])
        foreign_keys.update(_ADDITIONAL_REVISION_FOREIGN_KEYS[additional_revision])
        unique_constraints.update(_ADDITIONAL_REVISION_UNIQUE_CONSTRAINTS.get(additional_revision, set()))

    return {
        "revision": revision,
        "tables": tables,
        "columns": columns,
        "indexes": indexes,
        "foreign_keys": foreign_keys,
        "unique_constraints": unique_constraints,
        "requires_pgvector": True,
    }


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


def _read_alembic_version(connection: Connection) -> dict[str, Any]:
    """Read the Alembic marker without treating it as schema proof."""

    tables = set(inspect(connection).get_table_names())
    if "alembic_version" not in tables:
        return {"status": "missing", "versions": []}

    versions = [row[0] for row in connection.execute(text("SELECT version_num FROM alembic_version"))]
    if not versions:
        status = "empty"
    elif len(versions) == 1:
        status = "single"
    else:
        status = "multiple"
    return {"status": status, "versions": versions}


def _schema_problems(report: dict[str, Any]) -> list[str]:
    problems = []
    if report["missing_tables"]:
        problems.append(f"missing tables: {', '.join(report['missing_tables'])}")
    if report["missing_columns"]:
        problems.append(f"missing columns: {report['missing_columns']}")
    if report["unexpected_tables"]:
        problems.append(f"unexpected tables: {', '.join(report['unexpected_tables'])}")
    if report["unexpected_columns"]:
        problems.append(f"unexpected columns: {report['unexpected_columns']}")
    if report["missing_indexes"]:
        problems.append(f"missing indexes: {', '.join(report['missing_indexes'])}")
    if report["missing_foreign_keys"]:
        problems.append(f"missing foreign keys: {report['missing_foreign_keys']}")
    if report["missing_unique_constraints"]:
        problems.append(f"missing unique constraints: {report['missing_unique_constraints']}")
    if report["marker_conflict"]:
        problems.append(report["marker_conflict"])
    if report["dialect"] == "postgresql" and not report["pgvector_extension"]:
        problems.append("pgvector extension is not installed")
    return problems


def inspect_revision_schema(connection: Connection, revision: str) -> dict[str, Any]:
    """Return a read-only report for the schema expected through ``revision``.

    This intentionally reports later migration objects as unexpected when an
    earlier revision is selected. That prevents a later schema from being
    mistaken for the clean-database baseline before a stamp operation.
    """

    requirements = revision_requirements(revision)
    inspector = inspect(connection)
    tables = set(inspector.get_table_names())
    expected_tables = requirements["tables"]
    missing_tables = sorted(expected_tables - tables)
    unexpected_tables = sorted((tables - expected_tables) - {"alembic_version"})

    missing_columns: dict[str, list[str]] = {}
    unexpected_columns: dict[str, list[str]] = {}
    for table, expected_columns in requirements["columns"].items():
        if table not in tables:
            missing_columns[table] = sorted(expected_columns)
            continue
        actual_columns = {column["name"] for column in inspector.get_columns(table)}
        missing = sorted(expected_columns - actual_columns)
        unexpected = sorted(actual_columns - expected_columns)
        if missing:
            missing_columns[table] = missing
        if unexpected:
            unexpected_columns[table] = unexpected

    indexes_by_table: dict[str, set[str]] = {}
    indexes: set[str] = set()
    for table in tables:
        table_indexes = {
            index["name"]
            for index in inspector.get_indexes(table)
            if index.get("name")
        }
        indexes_by_table[table] = table_indexes
        indexes.update(table_indexes)

    expected_indexes = requirements["indexes"]
    missing_indexes = sorted(expected_indexes - indexes)
    expected_tables_with_indexes = set(requirements["columns"])
    unexpected_indexes = sorted(
        {
            f"{table}.{index}"
            for table, table_indexes in indexes_by_table.items()
            if table in expected_tables_with_indexes
            for index in table_indexes
            if index not in expected_indexes
        }
    )

    alembic_version = _read_alembic_version(connection)
    marker_conflict = None
    if alembic_version["status"] == "single":
        current_revision = alembic_version["versions"][0]
        if current_revision != revision:
            marker_conflict = (
                f"alembic_version reports {current_revision!r}, "
                f"not the inspected revision {revision!r}"
            )
    elif alembic_version["status"] == "multiple":
        marker_conflict = "alembic_version contains multiple revision rows"
    elif alembic_version["status"] == "empty":
        marker_conflict = "alembic_version exists but contains no revision"

    report: dict[str, Any] = {
        "revision": revision,
        "alembic_version": alembic_version,
        "marker_conflict": marker_conflict,
        "tables": sorted(tables),
        "expected_tables": sorted(expected_tables),
        "missing_tables": missing_tables,
        "unexpected_tables": unexpected_tables,
        "missing_columns": missing_columns,
        "unexpected_columns": unexpected_columns,
        "indexes": sorted(indexes),
        "missing_indexes": missing_indexes,
        "unexpected_indexes": unexpected_indexes,
        "dialect": connection.dialect.name,
    }
    if connection.dialect.name == "postgresql":
        actual_foreign_keys, actual_unique_constraints = _inspect_postgresql_constraints(connection)
        report["missing_foreign_keys"] = sorted(
            requirements["foreign_keys"] - actual_foreign_keys
        )
        report["missing_unique_constraints"] = sorted(
            requirements["unique_constraints"] - actual_unique_constraints
        )
        report["pgvector_extension"] = bool(
            connection.execute(
                text("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
            ).scalar()
        )
    else:
        report["missing_foreign_keys"] = []
        report["missing_unique_constraints"] = []
        report["pgvector_extension"] = None

    problems = _schema_problems(report)
    report["safe_to_stamp"] = not problems
    report["problems"] = problems
    return report


def inspect_required_schema(connection: Connection) -> dict[str, Any]:
    """Return a read-only full-head schema report without changing the database."""

    report = inspect_revision_schema(connection, REVISION_ORDER[-1])
    # Keep the historical report name/API for callers that use this helper.
    report["missing_tables"] = sorted(REQUIRED_TABLES - set(report["tables"]))
    report["missing_columns"] = {
        table: columns
        for table, columns in report["missing_columns"].items()
        if table in REQUIRED_COLUMNS
    }
    return report


def verify_revision_schema(connection: Connection, revision: str) -> dict[str, Any]:
    """Raise when the inspected database is not an exact revision match."""

    report = inspect_revision_schema(connection, revision)
    if not report["safe_to_stamp"]:
        raise RuntimeError(
            f"Database is not an exact match for {revision}: "
            + "; ".join(report["problems"])
        )
    return report


def verify_required_schema(connection: Connection) -> dict[str, Any]:
    """Raise a clear error when an existing database is not baseline-compatible."""

    report = inspect_required_schema(connection)
    if not report["safe_to_stamp"]:
        raise RuntimeError("Existing database is not safe to stamp: " + "; ".join(report["problems"]))
    return report
