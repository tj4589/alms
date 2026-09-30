import os
import sys
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("ALLOWED_SCHOOL_EMAIL_DOMAINS", "stu.cu.edu.ng,covenantuniversity.edu.ng")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import models  # noqa: E402
from learning_spaces import (  # noqa: E402
    CLAIM_FAILURE_MESSAGE,
    KSA_SLUG,
    claim_ksa_member,
    import_ksa_members,
    list_spaces,
    normalize_ksa_id,
    seed_learning_spaces,
)


class LearningSpaceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        for table in (
            models.LearningSpace.__table__,
            models.User.__table__,
            models.LearningSpaceMembership.__table__,
            models.KsaMember.__table__,
        ):
            table.create(self.engine)
        self.session = sessionmaker(bind=self.engine)()
        self.user = models.User(
            id=7,
            name="A student",
            username="a_student",
            email="student@stu.cu.edu.ng",
            firebase_uid="firebase-7",
            role="student",
        )
        self.session.add(self.user)
        self.session.commit()
        seed_learning_spaces(self.session, backfill_users=True)

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()

    def test_format_validation_is_not_authorization(self) -> None:
        self.assertEqual(normalize_ksa_id("  ksa-36 "), "KSA-36")
        self.assertEqual(normalize_ksa_id("KSA-999"), "KSA-999")

        with self.assertRaises(HTTPException) as error:
            claim_ksa_member(self.session, self.user, "KSA-36")
        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual(error.exception.detail, CLAIM_FAILURE_MESSAGE)

    def test_imported_active_member_can_be_claimed_once(self) -> None:
        self.assertEqual(import_ksa_members(self.session, [{"ksa_id": "ksa-36", "cohort": "2026", "status": "active"}]), 1)
        result = claim_ksa_member(self.session, self.user, " KSA-36 ")

        self.assertEqual(result["space"]["slug"], KSA_SLUG)
        self.assertTrue(result["onboarding_required"])
        member = self.session.query(models.KsaMember).one()
        membership = self.session.query(models.LearningSpaceMembership).filter_by(user_id=self.user.id).filter_by(external_member_id="KSA-36").one()
        self.assertEqual(member.claimed_by_user_id, self.user.id)
        self.assertEqual(membership.status, "active")
        self.assertEqual(self.user.active_learning_space_id, membership.learning_space_id)

    def test_claimed_id_does_not_disclose_the_other_account(self) -> None:
        import_ksa_members(self.session, [{"ksa_id": "KSA-36"}])
        first = self.user
        claim_ksa_member(self.session, first, "KSA-36")
        second = models.User(id=8, name="Another student", username="another_student", email="other@stu.cu.edu.ng", role="student")
        self.session.add(second)
        self.session.commit()

        with self.assertRaises(HTTPException) as error:
            claim_ksa_member(self.session, second, "KSA-36")
        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual(error.exception.detail, CLAIM_FAILURE_MESSAGE)
        self.assertNotIn("7", str(error.exception.detail))

    def test_space_listing_exposes_membership_without_registry_rows(self) -> None:
        import_ksa_members(self.session, [{"ksa_id": "KSA-36"}])
        payload = list_spaces(self.session, self.user)

        self.assertEqual({entry["space"]["slug"] for entry in payload["memberships"]}, {"cu"})
        self.assertEqual({space["slug"] for space in payload["available_spaces"]}, {"ksa"})
        self.assertNotIn("ksa_member_registry", str(payload))

    def test_non_cu_identity_receives_no_space_membership(self) -> None:
        non_cu = models.User(
            id=9,
            name="Global Student",
            username="global_student",
            email="global.student@gmail.com",
            firebase_uid="firebase-9",
            role="student",
        )
        self.session.add(non_cu)
        self.session.commit()

        seed_learning_spaces(self.session, backfill_users=True)
        self.assertIsNone(
            self.session.query(models.LearningSpaceMembership)
            .filter_by(user_id=non_cu.id)
            .first()
        )

        payload = list_spaces(self.session, non_cu)
        self.assertIsNone(payload["active_space"])
        self.assertEqual(payload["memberships"], [])
        self.assertEqual({space["slug"] for space in payload["available_spaces"]}, {"cu", "ksa"})

    def test_unbackfilled_cu_identity_is_not_lazily_granted_membership(self) -> None:
        new_cu_user = models.User(
            id=10,
            name="New CU Student",
            username="new_cu_student",
            email="new.student@stu.cu.edu.ng",
            firebase_uid="firebase-10",
            role="student",
        )
        self.session.add(new_cu_user)
        self.session.commit()

        payload = list_spaces(self.session, new_cu_user)
        self.assertIsNone(payload["active_space"])
        self.assertEqual(payload["memberships"], [])
        self.assertIsNone(
            self.session.query(models.LearningSpaceMembership)
            .filter_by(user_id=new_cu_user.id)
            .first()
        )

    def test_cu_backfill_is_idempotent(self) -> None:
        before = self.session.query(models.LearningSpaceMembership).filter_by(user_id=self.user.id).count()
        seed_learning_spaces(self.session, backfill_users=True)
        seed_learning_spaces(self.session, backfill_users=True)
        after = self.session.query(models.LearningSpaceMembership).filter_by(user_id=self.user.id).count()

        self.assertEqual(before, 1)
        self.assertEqual(after, before)


if __name__ == "__main__":
    unittest.main()
