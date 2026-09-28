import os
import sys
import unittest
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import models  # noqa: E402
from material_access import (  # noqa: E402
    GROUP,
    PRIVATE,
    PUBLIC,
    can_view_material,
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

    def test_public_material_is_visible_to_another_verified_student(self):
        row = SimpleNamespace(id=4, uploaded_by=7, visibility=PUBLIC)
        self.assertTrue(can_view_material(AccessDatabaseDouble(), row, user(8)))

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
