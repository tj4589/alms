"""Compatibility entry point for the authoritative Alembic migrations.

Use ``alembic -c alembic.ini upgrade head`` for new work. This wrapper remains
for existing deployment/runbook commands, but intentionally contains no
schema SQL of its own.
"""

import os
from pathlib import Path


def _load_local_env() -> None:
    env_path = Path(__file__).with_name(".env")
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def main() -> None:
    _load_local_env()
    if not os.getenv("DATABASE_URL"):
        raise SystemExit(
            "DATABASE_URL is not set. Configure it before running Alembic migrations."
        )

    from alembic import command
    from alembic.config import Config

    config = Config(str(Path(__file__).with_name("alembic.ini")))
    command.upgrade(config, "head")


if __name__ == "__main__":
    main()
