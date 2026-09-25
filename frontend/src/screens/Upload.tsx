import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, FileText, Plus, X } from 'lucide-react';
import type { Course, ScreenType, User } from '../types';
import { queuePendingUpload } from '../offline';
import { apiDelete, apiFormPost, apiGet } from '../lib/api';

import './Upload.css';

type RecentUpload = {
  id: number;
  year: number | null;
  metadata_json: {
    course_code?: string;
    document_type?: string;
    topics_covered?: string[];
    indexed_status?: string;
    needs_clearer_file?: boolean;
  } | null;
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
type FieldStatus = 'detected' | 'review' | 'missing' | 'edited';
type ValidationErrors = Partial<Record<'document_title' | 'document_type' | 'course' | 'academic_year' | 'year' | 'topics', string>>;

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
const EXAM_TYPES = ['unknown', 'quiz', 'test', 'midterm', 'final'];
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
  return status === 'detected' ? 'Detected' : status === 'review' ? 'Needs review' : status === 'edited' ? 'Edited' : 'Not found';
}

function fieldStatus(value: string | number | null | undefined, edited: boolean, needsReview = false): FieldStatus {
  if (edited) return 'edited';
  if (!displayValue(value, '')) return 'missing';
  return needsReview ? 'review' : 'detected';
}

