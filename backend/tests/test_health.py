import json
import os
import sys
import unittest
from unittest.mock import patch

from sqlalchemy.exc import SQLAlchemyError

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import database
import main


class _ConnectionContext:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def execute(self, statement):
        return statement


class HealthEndpointTests(unittest.TestCase):
    def test_health_reports_process_status_without_connecting_to_database(self):
        with patch.object(main.engine, "connect") as connect:
            self.assertEqual(main.health(), {"status": "ok", "application": "ok"})
        connect.assert_not_called()

    def test_readiness_reports_safe_success_after_database_probe(self):
        with patch.object(main.engine, "connect", return_value=_ConnectionContext()) as connect:
            self.assertEqual(
                main.readiness(),
                {"status": "ready", "application": "ok", "database": "ok"},
            )
        connect.assert_called_once_with()

    def test_readiness_redacts_database_failure_details(self):
        sentinel = "postgresql://secret-user:secret-password@private-host/internal"
        with patch.object(
            main.engine,
            "connect",
            side_effect=SQLAlchemyError(sentinel),
        ):
            response = main.readiness()

        self.assertEqual(response.status_code, 503)
        payload = json.loads(response.body)
        self.assertEqual(
            payload,
            {"status": "not_ready", "application": "ok", "database": "unavailable"},
        )
        self.assertNotIn("secret-password", response.body.decode("utf-8"))
        self.assertNotIn("private-host", response.body.decode("utf-8"))

    def test_database_connection_timeout_is_configurable_and_bounded(self):
        with patch.dict(os.environ, {"DB_CONNECT_TIMEOUT": "7"}):
            self.assertEqual(database._connect_args()["connect_timeout"], 7)


if __name__ == "__main__":
    unittest.main()
