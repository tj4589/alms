"""Contribution review, secure sharing, and permitted exports.

This router deliberately keeps three concerns separate:

* material visibility (private, space-shared, official),
* contribution moderation (pending/rejected/etc.), and
* link/export access (a delivery mechanism, never a permission bypass).

The payloads in this module contain metadata and excerpts only.  Original
files remain behind the existing authorized download endpoints.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import auth
import models
from database import get_db
from material_access import (
    OFFICIAL,
    PRIVATE,
    SPACE_SHARED,
    can_view_material,
    contribution_for_material,
    contribution_payload,
    is_moderator,
    material_model,
    material_type_for_model,
    request_material_contribution,
    require_contribution_space,
    require_material_owner,
    sharing_payload,
)
from public_schemas import (
    PublicContributionMaterial,
    PublicContributionResponse,
    PublicLearningSpace,
    PublicModerationAudit,
    PublicModerationDetailResponse,
    PublicResolvedResourceResponse,
    PublicShareLinkListResponse,
    PublicShareLinkResponse,
    PublicUploader,
    PublicContributionState,
    public_material_metadata,
    public_shared_content_payload,
)
from rate_limiting import share_read_rate_limit, user_rate_limit

router = APIRouter(prefix="/collaboration", tags=["collaboration"])

MATERIAL_TYPES = {"past_question", "lecture_note"}
MODERATION_STATUSES = {"pending_review", "approved", "rejected", "changes_requested"}
LINK_POLICIES = {"owner", "space", "group", "anyone"}
EXPORT_TYPES = {"maxe_answer", "conversation_excerpt", "study_note", "quiz_result"}
MAX_LINK_PAYLOAD_CHARS = 18_000


class ContributionRequest(BaseModel):
    requested_visibility: Literal["space_shared"] = "space_shared"
    confirm: bool = False


class ModerationDecisionRequest(BaseModel):
    status: Literal["approved", "rejected", "changes_requested"]
    reason: str | None = Field(default=None, max_length=1_000)
    mark_official: bool = False


class ShareLinkRequest(BaseModel):
    content_type: Literal["resource", "maxe_answer", "conversation_excerpt", "quiz_result", "study_note"]
    content_id: str | None = Field(default=None, max_length=160)
    material_type: Literal["past_question", "lecture_note"] | None = None
    material_id: int | None = Field(default=None, gt=0)
    access_policy: Literal["owner", "space", "group", "anyone"] = "owner"
    group_id: int | None = Field(default=None, gt=0)
    expires_in_hours: int | None = Field(default=72, ge=1, le=720)
    payload: dict[str, Any] | None = None


class ExportRequest(BaseModel):
    content_type: Literal["maxe_answer", "conversation_excerpt", "study_note", "quiz_result"]
    title: str = Field(default="ExamMind export", max_length=240)
    payload: dict[str, Any] = Field(default_factory=dict)
    format: Literal["md", "txt"] = "md"


class ReportRequest(BaseModel):
    content_type: Literal["resource", "share_link"]
    content_id: int = Field(gt=0)
    reason: Literal["incorrect", "outdated", "copyright", "inappropriate", "other"]
    details: str | None = Field(default=None, max_length=1_000)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _safe_text(value: Any, limit: int = 4_000) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _safe_metadata(row: Any) -> dict[str, Any]:
    return public_material_metadata(getattr(row, "metadata_json", None))


def _material_row(db: Session, material_type: str, material_id: int):
    if material_type not in MATERIAL_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported material type.")
    row = db.query(material_model(material_type)).filter(material_model(material_type).id == material_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="That material does not exist.")
    return row


def _document_rows(db: Session, row: Any, material_type: str) -> list[Any]:
    """Return all retrieval rows for one upload without crossing owners."""
    if material_type != "past_question":
        return [row]
    metadata = row.metadata_json or {}
    source_file = str(metadata.get("source_file") or "").strip().lower()
    source_title = str(metadata.get("document_title") or "").strip().lower()
    candidates = db.query(models.PastQuestion).filter(
        models.PastQuestion.uploaded_by == row.uploaded_by,
    ).all()
    return [
        candidate for candidate in candidates
        if (source_file and str((candidate.metadata_json or {}).get("source_file") or "").strip().lower() == source_file)
        or (source_title and str((candidate.metadata_json or {}).get("document_title") or "").strip().lower() == source_title)
        or candidate.id == row.id
    ] or [row]


def _contribution_view(db: Session, contribution: models.MaterialContribution, row: Any | None = None) -> dict[str, Any]:
    uploader = db.query(models.User).filter(models.User.id == contribution.submitted_by).first()
    space = db.query(models.LearningSpace).filter(models.LearningSpace.id == contribution.learning_space_id).first()
    payload = contribution_payload(contribution)
    raw_metadata = getattr(row, "metadata_json", None) or {}
    return PublicContributionResponse(
        id=contribution.id,
        contribution_id=payload.get("contribution_id"),
        moderation_status=payload.get("moderation_status") or "not_submitted",
        requested_visibility=payload.get("requested_visibility"),
        review_reason=payload.get("review_reason"),
        learning_space_id=payload.get("learning_space_id"),
        submitted_at=payload.get("submitted_at"),
        reviewed_at=payload.get("reviewed_at"),
        material_type=contribution.material_type,
        material_id=contribution.material_id,
        learning_space=PublicLearningSpace(
            id=space.id,
            slug=space.slug,
            name=space.name,
        ) if space else None,
        uploader=PublicUploader(
            id=uploader.id,
            name=uploader.name,
            username=uploader.username,
        ) if uploader else None,
        material=PublicContributionMaterial(
            title=getattr(row, "title", None) or raw_metadata.get("document_title"),
            file_name=getattr(row, "file_name", None),
            file_mime=getattr(row, "file_mime", None),
            file_size=getattr(row, "file_size", None),
            metadata=_safe_metadata(row) if row is not None else {},
            preview=_safe_text(getattr(row, "content_text", None), 1_200) if row is not None else "",
        ) if row is not None else None,
    ).model_dump(mode="json")


def _audit(
    db: Session,
    contribution: models.MaterialContribution,
    actor: models.User,
    action: str,
    previous: dict[str, Any],
    new: dict[str, Any],
    reason: str | None = None,
) -> None:
    db.add(models.ModerationAudit(
        contribution_id=contribution.id,
        actor_id=actor.id,
        action=action,
        material_type=contribution.material_type,
        material_id=contribution.material_id,
        learning_space_id=contribution.learning_space_id,
        previous_state=previous,
        new_state=new,
        reason=reason,
    ))


def _state(contribution: models.MaterialContribution, row: Any | None = None) -> dict[str, Any]:
    return {
        "visibility": getattr(row, "visibility", None),
        "moderation_status": contribution.moderation_status,
        "requested_visibility": contribution.requested_visibility,
    }


def _safe_content_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Keep links/exports to the explicitly selected answer or note."""
    payload = payload or {}
    if any(key in payload for key in ("messages", "conversation", "prompt", "access_token", "token")):
        raise HTTPException(status_code=400, detail="Share one selected result or answer, not a whole conversation or private token.")
    safe: dict[str, Any] = {}
    for key in ("question", "answer", "explanation", "title", "body", "score", "total", "mode", "generated_at", "source", "citations"):
        if key not in payload:
            continue
        value = payload[key]
        if key == "citations" and isinstance(value, list):
            safe[key] = [
                {
                    field: item.get(field)
                    for field in (
                        "source", "resource_type", "resource_id", "page_from", "page_to",
                        "slide_from", "slide_to", "timestamp_start", "timestamp_end", "section",
                    )
                    if isinstance(item, dict) and item.get(field) is not None
                }
                for item in value[:20]
                if isinstance(item, dict)
            ]
        elif isinstance(value, (str, int, float, bool)):
            safe[key] = _safe_text(value, 8_000) if isinstance(value, str) else value
    if len(str(safe)) > MAX_LINK_PAYLOAD_CHARS:
        raise HTTPException(status_code=413, detail="That shared selection is too large.")
    return safe


