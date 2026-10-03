"""Bounded maintenance entry point for abandoned upload processing rows.

Run this as an explicitly configured maintenance job. It is not invoked during
web requests and it never deletes source bytes.
"""

from database import SessionLocal
from storage_safety import mark_abandoned_processing


def main() -> None:
    with SessionLocal() as db:
        mark_abandoned_processing(db)


if __name__ == "__main__":
    main()
