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
from learning_space_roles import (  # noqa: E402
    demote_ksa_moderator_to_member,
    promote_ksa_member_to_moderator,
)
from routers.learning_spaces import (  # noqa: E402
    KsaModeratorRoleChangeRequest,
    demote_ksa_moderator,
    promote_ksa_moderator,
)
from material_access import is_moderator  # noqa: E402


class KsaModeratorRoleTests(unittest.TestCase):
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
            models.KsaClaimAudit.__table__,
            models.LearningSpaceRoleAudit.__table__,
            models.LectureNote.__table__,
            models.StudentProgress.__table__,
            models.PracticeAttempt.__table__,
        ):
            table.create(self.engine, checkfirst=True)
        self.db = self.Session()

        self.ksa = models.LearningSpace(id=1, slug="ksa", name="Kora Sales Academy", type="academy", status="active")
        self.cu = models.LearningSpace(id=2, slug="cu", name="Covenant University", type="university", status="active")
        self.db.add_all([self.ksa, self.cu])
        self.db.flush()

        self.admin = models.User(id=1, name="Global Admin", username="global_admin", email="admin@example.com", role="admin")
        self.member = models.User(id=2, name="KSA Member", username="ksa_member", email="member@example.com", role="student")
        self.already_moderator = models.User(id=3, name="Existing Moderator", username="existing_moderator", email="existing@example.com", role="student")
        self.ksa_moderator = models.User(id=4, name="KSA Moderator", username="ksa_moderator", email="moderator@example.com", role="student")
        self.ksa_owner = models.User(id=5, name="KSA Owner", username="ksa_owner", email="owner@example.com", role="student")
        self.ksa_admin = models.User(id=6, name="KSA Admin", username="ksa_admin", email="space-admin@example.com", role="student")
        self.cu_moderator = models.User(id=7, name="CU Moderator", username="cu_moderator", email="cu-moderator@example.com", role="student")
        self.cu_admin = models.User(id=8, name="CU Admin", username="cu_admin", email="cu-admin@example.com", role="student")
        self.cu_owner = models.User(id=9, name="CU Owner", username="cu_owner", email="cu-owner@example.com", role="student")
        self.multi_space = models.User(id=10, name="Multi Space", username="multi_space", email="multi@example.com", role="student")
        self.no_ksa = models.User(id=11, name="CU Only", username="cu_only", email="cu-only@example.com", role="student")
        self.inactive_account = models.User(id=12, name="Inactive Account", username="inactive_account", email="inactive@example.com", role="student", account_status="deactivated")
        self.inactive_membership = models.User(id=13, name="Inactive Membership", username="inactive_membership", email="inactive-membership@example.com", role="student")
        self.released = models.User(id=14, name="Released Member", username="released_member", email="released@example.com", role="student")
        self.db.add_all([
            self.admin,
            self.member,
            self.already_moderator,
            self.ksa_moderator,
            self.ksa_owner,
            self.ksa_admin,
            self.cu_moderator,
            self.cu_admin,
            self.cu_owner,
            self.multi_space,
            self.no_ksa,
            self.inactive_account,
            self.inactive_membership,
            self.released,
        ])
        self.db.flush()

        self.db.add_all([
            models.LearningSpaceMembership(id=101, user_id=self.member.id, learning_space_id=self.ksa.id, external_member_id="KSA-01", role="member", status="active"),
            models.LearningSpaceMembership(id=102, user_id=self.already_moderator.id, learning_space_id=self.ksa.id, external_member_id="KSA-02", role="moderator", status="active"),
            models.LearningSpaceMembership(id=103, user_id=self.ksa_moderator.id, learning_space_id=self.ksa.id, external_member_id="KSA-03", role="moderator", status="active"),
            models.LearningSpaceMembership(id=104, user_id=self.ksa_owner.id, learning_space_id=self.ksa.id, external_member_id="KSA-04", role="owner", status="active"),
            models.LearningSpaceMembership(id=105, user_id=self.ksa_admin.id, learning_space_id=self.ksa.id, external_member_id="KSA-05", role="admin", status="active"),
            models.LearningSpaceMembership(id=106, user_id=self.cu_moderator.id, learning_space_id=self.cu.id, role="moderator", status="active"),
            models.LearningSpaceMembership(id=107, user_id=self.cu_admin.id, learning_space_id=self.cu.id, role="admin", status="active"),
            models.LearningSpaceMembership(id=108, user_id=self.cu_owner.id, learning_space_id=self.cu.id, role="owner", status="active"),
            models.LearningSpaceMembership(id=109, user_id=self.multi_space.id, learning_space_id=self.ksa.id, external_member_id="KSA-10", role="member", status="active"),
            models.LearningSpaceMembership(id=110, user_id=self.multi_space.id, learning_space_id=self.cu.id, role="member", status="active"),
            models.LearningSpaceMembership(id=111, user_id=self.no_ksa.id, learning_space_id=self.cu.id, role="member", status="active"),
            models.LearningSpaceMembership(id=112, user_id=self.inactive_account.id, learning_space_id=self.ksa.id, external_member_id="KSA-12", role="member", status="active"),
            models.LearningSpaceMembership(id=113, user_id=self.inactive_membership.id, learning_space_id=self.ksa.id, external_member_id="KSA-13", role="member", status="inactive"),
            models.LearningSpaceMembership(id=114, user_id=self.released.id, learning_space_id=self.ksa.id, role="member", status="inactive"),
        ])
        self.db.add_all([
            models.KsaMember(ksa_id="KSA-01", status="active", claimed_by_user_id=self.member.id),
            models.KsaMember(ksa_id="KSA-02", status="active", claimed_by_user_id=self.already_moderator.id),
            models.KsaMember(ksa_id="KSA-03", status="active", claimed_by_user_id=self.ksa_moderator.id),
            models.KsaMember(ksa_id="KSA-04", status="active", claimed_by_user_id=self.ksa_owner.id),
            models.KsaMember(ksa_id="KSA-05", status="active", claimed_by_user_id=self.ksa_admin.id),
            models.KsaMember(ksa_id="KSA-10", status="active", claimed_by_user_id=self.multi_space.id),
            models.KsaMember(ksa_id="KSA-12", status="active", claimed_by_user_id=self.inactive_account.id),
            models.KsaMember(ksa_id="KSA-13", status="active", claimed_by_user_id=self.inactive_membership.id),
            models.KsaMember(ksa_id="KSA-14", status="released", claimed_by_user_id=None),
        ])
        self.admin.active_learning_space_id = self.ksa.id
        self.multi_space.active_learning_space_id = self.ksa.id
        self.db.commit()

    def tearDown(self):
        self.db.close()
        for table in (
            models.PracticeAttempt.__table__,
            models.StudentProgress.__table__,
            models.LectureNote.__table__,
            models.LearningSpaceRoleAudit.__table__,
            models.KsaClaimAudit.__table__,
            models.KsaMember.__table__,
            models.LearningSpaceMembership.__table__,
            models.Topic.__table__,
            models.Course.__table__,
            models.User.__table__,
            models.LearningSpace.__table__,
        ):
            table.drop(self.engine, checkfirst=True)

    def membership(self, user):
        return self.db.query(models.LearningSpaceMembership).filter_by(
            user_id=user.id,
            learning_space_id=self.ksa.id,
        ).one()

    def audit_events(self):
        return self.db.query(models.LearningSpaceRoleAudit).order_by(models.LearningSpaceRoleAudit.id).all()

    def test_global_admin_is_the_only_role_manager_and_space_roles_do_not_grant_access(self):
        self.assertIs(auth.require_global_admin_user(self.admin), self.admin)
        callers = [
            self.member,
            self.ksa_moderator,
            self.ksa_owner,
            self.ksa_admin,
            self.cu_moderator,
            self.cu_admin,
            self.cu_owner,
        ]
        for caller in callers:
            with self.subTest(caller=caller.username):
                with self.assertRaises(HTTPException) as denied:
                    auth.require_global_admin_user(caller)
                self.assertEqual(denied.exception.status_code, 403)
        with self.assertRaises(HTTPException) as unauthenticated:
            auth.require_global_admin_user(None)
        self.assertEqual(unauthenticated.exception.status_code, 403)

    def test_role_change_request_rejects_blank_reasons_and_extra_fields(self):
        with self.assertRaises(ValidationError):
            KsaModeratorRoleChangeRequest(reason="")
        with self.assertRaises(ValidationError):
            KsaModeratorRoleChangeRequest(reason=" \t")
        with self.assertRaises(ValidationError):
            KsaModeratorRoleChangeRequest(reason="Assign", unexpected=True)

    def test_router_promotes_existing_member_and_records_one_audit(self):
        result = promote_ksa_moderator(
            self.member.id,
            KsaModeratorRoleChangeRequest(reason="  Assigned as KSA cohort moderator. "),
            self.db,
            self.admin,
        )

        self.assertEqual(result["status"], "promoted")
        self.assertEqual(result["previous_role"], "member")
        self.assertEqual(result["new_role"], "moderator")
        membership = self.membership(self.member)
        self.assertEqual(membership.role, "moderator")
        audit = self.audit_events()
        self.assertEqual(len(audit), 1)
        self.assertEqual(audit[0].learning_space_id, self.ksa.id)
        self.assertEqual(audit[0].target_user_id, self.member.id)
        self.assertEqual(audit[0].membership_id, membership.id)
        self.assertEqual(audit[0].performed_by_user_id, self.admin.id)
        self.assertEqual(audit[0].previous_role, "member")
        self.assertEqual(audit[0].new_role, "moderator")
        self.assertEqual(audit[0].reason, "Assigned as KSA cohort moderator.")
        self.assertIsNotNone(audit[0].created_at)

    def test_promotion_requires_active_ksa_member_without_implicit_membership(self):
        for target in (self.no_ksa, self.inactive_membership, self.released, self.inactive_account):
            with self.subTest(target=target.username):
                with self.assertRaises(HTTPException) as error:
                    promote_ksa_member_to_moderator(
                        self.db,
                        target_user_id=target.id,
                        performed_by=self.admin,
                        reason="Assigned as moderator.",
                    )
                self.assertEqual(error.exception.status_code, 409)
        with self.assertRaises(HTTPException) as missing:
            promote_ksa_member_to_moderator(
                self.db,
                target_user_id=9999,
                performed_by=self.admin,
                reason="Assigned as moderator.",
            )
        self.assertEqual(missing.exception.status_code, 404)
        self.assertEqual(self.db.query(models.LearningSpaceMembership).filter_by(user_id=self.no_ksa.id).count(), 1)

    def test_promotion_rejects_owner_admin_and_already_moderator(self):
        for target in (self.ksa_owner, self.ksa_admin, self.already_moderator):
            with self.subTest(target=target.username):
                with self.assertRaises(HTTPException) as error:
                    promote_ksa_member_to_moderator(
                        self.db,
                        target_user_id=target.id,
                        performed_by=self.admin,
                        reason="Attempted transition.",
                    )
                self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.db.query(models.LearningSpaceRoleAudit).count(), 0)
        self.assertEqual(self.membership(self.already_moderator).role, "moderator")

    def test_promotion_audit_failure_rolls_back_role_change(self):
        with patch("learning_space_roles.record_role_audit", side_effect=RuntimeError("audit unavailable")):
            with self.assertRaises(HTTPException) as error:
                promote_ksa_member_to_moderator(
                    self.db,
                    target_user_id=self.member.id,
                    performed_by=self.admin,
                    reason="Assigned as moderator.",
                )
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.membership(self.member).role, "member")
        self.assertEqual(self.db.query(models.LearningSpaceRoleAudit).count(), 0)

    def test_self_promotion_is_rejected_without_mutation(self):
        self.db.add(models.LearningSpaceMembership(
            id=115,
            user_id=self.admin.id,
            learning_space_id=self.ksa.id,
            external_member_id="KSA-15",
            role="member",
            status="active",
        ))
        self.db.commit()
        with self.assertRaises(HTTPException) as error:
            promote_ksa_member_to_moderator(
                self.db,
                target_user_id=self.admin.id,
                performed_by=self.admin,
                reason="Self assignment.",
            )
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.membership(self.admin).role, "member")
        self.assertEqual(self.db.query(models.LearningSpaceRoleAudit).count(), 0)

    def test_multi_space_promotion_changes_only_ksa_and_grants_ksa_moderation(self):
        cu_membership = self.db.query(models.LearningSpaceMembership).filter_by(
            user_id=self.multi_space.id,
            learning_space_id=self.cu.id,
        ).one()

        promote_ksa_member_to_moderator(
            self.db,
            target_user_id=self.multi_space.id,
            performed_by=self.admin,
            reason="Assigned to moderate KSA contributions.",
        )

        self.assertEqual(self.membership(self.multi_space).role, "moderator")
        self.assertEqual(cu_membership.role, "member")
        self.assertEqual(cu_membership.status, "active")
        self.assertTrue(is_moderator(self.db, self.multi_space, self.ksa.id))
        self.assertFalse(is_moderator(self.db, self.multi_space, self.cu.id))

    def test_demotion_requires_moderator_and_records_one_transition_audit(self):
        result = demote_ksa_moderator(
            self.already_moderator.id,
            KsaModeratorRoleChangeRequest(reason="Moderator responsibilities ended."),
            self.db,
            self.admin,
        )

        self.assertEqual(result["status"], "demoted")
        self.assertEqual(self.membership(self.already_moderator).role, "member")
        audit = self.audit_events()
        self.assertEqual(len(audit), 1)
        self.assertEqual(audit[0].previous_role, "moderator")
        self.assertEqual(audit[0].new_role, "member")
        self.assertEqual(audit[0].reason, "Moderator responsibilities ended.")

    def test_demotion_rejects_member_and_blank_reason_without_duplicate_audit(self):
        with self.assertRaises(ValidationError):
            KsaModeratorRoleChangeRequest(reason=" ")
        with self.assertRaises(HTTPException) as error:
            demote_ksa_moderator_to_member(
                self.db,
                target_user_id=self.member.id,
                performed_by=self.admin,
                reason="No longer assigned.",
            )
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.db.query(models.LearningSpaceRoleAudit).count(), 0)

    def test_demotion_audit_failure_rolls_back_role_change(self):
        with patch("learning_space_roles.record_role_audit", side_effect=RuntimeError("audit unavailable")):
            with self.assertRaises(HTTPException) as error:
                demote_ksa_moderator_to_member(
                    self.db,
                    target_user_id=self.already_moderator.id,
                    performed_by=self.admin,
                    reason="Moderator responsibilities ended.",
                )
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.membership(self.already_moderator).role, "moderator")
        self.assertEqual(self.db.query(models.LearningSpaceRoleAudit).count(), 0)

    def test_self_demotion_is_rejected(self):
        self.db.add(models.LearningSpaceMembership(
            id=116,
            user_id=self.admin.id,
            learning_space_id=self.ksa.id,
            external_member_id="KSA-16",
            role="moderator",
            status="active",
        ))
        self.db.commit()
        with self.assertRaises(HTTPException) as error:
            demote_ksa_moderator_to_member(
                self.db,
                target_user_id=self.admin.id,
                performed_by=self.admin,
                reason="Self demotion.",
            )
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.membership(self.admin).role, "moderator")
        self.assertEqual(self.db.query(models.LearningSpaceRoleAudit).count(), 0)

    def test_demotion_preserves_claim_memberships_resources_progress_and_learning_access(self):
        self.multi_space.active_learning_space_id = self.ksa.id
        promote_ksa_member_to_moderator(
            self.db,
            target_user_id=self.multi_space.id,
            performed_by=self.admin,
            reason="Assigned to moderate KSA contributions.",
        )
        course = models.Course(id=1, code="KSA-101", name="Prospecting")
        topic = models.Topic(id=1, course_id=course.id, name="Qualification")
        note = models.LectureNote(
            id=201,
            course_id=course.id,
            uploaded_by=self.multi_space.id,
            title="Prospecting notes",
            content_text="Qualification evidence",
            file_data=b"notes",
            file_name="notes.pdf",
            file_mime="application/pdf",
        )
        progress = models.StudentProgress(id=202, student_id=self.multi_space.id, topic_id=topic.id, mastery_score=64)
        attempt = models.PracticeAttempt(id=203, user_id=self.multi_space.id, course_id=course.id, topic="Qualification", score=3, total_questions=4)
        self.db.add(course)
        self.db.flush()
        self.db.add(topic)
        self.db.flush()
        self.db.add_all([note, progress, attempt])
        self.db.commit()
        claim = self.db.query(models.KsaMember).filter_by(claimed_by_user_id=self.multi_space.id).one()
        ksa_membership = self.membership(self.multi_space)
        cu_membership = self.db.query(models.LearningSpaceMembership).filter_by(
            user_id=self.multi_space.id,
            learning_space_id=self.cu.id,
        ).one()

        demote_ksa_moderator_to_member(
            self.db,
            target_user_id=self.multi_space.id,
            performed_by=self.admin,
            reason="Moderator responsibilities ended.",
        )

        self.assertEqual(ksa_membership.role, "member")
        self.assertEqual(ksa_membership.status, "active")
        self.assertEqual(ksa_membership.external_member_id, "KSA-10")
        self.assertEqual(self.multi_space.active_learning_space_id, self.ksa.id)
        self.assertEqual(cu_membership.role, "member")
        self.assertEqual(cu_membership.status, "active")
        self.assertEqual(claim.status, "active")
        self.assertEqual(claim.claimed_by_user_id, self.multi_space.id)
        self.assertEqual(self.db.query(models.LectureNote).one().file_data, b"notes")
        self.assertEqual(self.db.query(models.StudentProgress).one().mastery_score, 64)
        self.assertEqual(self.db.query(models.PracticeAttempt).one().score, 3)
        self.assertFalse(is_moderator(self.db, self.multi_space, self.ksa.id))

    def test_demoted_user_retains_normal_ksa_membership_access(self):
        demote_ksa_moderator_to_member(
            self.db,
            target_user_id=self.already_moderator.id,
            performed_by=self.admin,
            reason="Moderator responsibilities ended.",
        )
        membership = self.membership(self.already_moderator)
        self.assertEqual(membership.status, "active")
        self.assertEqual(membership.role, "member")
        self.assertFalse(is_moderator(self.db, self.already_moderator, self.ksa.id))

    def test_moderators_cannot_use_global_claim_or_role_management_authority(self):
        with self.assertRaises(HTTPException) as claim_access:
            auth.require_global_admin_user(self.ksa_moderator)
        self.assertEqual(claim_access.exception.status_code, 403)
        with self.assertRaises(HTTPException) as cu_admin_access:
            auth.require_global_admin_user(self.cu_admin)
        self.assertEqual(cu_admin_access.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
