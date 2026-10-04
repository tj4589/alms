import os
import sys
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("ADMIN_PORTAL_EMAILS", "admin@example.com")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import auth  # noqa: E402
import models  # noqa: E402
from ksa_claim_admin import (  # noqa: E402
    RELEASED_ACTION,
    claim_membership_ids_match,
    inspect_ksa_claim,
    record_claim_audit,
    release_ksa_claim,
)
from learning_spaces import KSA_SLUG, claim_ksa_member, seed_learning_spaces  # noqa: E402
from routers.learning_spaces import KsaClaimReleaseRequest, release_ksa_registry_claim  # noqa: E402


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
            models.Course.__table__,
            models.Topic.__table__,
            models.LearningSpaceMembership.__table__,
            models.KsaMember.__table__,
            models.LectureNote.__table__,
            models.AudioTranscriptSegment.__table__,
            models.StudentProgress.__table__,
            models.PracticeAttempt.__table__,
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
            models.PracticeAttempt.__table__,
            models.StudentProgress.__table__,
            models.AudioTranscriptSegment.__table__,
            models.LectureNote.__table__,
            models.KsaMember.__table__,
            models.LearningSpaceMembership.__table__,
            models.Topic.__table__,
            models.Course.__table__,
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

    def test_global_admin_access_requires_a_registered_email(self):
        with patch.dict(os.environ, {"ADMIN_PORTAL_EMAILS": " ADMIN@EXAMPLE.COM "}):
            self.assertTrue(auth.has_admin_portal_access(self.admin))
            self.assertTrue(self.admin.admin_portal_access)

            unregistered_admin = models.User(
                name="Unregistered Admin",
                username="unregistered_admin",
                email="other@example.com",
                role="admin",
            )
            self.assertFalse(auth.has_admin_portal_access(unregistered_admin))
            with self.assertRaises(HTTPException) as denied:
                auth.require_global_admin_user(unregistered_admin)
            self.assertEqual(denied.exception.status_code, 403)

            allowlisted_student = models.User(
                name="Allowlisted Student",
                username="allowlisted_student",
                email="admin@example.com",
                role="student",
            )
            self.assertFalse(auth.has_admin_portal_access(allowlisted_student))

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
        self.assertEqual(inspection["active_space"]["slug"], KSA_SLUG)
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

    def test_release_requires_a_non_blank_reason_and_canonical_id(self):
        with self.assertRaises(ValidationError):
            KsaClaimReleaseRequest(reason="  \t")

        with self.assertRaises(HTTPException) as invalid_id:
            release_ksa_registry_claim(
                "KSA-1",
                KsaClaimReleaseRequest(reason="Wrong academy ID"),
                self.db,
                self.admin,
            )
        self.assertEqual(invalid_id.exception.status_code, 422)

    def test_non_global_users_cannot_release_even_with_space_roles(self):
        ksa = self.db.query(models.LearningSpace).filter_by(slug=KSA_SLUG).one()
        for role in ("member", "moderator", "admin", "owner"):
            membership = models.LearningSpaceMembership(
                user_id=self.moderator.id,
                learning_space_id=ksa.id,
                role=role,
                status="active",
            )
            self.db.add(membership)
            self.db.commit()
            with self.assertRaises(HTTPException) as denied:
                auth.require_global_admin_user(self.moderator)
            self.assertEqual(denied.exception.status_code, 403)
            self.db.delete(membership)
            self.db.commit()

    def test_missing_claim_is_a_safe_not_found(self):
        with self.assertRaises(HTTPException) as missing:
            release_ksa_claim(
                self.db,
                ksa_id="KSA-78",
                performed_by=self.admin,
                reason="Wrong academy ID",
            )
        self.assertEqual(missing.exception.status_code, 404)

    def test_release_deactivates_only_ksa_and_preserves_data(self):
        cu = self.db.query(models.LearningSpace).filter_by(slug="cu").one()
        self.db.add(models.LearningSpaceMembership(
            user_id=self.student.id,
            learning_space_id=cu.id,
            role="member",
            status="active",
            onboarding_state="completed",
        ))
        self.student.active_learning_space_id = cu.id
        self.db.commit()
        claim_ksa_member(self.db, self.student, "KSA-78")
        ksa = self.db.query(models.LearningSpace).filter_by(slug=KSA_SLUG).one()

        note = models.LectureNote(
            id=700,
            uploaded_by=self.student.id,
            title="Private KSA notes",
            content_text="Qualification evidence",
            file_data=b"PDF-BYTES",
            file_name="notes.pdf",
            file_mime="application/pdf",
        )
        self.db.add(note)
        self.db.flush()
        self.db.add_all([
            models.AudioTranscriptSegment(
                id=701,
                resource_id=note.id,
                segment_index=0,
                start_time=1.0,
                end_time=3.0,
                text="Qualification evidence",
            ),
            models.StudentProgress(id=702, student_id=self.student.id, mastery_score=42),
            models.PracticeAttempt(
                id=703,
                user_id=self.student.id,
                topic="qualification",
                score=1,
                total_questions=2,
            ),
        ])
        self.db.commit()

        result = release_ksa_claim(
            self.db,
            ksa_id="KSA-78",
            performed_by=self.admin,
            reason="User claimed the wrong academy ID.",
        )

        self.assertEqual(result["status"], "released")
        released_claim = self.db.query(models.KsaMember).filter_by(ksa_id="KSA-78").one()
        self.assertIsNone(released_claim.claimed_by_user_id)
        self.assertIsNone(released_claim.claimed_at)
        self.assertEqual(released_claim.status, "released")
        ksa_membership = (
            self.db.query(models.LearningSpaceMembership)
            .filter_by(user_id=self.student.id, learning_space_id=ksa.id)
            .one()
        )
        self.assertEqual(ksa_membership.status, "inactive")
        self.assertIsNone(ksa_membership.external_member_id)
        self.assertEqual(self.student.active_learning_space_id, None)
        self.assertEqual(
            self.db.query(models.LearningSpaceMembership)
            .filter_by(user_id=self.student.id, learning_space_id=cu.id, status="active")
            .count(),
            1,
        )

        self.assertEqual(self.db.query(models.LectureNote).one().file_data, b"PDF-BYTES")
        self.assertEqual(self.db.query(models.AudioTranscriptSegment).one().text, "Qualification evidence")
        self.assertEqual(self.db.query(models.StudentProgress).one().mastery_score, 42)
        self.assertEqual(self.db.query(models.PracticeAttempt).one().score, 1)

        released_audit = (
            self.db.query(models.KsaClaimAudit)
            .filter_by(ksa_id="KSA-78", action=RELEASED_ACTION)
            .one()
        )
        self.assertEqual(released_audit.previous_user_id, self.student.id)
        self.assertIsNone(released_audit.current_user_id)
        self.assertEqual(released_audit.performed_by_user_id, self.admin.id)
        self.assertEqual(released_audit.reason, "User claimed the wrong academy ID.")

    def test_release_requires_consistent_active_claim_membership(self):
        claim_ksa_member(self.db, self.student, "KSA-79")
        membership = (
            self.db.query(models.LearningSpaceMembership)
            .join(models.LearningSpace)
            .filter(
                models.LearningSpaceMembership.user_id == self.student.id,
                models.LearningSpace.slug == KSA_SLUG,
            )
            .one()
        )
        membership.external_member_id = "KSA-80"
        self.db.commit()

        with self.assertRaises(HTTPException) as inconsistent:
            release_ksa_claim(
                self.db,
                ksa_id="KSA-79",
                performed_by=self.admin,
                reason="Wrong academy ID",
            )
        self.assertEqual(inconsistent.exception.status_code, 409)
        claim = self.db.query(models.KsaMember).filter_by(ksa_id="KSA-79").one()
        self.assertEqual(claim.claimed_by_user_id, self.student.id)
        self.assertEqual(self.db.query(models.KsaClaimAudit).filter_by(action=RELEASED_ACTION).count(), 0)

    def test_release_is_atomic_when_audit_write_fails(self):
        claim_ksa_member(self.db, self.student, "KSA-81")
        before_pointer = self.student.active_learning_space_id
        with patch("ksa_claim_admin.record_claim_audit", side_effect=RuntimeError("audit unavailable")):
            with self.assertRaises(HTTPException) as failed:
                release_ksa_claim(
                    self.db,
                    ksa_id="KSA-81",
                    performed_by=self.admin,
                    reason="Wrong academy ID",
                )
        self.assertEqual(failed.exception.status_code, 409)
        claim = self.db.query(models.KsaMember).filter_by(ksa_id="KSA-81").one()
        self.assertEqual(claim.claimed_by_user_id, self.student.id)
        self.assertEqual(self.student.active_learning_space_id, before_pointer)
        membership = (
            self.db.query(models.LearningSpaceMembership)
            .join(models.LearningSpace)
            .filter(
                models.LearningSpaceMembership.user_id == self.student.id,
                models.LearningSpace.slug == KSA_SLUG,
            )
            .one()
        )
        self.assertEqual(membership.status, "active")
        self.assertEqual(self.db.query(models.KsaClaimAudit).filter_by(action=RELEASED_ACTION).count(), 0)

    def test_repeat_release_is_conflict_without_duplicate_audit(self):
        claim_ksa_member(self.db, self.student, "KSA-82")
        release_ksa_claim(self.db, ksa_id="KSA-82", performed_by=self.admin, reason="Correction")
        with self.assertRaises(HTTPException) as repeated:
            release_ksa_claim(
                self.db,
                ksa_id="KSA-82",
                performed_by=self.admin,
                reason="Correction again",
            )
        self.assertEqual(repeated.exception.status_code, 409)
        self.assertEqual(self.db.query(models.KsaClaimAudit).filter_by(action=RELEASED_ACTION).count(), 1)

    def test_released_id_can_be_reclaimed_by_another_user(self):
        claim_ksa_member(self.db, self.student, "KSA-83")
        release_ksa_claim(self.db, ksa_id="KSA-83", performed_by=self.admin, reason="Correction")
        other = models.User(
            id=4,
            name="Other student",
            username="other_student",
            email="other@example.com",
            firebase_uid="firebase-other",
            role="student",
        )
        self.db.add(other)
        self.db.commit()

        result = claim_ksa_member(self.db, other, "KSA-83")
        self.assertTrue(result["onboarding_required"])
        self.assertEqual(self.db.query(models.KsaMember).filter_by(ksa_id="KSA-83").one().claimed_by_user_id, other.id)
        former_membership = (
            self.db.query(models.LearningSpaceMembership)
            .join(models.LearningSpace)
            .filter(
                models.LearningSpaceMembership.user_id == self.student.id,
                models.LearningSpace.slug == KSA_SLUG,
            )
            .one()
        )
        self.assertEqual(former_membership.status, "inactive")
        self.assertIsNone(self.student.active_learning_space_id)
        self.assertEqual(
            [row.action for row in self.db.query(models.KsaClaimAudit).filter_by(ksa_id="KSA-83").order_by(models.KsaClaimAudit.id)],
            ["CLAIMED", "RELEASED", "CLAIMED"],
        )

    def test_former_user_reclaims_through_normal_flow_and_reuses_membership(self):
        claim_ksa_member(self.db, self.student, "KSA-84")
        original_membership = (
            self.db.query(models.LearningSpaceMembership)
            .join(models.LearningSpace)
            .filter(
                models.LearningSpaceMembership.user_id == self.student.id,
                models.LearningSpace.slug == KSA_SLUG,
            )
            .one()
        )
        release_ksa_claim(self.db, ksa_id="KSA-84", performed_by=self.admin, reason="Correction")

        result = claim_ksa_member(self.db, self.student, "KSA-84")
        self.assertTrue(result["onboarding_required"])
        reused = (
            self.db.query(models.LearningSpaceMembership)
            .filter_by(user_id=self.student.id, external_member_id="KSA-84")
            .one()
        )
        self.assertEqual(reused.id, original_membership.id)
        self.assertEqual(reused.status, "active")
        self.assertEqual(self.db.query(models.KsaClaimAudit).filter_by(ksa_id="KSA-84").count(), 3)

    def test_admin_inspection_shows_released_state_and_history_without_owner(self):
        claim_ksa_member(self.db, self.student, "KSA-85")
        release_ksa_claim(self.db, ksa_id="KSA-85", performed_by=self.admin, reason="Correction")

        inspection = inspect_ksa_claim(self.db, "KSA-85")
        self.assertFalse(inspection["claimed"])
        self.assertEqual(inspection["claim_status"], "released")
        self.assertIsNone(inspection["claimant"])
        self.assertEqual(inspection["membership"]["status"], "inactive")
        self.assertIsNone(inspection["active_space"])
        self.assertEqual(
            [event["action"] for event in inspection["audit_history"]],
            ["CLAIMED", "RELEASED"],
        )


if __name__ == "__main__":
    unittest.main()
