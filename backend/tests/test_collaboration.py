import json
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import models  # noqa: E402
from material_access import (  # noqa: E402
    OFFICIAL,
    PRIVATE,
    SPACE_SHARED,
    can_view_material,
    request_material_contribution,
)
from routers import collaboration  # noqa: E402


class CollaborationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine("sqlite:///:memory:")
        models.Base.metadata.create_all(cls.engine)
        cls.Session = sessionmaker(bind=cls.engine)

    def setUp(self):
        models.Base.metadata.drop_all(self.engine)
        models.Base.metadata.create_all(self.engine)
        self.db: Session = self.Session()
        self.space = models.LearningSpace(slug="ksa", name="Kora Sales Academy", type="academy", status="active")
        self.other_space = models.LearningSpace(slug="other", name="Other space", type="academy", status="active")
        self.owner = models.User(id=101, role="student", name="Owner", username="owner")
        self.member = models.User(id=102, role="student", name="Member", username="member")
        self.outsider = models.User(id=103, role="student", name="Outsider", username="outsider")
        self.moderator = models.User(id=104, role="student", name="Moderator", username="moderator")
        self.db.add_all([self.space, self.other_space, self.owner, self.member, self.outsider, self.moderator])
        self.db.flush()
        self.owner.active_learning_space_id = self.space.id
        self.member.active_learning_space_id = self.space.id
        self.moderator.active_learning_space_id = self.space.id
        self.db.add_all([
            models.LearningSpaceMembership(user_id=self.owner.id, learning_space_id=self.space.id, status="active", role="member"),
            models.LearningSpaceMembership(user_id=self.member.id, learning_space_id=self.space.id, status="active", role="member"),
            models.LearningSpaceMembership(user_id=self.moderator.id, learning_space_id=self.space.id, status="active", role="moderator"),
            models.LearningSpaceMembership(user_id=self.outsider.id, learning_space_id=self.other_space.id, status="active", role="member"),
        ])
        self.note = models.LectureNote(
            id=501,
            uploaded_by=self.owner.id,
            title="Prospecting notes",
            content_text="Qualify a prospect before proposing a solution.",
            file_data=b"PDF-BYTES",
            file_name="prospecting.pdf",
            file_mime="application/pdf",
            file_size=10,
            metadata_json={"document_title": "Prospecting notes", "topics_covered": ["qualification"]},
            visibility=PRIVATE,
        )
        self.db.add(self.note)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_pending_contribution_is_private_and_moderator_can_review(self):
        contribution = request_material_contribution(self.db, [self.note], self.owner, self.space.id)
        self.db.commit()
        self.assertEqual(contribution.moderation_status, "pending_review")
        self.assertTrue(can_view_material(self.db, self.note, self.owner))
        self.assertFalse(can_view_material(self.db, self.note, self.member))
        self.assertTrue(can_view_material(self.db, self.note, self.moderator))
        self.assertEqual(self.note.file_data, b"PDF-BYTES")

    def test_approval_publishes_only_to_space_members_and_preserves_audit(self):
        contribution = request_material_contribution(self.db, [self.note], self.owner, self.space.id)
        self.db.commit()
        result = collaboration.decide_contribution(
            contribution.id,
            collaboration.ModerationDecisionRequest(status="approved"),
            self.db,
            self.moderator,
        )
        self.assertEqual(result["status"], "approved")
        self.assertEqual(self.note.visibility, SPACE_SHARED)
        self.assertTrue(can_view_material(self.db, self.note, self.member))
        self.assertFalse(can_view_material(self.db, self.note, self.outsider))
        self.assertEqual(self.db.query(models.ModerationAudit).count(), 1)
        self.assertEqual(self.note.file_data, b"PDF-BYTES")

    def test_self_approval_and_rejected_resources_are_blocked(self):
        contribution = request_material_contribution(self.db, [self.note], self.owner, self.space.id)
        self.db.commit()
        with self.assertRaises(HTTPException) as error:
            collaboration.decide_contribution(
                contribution.id,
                collaboration.ModerationDecisionRequest(status="approved"),
                self.db,
                self.owner,
            )
        self.assertEqual(error.exception.status_code, 404)
        rejected = collaboration.decide_contribution(
            contribution.id,
            collaboration.ModerationDecisionRequest(status="rejected", reason="The source is outdated."),
            self.db,
            self.moderator,
        )
        self.assertEqual(rejected["status"], "rejected")
        self.assertEqual(self.note.visibility, PRIVATE)
        self.assertFalse(can_view_material(self.db, self.note, self.member))

    def test_official_resources_require_moderation_and_membership(self):
        contribution = request_material_contribution(self.db, [self.note], self.owner, self.space.id)
        self.db.commit()
        collaboration.decide_contribution(
            contribution.id,
            collaboration.ModerationDecisionRequest(status="approved", mark_official=True),
            self.db,
            self.moderator,
        )
        self.assertEqual(self.note.visibility, OFFICIAL)
        self.assertTrue(can_view_material(self.db, self.note, self.member))
        self.assertFalse(can_view_material(self.db, self.note, self.outsider))

    def test_share_links_are_unguessable_revocable_and_cannot_bypass_access(self):
        request_material_contribution(self.db, [self.note], self.owner, self.space.id)
        self.db.commit()
        link_response = collaboration.create_share_link(
            collaboration.ShareLinkRequest(
                content_type="resource",
                material_type="lecture_note",
                material_id=self.note.id,
                access_policy="owner",
            ),
            self.db,
            self.owner,
        )
        self.assertGreaterEqual(len(link_response["token"]), 32)
        with self.assertRaises(HTTPException):
            collaboration.resolve_share_link(link_response["token"], self.db, self.member)
        collaboration.revoke_share_link(link_response["id"], self.db, self.owner)
        with self.assertRaises(HTTPException):
            collaboration.resolve_share_link(link_response["token"], self.db, self.owner)

    def test_group_share_links_require_group_membership(self):
        group = models.StudyGroup(name="KSA revision", status="active", created_by=self.owner.id)
        self.db.add(group)
        self.db.flush()
        with self.assertRaises(HTTPException) as error:
            collaboration.create_share_link(
                collaboration.ShareLinkRequest(
                    content_type="resource",
                    material_type="lecture_note",
                    material_id=self.note.id,
                    access_policy="group",
                    group_id=group.id,
                ),
                self.db,
                self.owner,
            )
        self.assertEqual(error.exception.status_code, 403)
        self.db.add(models.StudyGroupMember(group_id=group.id, user_id=self.owner.id))
        self.db.commit()
        link = collaboration.create_share_link(
            collaboration.ShareLinkRequest(
                content_type="resource",
                material_type="lecture_note",
                material_id=self.note.id,
                access_policy="group",
                group_id=group.id,
            ),
            self.db,
            self.owner,
        )
        self.assertEqual(link["access_policy"], "group")

    def test_selected_answer_links_reject_whole_conversations_and_keep_citation_boundary(self):
        with self.assertRaises(HTTPException):
            collaboration.create_share_link(
                collaboration.ShareLinkRequest(
                    content_type="maxe_answer",
                    payload={"messages": [{"role": "user", "content": "private"}]},
                ),
                self.db,
                self.owner,
            )
        response = collaboration.create_share_link(
            collaboration.ShareLinkRequest(
                content_type="maxe_answer",
                payload={
                    "question": "What is qualification?",
                    "answer": "It checks fit before a proposal.",
                    "citations": [{"source": "Private source", "resource_type": "lecture_note", "resource_id": self.note.id}],
                },
            ),
            self.db,
            self.owner,
        )
        resolved = collaboration.resolve_share_link(response["token"], self.db, self.owner)
        self.assertEqual(resolved["payload"]["question"], "What is qualification?")
        self.assertNotIn("messages", resolved["payload"])

    def test_exports_are_safe_and_authorized(self):
        response = collaboration.export_material("lecture_note", self.note.id, "md", self.db, self.owner)
        self.assertEqual(response.media_type, "text/markdown")
        self.assertIn("Prospecting notes", response.body.decode())
        with self.assertRaises(HTTPException):
            collaboration.export_material("lecture_note", self.note.id, "md", self.db, self.member)
        with self.assertRaises(HTTPException):
            collaboration.export_selected_content(
                collaboration.ExportRequest(content_type="conversation_excerpt", payload={"conversation": "private"}),
                self.owner,
            )


if __name__ == "__main__":
    unittest.main()
