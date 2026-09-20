"""Study Community endpoints.

These endpoints are deliberately additive. The original discussion, group and
room routes remain available to older clients while this API supplies the
profile/onboarding and group-home data needed by the current workspace.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import auth
import models
from database import get_db

router = APIRouter(prefix="/community", tags=["community"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _member(db: Session, group_id: int, user_id: int) -> models.StudyGroupMember | None:
    return (
        db.query(models.StudyGroupMember)
        .filter(
            models.StudyGroupMember.group_id == group_id,
            models.StudyGroupMember.user_id == user_id,
        )
        .first()
    )


def _group_or_404(db: Session, group_id: int) -> models.StudyGroup:
    group = db.query(models.StudyGroup).filter(models.StudyGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Study group not found.")
    return group


class AcademicProfileRequest(BaseModel):
    preferred_name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    username: Optional[str] = Field(default=None, min_length=3, max_length=24)
    department: Optional[str] = Field(default=None, max_length=160)
    level: Optional[str] = Field(default=None, max_length=40)
    semester: Optional[str] = Field(default=None, max_length=40)
    course_ids: Optional[list[int]] = Field(default=None, max_length=20)
    interests: list[str] = Field(default_factory=list, max_length=12)
    complete: bool = False


def _profile_payload(db: Session, user: models.User) -> dict:
    course_rows = (
        db.query(models.Course)
        .join(models.UserCourse, models.UserCourse.course_id == models.Course.id)
        .filter(models.UserCourse.user_id == user.id)
        .order_by(models.Course.code)
        .all()
    )
    return {
        "id": user.id,
        "preferred_name": user.name,
        "username": user.username,
        "department": user.department,
        "level": user.level,
        "semester": user.semester,
        "interests": user.interests or [],
        "courses": [{"id": c.id, "code": c.code, "name": c.name} for c in course_rows],
        "onboarding_completed": bool(user.onboarding_completed),
        "onboarding_required": not bool(user.onboarding_completed),
    }


def _save_profile(db: Session, user: models.User, req: AcademicProfileRequest) -> None:
    if req.preferred_name is not None:
        user.name = req.preferred_name.strip()[:120]
    if req.username is not None:
        username = req.username.strip().lower()
        conflict = (
            db.query(models.User)
            .filter(models.User.username == username, models.User.id != user.id)
            .first()
        )
        if conflict:
            raise HTTPException(status_code=409, detail="That username is already taken.")
        user.username = username
    user.department = req.department.strip()[:160] if req.department else None
    user.level = req.level.strip()[:40] if req.level else None
    user.semester = req.semester.strip()[:40] if req.semester else None
    user.interests = [item.strip()[:80] for item in req.interests if item.strip()][:12]

    if req.course_ids is not None:
        valid_ids = {
            row.id for row in db.query(models.Course.id).filter(models.Course.id.in_(req.course_ids)).all()
        }
        if valid_ids != set(req.course_ids):
            raise HTTPException(status_code=400, detail="One or more selected courses are unavailable.")
        existing = db.query(models.UserCourse).filter(models.UserCourse.user_id == user.id).all()
        for row in existing:
            db.delete(row)
        for course_id in sorted(valid_ids):
            db.add(models.UserCourse(user_id=user.id, course_id=course_id))
    elif req.complete:
        # Completing with no course is allowed for a returning student editing
        # a profile, but the onboarding UI strongly encourages at least one.
        pass

    if req.complete:
        user.onboarding_completed = True
    user.profile_updated_at = _now()


@router.get("/profile")
def get_academic_profile(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    return _profile_payload(db, current_user)


@router.put("/profile")
def update_academic_profile(
    req: AcademicProfileRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    _save_profile(db, current_user, req)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="That profile could not be saved safely.") from exc
    db.refresh(current_user)
    return _profile_payload(db, current_user)


@router.post("/onboarding")
def complete_onboarding(
    req: AcademicProfileRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    req.complete = True
    _save_profile(db, current_user, req)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="That profile could not be saved safely.") from exc
    db.refresh(current_user)
    return _profile_payload(db, current_user)


@router.get("/recommendations")
def recommendations(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    course_ids = [row.course_id for row in db.query(models.UserCourse).filter(models.UserCourse.user_id == current_user.id).all()]
    groups_query = db.query(models.StudyGroup).filter(models.StudyGroup.status == "active")
    threads_query = db.query(models.DiscussionThread)
    rooms_query = db.query(models.StudySession).filter(models.StudySession.status == "active")
    if course_ids:
        groups_query = groups_query.filter(models.StudyGroup.course_id.in_(course_ids))
        threads_query = threads_query.filter(models.DiscussionThread.course_id.in_(course_ids))
        rooms_query = rooms_query.filter(models.StudySession.course_id.in_(course_ids))

    groups = groups_query.order_by(models.StudyGroup.created_at.desc()).limit(5).all()
    threads = threads_query.order_by(models.DiscussionThread.created_at.desc()).limit(5).all()
    rooms = rooms_query.order_by(models.StudySession.created_at.desc()).limit(5).all()
    return {
        "groups": [{"id": g.id, "name": g.name, "course_id": g.course_id, "topic": g.topic} for g in groups],
        "discussions": [{"id": t.id, "title": t.title, "course_id": t.course_id, "category": t.category} for t in threads],
        "rooms": [{"id": r.id, "title": r.title, "course_id": r.course_id, "topic": r.topic} for r in rooms],
    }


class GroupPostRequest(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    post_type: str = Field(default="discussion", pattern="^(discussion|announcement|lounge)$")


class GroupUpdateRequest(BaseModel):
    visibility: Optional[str] = Field(default=None, pattern="^(public|private)$")
    welcome_message: Optional[str] = Field(default=None, max_length=1000)
    archive: bool = False


class GroupInviteRequest(BaseModel):
    username: str = Field(min_length=3, max_length=24)


class CommunityReportRequest(BaseModel):
    subject_type: str = Field(pattern="^(group|thread|post|room)$")
    subject_id: int
    reason: str = Field(min_length=2, max_length=80)
    details: Optional[str] = Field(default=None, max_length=1000)


def _require_group_admin(db: Session, group_id: int, user_id: int) -> models.StudyGroupMember:
    membership = _member(db, group_id, user_id)
    if membership is None or membership.role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Group admin access is required.")
    return membership


def _serialize_post(post: models.StudyGroupPost, username: str | None) -> dict:
    return {
        "id": post.id,
        "group_id": post.group_id,
        "user_id": post.user_id,
        "username": username,
        "content": post.content,
        "post_type": post.post_type,
        "created_at": post.created_at,
    }


@router.get("/groups/{group_id}/home")
def group_home(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    group = _group_or_404(db, group_id)
    membership = _member(db, group_id, current_user.id)
    if group.visibility != "public" and membership is None:
        raise HTTPException(status_code=403, detail="Join this group to view its home.")
    post_count = db.query(models.StudyGroupPost).filter(models.StudyGroupPost.group_id == group_id).count()
    room_count = db.query(models.StudySession).filter(models.StudySession.group_id == group_id).count()
    material_count = 0
    if group.course_id:
        material_count = db.query(models.LectureNote).filter(models.LectureNote.course_id == group.course_id).count()
        material_count += db.query(models.PastQuestion).filter(models.PastQuestion.course_id == group.course_id).count()
    return {
        "group": {
            "id": group.id,
            "name": group.name,
            "description": group.description,
            "course_id": group.course_id,
            "topic": group.topic,
            "visibility": group.visibility,
            "status": group.status,
            "created_by": group.created_by,
            "welcome_message": group.welcome_message or "Welcome. Start with the course, then make the next question easier for someone else.",
        },
        "my_role": membership.role if membership else None,
        "tabs": {"discussions": post_count, "rooms": room_count, "materials": material_count},
        "checklist": {
            "joined": membership is not None,
            "introduced": db.query(models.StudyGroupPost).filter(
                models.StudyGroupPost.group_id == group_id,
                models.StudyGroupPost.user_id == current_user.id,
            ).count() > 0,
            "opened_room": db.query(models.StudySessionParticipant).join(
                models.StudySession,
                models.StudySession.id == models.StudySessionParticipant.session_id,
            ).filter(
                models.StudySession.group_id == group_id,
                models.StudySessionParticipant.user_id == current_user.id,
            ).count() > 0,
        },
    }


@router.get("/groups/{group_id}/posts")
def list_group_posts(
    group_id: int,
    post_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    group = _group_or_404(db, group_id)
    if group.visibility != "public" and _member(db, group_id, current_user.id) is None:
        raise HTTPException(status_code=403, detail="Join this group to view its posts.")
    query = db.query(models.StudyGroupPost).filter(models.StudyGroupPost.group_id == group_id)
    if post_type in {"discussion", "announcement", "lounge"}:
        query = query.filter(models.StudyGroupPost.post_type == post_type)
    posts = query.order_by(models.StudyGroupPost.created_at.desc()).limit(50).all()
    user_ids = {post.user_id for post in posts}
    users = db.query(models.User.id, models.User.username).filter(models.User.id.in_(user_ids)).all() if user_ids else []
    names = {row.id: row.username for row in users}
    return [_serialize_post(post, names.get(post.user_id)) for post in posts]


@router.put("/groups/{group_id}")
def update_group(
    group_id: int,
    req: GroupUpdateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    group = _group_or_404(db, group_id)
    _require_group_admin(db, group_id, current_user.id)
    if req.visibility is not None:
        group.visibility = req.visibility
    if req.welcome_message is not None:
        group.welcome_message = req.welcome_message.strip() or None
    if req.archive:
        group.status = "archived"
        group.archived_at = _now()
    db.commit()
    db.refresh(group)
    return {"id": group.id, "visibility": group.visibility, "status": group.status, "welcome_message": group.welcome_message}


@router.post("/groups/{group_id}/invite")
def invite_to_group(
    group_id: int,
    req: GroupInviteRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    group = _group_or_404(db, group_id)
    _require_group_admin(db, group_id, current_user.id)
    invited = db.query(models.User).filter(models.User.username == req.username.strip().lower()).first()
    if not invited:
        raise HTTPException(status_code=404, detail="That student could not be found.")
    if _member(db, group_id, invited.id):
        return {"status": "already_member"}
    invite = db.query(models.StudyGroupInvite).filter(
        models.StudyGroupInvite.group_id == group_id,
        models.StudyGroupInvite.invited_user_id == invited.id,
    ).first()
    if not invite:
        invite = models.StudyGroupInvite(
            group_id=group_id,
            invited_user_id=invited.id,
            invited_by=current_user.id,
            status="pending",
        )
        db.add(invite)
        db.commit()
    return {"status": "invited"}


@router.post("/groups/{group_id}/invite/accept")
def accept_group_invite(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    group = _group_or_404(db, group_id)
    if group.status != "active":
        raise HTTPException(status_code=409, detail="This study group is archived.")
    invite = db.query(models.StudyGroupInvite).filter(
        models.StudyGroupInvite.group_id == group_id,
        models.StudyGroupInvite.invited_user_id == current_user.id,
        models.StudyGroupInvite.status == "pending",
    ).first()
    if not invite:
        raise HTTPException(status_code=404, detail="No pending invite was found.")
    if not _member(db, group_id, current_user.id):
        db.add(models.StudyGroupMember(group_id=group_id, user_id=current_user.id, role="member"))
    invite.status = "accepted"
    db.commit()
    return {"status": "joined"}


@router.delete("/groups/{group_id}/members/{user_id}")
def remove_group_member(
    group_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    _group_or_404(db, group_id)
    _require_group_admin(db, group_id, current_user.id)
    member = _member(db, group_id, user_id)
    if not member:
        raise HTTPException(status_code=404, detail="Group member not found.")
    if member.role == "owner":
        raise HTTPException(status_code=409, detail="The group owner cannot be removed.")
    db.delete(member)
    db.commit()
    return {"status": "removed"}


@router.post("/reports")
def report_community_subject(
    req: CommunityReportRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    report = models.CommunityReport(
        reporter_id=current_user.id,
        subject_type=req.subject_type,
        subject_id=req.subject_id,
        reason=req.reason.strip(),
        details=req.details.strip() if req.details else None,
    )
    db.add(report)
    db.commit()
    return {"status": "reported"}


@router.post("/groups/{group_id}/posts")
def create_group_post(
    group_id: int,
    req: GroupPostRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role("student")),
):
    group = _group_or_404(db, group_id)
    membership = _member(db, group_id, current_user.id)
    if membership is None:
        raise HTTPException(status_code=403, detail="Join the group before posting.")
    if group.status != "active":
        raise HTTPException(status_code=409, detail="This group is archived.")
    if req.post_type == "announcement" and membership.role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Only group admins can post announcements.")
    post = models.StudyGroupPost(
        group_id=group_id,
        user_id=current_user.id,
        content=req.content.strip(),
        post_type=req.post_type,
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return _serialize_post(post, current_user.username)


@router.get("/rooms/{session_id}/summary")
def room_summary(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    session = db.query(models.StudySession).filter(models.StudySession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Reading room not found.")
    participant = db.query(models.StudySessionParticipant).filter(
        models.StudySessionParticipant.session_id == session_id,
        models.StudySessionParticipant.user_id == current_user.id,
    ).first()
    if not participant:
        raise HTTPException(status_code=403, detail="Join this reading room to view its summary.")
    intervals = db.query(models.StudySessionAttendanceInterval).filter(
        models.StudySessionAttendanceInterval.session_id == session_id,
        models.StudySessionAttendanceInterval.user_id == current_user.id,
    ).order_by(models.StudySessionAttendanceInterval.started_at).all()
    now = _now()
    totals: dict[str, int] = {"studying": 0, "break": 0}
    for interval in intervals:
        end = interval.ended_at or now
        totals[interval.kind] = totals.get(interval.kind, 0) + max(0, int((end - interval.started_at).total_seconds()))
    return {
        "session_id": session_id,
        "status": participant.status,
        "seconds": totals,
        "intervals": [
            {"kind": item.kind, "started_at": item.started_at, "ended_at": item.ended_at}
            for item in intervals
        ],
    }
