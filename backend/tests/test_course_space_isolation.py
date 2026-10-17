"""Course catalogue and linked-content learning-space isolation tests."""

import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import models
from database import Base
from material_access import can_view_material
from routers import community, mvp, search


class CourseSpaceIsolationTests(unittest.TestCase):
    def setUp(self):
        self.config = patch.dict(os.environ, {"ADMIN_PORTAL_EMAILS": ""})
        self.config.start()
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.db.close)

        self.cu = models.LearningSpace(slug="cu", name="Covenant University", type="university", status="active")
        self.ksa = models.LearningSpace(slug="ksa", name="Kora Sales Academy", type="academy", status="active")
        self.cu_user = models.User(id=1, name="CU learner", username="cu_learner", email="cu@example.test", role="student")
        self.ksa_user = models.User(id=2, name="KSA learner", username="ksa_learner", email="ksa@example.test", role="student")
        self.db.add_all([self.cu, self.ksa, self.cu_user, self.ksa_user])
        self.db.flush()
        self.cu_user.active_learning_space_id = self.cu.id
        self.ksa_user.active_learning_space_id = self.ksa.id
        self.db.add_all([
            models.LearningSpaceMembership(user_id=self.cu_user.id, learning_space_id=self.cu.id, status="active"),
            models.LearningSpaceMembership(user_id=self.ksa_user.id, learning_space_id=self.ksa.id, status="active"),
        ])
        self.cu_course = models.Course(id=10, code="CSC317", name="System Analysis and Design", learning_space_id=self.cu.id)
        self.ksa_course = models.Course(id=11, code="KSA-SALES", name="Prospecting Foundations", learning_space_id=self.ksa.id)
        self.ambiguous = models.Course(id=12, code="UNKNOWN", name="Unassigned legacy course")
        self.db.add_all([self.cu_course, self.ksa_course, self.ambiguous])
        self.db.commit()

    def tearDown(self):
        self.config.stop()

    def test_course_catalogue_is_scoped_and_legacy_rows_are_hidden(self):
        cu_courses = mvp.list_courses(self.db, self.cu_user)
        ksa_courses = mvp.list_courses(self.db, self.ksa_user)
        self.assertEqual([row["code"] for row in cu_courses], ["CSC317"])
        self.assertEqual([row["code"] for row in ksa_courses], ["KSA-SALES"])
        self.assertNotIn("UNKNOWN", {row["code"] for row in cu_courses + ksa_courses})

    def test_profile_cannot_select_a_course_from_another_space(self):
        request = community.AcademicProfileRequest(
            preferred_name="KSA learner",
            username="ksa_learner",
            course_ids=[self.cu_course.id],
        )
        with self.assertRaises(HTTPException) as caught:
            community.update_academic_profile(request, self.db, self.ksa_user)
        self.assertEqual(caught.exception.status_code, 400)

    def test_discussion_course_context_cannot_cross_spaces(self):
        with self.assertRaises(HTTPException) as caught:
            mvp._validate_thread_context(self.db, self.cu_course.id, None, None, self.ksa_user)
        self.assertEqual(caught.exception.status_code, 400)

    def test_search_metadata_context_contains_only_active_space_courses(self):
        context = search._metadata_context(self.db, self.ksa_user)
        self.assertEqual([item["code"] for item in context if "code" in item], ["KSA-SALES"])

    def test_cross_space_public_material_is_not_readable(self):
        note = models.LectureNote(
            id=20,
            uploaded_by=self.cu_user.id,
            title="CU note",
            content_text="Covenant course content",
            course_id=self.cu_course.id,
            visibility="public",
            metadata_json={},
        )
        self.db.add(note)
        self.db.commit()
        self.assertFalse(can_view_material(self.db, note, self.ksa_user))


if __name__ == "__main__":
    unittest.main()
