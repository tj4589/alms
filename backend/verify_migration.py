"""Read-only pre-stamp verification for an existing ExamMind database."""

import argparse
import json

from database import engine
from migration_checks import REVISION_ORDER, inspect_revision_schema


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inspect an existing PostgreSQL schema without changing it."
    )
    parser.add_argument(
        "--revision",
        choices=REVISION_ORDER,
        default=REVISION_ORDER[-1],
        help="Exact Alembic revision whose schema should be inspected (default: head).",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    with engine.connect() as connection:
        report = inspect_revision_schema(connection, args.revision)
    print(json.dumps(report, indent=2, sort_keys=True))
    if not report["safe_to_stamp"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
