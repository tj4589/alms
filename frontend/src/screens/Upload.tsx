import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScreenType, User } from '../types';
import { queuePendingUpload } from '../offline';
import { apiDelete, apiFormPost, apiGet } from '../lib/api';

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
  indexed_status?: string;
  searchable?: boolean;
  needs_review?: boolean;
};

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

const wait = (ms: number) => new Promise(r => window.setTimeout(r, ms));

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

function rescueMessage(reason?: string) {
  if (reason === 'ocr_not_installed') return 'OCR is not installed on this server. Install Tesseract OCR or upload a text-based file.';
  if (reason === 'ocr_failed' || reason === 'ocr_low_confidence' || reason === 'file_too_blurry') return 'ExamMind tried OCR, but the scan is too unclear to read confidently.';
  if (reason === 'encrypted_pdf') return 'This PDF appears to be encrypted. Upload an unlocked PDF.';
  return 'ExamMind could not read this file clearly.';
}

function displayValue(value?: string | number | null, fallback = 'Not found') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
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
  if (method === 'mixed') return 'Mixed';
  if (method === 'manual') return 'Manual';
  if (method === 'failed') return 'Failed';
  return 'Embedded Text';
}

function UploadProcessingState({ fileName, queueLabel, steps }: { fileName: string; queueLabel: string; steps: ProcessingStep[] }) {
  return (
    <div className="upload-processing-panel">
      <div className="upload-processing-kicker">ExamMind is preparing your material</div>
      <div className="upload-file">{fileName || 'PDF'}{queueLabel}</div>
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

function DetectedMetadataSummary({ metadata }: { metadata: Metadata }) {
  const rows = [
    ['Course', metadata.course_code || metadata.course_title ? <>{displayValue(metadata.course_code)} {metadata.course_title && <>&mdash; {metadata.course_title}</>}</> : 'Not found'],
    ['Academic session', displayValue(metadata.academic_year)],
    ['Semester', displayValue(metadata.semester)],
    ['Department', displayValue(metadata.department)],
    ['Pages read', displayValue(metadata.pages_read || 0)],
    ['Reading method', methodLabel(metadata.extraction_method)],
  ];

  return (
    <div className="detected-summary">
      {rows.map(([label, value]) => (
        <div className="detected-row" key={label as string}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function ExtractedContentPreview({
  contentPreview,
  sections,
  rawText,
  previewQuality,
}: {
  contentPreview: ContentPreview | null;
  sections: PreviewSection[];
  rawText: string;
  previewQuality: 'high' | 'medium' | 'low';
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
          <button className="upload-link-btn" onClick={() => setShowFullText(v => !v)}>
            {showFullText ? 'Hide raw OCR text' : 'View raw OCR text'}
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
}: {
  metadata: Metadata;
  updateField: (key: keyof Metadata, value: string) => void;
  updateListField: (key: 'topics_covered' | 'instructor_names', value: string) => void;
}) {
  const fields = [
    ['document_title', 'Document title'],
    ['document_type', 'Document type'],
    ['course_code', 'Course code'],
    ['course_title', 'Course title'],
    ['instructor_names', 'Instructor/Author'],
    ['academic_year', 'Academic year'],
    ['year', 'Year'],
    ['semester', 'Semester'],
    ['department', 'Department'],
    ['faculty', 'Faculty'],
    ['college', 'College'],
    ['exam_type', 'Exam type'],
  ] as const;

  return (
    <div className="advanced-editor">
      <div className="advanced-editor-title">Advanced details</div>
      <div className="metadata-grid">
        {fields.map(([key, label]) => {
          const value = key === 'instructor_names' ? metadata.instructor_names.join(', ') : String(metadata[key] ?? '');
          return (
            <label className="meta-field" key={key}>
              <span>{label}</span>
              {key === 'document_type' ? (
                <select value={metadata.document_type} onChange={e => updateField(key, e.target.value)}>
                  {DOC_TYPES.map(type => <option value={type} key={type}>{DOC_TYPE_LABEL[type]}</option>)}
                </select>
              ) : key === 'exam_type' ? (
                <select value={metadata.exam_type} onChange={e => updateField(key, e.target.value)}>
                  {EXAM_TYPES.map(type => <option value={type} key={type}>{type}</option>)}
                </select>
              ) : key === 'instructor_names' ? (
                <input value={value} onChange={e => updateListField('instructor_names', e.target.value)} />
              ) : (
                <input value={value} onChange={e => updateField(key, e.target.value)} />
              )}
            </label>
          );
        })}
        <label className="meta-field wide">
          <span>Topics covered</span>
          <input value={metadata.topics_covered.join(', ')} onChange={e => updateListField('topics_covered', e.target.value)} />
        </label>
      </div>
    </div>
  );
}

function UploadConfirmationCard({
  metadata,
  previewSections,
  contentPreview,
  rawOcrText,
  previewQuality,
  advancedOpen,
  setAdvancedOpen,
  updateField,
  updateListField,
  onCancel,
  onConfirm,
  hasQueue,
}: {
  metadata: Metadata;
  previewSections: PreviewSection[];
  contentPreview: ContentPreview | null;
  rawOcrText: string;
  previewQuality: 'high' | 'medium' | 'low';
  advancedOpen: boolean;
  setAdvancedOpen: (value: boolean) => void;
  updateField: (key: keyof Metadata, value: string) => void;
  updateListField: (key: 'topics_covered' | 'instructor_names', value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  hasQueue: boolean;
}) {
  const confidence = confidenceLabel(metadata);
  const review = confidence === 'Review Recommended';

  return (
    <div className="upload-confirm-shell">
      <div className="upload-confirm-card">
        <div className="confirm-topline">
          <span className="upload-badge primary">{DOC_TYPE_LABEL[metadata.document_type] ?? metadata.document_type}</span>
          <span className={`upload-badge ${review ? 'review' : 'good'}`}>{confidence}</span>
        </div>
        <h2>{metadata.document_title || `${metadata.course_code || 'Academic'} Material`}</h2>
        <p className="confirm-statement">ExamMind has read this document and prepared it for the knowledge base.</p>
        <div className="confirm-subtitle">
          {displayValue(metadata.course_code, 'Course pending')}
          {metadata.course_title && <>&nbsp;&mdash;&nbsp;{metadata.course_title}</>}
          {metadata.academic_year && <span> / {metadata.academic_year}</span>}
          {metadata.semester && <span> / {metadata.semester}</span>}
        </div>

        <DetectedMetadataSummary metadata={metadata} />

        {metadata.topics_covered.length > 0 && (
          <div className="topic-block">
            <div className="content-preview-head">Topics detected</div>
            <div className="topic-chip-row">
              {metadata.topics_covered.slice(0, 18).map(topic => <span className="topic-chip" key={topic}>{topic}</span>)}
            </div>
          </div>
        )}

        <ExtractedContentPreview
          contentPreview={contentPreview}
          sections={previewSections}
          rawText={rawOcrText}
          previewQuality={previewQuality}
        />

        <div className="confirm-caution">ExamMind can make mistakes. Check important info before confirming.</div>

        <div className="advanced-toggle-row">
          <button className="upload-link-btn" onClick={() => setAdvancedOpen(!advancedOpen)}>
            {advancedOpen ? 'Hide advanced details' : 'Need to correct something? Advanced details'}
          </button>
        </div>

        {advancedOpen && (
          <AdvancedMetadataEditor
            metadata={metadata}
            updateField={updateField}
            updateListField={updateListField}
          />
        )}

        <div className="confirm-actions">
          <button className="cta cta-ghost" onClick={onCancel}>{hasQueue ? 'Skip this file' : 'Cancel'}</button>
          <button className="cta" onClick={onConfirm}>Confirm and Add to ExamMind</button>
        </div>
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
          <button className="cta" onClick={onViewLibrary}>View in Library</button>
          <button className="cta cta-ghost" onClick={onUploadAnother}>Upload Another</button>
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
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user?.id) return;
    apiGet(`/past-questions?uploaded_by=${user.id}`)
      .then(d => setRecentUploads((d as RecentUpload[]).slice(0, 3)))
      .catch(() => setRecentUploads([]));
  }, [user?.id, state]);

  const previewLines = useMemo(() => cleanPreviewLines(preview, previewSnippets), [preview, previewSnippets]);
  const structuredPreview = useMemo(
    () => normalizePreviewSections(previewSections, previewLines),
    [previewSections, previewLines],
  );

  const analyzeFile = async (selected: File) => {
    setFile(selected);
    setState('processing');
    setMessage('');
    setAdvancedOpen(false);
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
      await wait(220); setProcessingSteps(mkSteps(1));
      await wait(220); setProcessingSteps(mkSteps(2));
      await wait(220); setProcessingSteps(mkSteps(3));
      const data = await apiFormPost('/ingest/upload', formData);
      const nextMetadata = { ...emptyMetadata, ...data.metadata };
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

  const confirmUpload = async (saveUnindexed = false) => {
    if (!file) return;
    setState('processing');
    setMessage('');
    setProcessingSteps(mkSteps(0));
    setLastAction('index');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('confirm', 'true');
    formData.append('confirmed_metadata', JSON.stringify(saveUnindexed ? {
      ...metadata,
      extraction_method: 'manual',
      indexed_status: 'unindexed',
      searchable: false,
      needs_clearer_file: true,
    } : metadata));

    try {
      await wait(180); setProcessingSteps(mkSteps(1));
      await wait(180); setProcessingSteps(mkSteps(2));
      await wait(180); setProcessingSteps(mkSteps(3));
      await wait(180); setProcessingSteps(mkSteps(4));
      const data = await apiFormPost('/ingest/upload', formData);

      if (data.status === 'duplicate') {
        setProcessingSteps(failSteps(3));
        setState('duplicate');
        setMessage('A matching document already exists.');
      } else {
        setProcessingSteps(doneSteps(4));
        setChunksIndexed(data.chunks_indexed || 0);
        setLastIndexed(data.indexed !== false);
        setMetadata({ ...metadata, ...data.metadata });
        setState('success');
      }
    } catch (err) {
      setProcessingSteps(failSteps(4));
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Indexing failed.');
    }
  };

  const startQueue = (files: File[]) => {
    if (files.length === 0) return;
    setQueue(files);
    setQueueIndex(0);
    void analyzeFile(files[0]);
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
    const supportedFiles = Array.from(files).filter((f) => {
      const name = f.name.toLowerCase();
      return supportedMimeTypes.includes(f.type) || supportedExtensions.some((ext) => name.endsWith(ext));
    });
    if (supportedFiles.length === 0) { setMessage('Only PDF, Word, PowerPoint, PNG, JPG, and JPEG files are supported.'); return; }
    setMessage('');
    if (supportedFiles.length === 1) {
      setQueue([]);
      void analyzeFile(supportedFiles[0]);
    } else {
      startQueue(supportedFiles);
    }
  };

  const updateField = (key: keyof Metadata, value: string) => {
    setMetadata(c => ({ ...c, [key]: key === 'year' ? Number(value) || '' : value }));
  };

  const updateListField = (key: 'topics_covered' | 'instructor_names', value: string) => {
    setMetadata(c => ({ ...c, [key]: value.split(',').map(t => t.trim()).filter(Boolean) }));
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
            style={{ cursor: 'pointer' }}
          >
            <input id="file-input" type="file" accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/png,image/jpeg" multiple onChange={e => handleFiles(e.target.files)} />
            <div className="drop-icon">+</div>
            <div className="drop-title">Drop academic files here</div>
            <div className="drop-sub">ExamMind detects the document type, course, session, semester, department, topics, and reading confidence automatically.</div>
          </div>

          <div className="upload-side">
            <div className="card">
              <div className="card-hd"><div className="card-ttl">Automated reading pipeline</div></div>
              {STEP_LABELS.map(item => (
                <div className="upload-read" key={item}>
                  <span>+</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{item}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>Handled before you confirm indexing.</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="card-hd"><div className="card-ttl">Your recent uploads</div></div>
              {recentUploads === null && <div className="upload-history empty">Loading...</div>}
              {recentUploads?.length === 0 && <div className="upload-history empty">Nothing uploaded yet.</div>}
              {recentUploads?.map(u => (
                <div className="upload-read" key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: 13 }}>{u.metadata_json?.course_code ?? 'Unknown'}</span>
                    <span className="recent-type-pill">{DOC_TYPE_LABEL[u.metadata_json?.document_type ?? ''] ?? 'Document'}</span>
                  </div>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{u.year ?? '-'}</span>
                </div>
              ))}
            </div>
            <div className="card danger-card">
              <div className="card-hd"><div className="card-ttl">Clear test uploads</div></div>
              <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 12 }}>
                Remove old uploaded materials so you can re-upload them with the latest ExamMind indexing system.
              </div>
              <button className="cta cta-ghost danger-btn" onClick={() => setShowClearConfirm(true)}>
                Clear uploaded materials
              </button>
            </div>
          </div>
        </div>
      )}

      {(state === 'processing' || state === 'error') && (
        <div className="card upload-processing">
          <UploadProcessingState fileName={file?.name || 'PDF'} queueLabel={queueLabel} steps={processingSteps} />
          {state === 'error' && (
            <div className="confirm-actions">
              <button className="cta cta-ghost" onClick={() => setState(lastAction === 'index' ? 'confirm' : 'idle')}>
                {lastAction === 'index' ? 'Back to confirmation' : 'Choose another file'}
              </button>
              {file && <button className="cta" onClick={() => void (lastAction === 'index' ? confirmUpload() : analyzeFile(file))}>Try again</button>}
            </div>
          )}
        </div>
      )}

      {state === 'confirm' && (
        <UploadConfirmationCard
          metadata={{ ...metadata, pages_read: metadata.pages_read || extraction?.page_count || 0, extraction_confidence: metadata.extraction_confidence || extraction?.extraction_confidence || 0 }}
          previewSections={structuredPreview}
          contentPreview={contentPreview}
          rawOcrText={rawOcrText}
          previewQuality={previewQuality}
          advancedOpen={advancedOpen}
          setAdvancedOpen={setAdvancedOpen}
          updateField={updateField}
          updateListField={updateListField}
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
          <AdvancedMetadataEditor metadata={metadata} updateField={updateField} updateListField={updateListField} />
          <div className="confirm-actions">
            <button className="cta cta-ghost" onClick={() => setState('idle')}>Upload clearer file</button>
            <button className="cta cta-ghost" onClick={() => void confirmUpload(true)}>Save record only</button>
            {file && <button className="cta" onClick={() => void analyzeFile(file)}>Retry OCR</button>}
          </div>
        </div>
      )}

      {state === 'duplicate' && (
        <div className="duplicate-card">
          <div className="duplicate-label">Duplicate detected</div>
          <div className="duplicate-title">This {DOC_TYPE_LABEL[metadata.document_type] ?? metadata.document_type} is already in ExamMind.</div>
          <div className="duplicate-body">Same course, year, semester and type. Indexing was skipped to keep the knowledge base clean.</div>
          <div className="confirm-actions">
            {hasQueue && <button className="cta" onClick={nextInQueue}>Next file ({queueIndex + 1}/{queue.length})</button>}
            <button className="cta cta-ghost" onClick={() => setState('idle')}>Upload another file</button>
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
              <button className="cta cta-ghost" onClick={() => setShowClearConfirm(false)} disabled={clearingMaterials}>Cancel</button>
              <button className="cta danger-solid" onClick={() => void clearUploadedMaterials()} disabled={clearingMaterials}>
                {clearingMaterials ? 'Clearing...' : 'Clear materials'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
