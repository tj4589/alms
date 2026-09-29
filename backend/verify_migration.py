"""Read-only pre-stamp verification for an existing ExamMind database."""

import json

from database import engine
from migration_checks import verify_required_schema


def main() -> None:
    with engine.connect() as connection:
        report = verify_required_schema(connection)
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
