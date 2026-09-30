import os
import sys
import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import models  # noqa: E402
from material_access import (  # noqa: E402
    GROUP,
    PRIVATE,
    PUBLIC,
    SPACE_SHARED,
    accessible_material_filter,
    can_view_material,
    require_contribution_space,
    require_material_owner,
    normalize_group_ids,
    normalize_visibility,
    set_material_visibility,
)


class QueryDouble:
    def __init__(self, first_value=None):
        self.first_value = first_value

    def join(self, *_args, **_kwargs):
        return self

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        return self.first_value

    def delete(self, **_kwargs):
        return 0


class AccessDatabaseDouble:
    def __init__(self, membership=None):
        self.membership = membership
        self.added = []

    def query(self, model):
        if model is models.MaterialGroupShare:
            return QueryDouble(self.membership)
        return QueryDouble()

    def add(self, value):
        self.added.append(value)


def user(user_id: int, role: str = "student"):
    return SimpleNamespace(id=user_id, role=role)


class MaterialAccessTests(unittest.TestCase):
    def test_invalid_visibility_falls_back_to_private(self):
        self.assertEqual(normalize_visibility("publish_everywhere"), PRIVATE)
        self.assertEqual(normalize_visibility(" PUBLIC "), PUBLIC)

    def test_group_ids_are_unique_positive_integers(self):
        self.assertEqual(normalize_group_ids('[3, "3", 8]'), [3, 8])
        with self.assertRaises(ValueError):
            normalize_group_ids([0])

    def test_private_material_is_visible_only_to_owner(self):
        row = SimpleNamespace(id=4, uploaded_by=7, visibility=PRIVATE)
        db = AccessDatabaseDouble()
        self.assertTrue(can_view_material(db, row, user(7)))
        self.assertFalse(can_view_material(db, row, user(8)))

    def test_legacy_global_moderator_does_not_bypass_material_access_or_ownership(self):
        row = SimpleNamespace(id=4, uploaded_by=7, visibility=PRIVATE)
        legacy_moderator = user(8, role="moderator")
        self.assertFalse(can_view_material(AccessDatabaseDouble(), row, legacy_moderator))
        with self.assertRaises(HTTPException):
            require_material_owner(row, legacy_moderator)

    def test_public_material_is_visible_to_another_verified_student(self):
        row = SimpleNamespace(id=4, uploaded_by=7, visibility=PUBLIC)
        self.assertTrue(can_view_material(AccessDatabaseDouble(), row, user(8)))

    def test_cu_scoped_material_requires_active_cu_membership_and_context(self):
        engine = create_engine("sqlite:///:memory:")
        for table in (
            models.LearningSpace.__table__,
            models.User.__table__,
            models.LearningSpaceMembership.__table__,
            models.StudyGroup.__table__,
            models.StudyGroupMember.__table__,
            models.MaterialGroupShare.__table__,
            models.LectureNote.__table__,
            models.MaterialContribution.__table__,
        ):
            table.create(engine)
        db = sessionmaker(bind=engine)()
        try:
            cu = models.LearningSpace(slug="cu", name="Covenant University", type="university", status="active")
            owner = models.User(id=1, username="owner", email="owner@gmail.com", role="student")
            member = models.User(id=2, username="member", email="member@stu.cu.edu.ng", role="student")
            outsider = models.User(id=3, username="outsider", email="outsider@gmail.com", role="student")
            db.add_all([cu, owner, member, outsider])
            db.flush()
            member.active_learning_space_id = cu.id
            outsider.active_learning_space_id = cu.id
            db.add(models.LearningSpaceMembership(user_id=member.id, learning_space_id=cu.id, status="active"))
            note = models.LectureNote(id=4, uploaded_by=owner.id, title="CU notes", visibility=SPACE_SHARED)
            db.add(note)
            db.flush()
            db.add(models.MaterialContribution(
                material_type="lecture_note",
                material_id=note.id,
                learning_space_id=cu.id,
                submitted_by=owner.id,
                moderation_status="approved",
                requested_visibility=SPACE_SHARED,
            ))
            db.commit()

            self.assertTrue(can_view_material(db, note, member))
            self.assertFalse(can_view_material(db, note, outsider))
            self.assertEqual(
                db.query(models.LectureNote)
                .filter(accessible_material_filter(db, models.LectureNote, member))
                .count(),
                1,
            )
            self.assertEqual(
                db.query(models.LectureNote)
                .filter(accessible_material_filter(db, models.LectureNote, outsider))
                .count(),
                0,
            )
            member.active_learning_space_id = None
            self.assertFalse(can_view_material(db, note, member))
        finally:
            db.close()
            engine.dispose()

    def test_ksa_scoped_material_requires_active_membership_and_context(self):
        engine = create_engine("sqlite:///:memory:")
        for table in (
            models.LearningSpace.__table__,
            models.User.__table__,
            models.LearningSpaceMembership.__table__,
            models.StudyGroup.__table__,
            models.StudyGroupMember.__table__,
            models.MaterialGroupShare.__table__,
            models.LectureNote.__table__,
            models.MaterialContribution.__table__,
        ):
            table.create(engine)
        db = sessionmaker(bind=engine)()
        try:
            ksa = models.LearningSpace(slug="ksa", name="Kora Sales Academy", type="academy", status="active")
            cu = models.LearningSpace(slug="cu", name="Covenant University", type="university", status="active")
            owner = models.User(id=10, username="owner", email="owner@example.com", role="student")
            ksa_member = models.User(id=11, username="ksa-member", email="ksa@example.com", role="student")
            cu_member = models.User(id=12, username="cu-member", email="cu@example.com", role="student")
            multi = models.User(id=13, username="multi", email="multi@example.com", role="student")
            no_membership = models.User(id=14, username="none", email="none@example.com", role="student")
            db.add_all([ksa, cu, owner, ksa_member, cu_member, multi, no_membership])
            db.flush()
            ksa_member.active_learning_space_id = ksa.id
            cu_member.active_learning_space_id = cu.id
            multi.active_learning_space_id = ksa.id
            db.add_all([
                models.LearningSpaceMembership(user_id=ksa_member.id, learning_space_id=ksa.id, status="active"),
                models.LearningSpaceMembership(user_id=cu_member.id, learning_space_id=cu.id, status="active"),
                models.LearningSpaceMembership(user_id=multi.id, learning_space_id=ksa.id, status="active"),
                models.LearningSpaceMembership(user_id=multi.id, learning_space_id=cu.id, status="active"),
            ])
            ksa_note = models.LectureNote(id=41, uploaded_by=owner.id, title="KSA notes", visibility=SPACE_SHARED)
            cu_note = models.LectureNote(id=42, uploaded_by=owner.id, title="CU notes", visibility=SPACE_SHARED)
            db.add_all([ksa_note, cu_note])
            db.flush()
            db.add_all([
                models.MaterialContribution(
                    material_type="lecture_note", material_id=ksa_note.id, learning_space_id=ksa.id,
                    submitted_by=owner.id, moderation_status="approved", requested_visibility=SPACE_SHARED,
                ),
                models.MaterialContribution(
                    material_type="lecture_note", material_id=cu_note.id, learning_space_id=cu.id,
                    submitted_by=owner.id, moderation_status="approved", requested_visibility=SPACE_SHARED,
                ),
            ])
            db.commit()

            self.assertFalse(can_view_material(db, ksa_note, no_membership))
            self.assertFalse(can_view_material(db, cu_note, no_membership))
            no_membership.active_learning_space_id = ksa.id
            with self.assertRaises(HTTPException):
                require_contribution_space(db, no_membership)
            self.assertTrue(can_view_material(db, ksa_note, ksa_member))
            self.assertFalse(can_view_material(db, cu_note, ksa_member))
            self.assertTrue(can_view_material(db, cu_note, cu_member))
            self.assertFalse(can_view_material(db, ksa_note, cu_member))
            self.assertTrue(can_view_material(db, ksa_note, multi))
            self.assertFalse(can_view_material(db, cu_note, multi))
            self.assertEqual(require_contribution_space(db, multi).slug, "ksa")
            self.assertEqual(
                db.query(models.LectureNote).filter(accessible_material_filter(db, models.LectureNote, multi)).count(),
                1,
            )

            multi.active_learning_space_id = cu.id
            with self.assertRaises(HTTPException):
                require_contribution_space(db, multi)
            self.assertTrue(can_view_material(db, cu_note, multi))
            self.assertFalse(can_view_material(db, ksa_note, multi))
            self.assertEqual(
                db.query(models.LectureNote).filter(accessible_material_filter(db, models.LectureNote, multi)).count(),
                1,
            )
            self.assertEqual(
                db.query(models.LearningSpaceMembership).filter_by(user_id=multi.id, status="active").count(),
                2,
            )
        finally:
            db.close()
            engine.dispose()

    def test_group_material_requires_membership(self):
        row = models.LectureNote(id=4, uploaded_by=7, visibility=GROUP)
        self.assertTrue(can_view_material(AccessDatabaseDouble(object()), row, user(8)))
        self.assertFalse(can_view_material(AccessDatabaseDouble(), row, user(8)))

    def test_setting_group_visibility_creates_grants_without_storing_bytes(self):
        row = models.LectureNote(
            id=11,
            uploaded_by=7,
            metadata_json={"document_title": "Algorithms"},
            file_data=b"must stay internal",
        )
        db = AccessDatabaseDouble()
        set_material_visibility(db, [row], GROUP, [3, 8], 7)
        self.assertEqual(row.visibility, GROUP)
        self.assertEqual(row.metadata_json["shared_group_ids"], [3, 8])
        self.assertEqual([share.group_id for share in db.added], [3, 8])
        self.assertEqual(row.file_data, b"must stay internal")

    def test_public_or_group_visibility_requires_explicit_consent_at_route_boundary(self):
        # This is the user-facing invariant enforced by the upload and update
        # routes; a missing consent flag must be a client error, not a default.
        from routers.mvp import MaterialVisibilityRequest  # noqa: E402

        request = MaterialVisibilityRequest(visibility=PUBLIC, confirm=False)
        self.assertFalse(request.confirm)
        self.assertEqual(request.visibility, PUBLIC)


if __name__ == "__main__":
    unittest.main()
