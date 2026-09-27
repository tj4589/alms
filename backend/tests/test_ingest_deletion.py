import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import HTTPException
from pydantic import ValidationError

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import auth  # noqa: E402
import models  # noqa: E402
from routers import ingest  # noqa: E402


class QueryDouble:
    def __init__(self, db, model):
        self.db = db
        self.model = model
        self.rows = list(db.rows.get(model, []))

    def filter(self, *conditions):
        for condition in conditions:
            if not self.rows:
                break
            key = getattr(condition.left, "key", None)
            value = getattr(condition.right, "value", None)
            if key is not None:
                self.rows = [row for row in self.rows if getattr(row, key, None) == value]
        return self

    def first(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return list(self.rows)

    def delete(self, **_kwargs):
        for row in self.rows:
            self.db.delete(row)
        return len(self.rows)


class DatabaseDouble:
    def __init__(self, *material_rows):
        self.rows = {
            models.PastQuestion: [],
            models.LectureNote: [],
            models.LectureNoteChunk: [],
            models.DiscussionThread: [],
            models.ThreadMessage: [],
            models.Course: [],
        }
        self.deleted = []
        self.commits = 0
        self.rollbacks = 0
        for row in material_rows:
            model = models.PastQuestion if isinstance(row, models.PastQuestion) else models.LectureNote
            self.rows[model].append(row)

    def query(self, model):
        return QueryDouble(self, model)

    def delete(self, row):
        self.deleted.append(row)
        for rows in self.rows.values():
            if row in rows:
                rows.remove(row)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def user(user_id: int, role: str = "student"):
    return SimpleNamespace(id=user_id, role=role)


def note(note_id: int, owner_id: int, filename: str = "shared.pdf"):
    return models.LectureNote(
        id=note_id,
        uploaded_by=owner_id,
        metadata_json={"source_file": filename, "document_title": "Shared lecture note"},
        title="Shared lecture note",
    )


class IngestDeletionTests(unittest.TestCase):
    def test_user_can_delete_their_own_upload(self):
        owned = note(1, 7, "mine.pdf")
        other = note(2, 8, "theirs.pdf")
        db = DatabaseDouble(owned, other)

        response = ingest.delete_uploaded_document(
            ingest.DeleteDocumentRequest(document_type="lecture_note", source_file="mine.pdf"),
            db,
            user(7),
        )

        self.assertEqual(response["lecture_notes_deleted"], 1)
        self.assertEqual(db.rows[models.LectureNote], [other])
        self.assertEqual(db.commits, 1)

    def test_user_cannot_delete_another_users_upload_by_filename(self):
        target = note(1, 8, "private.pdf")
        db = DatabaseDouble(target)

        with self.assertRaises(HTTPException) as error:
            ingest.delete_uploaded_document(
                ingest.DeleteDocumentRequest(document_type="lecture_note", source_file="private.pdf"),
                db,
                user(7),
            )

        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(db.rows[models.LectureNote], [target])
        self.assertEqual(db.commits, 0)
        self.assertEqual(db.deleted, [])

    def test_unauthenticated_user_cannot_delete_an_upload(self):
        with self.assertRaises(HTTPException) as error:
            auth.get_current_user(token="", db=MagicMock())

        self.assertEqual(error.exception.status_code, 401)

    def test_normal_user_cannot_call_bulk_delete(self):
        target = note(1, 8)
        db = DatabaseDouble(target)

        with self.assertRaises(HTTPException) as error:
            ingest.clear_uploaded_materials(False, db, user(7))

        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual(db.rows[models.LectureNote], [target])
        self.assertEqual(db.commits, 0)
        self.assertEqual(db.deleted, [])

    def test_administrator_can_delete_a_material_by_document_id(self):
        target = note(1, 8)
        db = DatabaseDouble(target)

        response = ingest.delete_uploaded_document(
            ingest.DeleteDocumentRequest(document_type="lecture_note", document_id=1),
            db,
            user(99, "admin"),
        )

        self.assertEqual(response["lecture_notes_deleted"], 1)
        self.assertEqual(db.rows[models.LectureNote], [])
        self.assertEqual(db.commits, 1)

    def test_document_id_cannot_bypass_ownership(self):
        target = note(1, 8)
        db = DatabaseDouble(target)

        with self.assertRaises(HTTPException) as error:
            ingest.delete_uploaded_document(
                ingest.DeleteDocumentRequest(document_type="lecture_note", document_id=1),
                db,
                user(7),
            )

        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(db.rows[models.LectureNote], [target])
        self.assertEqual(db.deleted, [])

    def test_malformed_or_client_supplied_admin_input_is_rejected_without_mutation(self):
        with self.assertRaises(ValidationError):
            ingest.DeleteDocumentRequest(
                document_type="lecture_note",
                source_file="mine.pdf",
                is_admin=True,
            )
        with self.assertRaises(ValidationError):
            ingest.DeleteDocumentRequest(document_type="lecture_note", document_id=0)

        target = note(1, 8)
        db = DatabaseDouble(target)
        with self.assertRaises(HTTPException) as error:
            ingest.delete_uploaded_document(
                ingest.DeleteDocumentRequest(document_type="lecture_note", source_file="mine.pdf"),
                db,
                user(7),
            )

        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(db.rows[models.LectureNote], [target])
        self.assertEqual(db.deleted, [])

    def test_administrator_can_clear_materials(self):
        first = note(1, 7)
        second = note(2, 8, "other.pdf")
        db = DatabaseDouble(first, second)

        response = ingest.clear_uploaded_materials(False, db, user(99, "admin"))

        self.assertEqual(response["lecture_notes_deleted"], 2)
        self.assertEqual(db.rows[models.LectureNote], [])
        self.assertEqual(db.commits, 1)


if __name__ == "__main__":
    unittest.main()
