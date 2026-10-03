"""Explicit response contracts for data that may leave the API.

The ORM models contain storage, retrieval and provider fields that are useful
inside the backend but are not part of a public response.  These DTOs keep the
public surface allowlisted.  Authorized reader, transcript, upload-preview,
download and export responses use separate contracts in their routers because
they intentionally carry content.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field


class PublicDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Existing internal callers historically treated these small response
    # dictionaries as mappings. Keep that compatibility while the API route
    # now validates them as explicit DTOs.
    def __getitem__(self, key: str) -> Any:
        return getattr(self, key)


class PublicMaterialMetadata(PublicDTO):
    """Metadata that is useful for catalogue cards and workspace state."""

    document_title: str | None = None
    document_type: str | None = None
    course_code: str | None = None
    course_title: str | None = None
    academic_year: str | None = None
    year: int | str | None = None
    semester: str | None = None
    department: str | None = None
    faculty: str | None = None
    college: str | None = None
    institution: str | None = None
    exam_type: str | None = None
    instructor_names: list[str] | None = None
    topics_covered: list[str] | None = None
    extraction_method: str | None = None
    extraction_confidence: float | None = None
    indexed_status: str | None = None
    searchable: bool | None = None
    needs_review: bool | None = None
    needs_clearer_file: bool | None = None
    pages_read: int | None = None
    confidence_score: float | None = None
    processing_status: str | None = None
    transcription_status: str | None = None
    transcript_available: bool | None = None
    visibility: str | None = None
    requested_visibility: str | None = None
    moderation_status: str | None = None
    course_catalogue_status: str | None = None
    catalogue_course_id: int | None = None


_PUBLIC_METADATA_FIELDS = frozenset(PublicMaterialMetadata.model_fields)


def _safe_text(value: Any) -> str | None:
    if isinstance(value, (str, int, float, bool)):
        return str(value)
    return None


def _safe_text_list(value: Any) -> list[str] | None:
    if not isinstance(value, (list, tuple)):
        return None
    return [item for item in (_safe_text(entry) for entry in value) if item]


def public_material_metadata(value: Mapping[str, Any] | None) -> dict[str, Any]:
    """Return only documented, non-content catalogue metadata.

    This intentionally does not copy unknown keys.  In particular it excludes
    bytes, storage references, extracted text, embeddings, provider details,
    checksums and moderation evidence even when they are nested in metadata.
    """

    source = value if isinstance(value, Mapping) else {}
    candidate: dict[str, Any] = {}
    for key in _PUBLIC_METADATA_FIELDS:
        if key not in source:
            continue
        item = source[key]
        if key in {"instructor_names", "topics_covered"}:
            item = _safe_text_list(item)
        elif key in {
            "document_title", "document_type", "course_code", "course_title",
            "academic_year", "semester", "department", "faculty", "college",
            "institution", "exam_type", "extraction_method", "indexed_status",
            "processing_status", "transcription_status", "visibility",
            "requested_visibility", "moderation_status", "course_catalogue_status",
        }:
            item = _safe_text(item)
        elif key in {"year", "catalogue_course_id", "pages_read"}:
            item = item if isinstance(item, (int, str)) and not isinstance(item, bool) else None
            if key != "year" and isinstance(item, str):
                try:
                    item = int(item)
                except ValueError:
                    item = None
        elif key in {"extraction_confidence", "confidence_score"}:
            item = item if isinstance(item, (int, float)) and not isinstance(item, bool) else None
        elif key in {"searchable", "needs_review", "needs_clearer_file", "transcript_available"}:
            item = item if isinstance(item, bool) else None
        if item is not None:
            candidate[key] = item
    return PublicMaterialMetadata.model_validate(candidate).model_dump(mode="json", exclude_none=True)


class PublicPastQuestionResponse(PublicDTO):
    id: int
    course_id: int | None = None
    topic_id: int | None = None
    year: int | None = None
    semester: str | None = None
    difficulty: str | None = None
    file_name: str | None = None
    file_size: int | None = None
    has_file: bool = False
    has_text: bool = False
    # Past-question rows are the existing authorized source-reading contract
    # used by Workspace. This is question content, not raw extraction or
    # hidden metadata; storage and retrieval fields remain excluded.
    content_text: str | None = None
    is_owner: bool = False
    visibility: str
    contributor_label: str | None = None
    moderation_status: str | None = None
    requested_visibility: str | None = None
    created_at: datetime | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class PublicLectureNoteResponse(PublicDTO):
    id: int
    course_id: int | None = None
    topic: str | None = None
    title: str | None = None
    year: int | None = None
    semester: str | None = None
    file_name: str | None = None
    file_size: int | None = None
    has_file: bool = False
    is_owner: bool = False
    visibility: str
    contributor_label: str | None = None
    moderation_status: str | None = None
    requested_visibility: str | None = None
    created_at: datetime | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class PublicReaderSection(PublicDTO):
    id: int
    index: int
    heading: str | None = None
    body: str
    page_from: int | None = None
    page_to: int | None = None
    cut_by: str


class PublicLectureNoteReaderResponse(PublicLectureNoteResponse):
    course_code: str | None = None
    course_name: str | None = None
    uploaded_by_username: str | None = None
    sections: list[PublicReaderSection] = Field(default_factory=list)
    content_text: str | None = None


class PublicAudioTranscriptSegment(PublicDTO):
    id: int
    segment_index: int
    start_time: float
    end_time: float
    text: str
    speaker: str | None = None
    confidence: float | None = None
    topic: str | None = None


class PublicAudioTranscriptResponse(PublicDTO):
    resource_id: int
    title: str | None = None
    file_name: str | None = None
    processing_status: str
    transcription_status: str
    message: str
    segments: list[PublicAudioTranscriptSegment] = Field(default_factory=list)


class PublicCitationTarget(PublicDTO):
    screen: str | None = None
    resource_type: str | None = None
    resource_id: int | None = None
    start_time: float | None = None
    end_time: float | None = None
    page_from: int | None = None
    slide_from: int | None = None


class PublicSourceCitation(PublicDTO):
    source: str | None = None
    material_type: str | None = None
    resource_type: str | None = None
    resource_id: int | None = None
    material_id: int | None = None
    chunk_id: int | None = None
    resource_title: str | None = None
    label: str | None = None
    page_from: int | None = None
    page_to: int | None = None
    slide_from: int | None = None
    slide_to: int | None = None
    timestamp_start: float | None = None
    timestamp_end: float | None = None
    section: str | None = None
    heading: str | None = None
    section_index: int | None = None
    evidence_status: str | None = None
    target: PublicCitationTarget | None = None


class PublicMaxeActiveResource(PublicDTO):
    resource_type: str
    resource_id: int
    title: str | None = None


class PublicMaxeContext(PublicDTO):
    mode: Literal["source", "beyond_materials"]
    workspace_name: str | None = None
    active_resource: PublicMaxeActiveResource | None = None
    selected_text_used: bool = False
    selected_text_source: str | None = None
    recent_context_used: bool = False


class PublicUnderstanding(PublicDTO):
    interpreted_topic: str | None = None
    related_terms: list[str] = Field(default_factory=list)
    possible_courses: list[str] = Field(default_factory=list)
    possible_people: list[str] = Field(default_factory=list)
    person_name: str | None = None
    course_code: str | None = None
    topic: str | None = None
    should_search: bool = False
    should_call_rag: bool = False
    needs_course: bool = False
    needs_person: bool = False
    intent: str = "general_search"
    confidence: float = 0.0
    needs_clarification: bool = False
    clarifying_question: str | None = None


class PublicLearningSuggestionEvidence(PublicDTO):
    answers: int | None = None
    missed: int | None = None
    attempts: int | None = None
    correct_answers: int | None = None
    distinct_topics: int | None = None
    known_topics: int | None = None
    latest_answered_at: datetime | None = None


class PublicLearningSuggestion(PublicDTO):
    message: str
    topic: str | None = None
    action: str
    evidence: PublicLearningSuggestionEvidence = Field(default_factory=PublicLearningSuggestionEvidence)


class PublicSearchPastQuestionResponse(PublicDTO):
    id: int
    course_id: int | None = None
    year: int | None = None
    semester: str | None = None
    difficulty: str | None = None
    title: str
    content_text: str = ""
    snippets: list[str] = Field(default_factory=list)
    chunk_ids: list[int] = Field(default_factory=list)
    matching_sections: int = 0
    visibility: str
    contributor_label: str | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class PublicSearchLectureNoteResponse(PublicDTO):
    id: int
    course_id: int | None = None
    topic: str | None = None
    title: str
    year: int | None = None
    semester: str | None = None
    visibility: str
    contributor_label: str | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class PublicLearningSpace(PublicDTO):
    id: int
    slug: str
    name: str


class PublicUploader(PublicDTO):
    id: int
    name: str | None = None
    username: str | None = None


class PublicContributionMaterial(PublicDTO):
    title: str | None = None
    file_name: str | None = None
    file_mime: str | None = None
    file_size: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    preview: str = ""


class PublicContributionResponse(PublicDTO):
    id: int
    contribution_id: int | None = None
    moderation_status: str
    requested_visibility: str | None = None
    review_reason: str | None = None
    learning_space_id: int | None = None
    submitted_at: datetime | None = None
    reviewed_at: datetime | None = None
    material_type: str
    material_id: int
    learning_space: PublicLearningSpace | None = None
    uploader: PublicUploader | None = None
    material: PublicContributionMaterial | None = None


class PublicContributionState(PublicDTO):
    visibility: str | None = None
    moderation_status: str | None = None
    requested_visibility: str | None = None


class PublicModerationAudit(PublicDTO):
    action: str
    reason: str | None = None
    previous_state: PublicContributionState
    new_state: PublicContributionState
    created_at: datetime | None = None


class PublicModerationDetailResponse(PublicContributionResponse):
    audit: list[PublicModerationAudit] = Field(default_factory=list)


class PublicShareLinkResponse(PublicDTO):
    id: int
    content_type: str
    access_policy: str
    expires_at: datetime | None = None
    revoked_at: datetime | None = None
    created_at: datetime | None = None
    token: str | None = None


class PublicShareLinkListResponse(PublicDTO):
    """Previously-created links deliberately never include a token."""

    id: int
    content_type: str
    access_policy: str
    expires_at: datetime | None = None
    revoked_at: datetime | None = None
    created_at: datetime | None = None


class PublicSharedContentCitation(PublicDTO):
    source: str | None = None
    resource_type: str | None = None
    resource_id: int | None = None
    page_from: int | None = None
    page_to: int | None = None
    slide_from: int | None = None
    slide_to: int | None = None
    timestamp_start: float | None = None
    timestamp_end: float | None = None
    section: str | None = None
    availability: str | None = None


class PublicSharedContentPayload(PublicDTO):
    question: str | None = None
    answer: str | None = None
    explanation: str | None = None
    title: str | None = None
    body: str | None = None
    score: int | float | None = None
    total: int | float | None = None
    mode: str | None = None
    generated_at: str | None = None
    source: str | None = None
    citations: list[PublicSharedContentCitation] = Field(default_factory=list)


class PublicResolvedResourceResponse(PublicDTO):
    content_type: Literal["resource"]
    material_type: str
    material_id: int
    title: str | None = None
    visibility: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    verified_citations: list[PublicSharedContentCitation] = Field(default_factory=list)


def public_shared_content_payload(value: Mapping[str, Any] | None) -> dict[str, Any]:
    """Project a stored selected-result payload onto its public contract."""

    source = value if isinstance(value, Mapping) else {}
    candidate = {key: source[key] for key in PublicSharedContentPayload.model_fields if key in source}
    citations = []
    for item in candidate.get("citations", []) if isinstance(candidate.get("citations"), list) else []:
        if not isinstance(item, Mapping):
            continue
        citations.append({
            key: item[key]
            for key in PublicSharedContentCitation.model_fields
            if key in item and item[key] is not None
        })
    if "citations" in candidate:
        candidate["citations"] = citations[:20]
    return PublicSharedContentPayload.model_validate(candidate).model_dump(mode="json", exclude_none=True)
