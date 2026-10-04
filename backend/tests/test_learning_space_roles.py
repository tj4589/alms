import os
import sys
import unittest
from datetime import datetime, timezone

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("ADMIN_PORTAL_EMAILS", "admin@example.com")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import models  # noqa: E402
from learning_space_roles import record_role_audit  # noqa: E402
from material_access import is_moderator  # noqa: E402


class LearningSpaceRoleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine("sqlite:///:memory:")

        @event.listens_for(cls.engine, "connect")
        def enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
            dbapi_connection.execute("PRAGMA foreign_keys=ON")

        cls.Session = sessionmaker(bind=cls.engine)

    def setUp(self):
        for table in (
            models.LearningSpace.__table__,
            models.User.__table__,
            models.LearningSpaceMembership.__table__,
            models.LearningSpaceRoleAudit.__table__,
        ):
            table.create(self.engine, checkfirst=True)
        self.db = self.Session()
        self.ksa = models.LearningSpace(id=1, slug="ksa", name="Kora Sales Academy", type="academy", status="active")
        self.cu = models.LearningSpace(id=2, slug="cu", name="Covenant University", type="university", status="active")
        self.admin = models.User(id=1, name="Global Admin", username="admin", email="admin@example.com", role="admin")
        self.ksa_moderator = models.User(id=2, name="KSA Moderator", username="ksa_mod", email="ksa@example.com", role="student")
        self.cu_moderator = models.User(id=3, name="CU Moderator", username="cu_mod", email="cu@example.com", role="student")
        self.legacy_moderator = models.User(id=4, name="Legacy Moderator", username="legacy_mod", email="legacy@example.com", role="moderator")
        self.member = models.User(id=5, name="Member", username="member", email="member@example.com", role="student")
        self.inactive = models.User(id=6, name="Inactive", username="inactive", email="inactive@example.com", role="student")
        self.db.add_all([self.ksa, self.cu, self.admin, self.ksa_moderator, self.cu_moderator, self.legacy_moderator, self.member, self.inactive])
        self.db.flush()
        self.db.add_all([
            models.LearningSpaceMembership(id=11, user_id=self.ksa_moderator.id, learning_space_id=self.ksa.id, role="moderator", status="active"),
            models.LearningSpaceMembership(id=12, user_id=self.cu_moderator.id, learning_space_id=self.cu.id, role="moderator", status="active"),
            models.LearningSpaceMembership(id=13, user_id=self.member.id, learning_space_id=self.ksa.id, role="member", status="active"),
            models.LearningSpaceMembership(id=14, user_id=self.inactive.id, learning_space_id=self.ksa.id, role="moderator", status="inactive"),
        ])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        for table in (
            models.LearningSpaceRoleAudit.__table__,
            models.LearningSpaceMembership.__table__,
            models.User.__table__,
            models.LearningSpace.__table__,
        ):
            table.drop(self.engine, checkfirst=True)

    def test_global_admin_can_moderate_any_space(self):
        self.assertTrue(is_moderator(self.db, self.admin, self.ksa.id))
        self.assertTrue(is_moderator(self.db, self.admin, self.cu.id))

    def test_membership_moderators_are_scoped_to_their_space(self):
        self.assertTrue(is_moderator(self.db, self.ksa_moderator, self.ksa.id))
        self.assertFalse(is_moderator(self.db, self.ksa_moderator, self.cu.id))
        self.assertTrue(is_moderator(self.db, self.cu_moderator, self.cu.id))
        self.assertFalse(is_moderator(self.db, self.cu_moderator, self.ksa.id))

    def test_owner_and_admin_can_moderate_only_their_active_space(self):
        owner = models.User(id=7, name="Owner", username="owner", email="owner@example.com", role="student")
        space_admin = models.User(id=8, name="Space Admin", username="space_admin", email="space_admin@example.com", role="student")
        self.db.add_all([owner, space_admin])
        self.db.flush()
        self.db.add_all([
            models.LearningSpaceMembership(user_id=owner.id, learning_space_id=self.ksa.id, role="owner", status="active"),
            models.LearningSpaceMembership(user_id=space_admin.id, learning_space_id=self.cu.id, role="admin", status="active"),
        ])
        self.db.commit()
        self.assertTrue(is_moderator(self.db, owner, self.ksa.id))
        self.assertFalse(is_moderator(self.db, owner, self.cu.id))
        self.assertTrue(is_moderator(self.db, space_admin, self.cu.id))
        self.assertFalse(is_moderator(self.db, space_admin, self.ksa.id))

    def test_membership_and_legacy_roles_without_target_membership_are_denied(self):
        self.assertFalse(is_moderator(self.db, self.member, self.ksa.id))
        self.assertFalse(is_moderator(self.db, self.inactive, self.ksa.id))
        self.assertFalse(is_moderator(self.db, self.legacy_moderator, self.ksa.id))
        self.assertFalse(is_moderator(self.db, self.legacy_moderator, self.cu.id))
        self.assertFalse(is_moderator(self.db, self.member, None))

    def test_role_audit_records_both_supported_transitions(self):
        membership = self.db.query(models.LearningSpaceMembership).filter_by(id=13).one()
        first_time = datetime(2026, 9, 30, tzinfo=timezone.utc)
        first = record_role_audit(
            self.db,
            membership=membership,
            previous_role="member",
            new_role="moderator",
            performed_by=self.admin,
            reason="Assigned as KSA cohort moderator.",
            created_at=first_time,
        )
        second = record_role_audit(
            self.db,
            membership=membership,
            previous_role="moderator",
            new_role="member",
            performed_by=self.admin,
            reason="Moderator coverage ended.",
        )
        self.db.commit()
        self.assertEqual(first.previous_role, "member")
        self.assertEqual(first.new_role, "moderator")
        self.assertEqual(first.reason, "Assigned as KSA cohort moderator.")
        # SQLite drops timezone metadata for DateTime(timezone=True); the
        # production PostgreSQL column retains the UTC-aware value.
        self.assertEqual(first.created_at.replace(tzinfo=timezone.utc), first_time)
        self.assertEqual(second.previous_role, "moderator")
        self.assertEqual(second.new_role, "member")
        self.assertEqual(self.db.query(models.LearningSpaceRoleAudit).count(), 2)

    def test_role_audit_requires_supported_transition_and_reason(self):
        membership = self.db.query(models.LearningSpaceMembership).filter_by(id=13).one()
        with self.assertRaises(ValueError):
            record_role_audit(self.db, membership=membership, previous_role="member", new_role="superuser", performed_by=self.admin, reason="No")
        with self.assertRaises(ValueError):
            record_role_audit(self.db, membership=membership, previous_role="member", new_role="moderator", performed_by=self.admin, reason=" ")
        with self.assertRaises(ValueError):
            record_role_audit(self.db, membership=membership, previous_role="member", new_role="member", performed_by=self.admin, reason="No transition")

    def test_role_audit_survives_target_actor_and_membership_deletion(self):
        membership = self.db.query(models.LearningSpaceMembership).filter_by(id=13).one()
        record_role_audit(
            self.db,
            membership=membership,
            previous_role="member",
            new_role="moderator",
            performed_by=self.admin,
            reason="Assigned as KSA cohort moderator.",
        )
        self.db.commit()
        self.db.delete(self.member)
        self.db.delete(self.admin)
        self.db.commit()

        audit = self.db.query(models.LearningSpaceRoleAudit).one()
        self.assertIsNone(audit.target_user_id)
        self.assertIsNone(audit.membership_id)
        self.assertIsNone(audit.performed_by_user_id)
        self.assertEqual(audit.learning_space_id, self.ksa.id)
        self.assertEqual(audit.learning_space_slug, "ksa")
        self.assertEqual(audit.previous_role, "member")
        self.assertEqual(audit.new_role, "moderator")
        self.assertEqual(audit.reason, "Assigned as KSA cohort moderator.")


if __name__ == "__main__":
    unittest.main()