def _policy_allows_link(db: Session, link: models.SecureShareLink, current_user: models.User) -> bool:
    if link.owner_id == current_user.id:
        return True
    if link.access_policy == "owner":
        return False
    if link.access_policy == "group":
        return bool(link.group_id and db.query(models.StudyGroupMember.id).filter(
            models.StudyGroupMember.group_id == link.group_id,
            models.StudyGroupMember.user_id == current_user.id,
        ).first())
    if link.access_policy in {"space", "anyone"} and link.learning_space_id:
        if not db.query(models.LearningSpaceMembership.id).filter(
            models.LearningSpaceMembership.learning_space_id == link.learning_space_id,
            models.LearningSpaceMembership.user_id == current_user.id,
            models.LearningSpaceMembership.status == "active",
        ).first():
            return False
    return link.access_policy == "anyone" or link.access_policy == "space"


def _citation_access(db: Session, payload: dict[str, Any], current_user: models.User) -> dict[str, Any]:
    result = dict(payload)
    citations = []
    for citation in payload.get("citations", []) if isinstance(payload.get("citations"), list) else []:
        item = dict(citation)
        material_type = item.get("resource_type") or item.get("material_type")
        material_id = item.get("resource_id") or item.get("material_id")
        if material_type in MATERIAL_TYPES and isinstance(material_id, int):
            row = db.query(material_model(material_type)).filter(material_model(material_type).id == material_id).first()
            if row is None or not can_view_material(db, row, current_user):
                item.pop("resource_id", None)
                item.pop("material_id", None)
                item["availability"] = "source_not_available"
        citations.append(item)
    if "citations" in result:
        result["citations"] = citations
    return result


