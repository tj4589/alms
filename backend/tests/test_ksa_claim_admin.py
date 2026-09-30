import os
import sys
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import auth  # noqa: E402
import models  # noqa: E402
from ksa_claim_admin import (  # noqa: E402
    RELEASED_ACTION,
    claim_membership_ids_match,
    inspect_ksa_claim,
    record_claim_audit,
)
from learning_spaces import claim_ksa_member, seed_learning_spaces  # noqa: E402


class KsaClaimAdminTests(unittest.TestCase):
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
            models.KsaMember.__table__,
            models.KsaClaimAudit.__table__,
        ):
            table.create(self.engine, checkfirst=True)
        self.db = self.Session()
        self.student = models.User(
            id=1,
            name="Student",
            username="student",
            email="student@example.com",
            firebase_uid="firebase-student",
            role="student",
        )
        self.admin = models.User(
            id=2,
            name="Global Admin",
            username="admin",
            email="admin@example.com",
            firebase_uid="firebase-admin",
            role="admin",
        )
        self.moderator = models.User(
            id=3,
            name="Moderator",
            username="moderator",
            email="moderator@example.com",
            firebase_uid="firebase-moderator",
            role="student",
        )
        self.db.add_all([self.student, self.admin, self.moderator])
        self.db.commit()
        seed_learning_spaces(self.db)

    def tearDown(self):
        self.db.close()
        for table in (
            models.KsaClaimAudit.__table__,
            models.KsaMember.__table__,
            models.LearningSpaceMembership.__table__,
            models.User.__table__,
            models.LearningSpace.__table__,
        ):
            table.drop(self.engine, checkfirst=True)

    def test_unauthenticated_and_non_global_users_are_denied(self):
        with self.assertRaises(HTTPException) as unauthenticated:
            auth.get_current_user("not-a-token", self.db)
        self.assertEqual(unauthenticated.exception.status_code, 401)

        for user in (self.student, self.moderator):
            with self.assertRaises(HTTPException) as denied:
                auth.require_global_admin_user(user)
            self.assertEqual(denied.exception.status_code, 403)
            self.assertEqual(denied.exception.detail, auth.GLOBAL_ADMIN_REQUIRED_MESSAGE)

    def test_space_roles_do_not_grant_global_claim_admin_access(self):
        ksa = self.db.query(models.LearningSpace).filter_by(slug="ksa").one()
        for role in ("member", "moderator", "admin", "owner"):
            self.moderator_role = models.LearningSpaceMembership(
                user_id=self.moderator.id,
                learning_space_id=ksa.id,
                role=role,
                status="active",
            )
            self.db.add(self.moderator_role)
            self.db.commit()
            with self.assertRaises(HTTPException) as denied:
                auth.require_global_admin_user(self.moderator)
            self.assertEqual(denied.exception.status_code, 403)
            self.db.delete(self.moderator_role)
            self.db.commit()

    def test_global_admin_is_authorized_with_one_centralized_path(self):
        self.assertIs(auth.require_global_admin_user(self.admin), self.admin)

    def test_new_claim_records_claimed_audit_and_inspection_is_admin_safe(self):
        claim_ksa_member(self.db, self.student, "KSA-07")
        audit = self.db.query(models.KsaClaimAudit).one()

        self.assertEqual(audit.ksa_id, "KSA-07")
        self.assertEqual(audit.action, "CLAIMED")
        self.assertIsNone(audit.previous_user_id)
        self.assertEqual(audit.current_user_id, self.student.id)
        self.assertEqual(audit.performed_by_user_id, self.student.id)
        self.assertIsNotNone(audit.created_at)
        self.assertEqual(audit.reason, "self_service_claim")
        self.assertTrue(claim_membership_ids_match(self.db, self.db.query(models.KsaMember).one()))

        inspection = inspect_ksa_claim(self.db, "KSA-07")
        self.assertTrue(inspection["claimed"])
        self.assertEqual(inspection["claimant"]["id"], self.student.id)
        self.assertEqual(inspection["membership"]["external_member_id"], "KSA-07")
        self.assertEqual(inspection["audit_history"][0]["action"], "CLAIMED")
        self.assertNotIn("firebase_uid", str(inspection))

    def test_repeated_claim_does_not_overwrite_history(self):
        claim_ksa_member(self.db, self.student, "KSA-08")
        claim_ksa_member(self.db, self.student, "KSA-08")
        self.assertEqual(self.db.query(models.KsaClaimAudit).count(), 1)

    def test_audit_model_can_represent_release_without_exposing_a_release_workflow(self):
        record_claim_audit(
            self.db,
            ksa_id="KSA-09",
            action=RELEASED_ACTION,
            previous_user_id=self.student.id,
            performed_by_user_id=self.admin.id,
            reason="future administrative release",
        )
        self.db.commit()
        audit = self.db.query(models.KsaClaimAudit).one()
        self.assertEqual(audit.action, RELEASED_ACTION)
        self.assertEqual(audit.previous_user_id, self.student.id)
        self.assertIsNone(audit.current_user_id)

    def test_claim_audit_survives_claimant_deletion(self):
        claim_ksa_member(self.db, self.student, "KSA-10")
        self.db.delete(self.student)
        self.db.commit()

        audit = self.db.query(models.KsaClaimAudit).one()
        self.assertEqual(audit.ksa_id, "KSA-10")
        self.assertEqual(audit.action, "CLAIMED")
        self.assertIsNone(audit.current_user_id)
        self.assertIsNone(audit.performed_by_user_id)

    def test_consistency_helper_detects_mismatched_active_membership(self):
        claim_ksa_member(self.db, self.student, "KSA-11")
        membership = (
            self.db.query(models.LearningSpaceMembership)
            .join(models.LearningSpace)
            .filter(
                models.LearningSpaceMembership.user_id == self.student.id,
                models.LearningSpace.slug == "ksa",
            )
            .one()
        )
        membership.external_member_id = "KSA-12"
        self.db.commit()
        self.assertFalse(claim_membership_ids_match(self.db, self.db.query(models.KsaMember).one()))


if __name__ == "__main__":
    unittest.main()