function FieldStatusBadge({ status }: { status: FieldStatus }) {
  return <span className={`field-status field-status--${status}`}>{statusLabel(status)}</span>;
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
    ['faculty', 'Faculty'],
    ['college', 'College'],
    ['exam_type', 'Exam type'],
  ] as const;

  const fieldValue = (key: keyof Metadata) => key === 'instructor_names' ? metadata.instructor_names.join(', ') : String(metadata[key] ?? '');

  return (
    <div className="advanced-editor">
      {showHeading && <div className="advanced-editor-title">More details</div>}
      <div className="metadata-grid">
        {includeEssentials && (
          <>
            <label className="meta-field wide" htmlFor="upload-document-title">
              <span>Document title <FieldStatusBadge status={fieldStatus(metadata.document_title, editedFields.has('document_title'), Boolean(metadata.needs_review))} /></span>
              <input id="upload-document-title" value={metadata.document_title} onChange={e => updateField('document_title', e.target.value)} />
            </label>
            <label className="meta-field" htmlFor="upload-document-type">
              <span>Document type <FieldStatusBadge status={fieldStatus(metadata.document_type === 'unknown' ? '' : metadata.document_type, editedFields.has('document_type'), Boolean(metadata.needs_review))} /></span>
              <select id="upload-document-type" value={metadata.document_type === 'unknown' ? '' : metadata.document_type} onChange={e => updateField('document_type', e.target.value)}>
                <option value="" disabled>Choose a type</option>
                {DOC_TYPES.filter(type => type !== 'unknown').map(type => <option value={type} key={type}>{DOC_TYPE_LABEL[type]}</option>)}
              </select>
            </label>
            <label className="meta-field" htmlFor="upload-course-code">
              <span>Course code <FieldStatusBadge status={fieldStatus(metadata.course_code, editedFields.has('course_code'), Boolean(metadata.needs_review))} /></span>
              <input id="upload-course-code" value={metadata.course_code} onChange={e => updateField('course_code', e.target.value)} />
            </label>
            <label className="meta-field" htmlFor="upload-course-title">
              <span>Course title <FieldStatusBadge status={fieldStatus(metadata.course_title, editedFields.has('course_title'), Boolean(metadata.needs_review))} /></span>
              <input id="upload-course-title" value={metadata.course_title} onChange={e => updateField('course_title', e.target.value)} />
            </label>
            <label className="meta-field" htmlFor="upload-academic-year">
              <span>Academic session <FieldStatusBadge status={fieldStatus(metadata.academic_year, editedFields.has('academic_year'), Boolean(metadata.needs_review))} /></span>
              <input id="upload-academic-year" value={metadata.academic_year} onChange={e => updateField('academic_year', e.target.value)} placeholder="e.g. 2024/2025" />
            </label>
            <label className="meta-field" htmlFor="upload-semester">
              <span>Semester <FieldStatusBadge status={fieldStatus(metadata.semester, editedFields.has('semester'), Boolean(metadata.needs_review))} /></span>
              <input id="upload-semester" value={metadata.semester} onChange={e => updateField('semester', e.target.value)} placeholder="e.g. First" />
            </label>
          </>
        )}
        {fields.map(([key, label]) => {
          const value = fieldValue(key);
          const statusValue = key === 'instructor_names' ? metadata.instructor_names.join(', ') : String(metadata[key] ?? '');
          return (
            <label className={`meta-field${key === 'instructor_names' ? ' wide' : ''}`} key={key} htmlFor={`upload-${key}`}>
              <span>{label} <FieldStatusBadge status={fieldStatus(statusValue, editedFields.has(key), Boolean(metadata.needs_review))} /></span>
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
        <span>Title <FieldStatusBadge status={fieldStatus(metadata.document_title, editedFields.has('document_title'), review)} /></span>
        <input id="review-document-title" value={metadata.document_title} onChange={e => updateField('document_title', e.target.value)} aria-invalid={Boolean(errors.document_title)} />
        {errors.document_title && <small className="field-error">{errors.document_title}</small>}
      </label>

      <label className="meta-field" htmlFor="review-document-type">
        <span>Type <FieldStatusBadge status={fieldStatus(metadata.document_type === 'unknown' ? '' : metadata.document_type, editedFields.has('document_type'), review)} /></span>
        <select id="review-document-type" value={metadata.document_type === 'unknown' ? '' : metadata.document_type} onChange={e => updateField('document_type', e.target.value)} aria-invalid={Boolean(errors.document_type)}>
          <option value="" disabled>Choose a document type</option>
          {DOC_TYPES.filter(type => type !== 'unknown').map(type => <option value={type} key={type}>{DOC_TYPE_LABEL[type]}</option>)}
        </select>
        {errors.document_type && <small className="field-error">{errors.document_type}</small>}
      </label>

      <div className="course-field-group">
        <div className="field-label-line"><span className="field-label">Course</span><FieldStatusBadge status={fieldStatus(metadata.course_code || metadata.course_title, editedFields.has('course_code') || editedFields.has('course_title'), review)} /></div>
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
        <span>Academic session <FieldStatusBadge status={fieldStatus(metadata.academic_year, editedFields.has('academic_year'), review)} /></span>
        <input id="review-academic-year" value={metadata.academic_year} onChange={e => updateField('academic_year', e.target.value)} placeholder="e.g. 2024/2025" aria-invalid={Boolean(errors.academic_year)} />
        {errors.academic_year && <small className="field-error">{errors.academic_year}</small>}
      </label>

      <label className="meta-field" htmlFor="review-semester">
        <span>Semester <FieldStatusBadge status={fieldStatus(metadata.semester, editedFields.has('semester'), review)} /></span>
        <input id="review-semester" value={metadata.semester} onChange={e => updateField('semester', e.target.value)} placeholder="e.g. First" />
      </label>
    </div>
  );
}

function TopicsEditor({
  topics,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
}: {
  topics: string[];
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
        <FieldStatusBadge status={topics.length ? 'detected' : 'missing'} />
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
  onCancel: () => void;
  onConfirm: () => void;
  hasQueue: boolean;
}) {
  const confidence = confidenceLabel(metadata);
  const review = confidence === 'Review Recommended';
  const hasMissingEssentials = !metadata.document_title || metadata.document_type === 'unknown';
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
          <TopicsEditor topics={metadata.topics_covered} draft={topicDraft} onDraftChange={onTopicDraftChange} onAdd={onAddTopic} onRemove={onRemoveTopic} />
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
          <EssentialMetadataEditor metadata={metadata} courses={courses} courseState={courseState} editedFields={editedFields} errors={errors} updateField={updateField} onCourseSelect={onCourseSelect} />
          {(review || hasMissingEssentials) && (
            <div className="review-warning"><AlertCircle size={16} /><span>ExamMind may misread some details. Review anything marked “Needs review” before adding this material.</span></div>
          )}
          <button type="button" className="details-disclosure" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(!advancedOpen)}>
            <span>More details</span><ChevronDown size={17} aria-hidden="true" />
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
  onViewLibrary,
  onUploadAnother,
}: {
  metadata: Metadata;
  chunksIndexed: number;
  searchable: boolean;
  onViewLibrary: () => void;
  onUploadAnother: () => void;
}) {
  return (
    <div className="success-modal-backdrop">
      <div className="success-modal">
        <div className="success-label">Upload complete</div>
        <h2>Thank you for contributing</h2>
        <p>Your upload has strengthened ExamMind's knowledge base. Students can now discover this material through search, AI assistance, and practice tools.</p>
        <div className="success-modal-meta">
          <span>{metadata.course_code || 'Course pending'}</span>
          <span>{DOC_TYPE_LABEL[metadata.document_type] ?? 'Document'}</span>
          <span>{chunksIndexed} chunks</span>
          <span>{searchable ? 'Searchable' : 'Record only'}</span>
        </div>
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
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearingMaterials, setClearingMaterials] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseState, setCourseState] = useState<CourseState>('loading');
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set());
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [topicDraft, setTopicDraft] = useState('');
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user?.id) return;
    apiGet(`/past-questions?uploaded_by=${user.id}`)
      .then(d => setRecentUploads((d as RecentUpload[]).slice(0, 3)))
      .catch(() => setRecentUploads([]));
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
    if (courseValues.some(value => UNKNOWN_VALUES.has(value))) {
      errors.course = 'Replace “Unknown” with a course code or title, or leave the course blank.';
    }
    if (metadata.year !== '' && (!Number.isInteger(metadata.year) || metadata.year < 1900 || metadata.year > 2100)) {
      errors.year = 'Enter a year between 1900 and 2100.';
    }
    if (metadata.topics_covered.some(topic => !topic.trim())) {
      errors.topics = 'Remove blank topics before adding this material.';
    }
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) {
      const firstField = errors.document_title ? 'review-document-title' : errors.document_type ? 'review-document-type' : errors.course ? 'review-course-code' : errors.year ? 'upload-year' : undefined;
      if (firstField) window.setTimeout(() => document.getElementById(firstField)?.focus(), 0);
      return false;
    }
    return true;
  };

  const confirmUpload = async (saveUnindexed = false) => {
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
        setProcessingSteps(failSteps(3));
        setState('duplicate');
        setMessage('A matching document already exists.');
      } else {
        setProcessingSteps(doneSteps(4));
        setChunksIndexed(data.chunks_indexed || 0);
        setLastIndexed(data.indexed !== false);
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
  };

  const clearUploadedMaterials = async () => {
    setClearingMaterials(true);
    setMessage('');
    try {
      const summary = await apiDelete('/ingest/clear-materials') as {
        past_questions_deleted?: number;
        lecture_notes_deleted?: number;
        lecture_note_chunks_deleted?: number;
      };
      setShowClearConfirm(false);
      setRecentUploads([]);
      setMessage(
        `Uploaded materials cleared. Removed ${summary.past_questions_deleted || 0} past question chunks, ${summary.lecture_notes_deleted || 0} lecture notes, and ${summary.lecture_note_chunks_deleted || 0} note chunks.`
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not clear uploaded materials.');
    } finally {
      setClearingMaterials(false);
    }
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
                    <li key={u.id}>
                      <span className="ledger-code">{u.metadata_json?.course_code ?? 'Unknown'}</span>
                      <span className="ledger-kind">{DOC_TYPE_LABEL[u.metadata_json?.document_type ?? ''] ?? 'Document'}</span>
                      <span className="ledger-year">{u.year ?? '--'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {(user?.role === 'admin' || import.meta.env.DEV) && (
              <section className="margin-block margin-block--end">
                <button type="button" className="margin-action" onClick={() => setShowClearConfirm(true)}>
                  Clear uploaded materials
                </button>
                <p className="margin-note">Removes old uploads so you can re-file them with the current indexer.</p>
              </section>
            )}
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
          <div className="duplicate-title">This {DOC_TYPE_LABEL[metadata.document_type] ?? metadata.document_type} is already in ExamMind.</div>
          <div className="duplicate-body">Same course, year, semester and type. Indexing was skipped to keep the knowledge base clean.</div>
          <div className="confirm-actions">
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
          onViewLibrary={() => go('questions')}
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

      {showClearConfirm && (
        <div className="success-modal-backdrop">
          <div className="success-modal danger-modal">
            <div className="success-label">Clear uploaded materials</div>
            <h2>Remove test uploads?</h2>
            <p>This will remove uploaded past questions and notes from ExamMind, but your account will remain. Continue?</p>
            <div className="empty-actions">
              <button type="button" className="cta cta-ghost" onClick={() => setShowClearConfirm(false)} disabled={clearingMaterials}>Cancel</button>
              <button type="button" className="cta danger-solid" onClick={() => void clearUploadedMaterials()} disabled={clearingMaterials}>
                {clearingMaterials ? 'Clearing...' : 'Clear materials'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
