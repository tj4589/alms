import os
import sys
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import models  # noqa: E402
from database import Base  # noqa: E402
from migration_checks import revision_requirements  # noqa: E402
from notifications import create_notification, notify_discussion_reply  # noqa: E402
from routers.notifications import (  # noqa: E402
    list_notifications,
    mark_all_notifications_read,
    mark_notification_read,
)


class NotificationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session = sessionmaker(bind=self.engine)()
        self.cu = models.LearningSpace(
            id=1,
            slug="cu",
            name="Covenant University",
            type="university",
            status="active",
        )
        self.ksa = models.LearningSpace(
            id=2,
            slug="ksa",
            name="Kora Sales Academy",
            type="academy",
            status="active",
        )
        self.author = models.User(
            id=1,
            name="Thread author",
            username="thread_author",
            email="author@example.com",
            firebase_uid="firebase-author",
            active_learning_space_id=1,
        )
        self.reply_author = models.User(
            id=2,
            name="Reply author",
            username="reply_author",
            email="reply@example.com",
            firebase_uid="firebase-reply",
            active_learning_space_id=1,
        )
        self.other_space_user = models.User(
            id=3,
            name="Other space",
            username="other_space",
            email="other@example.com",
            firebase_uid="firebase-other",
            active_learning_space_id=2,
        )
        self.session.add_all([self.cu, self.ksa, self.author, self.reply_author, self.other_space_user])
        self.session.add_all([
            models.LearningSpaceMembership(user_id=1, learning_space_id=1, status="active"),
            models.LearningSpaceMembership(user_id=1, learning_space_id=2, status="active"),
            models.LearningSpaceMembership(user_id=2, learning_space_id=1, status="active"),
            models.LearningSpaceMembership(user_id=3, learning_space_id=2, status="active"),
        ])
        self.thread = models.DiscussionThread(
            id=10,
            title="A CU discussion",
            content="Please explain this topic.",
            created_by=1,
            learning_space_id=1,
        )
        self.message = models.ThreadMessage(
            id=100,
            thread_id=10,
            user_id=2,
            content="Here is a reply.",
        )
        self.session.add_all([self.thread, self.message])
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()

    def test_revision_0008_is_after_0007_and_has_notification_contract(self) -> None:
        requirements = revision_requirements("0008_notifications")
        self.assertIn("notifications", requirements["tables"])
        self.assertIn("event_key", requirements["columns"]["notifications"])
        self.assertIn("ix_notifications_recipient_space_read_created", requirements["indexes"])
        self.assertIn(
            ("notifications", "recipient_user_id", "users", "id", "CASCADE"),
            requirements["foreign_keys"],
        )
        self.assertIn(
            ("notifications", ("recipient_user_id", "learning_space_id", "event_type", "event_key")),
            requirements["unique_constraints"],
        )

    def test_reply_creates_persists_and_deduplicates_notification(self) -> None:
        first = notify_discussion_reply(
            self.session,
            thread=self.thread,
            message=self.message,
            actor=self.reply_author,
        )
        self.session.commit()
        second = notify_discussion_reply(
            self.session,
            thread=self.thread,
            message=self.message,
            actor=self.reply_author,
        )
        self.session.commit()

        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        self.assertEqual(first.id, second.id)
        self.assertEqual(self.session.query(models.Notification).count(), 1)
        self.session.expire_all()
        stored = self.session.query(models.Notification).one()
        self.assertEqual(stored.recipient_user_id, self.author.id)
        self.assertEqual(stored.learning_space_id, self.cu.id)
        self.assertEqual(stored.target_screen, "discussions")
        self.assertEqual(stored.target_id, self.thread.id)
        payload = list_notifications(limit=40, unread_only=False, db=self.session, current_user=self.author)
        self.assertEqual(payload["unread_count"], 1)
        self.assertEqual(payload["items"][0]["is_read"], False)

    def test_read_one_and_mark_all_are_persisted(self) -> None:
        for message_id in (101, 102):
            create_notification(
                self.session,
                recipient_user_id=self.author.id,
                learning_space_id=self.cu.id,
                event_type="discussion_reply",
                event_key=f"message:{message_id}",
                title="New reply",
                body="A student replied.",
                target_screen="discussions",
                target_id=self.thread.id,
            )
        self.session.commit()
        first = self.session.query(models.Notification).order_by(models.Notification.id).first()
        assert first is not None
        marked = mark_notification_read(first.id, db=self.session, current_user=self.author)
        self.assertTrue(marked["is_read"])
        self.assertEqual(
            list_notifications(limit=40, unread_only=False, db=self.session, current_user=self.author)["unread_count"],
            1,
        )

        result = mark_all_notifications_read(db=self.session, current_user=self.author)
        self.assertEqual(result["updated_count"], 1)
        self.assertEqual(result["unread_count"], 0)
        self.assertEqual(
            list_notifications(limit=40, unread_only=False, db=self.session, current_user=self.author)["unread_count"],
            0,
        )

    def test_recipient_and_active_space_isolation(self) -> None:
        create_notification(
            self.session,
            recipient_user_id=self.author.id,
            learning_space_id=self.cu.id,
            event_type="discussion_reply",
            event_key="cu-message",
            title="CU reply",
            body="Only for CU.",
            target_screen="discussions",
            target_id=self.thread.id,
        )
        self.session.commit()

        self.author.active_learning_space_id = self.ksa.id
        self.session.commit()
        self.assertEqual(
            list_notifications(limit=40, unread_only=False, db=self.session, current_user=self.author)["items"],
            [],
        )
        with self.assertRaises(HTTPException) as denied:
            mark_notification_read(1, db=self.session, current_user=self.author)
        self.assertEqual(denied.exception.status_code, 404)

        other_payload = list_notifications(limit=40, unread_only=False, db=self.session, current_user=self.other_space_user)
        self.assertEqual(other_payload["items"], [])
        self.assertEqual(mark_all_notifications_read(db=self.session, current_user=self.other_space_user)["updated_count"], 0)
        stored = self.session.query(models.Notification).one()
        self.assertIsNone(stored.read_at)

    def test_ambiguous_thread_and_self_reply_do_not_create_notifications(self) -> None:
        ambiguous = models.DiscussionThread(
            id=11,
            title="Legacy discussion",
            content="Unassigned legacy content.",
            created_by=self.author.id,
            learning_space_id=None,
        )
        self.session.add(ambiguous)
        self.session.flush()
        legacy_message = models.ThreadMessage(
            id=110,
            thread_id=ambiguous.id,
            user_id=self.reply_author.id,
            content="Reply to a legacy row.",
        )
        self.session.add(legacy_message)
        self.session.flush()
        self.assertIsNone(
            notify_discussion_reply(self.session, thread=ambiguous, message=legacy_message, actor=self.reply_author)
        )
        self.assertIsNone(
            notify_discussion_reply(self.session, thread=self.thread, message=self.message, actor=self.author)
        )
        self.assertEqual(self.session.query(models.Notification).count(), 0)


if __name__ == "__main__":
    unittest.main()
