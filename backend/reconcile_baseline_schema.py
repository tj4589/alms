"""Safely reconcile known pre-Alembic schema drift before baseline adoption.

The command is check-only by default. ``--apply`` adds only the explicitly
listed baseline indexes, foreign keys and unique constraints, in one
transaction. It never writes ``alembic_version`` and never changes rows.
Run it only against a disposable clone or an explicitly approved maintenance
target after the preflight report is clean.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection


MISSING_INDEXES = (
    {"name": "ix_courses_department", "table": "courses", "columns": ("department",), "unique": False},
    {"name": "ix_courses_level", "table": "courses", "columns": ("level",), "unique": False},
    {"name": "ix_discussion_threads_category", "table": "discussion_threads", "columns": ("category",), "unique": False},
    {"name": "ix_discussion_threads_group_id", "table": "discussion_threads", "columns": ("group_id",), "unique": False},
    {"name": "ix_study_group_invites_expires_at", "table": "study_group_invites", "columns": ("expires_at",), "unique": False},
    {"name": "ix_users_department", "table": "users", "columns": ("department",), "unique": False},
    {"name": "ix_users_email_lower", "table": "users", "columns": (), "unique": True, "expression": "lower(email)"},
    {"name": "ix_users_onboarding_state", "table": "users", "columns": ("onboarding_state",), "unique": False},
)

MISSING_UNIQUE_CONSTRAINTS = (
    {"name": "uq_study_group_members_group_id_user_id", "table": "study_group_members", "columns": ("group_id", "user_id")},
    {"name": "uq_study_session_participants_session_id_user_id", "table": "study_session_participants", "columns": ("session_id", "user_id")},
)

MISSING_FOREIGN_KEYS = (
    {"name": "fk_discussion_threads_group_id_study_groups", "table": "discussion_threads", "column": "group_id", "target_table": "study_groups", "target_column": "id", "ondelete": "NO ACTION"},
    {"name": "fk_lecture_notes_version_of_id_lecture_notes", "table": "lecture_notes", "column": "version_of_id", "target_table": "lecture_notes", "target_column": "id", "ondelete": "NO ACTION"},
    {"name": "fk_past_questions_version_of_id_past_questions", "table": "past_questions", "column": "version_of_id", "target_table": "past_questions", "target_column": "id", "ondelete": "NO ACTION"},
    {"name": "fk_users_active_learning_space_id_learning_spaces", "table": "users", "column": "active_learning_space_id", "target_table": "learning_spaces", "target_column": "id", "ondelete": "NO ACTION"},
)

REQUIRED_COLUMNS = {
    "courses": {"id", "department", "level"},
    "discussion_threads": {"id", "category", "group_id"},
    "lecture_notes": {"id", "version_of_id"},
    "past_questions": {"id", "version_of_id"},
    "study_group_invites": {"id", "expires_at"},
    "study_group_members": {"id", "group_id", "user_id"},
    "study_session_participants": {"id", "session_id", "user_id"},
    "users": {"id", "email", "department", "onboarding_state", "active_learning_space_id"},
    "study_groups": {"id"},
    "learning_spaces": {"id"},
}


def _normalise_definition(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def _read_marker(connection: Connection) -> dict[str, Any]:
    tables = set(inspect(connection).get_table_names())
    if "alembic_version" not in tables:
        return {"status": "missing", "versions": []}
    versions = [row[0] for row in connection.execute(text("SELECT version_num FROM alembic_version"))]
    if not versions:
        return {"status": "empty", "versions": []}
    return {"status": "single" if len(versions) == 1 else "multiple", "versions": versions}


def _read_unique_constraints(connection: Connection) -> dict[tuple[str, tuple[str, ...]], str]:
    rows = connection.execute(
        text(
            """
            SELECT tc.table_name, tc.constraint_name, kcu.column_name, kcu.ordinal_position
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_schema = kcu.constraint_schema
             AND tc.constraint_name = kcu.constraint_name
             AND tc.table_name = kcu.table_name
            WHERE tc.constraint_schema = 'public'
              AND tc.constraint_type = 'UNIQUE'
            ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position
            """
        )
    ).mappings()
    grouped: defaultdict[tuple[str, str], list[tuple[int, str]]] = defaultdict(list)
    for row in rows:
        grouped[(row["table_name"], row["constraint_name"])].append(
            (row["ordinal_position"], row["column_name"])
        )
    return {
        (table, tuple(column for _, column in sorted(columns))): name
        for (table, name), columns in grouped.items()
    }


def _read_foreign_keys(connection: Connection) -> tuple[dict[str, tuple], set[tuple]]:
    rows = connection.execute(
        text(
            """
            SELECT tc.constraint_name, tc.table_name, kcu.column_name,
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
    by_name = {}
    definitions = set()
    for row in rows:
        definition = (
            row["table_name"],
            row["column_name"],
            row["foreign_table_name"],
            row["foreign_column_name"],
            row["delete_rule"],
        )
        by_name[row["constraint_name"]] = definition
        definitions.add(definition)
    return by_name, definitions


