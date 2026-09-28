import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, FileText, Globe2, LockKeyhole, Plus, Users, X } from 'lucide-react';
import type { Course, ScreenType, User } from '../types';
import { queuePendingUpload } from '../offline';
import { apiFormPost, apiGet, apiPatch } from '../lib/api';

import './Upload.css';

type RecentUpload = {
  id: number;
  material_type: 'past_question' | 'lecture_note';
  title?: string | null;
  year: number | null;
  visibility?: ShareVisibility;
  shared_group_ids?: number[];
  created_at?: string | null;
  metadata_json: {
    course_code?: string;
    document_type?: string;
    topics_covered?: string[];
    indexed_status?: string;
    needs_clearer_file?: boolean;
  } | null;
};

type ShareVisibility = 'public' | 'group' | 'private';
type ShareGroup = { id: number; name: string; is_member?: boolean; status?: string };
type DuplicateDocument = {
  id: number;
  type: 'past_question' | 'lecture_note';
  title?: string | null;
  match_type?: 'exact_checksum' | 'filename_or_title' | 'text_similarity';
  similarity?: number;
  actions?: string[];
};

type UploadState = 'idle' | 'processing' | 'confirm' | 'manual_metadata_required' | 'duplicate' | 'success' | 'error';
type UploadAction = 'analyze' | 'index';
type StepStatus = 'pending' | 'active' | 'done' | 'error';
type ProcessingStep = { label: string; status: StepStatus };
type PreviewItem = { label: string; text: string };
type PreviewSection = { title: string; items: PreviewItem[] };
type ContentPreview = {
  instruction?: string;
  scenario?: string;
  questions?: { number: string; preview: string }[];
};

type ExtractionInfo = {
  page_count?: number;
  method?: string;
  extraction_confidence?: number;
  text_char_count?: number;
  ocr_used?: boolean;
  indexed_status?: string;
  searchable?: boolean;
  needs_review?: boolean;
};

type CourseState = 'loading' | 'ready' | 'empty' | 'error';
type MetadataEvidence = {
  value?: unknown;
  status?: 'catalogue_confirmed' | 'strong_evidence' | 'suggested' | 'missing_required' | 'optional' | 'conflict';
  source?: string;
  confidence?: number;
  evidence?: string;
  page_number?: number | null;
  requires_confirmation?: boolean;
};
type FieldStatus = 'detected' | 'review' | 'missing' | 'edited' | 'catalogue' | 'strong' | 'suggested' | 'optional' | 'conflict';
type ValidationErrors = Partial<Record<'document_title' | 'document_type' | 'course' | 'academic_year' | 'semester' | 'year' | 'topics' | 'sharing', string>>;

type Metadata = {
  document_type: string;
  document_title: string;
  course_code: string;
  course_title: string;
  instructor_names: string[];
  academic_year: string;
  year: number | '';
  semester: string;
  department: string;
  faculty: string;
  college: string;
  exam_type: string;
  topics_covered: string[];
  source_file?: string;
  extraction_method: string;
  extraction_confidence: number;
  extraction_failure_reason?: string;
  indexed_status?: string;
  searchable?: boolean;
  needs_review?: boolean;
  needs_clearer_file?: boolean;
  confidence_score?: number;
  pages_read?: number;
  metadata_evidence?: Record<string, MetadataEvidence>;
  metadata_proposal?: Record<string, unknown>;
  metadata_corrections?: Record<string, unknown>;
  metadata_model_version?: string;
  metadata_conflicts?: Record<string, unknown>;
  course_catalogue_status?: string;
  catalogue_course_id?: number | null;
};

const emptyMetadata: Metadata = {
  document_type: 'past_question',
  document_title: '',
  course_code: '',
  course_title: '',
  instructor_names: [],
  academic_year: '',
  year: '',
  semester: '',
  department: '',
  faculty: '',
  college: '',
  exam_type: 'unknown',
  topics_covered: [],
  extraction_method: 'embedded_text',
  extraction_confidence: 0,
  extraction_failure_reason: '',
  indexed_status: 'indexed',
  searchable: true,
  needs_review: false,
  needs_clearer_file: false,
  pages_read: 0,
  metadata_evidence: {},
};

const STEP_LABELS = [
  'Reading document',
  'Extracting text / running OCR if needed',
  'Understanding academic metadata',
  'Checking duplicates',
  'Preparing for indexing',
];

