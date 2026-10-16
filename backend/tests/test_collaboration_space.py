"""Logical access tests; PostgreSQL migration behavior needs a disposable server."""
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import models
from collaboration_access import require_linked_material_space
from routers import collaboration_admin, community, mvp, sessions


class CollaborationSpaceTests(unittest.TestCase):
    def setUp(self):
        self.config = patch.dict(os.environ, {"ADMIN_PORTAL_EMAILS": "review@example.test"})
        self.config.start()
        self.addCleanup(self.config.stop)
        self.engine = create_engine("sqlite:///:memory:")
        models.Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.db.close)
        self.cu = models.LearningSpace(slug="cu", name="CU", type="university", status="active")
        self.ksa = models.LearningSpace(slug="ksa", name="KSA", type="academy", status="active")
        self.cu_user = models.User(username="cu_user", role="student", email="cu@example.test")
        self.ksa_user = models.User(username="ksa_user", role="student", email="ksa@example.test")
        self.admin = models.User(username="admin_review", role="admin", email="review@example.test")
        self.role_only = models.User(username="admin_role", role="admin", email="unlisted@example.test")
        self.db.add_all([self.cu, self.ksa, self.cu_user, self.ksa_user, self.admin, self.role_only])
        self.db.flush()
        for user, space in ((self.cu_user, self.cu), (self.ksa_user, self.ksa)):
            user.active_learning_space_id = space.id
            self.db.add(models.LearningSpaceMembership(user_id=user.id, learning_space_id=space.id,
                                                       role="member", status="active"))
        now = datetime.now(timezone.utc)
        self.group = models.StudyGroup(name="KSA practice", created_by=self.ksa_user.id,
                                       learning_space_id=self.ksa.id, status="active", visibility="public")
        self.legacy = models.StudyGroup(name="Unattributed", created_by=self.ksa_user.id,
                                        status="active", visibility="public")
        self.thread = models.DiscussionThread(title="KSA thread", content="Private source sentinel",
                                              created_by=self.ksa_user.id, learning_space_id=self.ksa.id)
        self.room = models.StudySession(title="KSA room", created_by=self.ksa_user.id,
                                        learning_space_id=self.ksa.id, status="active",
                                        starts_at=now, ends_at=now + timedelta(hours=1))
        self.db.add_all([self.group, self.legacy, self.thread, self.room])
        self.db.commit()

    def denied(self, status, operation):
        with self.assertRaises(HTTPException) as caught:
            operation()
        self.assertEqual(caught.exception.status_code, status)

    def test_same_space_lists_and_detail_cross_space_and_legacy_denied(self):
        for user in (self.ksa_user, self.cu_user):
            groups = mvp.list_study_groups(None, None, None, self.db, user)
            threads = mvp.list_threads(None, None, None, 50, self.db, user)
            rooms = sessions.list_sessions(None, None, None, False, self.db, user)
            self.assertEqual([row["id"] for row in groups], [self.group.id] if user == self.ksa_user else [])
            self.assertEqual([row["id"] for row in threads], [self.thread.id] if user == self.ksa_user else [])
            self.assertEqual([row["id"] for row in rooms], [self.room.id] if user == self.ksa_user else [])
        self.assertEqual(mvp.get_thread(self.thread.id, self.db, self.ksa_user)["id"], self.thread.id)
        self.denied(404, lambda: mvp.get_thread(self.thread.id, self.db, self.cu_user))
        self.denied(404, lambda: mvp.join_study_group(self.legacy.id, self.db, self.ksa_user))
        self.denied(404, lambda: mvp.join_study_group(self.group.id, self.db, self.cu_user))
        self.denied(404, lambda: community.group_home(self.legacy.id, self.db, self.ksa_user))
        self.denied(404, lambda: sessions._ensure_room_access(self.room, self.cu_user.id, self.db))

    def test_creator_identity_does_not_unquarantine_or_grant_cross_space_access(self):
        legacy_thread = models.DiscussionThread(title="old", content="hidden", created_by=self.ksa_user.id)
        legacy_room = models.StudySession(title="old", created_by=self.ksa_user.id,
                                          starts_at=datetime.now(timezone.utc),
                                          ends_at=datetime.now(timezone.utc) + timedelta(hours=1))
        self.db.add_all([legacy_thread, legacy_room])
        self.db.commit()
        self.denied(404, lambda: mvp.get_thread(legacy_thread.id, self.db, self.ksa_user))
        self.denied(404, lambda: sessions._ensure_room_access(legacy_room, self.ksa_user.id, self.db))
        self.assertFalse(self.db.query(models.StudyGroupMember).filter_by(group_id=self.legacy.id).first())

    def test_assignment_requires_both_admin_gates_and_one_audit(self):
        request = collaboration_admin.AssignmentRequest(learning_space_id=self.ksa.id, reason="Confirmed KSA cohort source")
        self.denied(403, lambda: collaboration_admin.assign_quarantined("group", self.legacy.id, request, self.db, self.role_only))
        self.denied(403, lambda: collaboration_admin.list_quarantine("group", 0, 20, self.db, self.ksa_user))
        listing = collaboration_admin.list_quarantine("group", 0, 20, self.db, self.admin)
        self.assertEqual([row["id"] for row in listing["items"]], [self.legacy.id])
        self.assertNotIn("content", listing["items"][0])
        response = collaboration_admin.assign_quarantined("group", self.legacy.id, request, self.db, self.admin)
        self.assertEqual(response["status"], "assigned")
        self.denied(409, lambda: collaboration_admin.assign_quarantined("group", self.legacy.id, request, self.db, self.admin))
        self.assertEqual(self.db.query(models.CollaborationSpaceAudit).count(), 1)
        self.assertEqual(self.db.query(models.StudyGroup).filter_by(id=self.legacy.id).one().name, "Unattributed")
        self.assertEqual({row["id"] for row in mvp.list_study_groups(None, None, None, self.db, self.ksa_user)},
                         {self.group.id, self.legacy.id})
        self.denied(404, lambda: mvp.join_study_group(self.legacy.id, self.db, self.cu_user))

    def test_linked_records_cannot_cross_or_precede_parent_assignment(self):
        linked = models.DiscussionThread(title="Linked", group_id=self.legacy.id, created_by=self.ksa_user.id)
        conflicting = models.StudySession(title="Wrong space", group_id=self.legacy.id,
                                          learning_space_id=self.cu.id, created_by=self.cu_user.id,
                                          starts_at=datetime.now(timezone.utc),
                                          ends_at=datetime.now(timezone.utc) + timedelta(hours=1))
        self.db.add_all([linked, conflicting])
        self.db.commit()
        request = collaboration_admin.AssignmentRequest(learning_space_id=self.ksa.id, reason="Group source reviewed")
        self.denied(409, lambda: collaboration_admin.assign_quarantined("thread", linked.id, request, self.db, self.admin))
        self.denied(409, lambda: collaboration_admin.assign_quarantined("group", self.legacy.id, request, self.db, self.admin))
        self.assertIsNone(self.db.query(models.StudyGroup).filter_by(id=self.legacy.id).one().learning_space_id)
        self.assertEqual(self.db.query(models.CollaborationSpaceAudit).count(), 0)

    def test_linked_material_requires_matching_space_or_explicit_owner_action(self):
        question = models.PastQuestion(uploaded_by=self.ksa_user.id, content_text="Source", metadata_json={})
        self.db.add(question)
        self.db.commit()
        require_linked_material_space(self.db, "past_question", question.id, self.ksa.id, self.ksa_user)
        self.denied(409, lambda: require_linked_material_space(self.db, "past_question", question.id, self.cu.id, self.cu_user))
        self.denied(409, lambda: require_linked_material_space(self.db, "past_question", question.id, self.ksa.id))
        question.metadata_json = {"learning_space_id": self.cu.id}
        self.db.commit()
        self.denied(409, lambda: require_linked_material_space(self.db, "past_question", question.id, self.ksa.id, self.ksa_user))

    def test_group_visibility_rejects_a_resource_owned_by_another_space(self):
        note = models.LectureNote(uploaded_by=self.ksa_user.id, title="CU source",
                                  metadata_json={"learning_space_id": self.cu.id}, visibility="private")
        self.db.add_all([note, models.StudyGroupMember(group_id=self.group.id, user_id=self.ksa_user.id)])
        self.db.commit()
        request = mvp.MaterialVisibilityRequest(visibility="group", group_ids=[self.group.id], confirm=True)
        self.denied(409, lambda: mvp.update_material_visibility("lecture_note", note.id, request, self.db, self.ksa_user))
        self.db.refresh(note)
        self.assertEqual(note.visibility, "private")
        self.assertEqual(self.db.query(models.MaterialGroupShare).count(), 0)
        note.metadata_json = {}
        self.db.commit()
        result = mvp.update_material_visibility("lecture_note", note.id, request, self.db, self.ksa_user)
        self.assertEqual(result["sharing"]["visibility"], "group")
        self.assertEqual(self.db.query(models.MaterialGroupShare).count(), 1)


if __name__ == "__main__":
    unittest.main()