def _read_indexes(connection: Connection) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    inspector = inspect(connection)
    indexes = {}
    definitions = {}
    for table in inspector.get_table_names():
        for index in inspector.get_indexes(table):
            name = index.get("name")
            if name:
                indexes[name] = {**index, "table": table}
    rows = connection.execute(
        text(
            "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'"
        )
    ).mappings()
    for row in rows:
        definitions[row["indexname"]] = row["indexdef"]
    return indexes, definitions


def _duplicate_rows(connection: Connection, table: str, columns: tuple[str, ...]) -> list[dict[str, Any]]:
    selected = ", ".join(columns)
    grouped = ", ".join(columns)
    rows = connection.execute(
        text(
            f"SELECT {selected}, COUNT(*) AS row_count FROM {table} "
            f"GROUP BY {grouped} HAVING COUNT(*) > 1 ORDER BY row_count DESC"
        )
    ).mappings()
    return [dict(row) for row in rows]


def preflight(connection: Connection) -> dict[str, Any]:
    """Inspect all prerequisites without changing rows or schema."""

    marker = _read_marker(connection)
    inspector = inspect(connection)
    tables = set(inspector.get_table_names())
    missing_tables = sorted(set(REQUIRED_COLUMNS) - tables)
    missing_columns = {}
    for table, columns in REQUIRED_COLUMNS.items():
        if table not in tables:
            continue
        actual = {column["name"] for column in inspector.get_columns(table)}
        missing = sorted(set(columns) - actual)
        if missing:
            missing_columns[table] = missing

    duplicates = {
        "study_group_members": _duplicate_rows(connection, "study_group_members", ("group_id", "user_id")),
        "study_session_participants": _duplicate_rows(connection, "study_session_participants", ("session_id", "user_id")),
        "users_lower_email": [dict(row) for row in connection.execute(text("SELECT lower(email) AS email, COUNT(*) AS row_count FROM users WHERE email IS NOT NULL GROUP BY lower(email) HAVING COUNT(*) > 1 ORDER BY row_count DESC")).mappings()],
    }
    orphans = {
        "discussion_threads.group_id": [dict(row) for row in connection.execute(text("SELECT d.id, d.group_id FROM discussion_threads d LEFT JOIN study_groups g ON g.id = d.group_id WHERE d.group_id IS NOT NULL AND g.id IS NULL")).mappings()],
        "lecture_notes.version_of_id": [dict(row) for row in connection.execute(text("SELECT child.id, child.version_of_id FROM lecture_notes child LEFT JOIN lecture_notes parent ON parent.id = child.version_of_id WHERE child.version_of_id IS NOT NULL AND parent.id IS NULL")).mappings()],
        "past_questions.version_of_id": [dict(row) for row in connection.execute(text("SELECT child.id, child.version_of_id FROM past_questions child LEFT JOIN past_questions parent ON parent.id = child.version_of_id WHERE child.version_of_id IS NOT NULL AND parent.id IS NULL")).mappings()],
        "users.active_learning_space_id": [dict(row) for row in connection.execute(text("SELECT u.id, u.active_learning_space_id FROM users u LEFT JOIN learning_spaces s ON s.id = u.active_learning_space_id WHERE u.active_learning_space_id IS NOT NULL AND s.id IS NULL")).mappings()],
    }

    indexes, index_definitions = _read_indexes(connection)
    unique_constraints = _read_unique_constraints(connection)
    foreign_keys_by_name, foreign_keys = _read_foreign_keys(connection)
    conflicts = []
    actions = []

    for index in MISSING_INDEXES:
        existing = indexes.get(index["name"])
        if existing:
            definition = _normalise_definition(index_definitions.get(index["name"], ""))
            expected_table = f"on public.{index['table']}"
            expected_unique = definition.startswith("create unique index")
            if expected_table not in definition or expected_unique != index["unique"]:
                conflicts.append(f"index {index['name']} exists with an incompatible definition")
            elif index.get("expression") and index["expression"] not in definition:
                conflicts.append(f"index {index['name']} exists without the required expression")
            else:
                actions.append({"kind": "index", "name": index["name"], "action": "already_present"})
        else:
            actions.append({"kind": "index", "name": index["name"], "action": "create"})

    for constraint in MISSING_UNIQUE_CONSTRAINTS:
        existing_name = unique_constraints.get((constraint["table"], constraint["columns"]))
        if existing_name:
            actions.append({"kind": "unique_constraint", "name": existing_name, "table": constraint["table"], "columns": constraint["columns"], "action": "already_present"})
        elif constraint["name"] in {name for name in unique_constraints.values()}:
            conflicts.append(f"unique constraint {constraint['name']} exists with an incompatible definition")
        else:
            actions.append({"kind": "unique_constraint", "name": constraint["name"], "action": "create"})

    for foreign_key in MISSING_FOREIGN_KEYS:
        expected = (foreign_key["table"], foreign_key["column"], foreign_key["target_table"], foreign_key["target_column"], foreign_key["ondelete"])
        if expected in foreign_keys:
            actions.append({"kind": "foreign_key", "name": foreign_key["name"], "action": "already_present"})
        elif foreign_key["name"] in foreign_keys_by_name:
            conflicts.append(f"foreign key {foreign_key['name']} exists with an incompatible definition")
        else:
            actions.append({"kind": "foreign_key", "name": foreign_key["name"], "action": "create"})

    blocking = []
    if marker["status"] != "missing":
        blocking.append("alembic_version exists; reconciliation refuses to alter migration history")
    if missing_tables:
        blocking.append(f"missing required tables: {', '.join(missing_tables)}")
    if missing_columns:
        blocking.append(f"missing required columns: {missing_columns}")
    for table, rows in duplicates.items():
        if rows:
            blocking.append(f"duplicate values in {table}: {len(rows)} groups")
    for relation, rows in orphans.items():
        if rows:
            blocking.append(f"orphan references in {relation}: {len(rows)} rows")
    blocking.extend(conflicts)
    return {
        "marker": marker,
        "missing_tables": missing_tables,
        "missing_columns": missing_columns,
        "duplicates": duplicates,
        "orphans": orphans,
        "actions": actions,
        "blocking_issues": blocking,
        "safe_to_apply": not blocking,
    }