const mkSteps = (activeIndex = 0): ProcessingStep[] =>
  STEP_LABELS.map((label, i) => ({ label, status: i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending' }));
const doneSteps = (through = STEP_LABELS.length - 1): ProcessingStep[] =>
  STEP_LABELS.map((label, i) => ({ label, status: i <= through ? 'done' : 'pending' }));
const failSteps = (errIdx: number): ProcessingStep[] =>
  STEP_LABELS.map((label, i) => ({ label, status: i < errIdx ? 'done' : i === errIdx ? 'error' : 'pending' }));

const DOC_TYPE_LABEL: Record<string, string> = {
  past_question: 'Past Question',
  lecture_note: 'Lecture Note',
  course_outline: 'Course Outline',
  tutorial: 'Tutorial',
  assignment: 'Assignment',
  revision_slide: 'Revision Slide',
  exam_prep: 'Exam Prep',
  unknown: 'Academic Document',
};

const DOC_TYPES = Object.keys(DOC_TYPE_LABEL);
const EXAM_TYPES = ['unknown', 'quiz', 'test', 'midterm', 'continuous_assessment', 'final'];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const UNKNOWN_VALUES = new Set(['unknown', 'not found', 'n/a', 'na', 'none', 'null', 'undefined', 'not available']);

function rescueMessage(reason?: string) {
  if (reason === 'ocr_not_installed') return 'OCR is not installed on this server. Install Tesseract OCR or upload a text-based file.';
  if (reason === 'ocr_failed' || reason === 'ocr_low_confidence' || reason === 'file_too_blurry') return 'ExamMind tried OCR, but the scan is too unclear to read confidently.';
  if (reason === 'encrypted_pdf') return 'This PDF appears to be encrypted. Upload an unlocked PDF.';
  return 'ExamMind could not read this file clearly.';
}

function displayValue(value?: string | number | null, fallback = 'Not found') {
  if (value === null || value === undefined || value === '' || UNKNOWN_VALUES.has(String(value).trim().toLowerCase())) return fallback;
  return String(value);
}

function cleanIncomingValue(value: unknown, field = '') {
  const text = String(value ?? '').trim();
  if (!text || UNKNOWN_VALUES.has(text.toLowerCase())) return '';
  if (field === 'document_title' && /^unknown(?:\s+material)?$/i.test(text)) return '';
  return text;
}

function normalizeList(value: unknown) {
  const values = Array.isArray(value) ? value : String(value ?? '').split(',');
  const seen = new Set<string>();
  return values
    .map(item => String(item ?? '').trim())
    .filter(item => item && !UNKNOWN_VALUES.has(item.toLowerCase()))
    .filter(item => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeMetadata(value: Record<string, unknown> = {}) : Metadata {
  const next = { ...emptyMetadata, ...value } as Metadata;
  return {
    ...next,
    document_type: cleanIncomingValue(next.document_type) || 'unknown',
    document_title: cleanIncomingValue(next.document_title, 'document_title'),
    course_code: cleanIncomingValue(next.course_code, 'course_code'),
    course_title: cleanIncomingValue(next.course_title, 'course_title'),
    instructor_names: normalizeList(next.instructor_names),
    academic_year: cleanIncomingValue(next.academic_year, 'academic_year'),
    semester: cleanIncomingValue(next.semester, 'semester'),
    department: cleanIncomingValue(next.department, 'department'),
    faculty: cleanIncomingValue(next.faculty, 'faculty'),
    college: cleanIncomingValue(next.college, 'college'),
    exam_type: cleanIncomingValue(next.exam_type, 'exam_type') || 'unknown',
    topics_covered: normalizeList(next.topics_covered),
    year: next.year === '' || next.year === null || next.year === undefined ? '' : Number(next.year) || '',
  };
}

function visibilityLabel(visibility: ShareVisibility) {
  if (visibility === 'public') return 'Academy archive';
  if (visibility === 'group') return 'Study group only';
  return 'Only me';
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MB`;
}

function fileTypeLabel(file: File | null) {
  if (!file) return 'Document';
  const extension = file.name.split('.').pop()?.toUpperCase();
  return extension || file.type || 'Document';
}

function statusLabel(status: FieldStatus) {
  if (status === 'catalogue') return 'Catalogue';
  if (status === 'strong') return 'Verified';
  if (status === 'suggested') return 'Suggested';
  if (status === 'optional') return 'Optional';
  if (status === 'conflict') return 'Conflict';
  return status === 'detected' ? 'Detected' : status === 'review' ? 'Needs review' : status === 'edited' ? 'Edited' : 'Not found';
}

function fieldStatus(value: string | number | null | undefined, edited: boolean, needsReview = false, evidence?: MetadataEvidence): FieldStatus {
  if (edited) return 'edited';
  if (evidence?.status === 'catalogue_confirmed') return 'catalogue';
  if (evidence?.status === 'strong_evidence') return 'strong';
  if (evidence?.status === 'suggested') return 'suggested';
  if (evidence?.status === 'conflict') return 'conflict';
  if (evidence?.status === 'optional') return 'optional';
  if (evidence?.status === 'missing_required') return 'missing';
  if (!displayValue(value, '')) return 'missing';
  return needsReview ? 'review' : 'detected';
}

const EVIDENCE_FIELD_KEY: Record<string, string> = {
  document_title: 'title',
  academic_year: 'academic_session',
  instructor_names: 'instructor_or_author',
  topics_covered: 'topics',
};

function metadataEvidence(metadata: Metadata, field: string) {
  return metadata.metadata_evidence?.[EVIDENCE_FIELD_KEY[field] || field];
}

function metadataFieldStatus(metadata: Metadata, field: string, value: string | number | null | undefined, edited: boolean, needsReview = false) {
  return fieldStatus(value, edited, needsReview, metadataEvidence(metadata, field));
}

function FieldStatusBadge({ status }: { status: FieldStatus }) {
  return <span className={`field-status field-status--${status}`}>{statusLabel(status)}</span>;
}

function SharingChoice({
  visibility,
  onVisibilityChange,
  groups,
  selectedGroupIds,
  onToggleGroup,
  consent,
  onConsentChange,
  error,
  compact = false,
}: {
  visibility: ShareVisibility;
  onVisibilityChange: (value: ShareVisibility) => void;
  groups: ShareGroup[];
  selectedGroupIds: number[];
  onToggleGroup: (groupId: number) => void;
  consent: boolean;
  onConsentChange: (value: boolean) => void;
  error?: string;
  compact?: boolean;
}) {
  const selectedGroups = groups.filter(group => selectedGroupIds.includes(group.id));
  return (
    <section className={`sharing-choice${compact ? ' sharing-choice--compact' : ''}`} aria-labelledby="sharing-choice-title">
      <div className="sharing-choice-head">
        <div>
          <div className="document-summary-label" id="sharing-choice-title">Where should this material be available?</div>
          <p>The academy archive is the recommended path for course resources. You will confirm before anything is shared.</p>
        </div>
        <span className="sharing-safe-note"><LockKeyhole size={13} /> Consent required</span>
      </div>
      <p className="sharing-private-data-note">
        {compact
          ? 'Your personal study data always stays private.'
          : 'Your conversations with Maxe, highlights, practice attempts, scores, weaknesses and revision plan always stay private.'}
      </p>

      <div className="sharing-options" role="radiogroup" aria-label="Where this material should be available">
        <label className={`sharing-option sharing-option--recommended${visibility === 'public' ? ' is-selected' : ''}`}>
          <input type="radio" name="upload-visibility" value="public" checked={visibility === 'public'} onChange={() => { onVisibilityChange('public'); onConsentChange(false); }} />
          <span className="sharing-option-icon"><Globe2 size={17} /></span>
          <span className="sharing-option-copy">
            <strong>Academy archive <em>Recommended</em></strong>
            <span>Help everyone studying this course find and use this resource.</span>
            <ul className="sharing-benefits">
              <li>Build a reliable CU course archive</li>
              <li>Keep useful materials from getting lost in chats</li>
              <li>Make resources searchable by course and session</li>
              <li>Help other students study and practise from the same resource</li>
            </ul>
          </span>
        </label>
        <label className={`sharing-option${visibility === 'group' ? ' is-selected' : ''}`}>
          <input type="radio" name="upload-visibility" value="group" checked={visibility === 'group'} onChange={() => { onVisibilityChange('group'); onConsentChange(false); }} />
          <span className="sharing-option-icon"><Users size={17} /></span>
          <span className="sharing-option-copy">
            <strong>A study group</strong>
            <span>Share only with members of your selected group so everyone can study from the same materials.</span>
          </span>
        </label>
        <label className={`sharing-option${visibility === 'private' ? ' is-selected' : ''}`}>
          <input type="radio" name="upload-visibility" value="private" checked={visibility === 'private'} onChange={() => { onVisibilityChange('private'); onConsentChange(false); }} />
          <span className="sharing-option-icon"><LockKeyhole size={17} /></span>
          <span className="sharing-option-copy">
            <strong>Only me</strong>
            <span>Use this for personal or sensitive materials. Only you can access it, and you can share it later.</span>
          </span>
        </label>
      </div>

      {visibility === 'group' && (
        <div className="sharing-groups" aria-label="Choose study groups">
          <div className="sharing-groups-title">Choose one or more groups</div>
          {groups.length === 0 ? (
            <p className="sharing-groups-empty">You are not a member of an active study group yet. Choose Only me or join a group first.</p>
          ) : (
            <div className="sharing-group-list">
              {groups.map(group => (
                <label className="sharing-group" key={group.id}>
                  <input type="checkbox" checked={selectedGroupIds.includes(group.id)} onChange={() => onToggleGroup(group.id)} />
                  <span>{group.name}</span>
                </label>
              ))}
            </div>
          )}
          {selectedGroups.length > 0 && <p className="sharing-audience">Only members of {selectedGroups.map(group => group.name).join(', ')} can access this material.</p>}
        </div>
      )}

      {visibility === 'public' && (
        <label className="sharing-consent">
          <input type="checkbox" checked={consent} onChange={event => onConsentChange(event.target.checked)} />
          <span>You are sharing this material with all verified ExamMind students. It may appear in course search, AI study answers and practice generation.</span>
        </label>
      )}

      {visibility === 'private' && <p className="sharing-audience sharing-audience--private">Only you can access this material. It stays out of the academy archive until you choose to share it.</p>}
      {error && <p className="sharing-error" role="alert">{error}</p>}
    </section>
  );
}

function cleanPreviewLines(raw: string, snippets: string[]) {
  const sourceLines = snippets.length > 0 ? snippets : raw.split(/\r?\n/);
  const seen = new Set<string>();
  return sourceLines
    .map(line => line.replace(/[_=*#~]{3,}/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(line => line.length >= 12 && /[A-Za-z]{4,}/.test(line))
    .filter(line => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

function normalizePreviewSections(sections: PreviewSection[], fallbackLines: string[]) {
  if (sections.length > 0) {
    return sections
      .map(section => ({
        title: section.title,
        items: section.items
          .map(item => ({
            label: item.label || 'Snippet',
            text: item.text.replace(/[_=*#~|]{2,}/g, ' ').replace(/\s+/g, ' ').trim(),
          }))
          .filter(item => item.text.length >= 12),
      }))
      .filter(section => section.items.length > 0);
  }
  return fallbackLines.length > 0
    ? [{ title: 'Document preview', items: fallbackLines.slice(0, 5).map((text, index) => ({ label: `Snippet ${index + 1}`, text })) }]
    : [];
}

function confidenceLabel(metadata: Metadata) {
  const confidence = metadata.extraction_confidence || 0;
  if (metadata.indexed_status === 'indexed_review_required' || metadata.needs_review || confidence < 0.65) return 'Review Recommended';
  if (confidence >= 0.8) return 'High';
  return 'Medium';
}

function methodLabel(method: string) {
  if (method === 'ocr') return 'OCR';
  if (method === 'mixed') return 'Mixed extraction';
  if (method === 'manual') return 'Manual details';
  if (method === 'failed') return 'Could not read';
  return 'Embedded text';
}

function UploadProcessingState({ fileName, queueLabel, steps, action }: { fileName: string; queueLabel: string; steps: ProcessingStep[]; action: UploadAction }) {
  return (
    <div className="upload-processing-panel" aria-live="polite">
      <div className="upload-processing-kicker">{action === 'index' ? 'Adding to your library' : 'ExamMind is preparing your material'}</div>
      <div className="upload-file">{fileName || 'PDF'}{queueLabel}</div>
      <p className="processing-live">Working through this file now. This can take a moment for scanned documents.</p>
      <div className="upload-step-list">
        {steps.map((step, i) => (
          <div className={`upload-step ${step.status}`} key={step.label}>
            <span className="upload-step-dot">{i + 1}</span>
            <span>{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DocumentSummary({ file, metadata, extraction, review }: { file: File | null; metadata: Metadata; extraction: ExtractionInfo | null; review: boolean }) {
  const facts = [
    ['File type', fileTypeLabel(file), false],
    ['File size', file ? formatBytes(file.size) : 'Not found', false],
    ['Pages / slides', metadata.pages_read || extraction?.page_count || '', false],
    ['Reading method', methodLabel(metadata.extraction_method || extraction?.method || ''), false],
  ] as const;
  return (
    <section className="document-summary" aria-labelledby="document-summary-title">
      <div className="document-summary-head">
        <div className="document-summary-icon" aria-hidden="true"><FileText size={20} strokeWidth={1.7} /></div>
        <div>
          <div className="document-summary-label" id="document-summary-title">Document review</div>
          <div className="document-file-name">{file?.name || 'Uploaded document'}</div>
          <div className="document-file-meta">Ready to review before it is added to the library.</div>
        </div>
      </div>
      <div className="document-fact-grid">
        {facts.map(([label, value]) => (
          <div className="document-fact" key={label}>
            <dt>{label}</dt>
            <dd>{displayValue(value)}</dd>
          </div>
        ))}
        <div className="document-fact">
          <dt>Overall status</dt>
          <dd><span className={`summary-status ${review ? 'summary-status--review' : 'summary-status--ready'}`}><Check size={13} /> {review ? 'Needs review' : 'Ready to add'}</span></dd>
        </div>
      </div>
    </section>
  );
}

function ExtractedContentPreview({
  contentPreview,
  sections,
  rawText,
  previewQuality,
  extractionMethod,
}: {
  contentPreview: ContentPreview | null;
  sections: PreviewSection[];
  rawText: string;
  previewQuality: 'high' | 'medium' | 'low';
  extractionMethod: string;
}) {
  const [showFullText, setShowFullText] = useState(false);
  const status = previewQuality === 'high'
    ? 'ExamMind read this document successfully.'
    : previewQuality === 'medium'
      ? 'ExamMind read this document, but some scanned text may require review.'
      : 'ExamMind found readable text, but the preview may require review.';
  const questions = contentPreview?.questions ?? [];
  const hasStructuredPreview = Boolean(contentPreview?.instruction || contentPreview?.scenario || questions.length > 0);
  return (
    <div className="content-preview">
      <div className="content-preview-bar">
        <div>
          <div className="content-preview-head">Content preview</div>
          <div className={`preview-read-status ${previewQuality === 'high' ? 'good' : 'review'}`}>{status}</div>
        </div>
        {rawText && (
          <button type="button" className="upload-link-btn" onClick={() => setShowFullText(v => !v)}>
            {showFullText ? 'Hide extracted text' : extractionMethod === 'ocr' ? 'View OCR text' : 'View extracted text'}
          </button>
        )}
      </div>
      {!hasStructuredPreview && sections.length === 0 && <div className="preview-empty">No clean preview was available, but the extracted text can still be indexed.</div>}
      {hasStructuredPreview ? (
        <div className="structured-preview">
          {contentPreview?.instruction && (
            <div className="preview-block">
              <div className="preview-page-title">Instruction</div>
              <p>{contentPreview.instruction}</p>
            </div>
          )}
          {contentPreview?.scenario && (
            <div className="preview-block">
              <div className="preview-page-title">Scenario</div>
              <p>{contentPreview.scenario}</p>
            </div>
          )}
          {questions.length > 0 && (
            <div className="preview-block">
              <div className="preview-page-title">Detected Questions</div>
              {questions.map(question => (
                <div className="preview-line" key={question.number}>
                  <span>{question.number}</span>
                  <p>{question.preview}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        sections.map(section => (
          <div className="preview-section" key={section.title}>
            <div className="preview-page-title">{section.title}</div>
            {section.items.map((item, index) => (
              <div className="preview-line" key={`${section.title}-${item.label}-${index}`}>
                <span>{item.label}</span>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        ))
      )}
      {showFullText && <pre className="full-ocr-text">{rawText}</pre>}
    </div>
  );
}

function AdvancedMetadataEditor({
  metadata,
  updateField,
  updateListField,
  editedFields,
  showHeading = false,
  includeEssentials = false,
}: {
  metadata: Metadata;
  updateField: (key: keyof Metadata, value: string) => void;
  updateListField: (key: 'topics_covered' | 'instructor_names', value: string) => void;
  editedFields: Set<string>;
  showHeading?: boolean;
  includeEssentials?: boolean;
}) {
  const fields = [
    ['instructor_names', 'Instructor/Author'],
    ['year', 'Year'],
    ['department', 'Department'],
    ['exam_type', 'Exam type'],
  ].filter(([key]) => {
    const value = key === 'instructor_names' ? metadata.instructor_names.join(', ') : String(metadata[key as keyof Metadata] ?? '');
    if (key === 'year' || key === 'exam_type') return metadata.document_type === 'past_question' || Boolean(value && value !== 'unknown');
    return Boolean(value) || metadataEvidence(metadata, key)?.status === 'suggested' || metadataEvidence(metadata, key)?.status === 'conflict';
  }) as Array<['instructor_names' | 'year' | 'department' | 'exam_type', string]>;

  const fieldValue = (key: keyof Metadata) => key === 'instructor_names' ? metadata.instructor_names.join(', ') : String(metadata[key] ?? '');

  return (
    <div className="advanced-editor">
      {showHeading && <div className="advanced-editor-title">More details</div>}
      <div className="metadata-grid">
        {includeEssentials && (
          <>
            <label className="meta-field wide" htmlFor="upload-document-title">
              <span>Document title <FieldStatusBadge status={metadataFieldStatus(metadata, 'document_title', metadata.document_title, editedFields.has('document_title'), Boolean(metadata.needs_review))} /></span>
              <input id="upload-document-title" value={metadata.document_title} onChange={e => updateField('document_title', e.target.value)} />
            </label>
            <label className="meta-field" htmlFor="upload-document-type">
              <span>Document type <FieldStatusBadge status={metadataFieldStatus(metadata, 'document_type', metadata.document_type === 'unknown' ? '' : metadata.document_type, editedFields.has('document_type'), Boolean(metadata.needs_review))} /></span>
              <select id="upload-document-type" value={metadata.document_type === 'unknown' ? '' : metadata.document_type} onChange={e => updateField('document_type', e.target.value)}>
                <option value="" disabled>Choose a type</option>
                {DOC_TYPES.filter(type => type !== 'unknown').map(type => <option value={type} key={type}>{DOC_TYPE_LABEL[type]}</option>)}
              </select>
            </label>
            <label className="meta-field" htmlFor="upload-course-code">
              <span>Course code <FieldStatusBadge status={metadataFieldStatus(metadata, 'course_code', metadata.course_code, editedFields.has('course_code'), Boolean(metadata.needs_review))} /></span>
              <input id="upload-course-code" value={metadata.course_code} onChange={e => updateField('course_code', e.target.value)} />
            </label>
            <label className="meta-field" htmlFor="upload-course-title">
              <span>Course title <FieldStatusBadge status={metadataFieldStatus(metadata, 'course_title', metadata.course_title, editedFields.has('course_title'), Boolean(metadata.needs_review))} /></span>
              <input id="upload-course-title" value={metadata.course_title} onChange={e => updateField('course_title', e.target.value)} />
            </label>
            <label className="meta-field" htmlFor="upload-academic-year">
              <span>Academic session <FieldStatusBadge status={metadataFieldStatus(metadata, 'academic_year', metadata.academic_year, editedFields.has('academic_year'), Boolean(metadata.needs_review))} /></span>
              <input id="upload-academic-year" value={metadata.academic_year} onChange={e => updateField('academic_year', e.target.value)} placeholder="e.g. 2024/2025" />
            </label>
            <label className="meta-field" htmlFor="upload-semester">
              <span>Semester <FieldStatusBadge status={metadataFieldStatus(metadata, 'semester', metadata.semester, editedFields.has('semester'), Boolean(metadata.needs_review))} /></span>
              <input id="upload-semester" value={metadata.semester} onChange={e => updateField('semester', e.target.value)} placeholder="e.g. First" />
            </label>
          </>
        )}
        {fields.map(([key, label]) => {
          const value = fieldValue(key);
          const statusValue = key === 'instructor_names' ? metadata.instructor_names.join(', ') : String(metadata[key] ?? '');
          return (
            <label className={`meta-field${key === 'instructor_names' ? ' wide' : ''}`} key={key} htmlFor={`upload-${key}`}>
              <span>{label} <FieldStatusBadge status={metadataFieldStatus(metadata, key, statusValue, editedFields.has(key), Boolean(metadata.needs_review))} /></span>
              {key === 'exam_type' ? (
                <select id={`upload-${key}`} value={metadata.exam_type} onChange={e => updateField(key, e.target.value)}>
                  {EXAM_TYPES.map(type => <option value={type} key={type}>{type}</option>)}
                </select>
              ) : key === 'instructor_names' ? (
                <input id={`upload-${key}`} value={value} onChange={e => updateListField('instructor_names', e.target.value)} />
              ) : key === 'year' ? (
                <input id={`upload-${key}`} type="number" min="1900" max="2100" value={value} onChange={e => updateField(key, e.target.value)} />
              ) : (
                <input id={`upload-${key}`} value={value} onChange={e => updateField(key, e.target.value)} />
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function EssentialMetadataEditor({
  metadata,
  courses,
  courseState,
  editedFields,
  errors,
  updateField,
  onCourseSelect,
}: {
  metadata: Metadata;
  courses: Course[];
  courseState: CourseState;
  editedFields: Set<string>;
  errors: ValidationErrors;
  updateField: (key: keyof Metadata, value: string) => void;
  onCourseSelect: (courseId: string) => void;
}) {
  const matchingCourse = courses.find(course => course.code?.toLowerCase() === metadata.course_code.toLowerCase());
  const courseNeedsManualEntry = courseState !== 'ready' || !metadata.course_code || !matchingCourse;
  const review = Boolean(metadata.needs_review);
  return (
    <div className="essential-fields">
      <label className="meta-field wide" htmlFor="review-document-title">
        <span>Title <FieldStatusBadge status={metadataFieldStatus(metadata, 'document_title', metadata.document_title, editedFields.has('document_title'), review)} /></span>
        <input id="review-document-title" value={metadata.document_title} onChange={e => updateField('document_title', e.target.value)} aria-invalid={Boolean(errors.document_title)} />
        {errors.document_title && <small className="field-error">{errors.document_title}</small>}
      </label>

      <label className="meta-field" htmlFor="review-document-type">
        <span>Type <FieldStatusBadge status={metadataFieldStatus(metadata, 'document_type', metadata.document_type === 'unknown' ? '' : metadata.document_type, editedFields.has('document_type'), review)} /></span>
        <select id="review-document-type" value={metadata.document_type === 'unknown' ? '' : metadata.document_type} onChange={e => updateField('document_type', e.target.value)} aria-invalid={Boolean(errors.document_type)}>
          <option value="" disabled>Choose a document type</option>
          {DOC_TYPES.filter(type => type !== 'unknown').map(type => <option value={type} key={type}>{DOC_TYPE_LABEL[type]}</option>)}
        </select>
        {errors.document_type && <small className="field-error">{errors.document_type}</small>}
      </label>

      <div className="course-field-group">
        <div className="field-label-line"><span className="field-label">Course</span><FieldStatusBadge status={metadataFieldStatus(metadata, 'course_code', metadata.course_code || metadata.course_title, editedFields.has('course_code') || editedFields.has('course_title'), review)} /></div>
        {courseState === 'ready' ? (
          <select id="review-course" value={matchingCourse?.id ? String(matchingCourse.id) : ''} onChange={e => onCourseSelect(e.target.value)} aria-label="Choose a course">
            <option value="">Choose from the course catalogue</option>
            {courses.map(course => <option key={course.id} value={course.id}>{course.code} — {course.name}</option>)}
          </select>
        ) : (
          <div className="course-loading-note">{courseState === 'loading' ? 'Course catalogue is loading. You can enter it manually.' : 'Course catalogue unavailable. Enter the course manually.'}</div>
        )}
        {courseNeedsManualEntry && (
          <div className="course-manual-fields">
            <label className="meta-field" htmlFor="review-course-code">
              <span>Course code</span>
              <input id="review-course-code" value={metadata.course_code} onChange={e => updateField('course_code', e.target.value)} placeholder="e.g. CSC 301" aria-invalid={Boolean(errors.course)} />
            </label>
            <label className="meta-field" htmlFor="review-course-title">
              <span>Course title</span>
              <input id="review-course-title" value={metadata.course_title} onChange={e => updateField('course_title', e.target.value)} placeholder="Course title" aria-invalid={Boolean(errors.course)} />
            </label>
          </div>
        )}
        {errors.course && <small className="field-error">{errors.course}</small>}
      </div>

      <label className="meta-field" htmlFor="review-academic-year">
        <span>Academic session <FieldStatusBadge status={metadataFieldStatus(metadata, 'academic_year', metadata.academic_year, editedFields.has('academic_year'), review)} /></span>
        <input id="review-academic-year" value={metadata.academic_year} onChange={e => updateField('academic_year', e.target.value)} placeholder="e.g. 2024/2025" aria-invalid={Boolean(errors.academic_year)} />
        {errors.academic_year && <small className="field-error">{errors.academic_year}</small>}
      </label>

      <label className="meta-field" htmlFor="review-semester">
        <span>Semester <FieldStatusBadge status={metadataFieldStatus(metadata, 'semester', metadata.semester, editedFields.has('semester'), review)} /></span>
        <input id="review-semester" value={metadata.semester} onChange={e => updateField('semester', e.target.value)} placeholder="e.g. First" aria-invalid={Boolean(errors.semester)} />
        {errors.semester && <small className="field-error">{errors.semester}</small>}
      </label>
    </div>
  );
}

function TopicsEditor({
  topics,
  status,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
}: {
  topics: string[];
  status: FieldStatus;
  draft: string;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (topic: string) => void;
}) {
  return (
    <section className="topics-editor" aria-labelledby="topics-editor-title">
      <div className="topics-editor-head">
        <div>
          <div className="document-summary-label" id="topics-editor-title">Topics</div>
          <p>Review the study topics ExamMind found in this file.</p>
        </div>
        <FieldStatusBadge status={status} />
      </div>
      <div className="topic-chip-row">
        {topics.map(topic => (
          <span className="topic-chip topic-chip--editable" key={topic}>
            {topic}
            <button type="button" className="topic-remove" onClick={() => onRemove(topic)} aria-label={`Remove topic ${topic}`}><X size={13} /></button>
          </span>
        ))}
        {topics.length === 0 && <span className="topic-empty">No topics detected yet.</span>}
      </div>
      <div className="topic-entry">
        <input value={draft} onChange={e => onDraftChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); onAdd(); } }} placeholder="Add a topic" aria-label="Add a topic" />
        <button type="button" className="topic-add" onClick={onAdd}><Plus size={15} /> Add topic</button>
      </div>
    </section>
  );
}

function UploadConfirmationCard({
  file,
  metadata,
  extraction,
  previewSections,
  contentPreview,
  rawOcrText,
  previewQuality,
  advancedOpen,
  setAdvancedOpen,
  updateField,
  updateListField,
  editedFields,
  errors,
  courses,
  courseState,
  topicDraft,
  onTopicDraftChange,
  onAddTopic,
  onRemoveTopic,
  onCourseSelect,
  sharingVisibility,
  onSharingVisibilityChange,
  shareGroups,
  selectedShareGroupIds,
  onToggleShareGroup,
  sharingConsent,
  onSharingConsentChange,
  sharingError,
  onCancel,
  onConfirm,
  hasQueue,
}: {
  file: File | null;
  metadata: Metadata;
  extraction: ExtractionInfo | null;
  previewSections: PreviewSection[];
  contentPreview: ContentPreview | null;
  rawOcrText: string;
  previewQuality: 'high' | 'medium' | 'low';
  advancedOpen: boolean;
  setAdvancedOpen: (value: boolean) => void;
  updateField: (key: keyof Metadata, value: string) => void;
  updateListField: (key: 'topics_covered' | 'instructor_names', value: string) => void;
  editedFields: Set<string>;
  errors: ValidationErrors;
  courses: Course[];
  courseState: CourseState;
  topicDraft: string;
  onTopicDraftChange: (value: string) => void;
  onAddTopic: () => void;
  onRemoveTopic: (topic: string) => void;
  onCourseSelect: (courseId: string) => void;
  sharingVisibility: ShareVisibility;
  onSharingVisibilityChange: (value: ShareVisibility) => void;
  shareGroups: ShareGroup[];
  selectedShareGroupIds: number[];
  onToggleShareGroup: (groupId: number) => void;
  sharingConsent: boolean;
  onSharingConsentChange: (value: boolean) => void;
  sharingError?: string;
  onCancel: () => void;
  onConfirm: () => void;
  hasQueue: boolean;
}) {
  const confidence = confidenceLabel(metadata);
  const attentionEntries = Object.entries(metadata.metadata_evidence || {}).filter(([, item]) => item.status === 'missing_required' || item.status === 'conflict' || item.status === 'suggested');
  const completedEntries = Object.entries(metadata.metadata_evidence || {}).filter(([, item]) => item.status === 'catalogue_confirmed' || item.status === 'strong_evidence');
  const optionalEntries = Object.entries(metadata.metadata_evidence || {}).filter(([, item]) => item.status === 'optional' && displayValue(item.value as string | number | null, ''));
  const evidenceLabel: Record<string, string> = { title: 'Title', document_type: 'Document type', course_code: 'Course', course_title: 'Course title', academic_session: 'Academic session', semester: 'Semester', instructor_or_author: 'Instructor or author', year: 'Year', department: 'Department', exam_type: 'Exam type', topics: 'Topics' };
  const review = confidence === 'Review Recommended' || attentionEntries.length > 0 || Boolean(metadata.needs_review);
  const hasMissingEssentials = !metadata.document_title || metadata.document_type === 'unknown' || (!metadata.course_code && !metadata.course_title);
  const validationSummary = Object.values(errors).filter(Boolean);

  return (
    <div className="upload-confirm-shell">
      <div className="review-workspace">
        <section className="review-document-column" aria-labelledby="review-document-heading">
          <div className="review-intro">
            <div className="review-kicker">{review ? 'A quick check is needed' : 'Ready for your review'}</div>
            <h2 id="review-document-heading">Review this material</h2>
            <p>Confirm the important details before ExamMind adds this document to your library.</p>
          </div>
          <DocumentSummary file={file} metadata={metadata} extraction={extraction} review={review || hasMissingEssentials} />
          <TopicsEditor topics={metadata.topics_covered} status={metadataFieldStatus(metadata, 'topics_covered', metadata.topics_covered.join(', '), editedFields.has('topics_covered'), Boolean(metadata.needs_review))} draft={topicDraft} onDraftChange={onTopicDraftChange} onAdd={onAddTopic} onRemove={onRemoveTopic} />
          <ExtractedContentPreview
            contentPreview={contentPreview}
            sections={previewSections}
            rawText={rawOcrText}
            previewQuality={previewQuality}
            extractionMethod={metadata.extraction_method}
          />
        </section>

        <aside className="review-details-panel" aria-labelledby="review-details-heading">
          <div className="review-panel-heading">
            <div className="review-kicker">Library record</div>
            <h2 id="review-details-heading">Important details</h2>
            <p>These details make the material easy to find later.</p>
          </div>
          {validationSummary.length > 0 && (
            <div className="validation-summary" role="alert" aria-live="assertive">
              <AlertCircle size={18} />
              <div><h3>Review the highlighted fields</h3><ul>{validationSummary.map(error => <li key={error}>{error}</li>)}</ul></div>
            </div>
          )}
          {attentionEntries.length > 0 ? (
            <section className="metadata-attention" aria-labelledby="metadata-attention-heading">
              <h3 id="metadata-attention-heading">Needs your attention</h3>
              <ul>{attentionEntries.map(([key, item]) => <li key={key}><strong>{evidenceLabel[key] || key}</strong><span>{item.status === 'conflict' ? 'There are conflicting proposals.' : item.status === 'missing_required' ? 'Select or enter this before continuing.' : 'Review the suggested value.'}</span></li>)}</ul>
            </section>
          ) : (
            <p className="metadata-ready-note"><Check size={15} /> Everything looks ready. Review the details or continue.</p>
          )}
          {completedEntries.length > 0 && (
            <section className="metadata-completed" aria-labelledby="metadata-completed-heading">
              <h3 id="metadata-completed-heading">Already completed</h3>
              <p>{completedEntries.map(([key]) => evidenceLabel[key] || key).join(' · ')}</p>
            </section>
          )}
          {optionalEntries.length > 0 && (
            <section className="metadata-optional" aria-labelledby="metadata-optional-heading">
              <h3 id="metadata-optional-heading">Additional details</h3>
              <p>{optionalEntries.map(([key]) => evidenceLabel[key] || key).join(' · ')}</p>
            </section>
          )}
          <EssentialMetadataEditor metadata={metadata} courses={courses} courseState={courseState} editedFields={editedFields} errors={errors} updateField={updateField} onCourseSelect={onCourseSelect} />
          {(review || hasMissingEssentials) && (
            <div className="review-warning"><AlertCircle size={16} /><span>ExamMind may misread some details. Review anything marked “Needs review” before adding this material.</span></div>
          )}
          <SharingChoice
            visibility={sharingVisibility}
            onVisibilityChange={onSharingVisibilityChange}
            groups={shareGroups}
            selectedGroupIds={selectedShareGroupIds}
            onToggleGroup={onToggleShareGroup}
            consent={sharingConsent}
            onConsentChange={onSharingConsentChange}
            error={sharingError}
          />
          <button type="button" className="details-disclosure" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(!advancedOpen)}>
            <span>Additional details</span><ChevronDown size={17} aria-hidden="true" />
          </button>
          {advancedOpen && <AdvancedMetadataEditor metadata={metadata} updateField={updateField} updateListField={updateListField} editedFields={editedFields} showHeading={false} />}
          <div className="review-panel-actions">
            {hasQueue && <p className="queue-note">You can skip this file and continue with the next queued upload.</p>}
            <div className="confirm-actions">
              <button type="button" className="cta cta-ghost" onClick={onCancel}>{hasQueue ? 'Skip this file' : 'Choose another file'}</button>
              <button type="button" className="cta" onClick={onConfirm}>Add to library</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ContributionSuccessModal({
  metadata,
  chunksIndexed,
  searchable,
  documentId,
  documentType,
  initialVisibility,
  initialGroupIds,
  groups,
  onViewLibrary,
  onUploadAnother,
  onDismiss,
}: {
  metadata: Metadata;
  chunksIndexed: number;
  searchable: boolean;
  documentId: number | null;
  documentType: 'past_question' | 'lecture_note' | null;
  initialVisibility: ShareVisibility;
  initialGroupIds: number[];
  groups: ShareGroup[];
  onViewLibrary: () => void;
  onUploadAnother: () => void;
  onDismiss: () => void;
}) {
  const [currentVisibility, setCurrentVisibility] = useState<ShareVisibility>(initialVisibility);
  const [currentGroupIds, setCurrentGroupIds] = useState<number[]>(initialGroupIds);
  const [editorVisibility, setEditorVisibility] = useState<ShareVisibility | null>(null);
  const [editorGroupIds, setEditorGroupIds] = useState<number[]>(initialGroupIds);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedGroups = groups.filter(group => currentGroupIds.includes(group.id));
  const saveSharing = async () => {
    if (!documentId || !documentType || !editorVisibility) return;
    if (editorVisibility === 'group' && editorGroupIds.length === 0) {
      setError('Choose at least one study group.');
      return;
    }
    if (editorVisibility === 'public' && !consent) {
      setError('Confirm that all verified ExamMind students may access this material.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiPatch(`/materials/${documentType}/${documentId}/visibility`, {
        visibility: editorVisibility,
        group_ids: editorGroupIds,
        confirm: editorVisibility === 'private' ? true : consent,
      });
      setCurrentVisibility(editorVisibility);
      setCurrentGroupIds(editorVisibility === 'group' ? editorGroupIds : []);
      setEditorVisibility(null);
      setConsent(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update sharing.');
    } finally {
      setSaving(false);
    }
  };

  const startSharing = (value: ShareVisibility) => {
    setEditorVisibility(value);
    setEditorGroupIds(value === 'group' ? currentGroupIds : []);
    setConsent(false);
    setError('');
  };

  return (
    <div className="success-modal-backdrop">
      <div className="success-modal">
        <div className="success-label">Upload complete</div>
        <h2>{currentVisibility === 'private' ? 'Saved to your workspace' : 'Thank you for contributing'}</h2>
        <p>
          {currentVisibility === 'public'
            ? 'Resource shared successfully. Students studying this course can now find it in the CU archive.'
            : currentVisibility === 'group'
              ? `Resource shared with ${selectedGroups.map(group => group.name).join(', ')}. Only members of ${selectedGroups.length > 1 ? 'these groups' : 'this group'} can access it.`
              : 'This resource is currently private. Would you like to help other students by sharing it with your study group or the CU archive?'}
        </p>
        <div className="success-modal-meta">
          <span>{metadata.course_code || 'Course pending'}</span>
          <span>{DOC_TYPE_LABEL[metadata.document_type] ?? 'Document'}</span>
          <span>{chunksIndexed} chunks</span>
          <span>{searchable ? 'Searchable' : 'Record only'}</span>
          <span>{visibilityLabel(currentVisibility)}</span>
        </div>
        {currentVisibility === 'private' && !editorVisibility && (
          <div className="success-sharing-actions">
            <button type="button" className="cta" onClick={() => startSharing('public')}><Globe2 size={15} /> Share to academy archive</button>
            <button type="button" className="cta cta-ghost" onClick={() => startSharing('group')}><Users size={15} /> Share with a study group</button>
            <button type="button" className="success-keep-private" onClick={onDismiss}>Keep visible only to me</button>
          </div>
        )}
        {editorVisibility && (
          <div className="success-sharing-editor">
            <SharingChoice
              visibility={editorVisibility}
              onVisibilityChange={value => { setEditorVisibility(value); setError(''); }}
              groups={groups}
              selectedGroupIds={editorGroupIds}
              onToggleGroup={groupId => setEditorGroupIds(current => current.includes(groupId) ? current.filter(id => id !== groupId) : [...current, groupId])}
              consent={consent}
              onConsentChange={setConsent}
              error={error}
              compact
            />
            <div className="empty-actions">
              <button type="button" className="cta cta-ghost" onClick={() => setEditorVisibility(null)} disabled={saving}>Cancel</button>
              <button type="button" className="cta" onClick={() => void saveSharing()} disabled={saving}>{saving ? 'Saving...' : 'Confirm sharing'}</button>
            </div>
          </div>
        )}
        <div className="empty-actions">
          <button type="button" className="cta" onClick={onViewLibrary}>View in Library</button>
          <button type="button" className="cta cta-ghost" onClick={onUploadAnother}>Upload Another</button>
        </div>
      </div>
    </div>
  );
}

export default function Upload({ go, user }: { go: (s: ScreenType) => void; user: User | null }) {
  const [state, setState] = useState<UploadState>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<Metadata>(emptyMetadata);
  const [message, setMessage] = useState('');
  const [chunksIndexed, setChunksIndexed] = useState(0);
  const [lastIndexed, setLastIndexed] = useState(true);
  const [recentUploads, setRecentUploads] = useState<RecentUpload[] | null>(null);
  const [processingSteps, setProcessingSteps] = useState<ProcessingStep[]>(mkSteps());
  const [lastAction, setLastAction] = useState<UploadAction>('analyze');
  const [dragOver, setDragOver] = useState(false);
  const [queue, setQueue] = useState<File[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [preview, setPreview] = useState('');
  const [previewSnippets, setPreviewSnippets] = useState<string[]>([]);
  const [previewSections, setPreviewSections] = useState<PreviewSection[]>([]);
  const [contentPreview, setContentPreview] = useState<ContentPreview | null>(null);
  const [rawOcrText, setRawOcrText] = useState('');
  const [previewQuality, setPreviewQuality] = useState<'high' | 'medium' | 'low'>('low');
  const [extraction, setExtraction] = useState<ExtractionInfo | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseState, setCourseState] = useState<CourseState>('loading');
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set());
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [topicDraft, setTopicDraft] = useState('');
  const [sharingVisibility, setSharingVisibility] = useState<ShareVisibility>('public');
  const [shareGroups, setShareGroups] = useState<ShareGroup[]>([]);
  const [selectedShareGroupIds, setSelectedShareGroupIds] = useState<number[]>([]);
  const [sharingConsent, setSharingConsent] = useState(false);
  const [sharingError, setSharingError] = useState('');
  const [lastDocumentId, setLastDocumentId] = useState<number | null>(null);
  const [lastDocumentType, setLastDocumentType] = useState<'past_question' | 'lecture_note' | null>(null);
  const [editingRecentKey, setEditingRecentKey] = useState<string | null>(null);
  const [recentVisibility, setRecentVisibility] = useState<ShareVisibility>('private');
  const [recentGroupIds, setRecentGroupIds] = useState<number[]>([]);
  const [recentConsent, setRecentConsent] = useState(false);
  const [recentShareError, setRecentShareError] = useState('');
  const [recentShareBusy, setRecentShareBusy] = useState(false);
  const [duplicateDocument, setDuplicateDocument] = useState<DuplicateDocument | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user?.id) return;
    Promise.all([
      apiGet(`/past-questions?uploaded_by=${user.id}`),
      apiGet(`/lecture-notes?uploaded_by=${user.id}`),
    ])
      .then(([past, notes]) => {
        const pastRows = (Array.isArray(past) ? past as RecentUpload[] : []).map(row => ({ ...row, material_type: 'past_question' as const }));
        const noteRows = (Array.isArray(notes) ? notes as RecentUpload[] : []).map(row => ({ ...row, material_type: 'lecture_note' as const }));
        setRecentUploads([...pastRows, ...noteRows].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()).slice(0, 4));
      })
      .catch(() => setRecentUploads([]));
  }, [user?.id, state]);

  useEffect(() => {
    if (!user?.id) return;
    apiGet('/study-groups')
      .then(data => {
        const groups = Array.isArray(data) ? data as ShareGroup[] : [];
        setShareGroups(groups.filter(group => group.is_member && group.status === 'active'));
      })
      .catch(() => setShareGroups([]));
  }, [user?.id, state]);

  useEffect(() => {
    if (!user?.id) return;
    setCourseState('loading');
    apiGet('/courses')
      .then(data => {
        const nextCourses = Array.isArray(data) ? data as Course[] : [];
        setCourses(nextCourses);
        setCourseState(nextCourses.length > 0 ? 'ready' : 'empty');
      })
      .catch(() => {
        setCourses([]);
        setCourseState('error');
      });
  }, [user?.id]);

  const previewLines = useMemo(() => cleanPreviewLines(preview, previewSnippets), [preview, previewSnippets]);
  const structuredPreview = useMemo(
    () => normalizePreviewSections(previewSections, previewLines),
    [previewSections, previewLines],
  );

  const analyzeFile = async (selected: File, notice = '') => {
    setFile(selected);
    setState('processing');
    setMessage(notice);
    setAdvancedOpen(false);
    setEditedFields(new Set());
    setValidationErrors({});
    setTopicDraft('');
    setSharingVisibility('public');
    setSelectedShareGroupIds([]);
    setSharingConsent(false);
    setSharingError('');
    setDuplicateDocument(null);
    setPreview('');
    setPreviewSnippets([]);
    setPreviewSections([]);
    setContentPreview(null);
    setRawOcrText('');
    setPreviewQuality('low');
    setExtraction(null);
    setProcessingSteps(mkSteps(0));
    setLastAction('analyze');

    if (!navigator.onLine) {
      await queuePendingUpload({
        id: `${selected.name}-${Date.now()}`,
        fileName: selected.name,
        fileSize: selected.size,
        queuedAt: new Date().toISOString(),
        status: 'waiting_to_sync',
      }, selected);
      window.dispatchEvent(new Event('exammind-offline-updated'));
      setState('idle');
      setMessage(`You are offline. "${selected.name}" was added to the sync queue.`);
      return;
    }

    const formData = new FormData();
    formData.append('file', selected);

    try {
      const data = await apiFormPost('/ingest/upload', formData);
      const nextMetadata = normalizeMetadata(data.metadata || {});
      setMetadata(nextMetadata);
      setPreview(data.preview || '');
      setPreviewSnippets(data.preview_snippets || []);
      setPreviewSections(data.preview_sections || []);
      setContentPreview(data.content_preview || null);
      setRawOcrText(data.raw_ocr_text || data.raw_extracted_text || '');
      setPreviewQuality(data.preview_quality || 'low');
      setExtraction(data.extraction || null);

      if (data.status === 'duplicate') {
        setDuplicateDocument((data.existing_document || null) as DuplicateDocument | null);
        setProcessingSteps(doneSteps(3));
        setState('duplicate');
        setMessage(`Already uploaded as ${data.existing_document?.title || 'an existing document'}.`);
      } else if (data.status === 'manual_metadata_required') {
        setProcessingSteps(failSteps(1));
        setState('manual_metadata_required');
        setMessage(data.message || rescueMessage(data.metadata?.extraction_failure_reason));
      } else {
        setProcessingSteps(doneSteps(4));
        setMessage('');
        setState('confirm');
      }
    } catch (err) {
      setProcessingSteps(failSteps(2));
      setState('error');
      const fallback = 'Upload analysis failed.';
      const errorMessage = err instanceof Error ? err.message : fallback;
      setMessage(errorMessage.includes('scanned or image-based') ? 'ExamMind could not read this scan clearly. Try a clearer file.' : errorMessage);
    }
  };

  const validateConfirmation = () => {
    const errors: ValidationErrors = {};
    if (!metadata.document_title.trim() || UNKNOWN_VALUES.has(metadata.document_title.trim().toLowerCase())) {
      errors.document_title = 'Add a meaningful title for this material.';
    }
    if (!metadata.document_type || metadata.document_type === 'unknown') {
      errors.document_type = 'Choose the document type.';
    }
    const courseValues = [metadata.course_code, metadata.course_title].map(value => value.trim().toLowerCase());
    if (!courseValues.some(value => value && !UNKNOWN_VALUES.has(value))) {
      errors.course = 'Choose a course from the catalogue or enter a course code or title.';
    }
    if (metadata.document_type === 'past_question' && !metadata.academic_year.trim() && metadata.year === '') {
      errors.academic_year = 'Select the academic session for this past question.';
    }
    if (metadata.document_type === 'past_question' && (!metadata.semester.trim() || UNKNOWN_VALUES.has(metadata.semester.trim().toLowerCase()))) {
      errors.semester = 'Select the semester for this past question.';
    }
    if (metadata.year !== '' && (!Number.isInteger(metadata.year) || metadata.year < 1900 || metadata.year > 2100)) {
      errors.year = 'Enter a year between 1900 and 2100.';
    }
    if (metadata.topics_covered.some(topic => !topic.trim())) {
      errors.topics = 'Remove blank topics before adding this material.';
    }
    if (sharingVisibility === 'group' && selectedShareGroupIds.length === 0) {
      errors.sharing = 'Choose at least one study group, or choose Only me.';
    } else if (sharingVisibility === 'public' && !sharingConsent) {
      errors.sharing = 'Confirm that you want all verified ExamMind students to access this material.';
    }
    setValidationErrors(errors);
    setSharingError(errors.sharing || '');
    if (Object.keys(errors).length > 0) {
      const firstField = errors.document_title ? 'review-document-title' : errors.document_type ? 'review-document-type' : errors.course ? 'review-course-code' : errors.academic_year ? 'review-academic-year' : errors.semester ? 'review-semester' : errors.year ? 'upload-year' : undefined;
      if (firstField) window.setTimeout(() => document.getElementById(firstField)?.focus(), 0);
      return false;
    }
    return true;
  };

  const confirmUpload = async (saveUnindexed = false, duplicateResolution?: 'continue' | 'newer_version') => {
    if (!file) return;
    if (!validateConfirmation()) return;
    setState('processing');
    setMessage('');
    setProcessingSteps(mkSteps(0));
    setLastAction('index');

    const submissionMetadata = normalizeMetadata(metadata);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('confirm', 'true');
    formData.append('visibility', sharingVisibility);
    formData.append('shared_group_ids', JSON.stringify(selectedShareGroupIds));
    formData.append('visibility_confirmed', sharingVisibility === 'private' ? 'true' : String(sharingConsent));
    if (duplicateResolution) formData.append('duplicate_resolution', duplicateResolution);
    formData.append('confirmed_metadata', JSON.stringify(saveUnindexed ? {
      ...submissionMetadata,
      extraction_method: 'manual',
      indexed_status: 'unindexed',
      searchable: false,
      needs_clearer_file: true,
    } : submissionMetadata));

    try {
      const data = await apiFormPost('/ingest/upload', formData);

      if (data.status === 'duplicate') {
        setDuplicateDocument((data.existing_document || null) as DuplicateDocument | null);
        setProcessingSteps(failSteps(3));
        setState('duplicate');
        setMessage('A matching document already exists.');
      } else {
        setDuplicateDocument(null);
        setProcessingSteps(doneSteps(4));
        setChunksIndexed(data.chunks_indexed || 0);
        setLastIndexed(data.indexed !== false);
        setLastDocumentId(typeof data.document_id === 'number' ? data.document_id : null);
        setLastDocumentType(data.document_type === 'past_question' ? 'past_question' : 'lecture_note');
        setMetadata(normalizeMetadata({ ...submissionMetadata, ...(data.metadata || {}) }));
        setState('success');
      }
    } catch (err) {
      setProcessingSteps(failSteps(4));
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Indexing failed.');
    }
  };

  const startQueue = (files: File[], notice = '') => {
    if (files.length === 0) return;
    setQueue(files);
    setQueueIndex(0);
    void analyzeFile(files[0], notice);
  };

  const nextInQueue = () => {
    const next = queueIndex + 1;
    if (next < queue.length) {
      setQueueIndex(next);
      void analyzeFile(queue[next]);
    } else {
      setQueue([]);
      setQueueIndex(0);
      setState('idle');
    }
  };

  const openRecentVisibility = (upload: RecentUpload) => {
    setEditingRecentKey(`${upload.material_type}:${upload.id}`);
    setRecentVisibility(upload.visibility || 'private');
    setRecentGroupIds(upload.shared_group_ids || []);
    setRecentConsent(false);
    setRecentShareError('');
  };

  const saveRecentVisibility = async (upload: RecentUpload) => {
    if (recentVisibility === 'group' && recentGroupIds.length === 0) {
      setRecentShareError('Choose at least one study group.');
      return;
    }
    if (recentVisibility === 'public' && !recentConsent) {
      setRecentShareError('Confirm that all verified students may access this material.');
      return;
    }
    setRecentShareBusy(true);
    setRecentShareError('');
    try {
      await apiPatch(`/materials/${upload.material_type}/${upload.id}/visibility`, {
        visibility: recentVisibility,
        group_ids: recentGroupIds,
        confirm: recentVisibility === 'private' ? true : recentConsent,
      });
      setRecentUploads(current => current?.map(item => item.material_type === upload.material_type && item.id === upload.id
        ? { ...item, visibility: recentVisibility, shared_group_ids: recentVisibility === 'group' ? recentGroupIds : [] }
        : item) || current);
      setEditingRecentKey(null);
    } catch (err) {
      setRecentShareError(err instanceof Error ? err.message : 'Could not update sharing.');
    } finally {
      setRecentShareBusy(false);
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const supportedExtensions = ['.pdf', '.docx', '.pptx', '.png', '.jpg', '.jpeg'];
    const supportedMimeTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/png',
      'image/jpeg',
    ];
    const selectedFiles = Array.from(files);
    const supportedFiles = selectedFiles.filter((f) => {
      const name = f.name.toLowerCase();
      return supportedMimeTypes.includes(f.type) || supportedExtensions.some((ext) => name.endsWith(ext));
    });
    const oversizedFiles = supportedFiles.filter(fileItem => fileItem.size > MAX_UPLOAD_BYTES);
    const acceptedFiles = supportedFiles.filter(fileItem => fileItem.size <= MAX_UPLOAD_BYTES);
    const rejectedUnsupported = selectedFiles.length - supportedFiles.length;
    const rejectionMessage = [
      rejectedUnsupported > 0 ? `${rejectedUnsupported} unsupported file${rejectedUnsupported === 1 ? '' : 's'} skipped` : '',
      oversizedFiles.length > 0 ? `${oversizedFiles.map(item => item.name).join(', ')} exceeds the ${formatBytes(MAX_UPLOAD_BYTES)} limit` : '',
    ].filter(Boolean).join('. ');
    if (acceptedFiles.length === 0) {
      setMessage(rejectionMessage || 'Only PDF, Word, PowerPoint, PNG, JPG, and JPEG files are supported.');
      return;
    }
    if (acceptedFiles.length === 1) {
      setQueue([]);
      void analyzeFile(acceptedFiles[0], rejectionMessage);
    } else {
      startQueue(acceptedFiles, rejectionMessage);
    }
  };

  const updateField = (key: keyof Metadata, value: string) => {
    setMetadata(c => ({ ...c, [key]: key === 'year' ? Number(value) || '' : value }));
    setEditedFields(previous => new Set(previous).add(key));
    const errorKey = key === 'course_code' || key === 'course_title' ? 'course' : key === 'year' ? 'year' : key in validationErrors ? key as keyof ValidationErrors : undefined;
    if (errorKey) setValidationErrors(previous => ({ ...previous, [errorKey]: undefined }));
  };

  const updateListField = (key: 'topics_covered' | 'instructor_names', value: string) => {
    setMetadata(c => ({ ...c, [key]: normalizeList(value) }));
    setEditedFields(previous => new Set(previous).add(key));
  };

  const addTopic = () => {
    const topic = topicDraft.trim().replace(/,+$/, '').trim();
    if (!topic) return;
    setMetadata(current => ({ ...current, topics_covered: normalizeList([...current.topics_covered, topic]) }));
    setEditedFields(previous => new Set(previous).add('topics_covered'));
    setTopicDraft('');
    setValidationErrors(previous => ({ ...previous, topics: undefined }));
  };

  const removeTopic = (topic: string) => {
    setMetadata(current => ({ ...current, topics_covered: current.topics_covered.filter(item => item.toLowerCase() !== topic.toLowerCase()) }));
    setEditedFields(previous => new Set(previous).add('topics_covered'));
  };

  const selectCourse = (courseId: string) => {
    const course = courses.find(item => String(item.id) === courseId);
    if (!course) return;
    updateField('course_code', course.code || '');
    updateField('course_title', course.name || '');
    if (course.department) updateField('department', course.department);
  };

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = (e: React.DragEvent) => { if (!dropRef.current?.contains(e.relatedTarget as Node)) setDragOver(false); };
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); };

  const hasQueue = queue.length > 1;
  const queueLabel = hasQueue ? ` (${queueIndex + 1} of ${queue.length})` : '';
  const reviewRequired = metadata.indexed_status === 'indexed_review_required' || Boolean(metadata.needs_review);
  const extractionConfidence = Math.round((metadata.extraction_confidence || extraction?.extraction_confidence || 0) * 100);
  const rescueReason = rescueMessage(metadata.extraction_failure_reason);

  return (
    <div className="page" id="s-upload">
      <div className="pg-head">
        <div className="pg-title">Upload <em>Knowledge</em></div>
        <div className="pg-sub">Drop a PDF, Word document, PowerPoint, or image. ExamMind reads it, classifies it, checks duplicates, and asks for one final confirmation before indexing.</div>
      </div>

      {message && <div className={`upload-alert${reviewRequired ? ' review' : ''}`} style={{ marginBottom: 16 }}>{message}</div>}

      {state === 'idle' && (
        <div className="upload-grid">
          <div
            ref={dropRef}
            className={`drop-zone${dragOver ? ' drag-active' : ''}`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => document.getElementById('file-input')?.click()}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                document.getElementById('file-input')?.click();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Choose academic files to upload"
          >
            <input id="file-input" type="file" accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/png,image/jpeg" multiple onChange={e => handleFiles(e.target.files)} />
            <span className="sheet-margin" aria-hidden="true"><i /><i /><i /></span>
            <span className="sheet-frame" aria-hidden="true"><i /><i /><i /><i /></span>
            <span className="sheet-body">
              <svg className="sheet-glyph" viewBox="0 0 64 80" aria-hidden="true">
                <path className="glyph-page" d="M5 4h35l19 19v53H5z" />
                <path className="glyph-fold" d="M40 4v19h19" />
                <path className="glyph-rule" d="M16 36h22M16 43h28" />
                <rect className="glyph-mark" x="16" y="52" width="32" height="7" rx="3.5" />
              </svg>
              <span className="sheet-title">Drop academic files here</span>
              <span className="sheet-sub">ExamMind detects the document type, course, session, semester, department, topics, and reading confidence automatically.</span>
              <span className="sheet-formats">PDF · DOCX · PPTX · PNG · JPG</span>
            </span>
          </div>

          <aside className="upload-margin">
            <section className="margin-block">
              <h2 className="margin-label">Reading pipeline</h2>
              <ol className="margin-steps">
                {STEP_LABELS.map((item, index) => (
                  <li key={item}>
                    <span className="step-no">{String(index + 1).padStart(2, '0')}</span>
                    <span className="step-name">{item}</span>
                  </li>
                ))}
              </ol>
              <p className="margin-note">Every step runs before you confirm indexing.</p>
            </section>

            <section className="margin-block">
              <h2 className="margin-label">Recent intake</h2>
              {recentUploads === null && <p className="margin-note">Reading the archive...</p>}
              {recentUploads?.length === 0 && <p className="margin-note">Nothing filed yet.</p>}
              {recentUploads && recentUploads.length > 0 && (
                <ul className="margin-ledger">
                  {recentUploads.map(u => (
                    <li key={`${u.material_type}:${u.id}`}>
                      <div className="ledger-main">
                        <span className="ledger-code">{u.metadata_json?.course_code ?? 'Unknown'}</span>
                        <span className="ledger-kind">{DOC_TYPE_LABEL[u.metadata_json?.document_type ?? ''] ?? (u.material_type === 'lecture_note' ? 'Lecture Note' : 'Document')}</span>
                        <span className="ledger-year">{u.year ?? '--'}</span>
                      </div>
                      <button type="button" className="ledger-visibility" onClick={() => openRecentVisibility(u)} aria-label={`Change access for ${u.title || u.metadata_json?.course_code || 'this material'}`}>
                        {u.visibility === 'public' ? <Globe2 size={12} /> : u.visibility === 'group' ? <Users size={12} /> : <LockKeyhole size={12} />}
                        {visibilityLabel(u.visibility || 'private')}
                      </button>
                      {editingRecentKey === `${u.material_type}:${u.id}` && (
                        <div className="ledger-editor">
                          <SharingChoice
                            visibility={recentVisibility}
                            onVisibilityChange={value => { setRecentVisibility(value); setRecentShareError(''); setRecentConsent(false); }}
                            groups={shareGroups}
                            selectedGroupIds={recentGroupIds}
                            onToggleGroup={groupId => setRecentGroupIds(current => current.includes(groupId) ? current.filter(id => id !== groupId) : [...current, groupId])}
                            consent={recentConsent}
                            onConsentChange={setRecentConsent}
                            error={recentShareError}
                            compact
                          />
                          <div className="ledger-editor-actions">
                            <button type="button" className="ledger-editor-cancel" onClick={() => setEditingRecentKey(null)} disabled={recentShareBusy}>Cancel</button>
                            <button type="button" className="ledger-editor-save" onClick={() => void saveRecentVisibility(u)} disabled={recentShareBusy}>{recentShareBusy ? 'Saving...' : 'Save access'}</button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

          </aside>
        </div>
      )}

      {(state === 'processing' || state === 'error') && (
        <div className="card upload-processing">
          <UploadProcessingState fileName={file?.name || 'PDF'} queueLabel={queueLabel} steps={processingSteps} action={lastAction} />
          {state === 'error' && (
            <div className="confirm-actions">
              <button type="button" className="cta cta-ghost" onClick={() => setState(lastAction === 'index' ? 'confirm' : 'idle')}>
                {lastAction === 'index' ? 'Back to confirmation' : 'Choose another file'}
              </button>
              {file && <button type="button" className="cta" onClick={() => void (lastAction === 'index' ? confirmUpload() : analyzeFile(file))}>Try again</button>}
            </div>
          )}
        </div>
      )}

      {state === 'confirm' && (
        <UploadConfirmationCard
          file={file}
          metadata={{ ...metadata, pages_read: metadata.pages_read || extraction?.page_count || 0, extraction_confidence: metadata.extraction_confidence || extraction?.extraction_confidence || 0 }}
          extraction={extraction}
          previewSections={structuredPreview}
          contentPreview={contentPreview}
          rawOcrText={rawOcrText}
          previewQuality={previewQuality}
          advancedOpen={advancedOpen}
          setAdvancedOpen={setAdvancedOpen}
          updateField={updateField}
          updateListField={updateListField}
          editedFields={editedFields}
          errors={validationErrors}
          courses={courses}
          courseState={courseState}
          topicDraft={topicDraft}
          onTopicDraftChange={setTopicDraft}
          onAddTopic={addTopic}
          onRemoveTopic={removeTopic}
          onCourseSelect={selectCourse}
           sharingVisibility={sharingVisibility}
           onSharingVisibilityChange={value => { setSharingVisibility(value); setSharingError(''); }}
           shareGroups={shareGroups}
           selectedShareGroupIds={selectedShareGroupIds}
           onToggleShareGroup={groupId => {
             setSelectedShareGroupIds(current => current.includes(groupId) ? current.filter(id => id !== groupId) : [...current, groupId]);
             setSharingError('');
           }}
           sharingConsent={sharingConsent}
           onSharingConsentChange={value => { setSharingConsent(value); setSharingError(''); }}
           sharingError={sharingError}
          onCancel={() => hasQueue ? nextInQueue() : setState('idle')}
          onConfirm={() => void confirmUpload(false)}
          hasQueue={hasQueue}
        />
      )}

      {state === 'manual_metadata_required' && (
        <div className="card confirm-card failure-card">
          <div className="failure-title">ExamMind could not read this file clearly.</div>
          <div className="failure-body">{rescueReason}</div>
          <div className="upload-badges">
            <span className="upload-badge warn">Not indexed</span>
            <span className="upload-badge warn">{extractionConfidence}% extraction confidence</span>
          </div>
          <div className="upload-rescue-note">Manual metadata rescue is available here because the file could not produce useful searchable text.</div>
          <AdvancedMetadataEditor metadata={metadata} updateField={updateField} updateListField={updateListField} editedFields={editedFields} includeEssentials />
          <SharingChoice
            visibility={sharingVisibility}
            onVisibilityChange={value => { setSharingVisibility(value); setSharingError(''); }}
            groups={shareGroups}
            selectedGroupIds={selectedShareGroupIds}
            onToggleGroup={groupId => {
              setSelectedShareGroupIds(current => current.includes(groupId) ? current.filter(id => id !== groupId) : [...current, groupId]);
              setSharingError('');
            }}
            consent={sharingConsent}
            onConsentChange={value => { setSharingConsent(value); setSharingError(''); }}
            error={sharingError}
          />
          <div className="confirm-actions">
            <button type="button" className="cta cta-ghost" onClick={() => setState('idle')}>Upload clearer file</button>
            <button type="button" className="cta cta-ghost" onClick={() => void confirmUpload(true)}>Save record only</button>
            {file && <button type="button" className="cta" onClick={() => void analyzeFile(file)}>Retry OCR</button>}
          </div>
        </div>
      )}

      {state === 'duplicate' && (
        <div className="duplicate-card">
          <div className="duplicate-label">Duplicate detected</div>
          <div className="duplicate-title">This {DOC_TYPE_LABEL[metadata.document_type] ?? metadata.document_type} may already be in ExamMind.</div>
          <div className="duplicate-body">
            {duplicateDocument?.title || 'A material with the same course and document details was found.'}
            {duplicateDocument?.match_type === 'text_similarity' ? ' The readable text is also very similar.' : ''}
            {' '}Choose what to do with your copy.
          </div>
          <div className="confirm-actions">
            {duplicateDocument?.id && <button type="button" className="cta cta-ghost" onClick={() => go('questions')}>View existing</button>}
            <button type="button" className="cta cta-ghost" onClick={() => void confirmUpload(false, 'continue')}>Continue with this version</button>
            <button type="button" className="cta" onClick={() => void confirmUpload(false, 'newer_version')}>Submit as newer version</button>
            {hasQueue && <button type="button" className="cta" onClick={nextInQueue}>Next file ({queueIndex + 1}/{queue.length})</button>}
            <button type="button" className="cta cta-ghost" onClick={() => setState('idle')}>Upload another file</button>
          </div>
        </div>
      )}

      {state === 'success' && (
        <ContributionSuccessModal
          metadata={metadata}
          chunksIndexed={chunksIndexed}
          searchable={lastIndexed}
          documentId={lastDocumentId}
          documentType={lastDocumentType}
          initialVisibility={sharingVisibility}
          initialGroupIds={selectedShareGroupIds}
          groups={shareGroups}
          onViewLibrary={() => go('questions')}
          onDismiss={() => setState('idle')}
          onUploadAnother={() => {
            if (hasQueue && queueIndex + 1 < queue.length) {
              nextInQueue();
            } else {
              setState('idle');
              setQueue([]);
              setQueueIndex(0);
            }
          }}
        />
      )}

    </div>
  );
}
