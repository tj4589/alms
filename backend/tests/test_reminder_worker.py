import os
import sys
import socketserver
import threading
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import models  # noqa: E402
import reminder_worker  # noqa: E402
from database import Base  # noqa: E402
from reminders import subscribe_user, unsubscribe_user  # noqa: E402


class _CaptureSmtpHandler(socketserver.StreamRequestHandler):
    def handle(self):
        self.wfile.write(b"220 ExamMind local test sink\r\n")
        message = bytearray()
        in_data = False
        while True:
            line = self.rfile.readline()
            if not line:
                return
            if in_data:
                if line == b".\r\n":
                    self.server.messages.append(bytes(message))
                    self.wfile.write(b"250 queued\r\n")
                    in_data = False
                else:
                    message.extend(line[1:] if line.startswith(b"..") else line)
                continue

            command = line.decode("ascii", errors="replace").upper()
            if command.startswith(("EHLO", "HELO")):
                self.wfile.write(b"250-localhost\r\n250 OK\r\n")
            elif command.startswith(("MAIL FROM", "RCPT TO")):
                self.wfile.write(b"250 OK\r\n")
            elif command.startswith("DATA"):
                self.wfile.write(b"354 End data with <CR><LF>.<CR><LF>\r\n")
                in_data = True
            elif command.startswith("QUIT"):
                self.wfile.write(b"221 Bye\r\n")
                return
            else:
                self.wfile.write(b"250 OK\r\n")


class _CaptureSmtpServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

    def __init__(self, address):
        self.messages = []
        super().__init__(address, _CaptureSmtpHandler)


class ReminderWorkerTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session = sessionmaker(bind=self.engine)()
        self.user = models.User(
            id=1,
            name="Worker Student",
            username="worker_student",
            email="worker@example.test",
            firebase_uid="worker-firebase",
            role="student",
            account_status="active",
            onboarding_preferences={"notifications_enabled": False},
        )
        self.session.add(self.user)
        self.session.commit()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def test_subscription_worker_sandbox_receipt_and_unsubscribe(self):
        subscribe_user(self.session, self.user, channel="email")
        self.session.commit()
        server = _CaptureSmtpServer(("127.0.0.1", 0))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def stop_server():
            server.shutdown()
            thread.join(2)
            server.server_close()
        self.addCleanup(stop_server)

        with patch.dict(os.environ, {
            "REMINDER_WORKER_ENABLED": "true",
            "REMINDER_DISPATCH_ENABLED": "true",
            "REMINDER_CADENCE": "daily",
            "REMINDER_EMAIL_PROVIDER": "smtp",
            "REMINDER_EMAIL_SMTP_HOST": "127.0.0.1",
            "REMINDER_EMAIL_SMTP_PORT": str(server.server_address[1]),
            "REMINDER_EMAIL_SMTP_STARTTLS": "false",
            "REMINDER_EMAIL_FROM": "noreply@example.test",
            "REMINDER_SUBJECT": "Local study check-in",
            "REMINDER_BODY": "Review one short section.",
        }, clear=False), patch.object(reminder_worker, "SessionLocal", return_value=self.session):
            first = reminder_worker.run_once(now=datetime(2026, 10, 17, 9, tzinfo=timezone.utc))

        self.assertEqual(first["sent"], 1)
        self.assertEqual(len(server.messages), 1)
        self.assertIn(b"To: worker@example.test", server.messages[0])
        self.assertIn(b"Subject: Local study check-in", server.messages[0])

        with patch.dict(os.environ, {
            "REMINDER_WORKER_ENABLED": "true",
            "REMINDER_DISPATCH_ENABLED": "true",
            "REMINDER_CADENCE": "daily",
        }, clear=False), patch.object(reminder_worker, "SessionLocal", return_value=self.session):
            reminder_worker.run_once(now=datetime(2026, 10, 17, 12, tzinfo=timezone.utc))

        self.assertEqual(len(server.messages), 1)
        self.assertEqual(self.session.query(models.ReminderDelivery).count(), 1)

        unsubscribe_user(self.session, self.session.get(models.User, 1), "email")
        self.session.commit()
        with patch.dict(os.environ, {
            "REMINDER_WORKER_ENABLED": "true",
            "REMINDER_DISPATCH_ENABLED": "true",
            "REMINDER_CADENCE": "daily",
        }, clear=False), patch.object(reminder_worker, "SessionLocal", return_value=self.session):
            stopped = reminder_worker.run_once(now=datetime(2026, 10, 18, 9, tzinfo=timezone.utc))

        self.assertEqual(stopped["users_considered"], 0)
        self.assertEqual(len(server.messages), 1)

    def test_worker_requires_an_explicit_supported_cadence(self):
        with patch.dict(os.environ, {
            "REMINDER_WORKER_ENABLED": "true",
            "REMINDER_DISPATCH_ENABLED": "true",
            "REMINDER_CADENCE": "",
        }, clear=False):
            with self.assertRaisesRegex(RuntimeError, "daily or weekly"):
                reminder_worker.run_once()


if __name__ == "__main__":
    unittest.main()
