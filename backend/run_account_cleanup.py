"""Entry point for a daily Render Cron Job.

The job is inert until both permanent-deletion flags are enabled and a
server-authorized Firebase identity deleter is wired in by deployment.
"""

from database import SessionLocal
from account_cleanup import run_cleanup_batch


def main() -> None:
    with SessionLocal() as db:
        run_cleanup_batch(db)


if __name__ == "__main__":
    main()