def _markdown(title: str, payload: dict[str, Any], content_type: str) -> str:
    lines = [f"# {_safe_text(title, 240)}", "", f"_ExamMind {content_type.replace('_', ' ')} · AI-generated content_", ""]
    for label, key in (("Question", "question"), ("Answer", "answer"), ("Explanation", "explanation"), ("Notes", "body")):
        if payload.get(key):
            lines.extend([f"## {label}", _safe_text(payload[key], 12_000), ""])
    if payload.get("score") is not None:
        lines.extend([f"Score: {payload.get('score')} / {payload.get('total') or '?' }", ""])
    if payload.get("mode"):
        lines.extend([f"Mode: {payload['mode']}", ""])
    citations = payload.get("citations") or []
    if citations:
        lines.append("## Sources")
        for citation in citations[:20]:
            label = citation.get("source") or citation.get("section") or "Source"
            coordinates = []
            if citation.get("page_from") is not None:
                coordinates.append(f"page {citation['page_from']}")
            if citation.get("slide_from") is not None:
                coordinates.append(f"slide {citation['slide_from']}")
            if citation.get("timestamp_start") is not None:
                coordinates.append(f"{citation['timestamp_start']}s")
            lines.append(f"- {label}" + (f" ({', '.join(coordinates)})" if coordinates else ""))
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def _require_link(db: Session, token: str) -> models.SecureShareLink:
    link = db.query(models.SecureShareLink).filter(models.SecureShareLink.token_hash == _hash_token(token)).first()
    expires_at = link.expires_at if link is not None else None
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if link is None or link.revoked_at is not None or (expires_at and expires_at <= _now()):
        raise HTTPException(status_code=404, detail="That share link is no longer available.")
    return link