def _quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def apply_reconciliation(connection: Connection, report: dict[str, Any], lock_timeout_ms: int) -> list[str]:
    if not report["safe_to_apply"]:
        raise RuntimeError("Preflight failed: " + "; ".join(report["blocking_issues"]))
    if connection.execute(text("SELECT current_setting('transaction_read_only')")).scalar() == "on":
        raise RuntimeError("Refusing --apply on a read-only transaction")
    connection.execute(text(f"SET LOCAL lock_timeout = '{int(lock_timeout_ms)}ms'"))
    applied = []
    for index in MISSING_INDEXES:
        if any(action["kind"] == "index" and action["name"] == index["name"] and action["action"] == "already_present" for action in report["actions"]):
            continue
        uniqueness = "UNIQUE " if index["unique"] else ""
        target = index.get("expression") or ", ".join(_quote(column) for column in index["columns"])
        connection.execute(text(f"CREATE {uniqueness}INDEX {_quote(index['name'])} ON {_quote(index['table'])} ({target})"))
        applied.append(index["name"])
    for constraint in MISSING_UNIQUE_CONSTRAINTS:
        if any(action["kind"] == "unique_constraint" and action.get("table") == constraint["table"] and tuple(action.get("columns", ())) == tuple(constraint["columns"]) and action["action"] == "already_present" for action in report["actions"]):
            continue
        columns = ", ".join(_quote(column) for column in constraint["columns"])
        connection.execute(text(f"ALTER TABLE {_quote(constraint['table'])} ADD CONSTRAINT {_quote(constraint['name'])} UNIQUE ({columns})"))
        applied.append(constraint["name"])
    for foreign_key in MISSING_FOREIGN_KEYS:
        if any(action["kind"] == "foreign_key" and action["name"] == foreign_key["name"] and action["action"] == "already_present" for action in report["actions"]):
            continue
        connection.execute(text(f"ALTER TABLE {_quote(foreign_key['table'])} ADD CONSTRAINT {_quote(foreign_key['name'])} FOREIGN KEY ({_quote(foreign_key['column'])}) REFERENCES {_quote(foreign_key['target_table'])} ({_quote(foreign_key['target_column'])})"))
        applied.append(foreign_key["name"])
    return applied


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Apply only the reviewed reconciliation DDL after a clean preflight.")
    parser.add_argument("--lock-timeout-ms", type=int, default=5000)
    args = parser.parse_args()
    if args.lock_timeout_ms < 1:
        parser.error("--lock-timeout-ms must be positive")

    from database import engine

    try:
        if args.apply:
            with engine.begin() as connection:
                report = preflight(connection)
                if not report["safe_to_apply"]:
                    print(json.dumps({"mode": "apply", "preflight": report}, indent=2, sort_keys=True))
                    return 2
                applied = apply_reconciliation(connection, report, args.lock_timeout_ms)
            print(json.dumps({"mode": "apply", "preflight": report, "applied": applied}, indent=2, sort_keys=True))
        else:
            with engine.connect() as connection:
                connection.execute(text("SET TRANSACTION READ ONLY"))
                report = preflight(connection)
                print(json.dumps({"mode": "check", "preflight": report}, indent=2, sort_keys=True))
        return 0 if report["safe_to_apply"] else 2
    except Exception as exc:
        print(json.dumps({"mode": "apply" if args.apply else "check", "error": str(exc)}, indent=2, sort_keys=True))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
