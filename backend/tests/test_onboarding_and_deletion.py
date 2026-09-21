import os
import sys
import unittest
import time
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import Column, DateTime, Integer, String, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import models  # noqa: E402
import schemas  # noqa: E402
from routers import community  # noqa: E402
from routers import auth as auth_router  # noqa: E402
import auth  # noqa: E402
import account_cleanup  # noqa: E402
from firebase_tokens import FirebaseTokenError  # noqa: E402
from account_cleanup import run_cleanup_batch  # noqa: E402


CleanupBase = declarative_base()


class CleanupUserRow(CleanupBase):
    __tablename__ = "cleanup_users"

    id = Column(Integer, primary_key=True)
    firebase_uid = Column(String, nullable=False)
    account_status = Column(String, nullable=False)
    deletion_due_at = Column(DateTime(timezone=True), nullable=True)


class QueryDouble:
    def __init__(self, db, model):
        self.db = db
        self.model = model

    def filter(self, *args, **kwargs):
        return self

    def join(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def first(self):
        if self.model is models.StudyGroupMember:
            if self.db.group_members:
                candidates = [member for member in self.db.group_members if member.user_id != 7]
                return min(
                    candidates,
                    key=lambda member: (
                        0 if member.role in {"owner", "admin"} else 1,
                        getattr(member, "joined_at", None) or "",
                        getattr(member, "id", None) or 0,
                    ),
                    default=None,
                )
            return self.db.group_replacement
        if self.model is models.StudySessionParticipant:
            return self.db.room_replacement
        if self.model is models.DeletedFirebaseIdentity:
            return self.db.deleted_identity
        return None

    def all(self):
        if self.model is models.StudyGroup:
            return self.db.owned_groups
        if self.model is models.StudySession:
            return self.db.owned_rooms
        if self.model is models.User:
            return self.db.due_users
        return []

    def delete(self, **kwargs):
        self.db.deleted_models.append(self.model)
        return 0

    def update(self, values, **kwargs):
        self.db.updated_models.append(self.model)
        return 0


class DatabaseDouble:
    def __init__(self):
        self.deleted_models = []
        self.updated_models = []
        self.added = []
        self.deleted_objects = []
        self.commits = 0
        self.rollbacks = 0
        self.owned_groups = []
        self.owned_rooms = []
        self.group_replacement = None
        self.group_members = []
        self.room_replacement = None
        self.deleted_identity = None
        self.due_users = []

    def query(self, model):
        return QueryDouble(self, model)

    def add(self, value):
        self.added.append(value)
        if isinstance(value, models.DeletedFirebaseIdentity):
            self.deleted_identity = value

    def delete(self, value):
        self.deleted_objects.append(value)

    def commit(self):
        self.commits += 1

    def refresh(self, value):
        return None

    def rollback(self):
        self.rollbacks += 1


def user(state="pending"):
    return models.User(
        id=7,
        name="A student",
        username="a_student",
        email="student@stu.cu.edu.ng",
        firebase_uid="firebase-7",
        role="student",
        account_status="active",
        onboarding_completed=state == "completed",
        onboarding_state=state,
    )


class OnboardingStateTests(unittest.TestCase):
    def test_legacy_completed_profile_without_username_requires_identity_step(self):
        current = user("completed")
        current.username = None
        db = DatabaseDouble()

        payload = community._profile_payload(db, current)

        self.assertTrue(payload["onboarding_required"])

    def test_skipped_profile_can_stay_skipped_until_student_is_ready(self):
        current = user("skipped")
        current.username = None
        db = DatabaseDouble()

        payload = community._profile_payload(db, current)

        self.assertFalse(payload["onboarding_required"])

    def test_skip_is_distinct_from_completed(self):
        current = user()
        db = DatabaseDouble()

        community.skip_onboarding(db, current)

        self.assertEqual(current.onboarding_state, "skipped")
        self.assertFalse(current.onboarding_completed)

    def test_continue_completes_without_mutating_request(self):
        current = user()
        db = DatabaseDouble()
        request = community.AcademicProfileRequest(
            preferred_name="A student",
            username="a_student",
            department="Computer Science",
            level="300",
            course_ids=[],
            complete=False,
        )

        community.complete_onboarding(request, db, current)

        self.assertFalse(request.complete)
        self.assertEqual(current.onboarding_state, "completed")
        self.assertTrue(current.onboarding_completed)
        self.assertEqual(current.department, "computer-science")

    def test_profile_edit_preserves_skipped_state(self):
        current = user("skipped")
        db = DatabaseDouble()
        request = community.AcademicProfileRequest(
            preferred_name="A student",
            username="a_student",
            department=None,
            level=None,
            course_ids=[],
            complete=True,
        )

        community.update_academic_profile(request, db, current)

        self.assertEqual(current.onboarding_state, "skipped")
        self.assertFalse(current.onboarding_completed)


class AccountDeletionSwitchTests(unittest.TestCase):
    def _payload(self):
        return schemas.DeleteAccountRequest(confirmation="DELETE", firebase_id_token="fresh")

    def test_missing_variable_disables_account_deletion(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(HTTPException) as error:
                auth_router.delete_account(self._payload(), DatabaseDouble(), user("completed"))
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(error.exception.detail, "Account deletion is temporarily unavailable.")

    def test_false_variable_disables_account_deletion(self):
        with patch.dict(os.environ, {"ACCOUNT_DELETION_ENABLED": "false"}, clear=True):
            with self.assertRaises(HTTPException) as error:
                auth_router.delete_account(self._payload(), DatabaseDouble(), user("completed"))
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(error.exception.detail, "Account deletion is temporarily unavailable.")

    def test_true_variable_preserves_deletion_flow(self):
        current = user("completed")
        db = DatabaseDouble()
        claims = {"sub": current.firebase_uid, "email": current.email, "auth_time": int(time.time())}
        with patch.dict(os.environ, {"ACCOUNT_DELETION_ENABLED": "true"}, clear=True):
            with patch.object(auth_router, "verify_firebase_id_token", return_value=claims):
                response = auth_router.delete_account(self._payload(), db, current)
        self.assertEqual(db.commits, 1)
        self.assertEqual(response["detail"], "Your account is scheduled for permanent deletion after 30 days.")
        self.assertEqual(current.account_status, "pending_deletion")
        self.assertIsNotNone(current.deletion_requested_at)
        self.assertIsNotNone(current.deletion_due_at)
        self.assertEqual(
            current.deletion_due_at - current.deletion_requested_at,
            auth.timedelta(days=30),
        )


class PermanentDeletionGuardTests(unittest.TestCase):
    def test_direct_cleanup_rejects_when_both_flags_are_missing(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(auth.PermanentDeletionDisabledError):
                auth.delete_user_account(DatabaseDouble(), user("completed"))

    def test_direct_cleanup_rejects_when_both_flags_are_false(self):
        with patch.dict(os.environ, {
            "PERMANENT_ACCOUNT_DELETION_ENABLED": "false",
            "FIREBASE_ADMIN_DELETE_ENABLED": "false",
        }, clear=True):
            with self.assertRaises(auth.PermanentDeletionDisabledError):
                auth.delete_user_account(DatabaseDouble(), user("completed"))

    def test_direct_cleanup_rejects_when_only_one_flag_is_true(self):
        for values in (
            {"PERMANENT_ACCOUNT_DELETION_ENABLED": "true", "FIREBASE_ADMIN_DELETE_ENABLED": "false"},
            {"PERMANENT_ACCOUNT_DELETION_ENABLED": "false", "FIREBASE_ADMIN_DELETE_ENABLED": "true"},
        ):
            with self.subTest(values=values), patch.dict(os.environ, values, clear=True):
                with self.assertRaises(auth.PermanentDeletionDisabledError):
                    auth.delete_user_account(DatabaseDouble(), user("completed"))

    def test_direct_cleanup_is_allowed_only_when_both_flags_are_true(self):
        with patch.dict(os.environ, {
            "PERMANENT_ACCOUNT_DELETION_ENABLED": "true",
            "FIREBASE_ADMIN_DELETE_ENABLED": "true",
        }, clear=True):
            db = DatabaseDouble()
            current = user("completed")
            auth.delete_user_account(db, current)
        self.assertEqual(db.deleted_objects, [current])


class AccountLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.deletion_env = patch.dict(os.environ, {"ACCOUNT_DELETION_ENABLED": "true", "APP_ENV": "development"})
        self.deletion_env.start()

    def tearDown(self):
        self.deletion_env.stop()

    def test_restart_onboarding_requires_admin_or_development(self):
        current = user("completed")
        db = DatabaseDouble()
        current.role = "student"
        with patch.dict(os.environ, {"APP_ENV": "production"}, clear=True):
            with self.assertRaises(HTTPException) as error:
                auth_router.restart_onboarding(db, current)
        self.assertEqual(error.exception.status_code, 403)

        with patch.dict(os.environ, {"APP_ENV": "development"}, clear=True):
            response = auth_router.restart_onboarding(db, current)
        self.assertEqual(response.onboarding_state, "pending")
        self.assertFalse(response.onboarding_completed)

    def test_restart_onboarding_preserves_user_data(self):
        current = user("completed")
        current.department = "computer-science"
        db = DatabaseDouble()
        response = auth_router.restart_onboarding(db, current)
        self.assertEqual(response.id, current.id)
        self.assertEqual(current.department, "computer-science")
        self.assertEqual(db.deleted_objects, [])
        self.assertEqual(db.deleted_models, [])

    def test_deactivation_preserves_data_and_requires_recent_identity(self):
        current = user("completed")
        db = DatabaseDouble()
        payload = schemas.AccountLifecycleRequest(confirmation="DEACTIVATE", firebase_id_token="fresh")
        claims = {"sub": current.firebase_uid, "email": current.email, "auth_time": int(time.time())}
        with patch.object(auth_router, "verify_firebase_id_token", return_value=claims):
            response = auth_router.deactivate_account(payload, db, current)
        self.assertEqual(response["detail"], "Your account has been deactivated.")
        self.assertEqual(current.account_status, "deactivated")
        self.assertIsNotNone(current.deactivated_at)
        self.assertEqual(db.deleted_objects, [])

    def test_reactivation_restores_access(self):
        current = user("completed")
        auth.deactivate_user(current)
        db = DatabaseDouble()
        # The double returns the current user for the Firebase UID query.
        db.firebase_user = current
        original_query = db.query

        def query(model):
            if model is models.User:
                query_double = QueryDouble(db, model)
                query_double.first = lambda: current
                return query_double
            return original_query(model)

        db.query = query
        payload = schemas.FirebaseIdentityRequest(firebase_id_token="fresh")
        claims = {"sub": current.firebase_uid, "email": current.email, "auth_time": int(time.time())}
        with patch.object(auth_router, "verify_firebase_id_token", return_value=claims):
            response = auth_router.reactivate_account(payload, db)
        self.assertTrue(response["access_token"])
        self.assertEqual(current.account_status, "active")
        self.assertIsNone(current.deactivated_at)

    def test_pending_deletion_recovery_state_uses_server_due_boundary(self):
        current = user("completed")
        current.account_status = "pending_deletion"

        current.deletion_due_at = datetime.now(timezone.utc) + auth.timedelta(seconds=1)
        with self.assertRaises(auth.AccountPendingDeletionError):
            auth_router._account_state_error(current)

        current.deletion_due_at = datetime.now(timezone.utc)
        with self.assertRaises(auth.AccountDeletionRecoveryExpiredError):
            auth_router._account_state_error(current)

        current.deletion_due_at = datetime.now(timezone.utc) - auth.timedelta(seconds=1)
        with self.assertRaises(auth.AccountDeletionRecoveryExpiredError):
            auth_router._account_state_error(current)

        current.deletion_due_at = None
        with self.assertRaises(auth.AccountDeletionRecoveryExpiredError):
            auth_router._account_state_error(current)

    def test_expired_sign_in_returns_stable_recovery_state(self):
        current = user("completed")
        current.account_status = "pending_deletion"
        current.deletion_due_at = datetime.now(timezone.utc) - auth.timedelta(seconds=1)
        db = DatabaseDouble()
        claims = {"sub": current.firebase_uid, "email": current.email, "firebase": {"sign_in_provider": "password"}}
        payload = schemas.FirebaseSessionRequest(firebase_id_token="fresh", provider="password")
        with patch.object(auth_router, "verify_firebase_id_token", return_value=claims):
            with patch.object(auth, "get_or_create_firebase_user", return_value=current):
                with self.assertRaises(HTTPException) as error:
                    auth_router.firebase_session(payload, db)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(error.exception.detail, "DELETION_RECOVERY_EXPIRED")


class AccountCleanupJobTests(unittest.TestCase):
    def setUp(self):
        self.flags = patch.dict(os.environ, {
            "PERMANENT_ACCOUNT_DELETION_ENABLED": "true",
            "FIREBASE_ADMIN_DELETE_ENABLED": "true",
        })
        self.flags.start()

    def tearDown(self):
        self.flags.stop()

    def test_cleanup_job_ignores_accounts_not_due_or_cancelled(self):
        db = DatabaseDouble()
        not_due = user("completed")
        not_due.account_status = "pending_deletion"
        not_due.deletion_due_at = None
        cancelled = user("completed")
        cancelled.account_status = "active"
        db.due_users = []
        result = run_cleanup_batch(db, firebase_delete_identity=lambda _: None)
        self.assertEqual(result["processed"], 0)
        self.assertIsNone(not_due.deletion_due_at)
        self.assertEqual(cancelled.account_status, "active")

    def test_cleanup_job_processes_overdue_account_idempotently(self):
        current = user("completed")
        current.account_status = "pending_deletion"
        current.deletion_due_at = datetime.now(timezone.utc) - auth.timedelta(days=1)
        db = DatabaseDouble()
        db.due_users = [current]
        with patch.object(auth, "delete_user_account") as cleanup:
            result = run_cleanup_batch(db, firebase_delete_identity=lambda _: None)
            self.assertEqual(result["processed"], 1)
            cleanup.assert_called_once_with(db, current)
        db.due_users = []
        result = run_cleanup_batch(db, firebase_delete_identity=lambda _: None)
        self.assertEqual(result["processed"], 0)

    def test_failed_cleanup_stays_retryable(self):
        current = user("completed")
        current.account_status = "pending_deletion"
        current.deletion_due_at = datetime.now(timezone.utc) - auth.timedelta(days=1)
        db = DatabaseDouble()
        db.due_users = [current]
        attempts = {"count": 0}

        def delete_identity(_):
            attempts["count"] += 1
            if attempts["count"] == 1:
                raise RuntimeError("temporary failure")

        result = run_cleanup_batch(db, firebase_delete_identity=delete_identity)
        self.assertEqual(result["failed"], 1)
        self.assertEqual(db.rollbacks, 1)
        with patch.object(auth, "delete_user_account"):
            result = run_cleanup_batch(db, firebase_delete_identity=delete_identity)
        self.assertEqual(result["processed"], 1)


class AccountCleanupDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.flags = patch.dict(os.environ, {
            "PERMANENT_ACCOUNT_DELETION_ENABLED": "true",
            "FIREBASE_ADMIN_DELETE_ENABLED": "true",
        })
        self.flags.start()
        self.engine = create_engine("sqlite:///:memory:")
        CleanupBase.metadata.create_all(self.engine)
        self.session = sessionmaker(bind=self.engine)()
        self.user_model = patch.object(account_cleanup.models, "User", CleanupUserRow)
        self.user_model.start()

    def tearDown(self):
        self.user_model.stop()
        self.session.close()
        self.engine.dispose()
        self.flags.stop()

    def _row(self, uid, status, due_at):
        return CleanupUserRow(firebase_uid=uid, account_status=status, deletion_due_at=due_at)

    def _run(self, callback, *, now, batch_size=25):
        with patch.object(auth, "delete_user_account", side_effect=lambda db, row: db.delete(row)):
            return account_cleanup.run_cleanup_batch(
                self.session,
                firebase_delete_identity=callback,
                now=now,
                batch_size=batch_size,
            )

    def test_query_excludes_active_deactivated_and_future_accounts(self):
        now = datetime.now(timezone.utc)
        self.session.add_all([
            self._row("active", "active", now - auth.timedelta(days=1)),
            self._row("deactivated", "deactivated", now - auth.timedelta(days=1)),
            self._row("future", "pending_deletion", now + auth.timedelta(seconds=1)),
            self._row("at-boundary", "pending_deletion", now),
            self._row("overdue", "pending_deletion", now - auth.timedelta(seconds=1)),
        ])
        self.session.commit()
        seen = []
        result = self._run(seen.append, now=now, batch_size=25)
        self.assertEqual(result, {"processed": 2, "failed": 0, "skipped": 0})
        self.assertEqual(seen, ["overdue", "at-boundary"])

    def test_query_order_and_hard_batch_limit_are_deterministic(self):
        now = datetime.now(timezone.utc)
        self.session.add_all([
            self._row(f"due-{index}", "pending_deletion", now)
            for index in range(105)
        ])
        self.session.commit()
        seen = []
        result = self._run(seen.append, now=now, batch_size=1000)
        self.assertEqual(result["processed"], 100)
        self.assertEqual(len(seen), 100)
        self.assertEqual(seen, [f"due-{index}" for index in range(100)])
        result = self._run(seen.append, now=now, batch_size=1000)
        self.assertEqual(result["processed"], 5)
        self.assertEqual(seen[-5:], [f"due-{index}" for index in range(100, 105)])
        self.assertEqual(len(set(seen)), 105)

    def test_failed_account_is_rolled_back_and_retried_without_stopping_batch(self):
        now = datetime.now(timezone.utc)
        self.session.add_all([
            self._row("fail-once", "pending_deletion", now),
            self._row("succeed-now", "pending_deletion", now),
        ])
        self.session.commit()
        attempts = []

        def delete_identity(uid):
            attempts.append(uid)
            if uid == "fail-once" and attempts.count(uid) == 1:
                raise RuntimeError("temporary failure")

        result = self._run(delete_identity, now=now)
        self.assertEqual(result, {"processed": 1, "failed": 1, "skipped": 0})
        self.assertEqual(self.session.query(CleanupUserRow).count(), 1)
        result = self._run(delete_identity, now=now)
        self.assertEqual(result, {"processed": 1, "failed": 0, "skipped": 0})
        self.assertEqual(self.session.query(CleanupUserRow).count(), 0)


class AccountDeletionPolicyTests(unittest.TestCase):
    def setUp(self):
        self.deletion_env = patch.dict(os.environ, {
            "ACCOUNT_DELETION_ENABLED": "true",
            "PERMANENT_ACCOUNT_DELETION_ENABLED": "true",
            "FIREBASE_ADMIN_DELETE_ENABLED": "true",
        })
        self.deletion_env.start()

    def tearDown(self):
        self.deletion_env.stop()

    def test_delete_requires_exact_confirmation(self):
        with self.assertRaises(ValidationError):
            schemas.DeleteAccountRequest(firebase_id_token="fresh")
        with self.assertRaises(ValidationError):
            schemas.DeleteAccountRequest(confirmation="DELETE", firebase_id_token="fresh", extra="nope")

    def test_delete_confirmation_is_explicit_and_identity_bound(self):
        with self.assertRaises(ValidationError):
            schemas.DeleteAccountRequest(confirmation="delete", firebase_id_token="fresh")

        current = user("completed")
        db = DatabaseDouble()
        payload = schemas.DeleteAccountRequest(confirmation="DELETE", firebase_id_token="fresh")
        claims = {"sub": "another-firebase-user", "email": current.email, "auth_time": int(time.time())}
        with patch.object(auth_router, "verify_firebase_id_token", return_value=claims):
            with self.assertRaises(HTTPException) as error:
                auth_router.delete_account(payload, db, current)
        self.assertEqual(error.exception.status_code, 401)
        self.assertEqual(db.deleted_objects, [])

    def test_deletion_targets_private_rows_and_anonymises_shared_rows(self):
        current = user("completed")
        db = DatabaseDouble()

        auth.delete_user_account(db, current)

        self.assertIn(models.DeletedFirebaseIdentity, [type(item) for item in db.added])
        self.assertIn(models.UserCourse, db.deleted_models)
        self.assertIn(models.StudentProgress, db.deleted_models)
        self.assertIn(models.PracticeAttempt, db.deleted_models)
        self.assertIn(models.StudySessionParticipant, db.deleted_models)
        self.assertIn(models.DiscussionThread, db.updated_models)
        self.assertIn(models.Feedback, db.updated_models)
        self.assertIn(current, db.deleted_objects)

    def test_group_owner_transfers_to_earliest_member(self):
        current = user("completed")
        group = models.StudyGroup(id=11, created_by=current.id, status="active")
        replacement = models.StudyGroupMember(group_id=11, user_id=19, role="member")
        db = DatabaseDouble()
        db.owned_groups = [group]
        db.group_replacement = replacement

        auth.delete_user_account(db, current)

        self.assertEqual(group.created_by, 19)
        self.assertEqual(replacement.role, "owner")

    def test_group_owner_prefers_admin_over_earlier_ordinary_member(self):
        current = user("completed")
        group = models.StudyGroup(id=13, created_by=current.id, status="active")
        ordinary = models.StudyGroupMember(id=1, group_id=13, user_id=19, role="member")
        admin = models.StudyGroupMember(id=2, group_id=13, user_id=20, role="admin")
        db = DatabaseDouble()
        db.owned_groups = [group]
        db.group_members = [ordinary, admin]

        auth.delete_user_account(db, current)

        self.assertEqual(group.created_by, 20)
        self.assertEqual(admin.role, "owner")
        self.assertEqual(ordinary.role, "member")

    def test_group_owner_chooses_deterministic_first_admin(self):
        current = user("completed")
        group = models.StudyGroup(id=14, created_by=current.id, status="active")
        later_admin = models.StudyGroupMember(id=9, group_id=14, user_id=29, role="admin")
        earlier_admin = models.StudyGroupMember(id=4, group_id=14, user_id=24, role="admin")
        db = DatabaseDouble()
        db.owned_groups = [group]
        db.group_members = [later_admin, earlier_admin]

        auth.delete_user_account(db, current)

        self.assertEqual(group.created_by, 24)
        self.assertEqual(earlier_admin.role, "owner")

    def test_group_owner_falls_back_to_ordinary_member(self):
        current = user("completed")
        group = models.StudyGroup(id=15, created_by=current.id, status="active")
        first_member = models.StudyGroupMember(id=4, group_id=15, user_id=24, role="member")
        second_member = models.StudyGroupMember(id=9, group_id=15, user_id=29, role="member")
        db = DatabaseDouble()
        db.owned_groups = [group]
        db.group_members = [second_member, first_member]

        auth.delete_user_account(db, current)

        self.assertEqual(group.created_by, 24)
        self.assertEqual(first_member.role, "owner")

    def test_sole_owned_group_is_archived_without_creator(self):
        current = user("completed")
        group = models.StudyGroup(id=12, created_by=current.id, status="active")
        db = DatabaseDouble()
        db.owned_groups = [group]

        auth.delete_user_account(db, current)

        self.assertIsNone(group.created_by)
        self.assertEqual(group.status, "archived")

    def test_sole_owned_room_is_ended(self):
        current = user("completed")
        room = models.StudySession(id=17, created_by=current.id, status="active")
        db = DatabaseDouble()
        db.owned_rooms = [room]

        auth.delete_user_account(db, current)

        self.assertIsNone(room.created_by)
        self.assertEqual(room.status, "ended")
        self.assertIsNotNone(room.ends_at)

    def test_stale_reauthentication_is_rejected_without_deleting(self):
        current = user("completed")
        db = DatabaseDouble()
        payload = schemas.DeleteAccountRequest(confirmation="DELETE", firebase_id_token="fresh")
        claims = {"sub": current.firebase_uid, "email": current.email, "auth_time": int(time.time()) - 601}
        with patch.object(auth_router, "verify_firebase_id_token", return_value=claims):
            with self.assertRaises(HTTPException) as error:
                auth_router.delete_account(payload, db, current)
        self.assertEqual(error.exception.status_code, 401)
        self.assertEqual(db.deleted_objects, [])

    def test_verified_email_mismatch_is_rejected_without_deleting(self):
        current = user("completed")
        db = DatabaseDouble()
        payload = schemas.DeleteAccountRequest(confirmation="DELETE", firebase_id_token="fresh")
        claims = {"sub": current.firebase_uid, "email": "other@stu.cu.edu.ng", "auth_time": int(time.time())}
        with patch.object(auth_router, "verify_firebase_id_token", return_value=claims):
            with self.assertRaises(HTTPException) as error:
                auth_router.delete_account(payload, db, current)
        self.assertEqual(error.exception.status_code, 401)
        self.assertEqual(db.deleted_objects, [])

    def test_firebase_verification_failure_rolls_back_without_mutation(self):
        current = user("completed")
        db = DatabaseDouble()
        payload = schemas.DeleteAccountRequest(confirmation="DELETE", firebase_id_token="fresh")
        with patch.object(auth_router, "verify_firebase_id_token", side_effect=FirebaseTokenError("invalid")):
            with self.assertRaises(HTTPException) as error:
                auth_router.delete_account(payload, db, current)
        self.assertEqual(error.exception.status_code, 401)
        self.assertEqual(db.rollbacks, 1)
        self.assertEqual(db.commits, 0)
        self.assertEqual(db.deleted_objects, [])

    def test_scheduling_does_not_run_permanent_cleanup(self):
        current = user("completed")
        db = DatabaseDouble()
        payload = schemas.DeleteAccountRequest(confirmation="DELETE", firebase_id_token="fresh")
        claims = {"sub": current.firebase_uid, "email": current.email, "auth_time": int(time.time())}
        with patch.object(auth_router, "verify_firebase_id_token", return_value=claims):
            with patch.object(auth, "delete_user_account", side_effect=RuntimeError("database unavailable")):
                response = auth_router.delete_account(payload, db, current)
        self.assertEqual(response["detail"], "Your account is scheduled for permanent deletion after 30 days.")
        self.assertEqual(current.account_status, "pending_deletion")
        self.assertEqual(db.rollbacks, 0)
        self.assertEqual(db.commits, 1)
        self.assertEqual(db.deleted_objects, [])

    def test_tombstoned_firebase_identity_is_pending(self):
        db = DatabaseDouble()
        db.deleted_identity = models.DeletedFirebaseIdentity(firebase_uid="firebase-7")
        with self.assertRaises(auth.AccountDeletionPendingError) as error:
            auth.get_or_create_firebase_user(
                db,
                firebase_uid="firebase-7",
                email="student@stu.cu.edu.ng",
                claims={"sub": "firebase-7", "email": "student@stu.cu.edu.ng"},
            )
        self.assertEqual(str(error.exception), "ACCOUNT_DELETION_PENDING")

    def test_repeated_deletion_does_not_add_duplicate_tombstone(self):
        current = user("completed")
        db = DatabaseDouble()

        auth.delete_user_account(db, current)
        auth.delete_user_account(db, current)

        tombstones = [item for item in db.added if isinstance(item, models.DeletedFirebaseIdentity)]
        self.assertEqual(len(tombstones), 1)


if __name__ == "__main__":
    unittest.main()