@router.post("/materials/{material_type}/{material_id}/contribute")
def submit_contribution(
    material_type: str,
    material_id: int,
    req: ContributionRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if not req.confirm:
        raise HTTPException(status_code=400, detail="Confirm that this material may be reviewed for the academy archive.")
    row = _material_row(db, material_type, material_id)
    require_material_owner(row, current_user)
    space = require_contribution_space(db, current_user)
    contribution = request_material_contribution(db, _document_rows(db, row, material_type), current_user, space.id)
    _audit(db, contribution, current_user, "submitted", {"moderation_status": "not_submitted"}, _state(contribution, row))
    db.commit()
    return {"status": "pending_review", "sharing": {**sharing_payload(PRIVATE), **contribution_payload(contribution)}}


@router.post("/materials/{material_type}/{material_id}/withdraw")
def withdraw_contribution(
    material_type: str,
    material_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    row = _material_row(db, material_type, material_id)
    require_material_owner(row, current_user)
    contribution = contribution_for_material(db, row)
    if contribution is None or contribution.moderation_status not in {"pending_review", "changes_requested"}:
        raise HTTPException(status_code=409, detail="Only a pending contribution can be withdrawn.")
    previous = _state(contribution, row)
    contribution.moderation_status = "not_submitted"
    contribution.review_reason = None
    row.visibility = PRIVATE
    _audit(db, contribution, current_user, "withdrawn", previous, _state(contribution, row))
    db.commit()
    return {"status": "withdrawn", "sharing": {**sharing_payload(PRIVATE), **contribution_payload(contribution)}}


@router.get("/contributions/mine", response_model=list[PublicContributionResponse])
def list_my_contributions(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    contributions = db.query(models.MaterialContribution).filter(
        models.MaterialContribution.submitted_by == current_user.id,
    ).order_by(models.MaterialContribution.updated_at.desc()).limit(100).all()
    return [_contribution_view(db, item, _material_row(db, item.material_type, item.material_id)) for item in contributions]


@router.get("/moderation/contributions", response_model=list[PublicContributionResponse])
def list_moderation_queue(
    status: str = Query(default="pending_review"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if status not in MODERATION_STATUSES:
        raise HTTPException(status_code=400, detail="That moderation status is not available.")
    candidates = db.query(models.MaterialContribution).filter(
        models.MaterialContribution.moderation_status == status,
    ).order_by(models.MaterialContribution.submitted_at.asc()).limit(100).all()
    visible = [item for item in candidates if is_moderator(db, current_user, item.learning_space_id)]
    return [_contribution_view(db, item, _material_row(db, item.material_type, item.material_id)) for item in visible]


@router.get("/moderation/contributions/{contribution_id}", response_model=PublicModerationDetailResponse)
def moderation_detail(
    contribution_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    contribution = db.query(models.MaterialContribution).filter(models.MaterialContribution.id == contribution_id).first()
    if contribution is None or not is_moderator(db, current_user, contribution.learning_space_id):
        raise HTTPException(status_code=404, detail="That contribution is not available.")
    row = _material_row(db, contribution.material_type, contribution.material_id)
    audits = db.query(models.ModerationAudit).filter(
        models.ModerationAudit.contribution_id == contribution.id,
    ).order_by(models.ModerationAudit.created_at.asc()).all()
    base = _contribution_view(db, contribution, row)
    return PublicModerationDetailResponse(
        **base,
        audit=[
            PublicModerationAudit(
                action=item.action,
                reason=item.reason,
                previous_state=PublicContributionState.model_validate(item.previous_state or {}),
                new_state=PublicContributionState.model_validate(item.new_state or {}),
                created_at=item.created_at,
            )
            for item in audits
        ],
    )


@router.post("/moderation/contributions/{contribution_id}/decision")
def decide_contribution(
    contribution_id: int,
    req: ModerationDecisionRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    contribution = db.query(models.MaterialContribution).filter(models.MaterialContribution.id == contribution_id).first()
    if contribution is None or not is_moderator(db, current_user, contribution.learning_space_id):
        raise HTTPException(status_code=404, detail="That contribution is not available.")
    if contribution.submitted_by == current_user.id:
        raise HTTPException(status_code=403, detail="A contributor cannot approve their own material.")
    reason = _safe_text(req.reason, 1_000)
    if req.status != "approved" and not reason:
        raise HTTPException(status_code=400, detail="Add a reason for rejection or requested changes.")
    if req.mark_official and req.status != "approved":
        raise HTTPException(status_code=400, detail="Only an approved contribution can be marked official.")
    row = _material_row(db, contribution.material_type, contribution.material_id)
    previous = _state(contribution, row)
    rows = _document_rows(db, row, contribution.material_type)
    related = []
    for candidate in rows:
        item = contribution_for_material(db, candidate)
        if item is not None:
            related.append(item)
        candidate.visibility = OFFICIAL if req.mark_official else (SPACE_SHARED if req.status == "approved" else PRIVATE)
        metadata = dict(candidate.metadata_json or {})
        metadata["visibility"] = candidate.visibility
        metadata["moderation_status"] = req.status
        candidate.metadata_json = metadata
    for item in related:
        item.moderation_status = req.status
        item.review_reason = reason or None
        item.reviewed_by = current_user.id
        item.reviewed_at = _now()
        _audit(db, item, current_user, "marked_official" if req.mark_official else req.status, previous, _state(item, row), reason or None)
    db.commit()
    return {"status": req.status, "official": req.mark_official, "reason": reason or None, "sharing": {"visibility": OFFICIAL if req.mark_official else (SPACE_SHARED if req.status == "approved" else PRIVATE), "moderation_status": req.status}}


@router.post("/share-links")
def create_share_link(
    req: ShareLinkRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
    _rate_limit: None = Depends(user_rate_limit("share_create", auth.get_current_user)),
):
    if req.content_type == "resource":
        if not req.material_type or not req.material_id:
            raise HTTPException(status_code=400, detail="A resource share needs a material type and ID.")
        row = _material_row(db, req.material_type, req.material_id)
        if not can_view_material(db, row, current_user):
            raise HTTPException(status_code=404, detail="That resource is not available.")
        owner_id = row.uploaded_by
        contribution = contribution_for_material(db, row)
        learning_space_id = contribution.learning_space_id if contribution else None
        if req.access_policy == "anyone" and getattr(row, "visibility", None) != OFFICIAL:
            raise HTTPException(status_code=400, detail="Anyone-link sharing is available only for official resources.")
        if req.access_policy == "group" and not req.group_id:
            raise HTTPException(status_code=400, detail="Choose a study group for a group link.")
        if req.access_policy == "group":
            group_member = db.query(models.StudyGroupMember.id).filter(
                models.StudyGroupMember.group_id == req.group_id,
                models.StudyGroupMember.user_id == current_user.id,
            ).first()
            if group_member is None:
                raise HTTPException(status_code=403, detail="Join that study group before creating a group link.")
        if req.access_policy == "space" and not learning_space_id:
            raise HTTPException(status_code=400, detail="This resource is not attached to a learning space.")
        payload = None
    else:
        if req.access_policy != "owner":
            raise HTTPException(status_code=400, detail="Selected answers and study notes are private by default.")
        owner_id = current_user.id
        learning_space_id = None
        payload = _safe_content_payload(req.payload)
    raw_token = secrets.token_urlsafe(32)
    link = models.SecureShareLink(
        token_hash=_hash_token(raw_token),
        owner_id=owner_id,
        content_type=req.content_type,
        content_id=req.content_id,
        material_type=req.material_type,
        material_id=req.material_id,
        learning_space_id=learning_space_id,
        group_id=req.group_id,
        access_policy=req.access_policy,
        payload_json=payload,
        settings_json={"created_by": current_user.id},
        expires_at=_now() + timedelta(hours=req.expires_in_hours) if req.expires_in_hours else None,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return PublicShareLinkResponse(
        id=link.id,
        token=raw_token,
        expires_at=link.expires_at,
        access_policy=link.access_policy,
        content_type=link.content_type,
    ).model_dump(mode="json")


@router.get("/share/{token}")
def resolve_share_link(
    token: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
    _rate_limit: None = Depends(share_read_rate_limit),
):
    link = _require_link(db, token)
    if not _policy_allows_link(db, link, current_user):
        raise HTTPException(status_code=404, detail="That shared item is not available to you.")
    if link.content_type == "resource":
        if not link.material_type or not link.material_id:
            raise HTTPException(status_code=404, detail="That shared item is incomplete.")
        row = _material_row(db, link.material_type, link.material_id)
        if not can_view_material(db, row, current_user):
            raise HTTPException(status_code=404, detail="That shared item is not available to you.")
        return PublicResolvedResourceResponse(
            content_type="resource",
            material_type=link.material_type,
            material_id=link.material_id,
            title=getattr(row, "title", None) or (row.metadata_json or {}).get("document_title"),
            visibility=getattr(row, "visibility", PRIVATE) or PRIVATE,
            metadata=_safe_metadata(row),
            verified_citations=[],
        ).model_dump(mode="json")
    payload = _citation_access(db, link.payload_json or {}, current_user)
    return {
        "content_type": link.content_type,
        "content_id": link.content_id,
        "payload": public_shared_content_payload(payload),
        "created_at": link.created_at,
    }


@router.get("/share-links", response_model=list[PublicShareLinkListResponse])
def list_share_links(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    links = db.query(models.SecureShareLink).filter(models.SecureShareLink.owner_id == current_user.id).order_by(models.SecureShareLink.created_at.desc()).limit(100).all()
    return [
        PublicShareLinkListResponse(
            id=item.id,
            content_type=item.content_type,
            access_policy=item.access_policy,
            expires_at=item.expires_at,
            revoked_at=item.revoked_at,
            created_at=item.created_at,
        )
        for item in links
    ]


@router.delete("/share-links/{link_id}")
def revoke_share_link(
    link_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    link = db.query(models.SecureShareLink).filter(models.SecureShareLink.id == link_id).first()
    if link is None:
        raise HTTPException(status_code=404, detail="That share link does not exist.")
    if link.owner_id != current_user.id and not is_moderator(db, current_user, link.learning_space_id):
        raise HTTPException(status_code=403, detail="Only the owner or an authorized moderator can revoke this link.")
    link.revoked_at = _now()
    db.commit()
    return {"status": "revoked", "id": link.id}


@router.get("/materials/{material_type}/{material_id}/export")
def export_material(
    material_type: str,
    material_id: int,
    format: Literal["md", "txt"] = "md",
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
    _rate_limit: None = Depends(user_rate_limit("export", auth.get_current_user)),
):
    row = _material_row(db, material_type, material_id)
    if not can_view_material(db, row, current_user):
        raise HTTPException(status_code=404, detail="That material is not available.")
    metadata = _safe_metadata(row)
    title = getattr(row, "title", None) or metadata.get("document_title") or "ExamMind material"
    body = _safe_text(getattr(row, "content_text", None), 60_000)
    if metadata.get("document_type") == "audio":
        segments = db.query(models.AudioTranscriptSegment).filter(
            models.AudioTranscriptSegment.resource_id == row.id,
        ).order_by(models.AudioTranscriptSegment.segment_index.asc()).all()
        body = "\n".join(
            f"[{segment.start_time:.1f}s–{segment.end_time:.1f}s] {segment.text}"
            for segment in segments
        )[:60_000]
    if not body and material_type == "past_question":
        body = _safe_text((row.metadata_json or {}).get("content_preview"), 60_000)
    text = _markdown(title, {"body": body, "mode": "source"}, "material") if format == "md" else f"{title}\n\n{body}\n"
    return Response(content=text, media_type="text/markdown" if format == "md" else "text/plain", headers={"Content-Disposition": f'attachment; filename="{re.sub(r"[^A-Za-z0-9._-]+", "-", title)[:80]}.{format}"'})


@router.post("/exports")
def export_selected_content(
    req: ExportRequest,
    current_user: models.User = Depends(auth.get_current_user),
    _rate_limit: None = Depends(user_rate_limit("export", auth.get_current_user)),
):
    payload = _safe_content_payload(req.payload)
    text = _markdown(req.title, payload, req.content_type) if req.format == "md" else f"{req.title}\n\n{payload.get('answer') or payload.get('body') or ''}\n"
    return Response(content=text, media_type="text/markdown" if req.format == "md" else "text/plain", headers={"Content-Disposition": f'attachment; filename="{re.sub(r"[^A-Za-z0-9._-]+", "-", req.title)[:80]}.{req.format}"'})


@router.post("/reports")
def report_shared_content(
    req: ReportRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db.add(models.CommunityReport(
        reporter_id=current_user.id,
        subject_type="lecture_note" if req.content_type == "resource" else "share_link",
        subject_id=req.content_id,
        reason=req.reason,
        details=req.details,
    ))
    db.commit()
    return {"status": "reported"}
