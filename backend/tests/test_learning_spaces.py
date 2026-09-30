import os
import sys
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("ALLOWED_SCHOOL_EMAIL_DOMAINS", "stu.cu.edu.ng,covenantuniversity.edu.ng")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import models  # noqa: E402
from learning_spaces import (  # noqa: E402
    CLAIM_FAILURE_MESSAGE,
    KSA_ALREADY_CONFIGURED_MESSAGE,
    KSA_SLUG,
    activate_space,
    claim_ksa_member,
    import_ksa_members,
    list_spaces,
    mark_ksa_onboarding_complete,
    normalize_ksa_id,
    require_cu_membership,
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

    def test_format_validation_and_normalization_are_separate_from_claim_authorization(self) -> None:
        self.assertEqual(normalize_ksa_id("  ksa-36 "), "KSA-36")
        self.assertEqual(normalize_ksa_id("KSA-00"), "KSA-00")
        for invalid in ("KSA-1", "KSA-001", "KSA78", "KSA-ABC", "KSA-100", "ABC-78", "KSA-"):
            with self.assertRaises(ValueError, msg=invalid):
                normalize_ksa_id(invalid)

    def test_unused_id_is_claimable_without_an_imported_registry_row(self) -> None:
        result = claim_ksa_member(self.session, self.user, "KSA-01")

        self.assertEqual(result["space"]["slug"], KSA_SLUG)
        self.assertTrue(result["onboarding_required"])
        member = self.session.query(models.KsaMember).one()
        self.assertEqual(member.ksa_id, "KSA-01")
        self.assertEqual(member.claimed_by_user_id, self.user.id)
        self.assertEqual(self.session.query(models.LearningSpaceMembership).filter_by(user_id=self.user.id).count(), 2)

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
        self.assertEqual(
            self.session.query(models.LearningSpaceMembership)
            .filter_by(user_id=self.user.id, learning_space_id=self.session.query(models.LearningSpace).filter_by(slug="cu").one().id)
            .count(),
            1,
        )

    def test_valid_claims_support_two_digit_values_and_repeat_is_idempotent(self) -> None:
        first = claim_ksa_member(self.session, self.user, "ksa-78")
        second = claim_ksa_member(self.session, self.user, " KSA-78 ")

        self.assertTrue(first["onboarding_required"])
        self.assertEqual(second["space"]["membership"]["external_member_id"], "KSA-78")
        self.assertEqual(self.session.query(models.KsaMember).count(), 1)
        self.assertEqual(
            self.session.query(models.LearningSpaceMembership)
            .filter_by(user_id=self.user.id, learning_space_id=first["space"]["id"])
            .count(),
            1,
        )

    def test_one_user_cannot_claim_a_different_ksa_id(self) -> None:
        claim_ksa_member(self.session, self.user, "KSA-12")

        with self.assertRaises(HTTPException) as error:
            claim_ksa_member(self.session, self.user, "KSA-13")
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(error.exception.detail, KSA_ALREADY_CONFIGURED_MESSAGE)
        self.assertEqual(self.session.query(models.KsaMember).one().ksa_id, "KSA-12")

    def test_two_users_cannot_claim_the_same_id(self) -> None:
        claim_ksa_member(self.session, self.user, "KSA-78")
        other = models.User(id=8, name="Another student", username="another_student", email="other@example.com", role="student")
        self.session.add(other)
        self.session.commit()

        with self.assertRaises(HTTPException) as error:
            claim_ksa_member(self.session, other, "KSA-78")
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(error.exception.detail, CLAIM_FAILURE_MESSAGE)
        self.assertNotIn(str(self.user.id), str(error.exception.detail))

    def test_claim_table_database_constraints_backstop_duplicate_claims(self) -> None:
        claim_ksa_member(self.session, self.user, "KSA-01")
        other = models.User(id=8, name="Another student", username="another_student", email="other@example.com", role="student")
        self.session.add(other)
        self.session.commit()

        self.session.add(models.KsaMember(ksa_id="KSA-01", claimed_by_user_id=other.id, status="active"))
        with self.assertRaises(IntegrityError):
            self.session.commit()
        self.session.rollback()

        self.session.add(models.KsaMember(ksa_id="KSA-02", claimed_by_user_id=self.user.id, status="active"))
        with self.assertRaises(IntegrityError):
            self.session.commit()
        self.session.rollback()

    def test_non_cu_identity_can_claim_ksa_without_cu_membership(self) -> None:
        non_cu = models.User(
            id=9,
            name="Global Student",
            username="global_student_ksa",
            email="global.ksa@gmail.com",
            firebase_uid="firebase-ksa-9",
            role="student",
        )
        self.session.add(non_cu)
        self.session.commit()

        result = claim_ksa_member(self.session, non_cu, "KSA-36")

        self.assertEqual(result["space"]["slug"], KSA_SLUG)
        self.assertEqual(non_cu.active_learning_space_id, result["space"]["id"])
        self.assertEqual(
            self.session.query(models.LearningSpaceMembership)
            .join(models.LearningSpace)
            .filter(models.LearningSpaceMembership.user_id == non_cu.id, models.LearningSpace.slug == "cu")
            .count(),
            0,
        )

    def test_returning_member_state_and_existing_onboarding_remain_available(self) -> None:
        claim_ksa_member(self.session, self.user, "KSA-36")
        spaces = list_spaces(self.session, self.user)
        ksa = next(item["space"] for item in spaces["memberships"] if item["space"]["slug"] == KSA_SLUG)
        self.assertEqual(ksa["membership"]["external_member_id"], "KSA-36")
        self.assertTrue(ksa["membership"]["onboarding_required"])

        completed = mark_ksa_onboarding_complete(self.session, self.user, {"learning_goals": ["prospecting"]})
        self.assertFalse(completed["onboarding_required"])
        repeat = claim_ksa_member(self.session, self.user, "KSA-36")
        self.assertFalse(repeat["onboarding_required"])

    def test_claimed_id_does_not_disclose_the_other_account(self) -> None:
        import_ksa_members(self.session, [{"ksa_id": "KSA-36"}])
        first = self.user
        claim_ksa_member(self.session, first, "KSA-36")
        second = models.User(id=8, name="Another student", username="another_student", email="other@stu.cu.edu.ng", role="student")
        self.session.add(second)
        self.session.commit()

        with self.assertRaises(HTTPException) as error:
            claim_ksa_member(self.session, second, "KSA-36")
        self.assertEqual(error.exception.status_code, 409)
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

    def test_eligible_cu_identity_receives_membership_at_explicit_space_entry(self) -> None:
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

        self.assertEqual(
            self.session.query(models.LearningSpaceMembership).filter_by(user_id=new_cu_user.id).count(),
            0,
        )
        payload = list_spaces(self.session, new_cu_user)
        self.assertEqual(payload["active_space"]["slug"], "cu")
        self.assertEqual({entry["space"]["slug"] for entry in payload["memberships"]}, {"cu"})
        self.assertEqual(
            self.session.query(models.LearningSpaceMembership).filter_by(user_id=new_cu_user.id).count(),
            1,
        )

    def test_non_cu_identity_cannot_activate_cu(self) -> None:
        non_cu = models.User(
            id=11,
            name="Global Student",
            username="global_student_two",
            email="global.two@gmail.com",
            firebase_uid="firebase-11",
            role="student",
        )
        self.session.add(non_cu)
        self.session.commit()

        with self.assertRaises(HTTPException) as error:
            activate_space(self.session, non_cu, "cu")
        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual(
            self.session.query(models.LearningSpaceMembership).filter_by(user_id=non_cu.id).count(),
            0,
        )

    def test_invalid_cu_pointer_is_cleared_and_cannot_authorize(self) -> None:
        non_cu = models.User(
            id=12,
            name="Tampered Student",
            username="tampered_student",
            email="tampered@gmail.com",
            firebase_uid="firebase-12",
            role="student",
            active_learning_space_id=2,
        )
        self.session.add(non_cu)
        self.session.commit()

        with self.assertRaises(HTTPException):
            require_cu_membership(self.session, non_cu)
        payload = list_spaces(self.session, non_cu)
        self.assertIsNone(payload["active_space"])
        self.assertIsNone(non_cu.active_learning_space_id)

    def test_multiple_memberships_remain_compatible_with_cu_authorization(self) -> None:
        ksa = self.session.query(models.LearningSpace).filter_by(slug=KSA_SLUG).one()
        cu = self.session.query(models.LearningSpace).filter_by(slug="cu").one()
        self.session.add(models.LearningSpaceMembership(
            user_id=self.user.id,
            learning_space_id=ksa.id,
            status="active",
            onboarding_state="pending",
        ))
        self.session.commit()

        payload = list_spaces(self.session, self.user)
        self.assertEqual({entry["space"]["slug"] for entry in payload["memberships"]}, {"cu", KSA_SLUG})
        activate_space(self.session, self.user, KSA_SLUG)
        self.assertEqual(
            self.session.query(models.LearningSpaceMembership)
            .filter_by(user_id=self.user.id, learning_space_id=cu.id)
            .count(),
            1,
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
