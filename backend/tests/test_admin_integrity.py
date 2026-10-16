"""Verify the admin email gate on operations beyond the portal UI."""

import os
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

import auth
import models
from material_access import accessible_material_filter, can_view_material, is_moderator, require_material_owner
from routers import ingest


class AdminIntegrityTests(unittest.TestCase):
    def setUp(self):
        config = patch.dict(os.environ, {"ADMIN_PORTAL_EMAILS": " ADMIN@EXAMPLE.COM "})
        config.start()
        self.addCleanup(config.stop)
        self.approved = SimpleNamespace(id=9, role="admin", email="admin@example.com")
        self.denied = SimpleNamespace(id=10, role="admin", email="unregistered@example.com")
        self.row = SimpleNamespace(id=41, uploaded_by=7, visibility="private")

    def test_role_alone_cannot_read_or_manage_another_users_private_material(self):
        db = MagicMock()
        self.assertFalse(can_view_material(db, self.row, self.denied))
        with self.assertRaises(HTTPException) as error:
            require_material_owner(self.row, self.denied)
        self.assertEqual(error.exception.status_code, 403)
        self.assertNotEqual(str(accessible_material_filter(db, models.LectureNote, self.denied)), "true")

    def test_role_alone_cannot_moderate_across_spaces(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None
        self.assertFalse(is_moderator(db, self.denied, learning_space_id=123))
        self.assertFalse(is_moderator(db, self.denied))

    def test_role_alone_cannot_execute_destructive_upload_operations(self):
        for action in ("clear", "delete"):
            with self.subTest(action=action):
                db = MagicMock()
                with self.assertRaises(HTTPException) as error:
                    if action == "clear":
                        ingest.clear_uploaded_materials(False, db, self.denied)
                    else:
                        ingest.delete_uploaded_document(
                            ingest.DeleteDocumentRequest(document_type="lecture_note", document_id=41),
                            db, self.denied,
                        )
                self.assertEqual(error.exception.status_code, 403)
                db.query.assert_not_called()
                db.commit.assert_not_called()

    def test_registered_global_admin_keeps_existing_management_access(self):
        db = MagicMock()
        self.assertIs(auth.require_global_admin_user(self.approved), self.approved)
        self.assertTrue(is_moderator(db, self.approved, learning_space_id=123))
        self.assertTrue(can_view_material(db, self.row, self.approved))
        self.assertEqual(str(accessible_material_filter(db, models.LectureNote, self.approved)), "true")
        require_material_owner(self.row, self.approved)
        db.query.assert_not_called()

    def test_registered_admin_can_use_student_actions_without_a_second_identity(self):
        self.assertIs(auth.require_role("student")(self.approved), self.approved)
        student = SimpleNamespace(id=11, role="student", email="student@example.com")
        self.assertIs(auth.require_role("student")(student), student)
        for denied in (self.denied, SimpleNamespace(role="moderator", email="admin@example.com")):
            with self.assertRaises(HTTPException) as error:
                auth.require_role("student")(denied)
            self.assertEqual(error.exception.status_code, 403)

    def test_missing_allowlist_denies_global_overrides_but_preserves_owner_access(self):
        with patch.dict(os.environ, {"ADMIN_PORTAL_EMAILS": ""}):
            self.assertFalse(is_moderator(MagicMock(), self.approved))
            self.assertFalse(can_view_material(MagicMock(), self.row, self.approved))
            owned = SimpleNamespace(id=42, uploaded_by=self.approved.id, visibility="private")
            self.assertTrue(can_view_material(MagicMock(), owned, self.approved))
            require_material_owner(owned, self.approved)
