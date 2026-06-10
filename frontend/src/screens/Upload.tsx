import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScreenType, User } from '../types';
import { queuePendingUpload } from '../offline';
import { apiFormPost, apiGet } from '../lib/api';

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

type Metadata = {
  document_type: string;
  document_title: string;
  course_code: string;
  course_title: string;
  lecturer_names: string[];
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
  needs_clearer_file?: boolean;
  confidence_score?: number;
};

const emptyMetadata: Metadata = {
  document_type: 'past_question',
  document_title: '',
  course_code: '',
  course_title: '',
  lecturer_names: [],
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
  needs_clearer_file: false,
};

const STEP_LABELS = ['Document received', 'Text/OCR extraction', 'Metadata and duplicate check', 'Chunking and embedding'];

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
  unknown: 'Unknown',
};

const DOC_TYPES = Object.keys(DOC_TYPE_LABEL);
const EXAM_TYPES = ['unknown', 'quiz', 'test', 'midterm', 'final'];

function rescueMessage(reason?: string) {
  if (reason === 'ocr_not_installed') {
    return 'OCR is not installed on this server. Install Tesseract OCR or upload a text-based PDF.';
  }
  if (reason === 'ocr_failed' || reason === 'ocr_low_confidence' || reason === 'file_too_blurry') {
    return 'ExamMind tried OCR, but the scan is too unclear to read confidently.';
  }
  if (reason === 'encrypted_pdf') {
    return 'This PDF appears to be encrypted. Upload an unlocked PDF.';
  }
  return 'ExamMind could not extract enough readable text from this PDF.';
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
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user?.id) return;
    apiGet(`/past-questions?uploaded_by=${user.id}`)
      .then(d => setRecentUploads((d as RecentUpload[]).slice(0, 3)))
      .catch(() => setRecentUploads([]));
  }, [user?.id, state]);

  const fields = useMemo(() => [
    ['document_title', 'Document title'],
    ['document_type', 'Document type'],
    ['course_code', 'Course code'],
    ['course_title', 'Course title'],
    ['lecturer_names', 'Lecturer'],
    ['academic_year', 'Academic year'],
    ['year', 'Year'],
    ['semester', 'Semester'],
    ['department', 'Department'],
    ['faculty', 'Faculty'],
    ['college', 'College'],
    ['exam_type', 'Exam type'],
  ] as const, []);

  const analyzeFile = async (selected: File) => {
    setFile(selected);
    setState('processing');
    setMessage('');
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
      setMessage(`You are offline — "${selected.name}" was added to the sync queue.`);
      return;
    }

    const formData = new FormData();
    formData.append('file', selected);

    try {
      await wait(250);
      setProcessingSteps(mkSteps(1));
      await wait(250);
      setProcessingSteps(mkSteps(2));
      const data = await apiFormPost('/ingest/upload', formData);
      setMetadata({ ...emptyMetadata, ...data.metadata });
      if (data.status === 'duplicate') {
        setProcessingSteps(doneSteps(2));
        setState('duplicate');
        setMessage(`Already uploaded as ${data.existing_document?.title || 'an existing document'}.`);
      } else if (data.status === 'manual_metadata_required') {
        setProcessingSteps(failSteps(1));
        setState('manual_metadata_required');
        setMessage(data.message || rescueMessage(data.metadata?.extraction_failure_reason));
      } else {
        setProcessingSteps(doneSteps(2));
        setState('confirm');
        if (data.message) setMessage(data.message);
      }
    } catch (err) {
      setProcessingSteps(failSteps(2));
      setState('error');
      const fallback = 'Upload analysis failed.';
      const errorMessage = err instanceof Error ? err.message : fallback;
      setMessage(errorMessage.includes('scanned or image-based PDF') ? 'ExamMind could not read this scan clearly. Try a clearer PDF or enter metadata manually.' : errorMessage);
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
      await wait(200); setProcessingSteps(mkSteps(1));
      await wait(200); setProcessingSteps(mkSteps(2));
      await wait(200); setProcessingSteps(mkSteps(3));
      const data = await apiFormPost('/ingest/upload', formData);

      if (data.status === 'duplicate') {
        setProcessingSteps(failSteps(2));
        setState('duplicate');
        setMessage('A matching document already exists.');
      } else {
        setProcessingSteps(doneSteps(3));
        setChunksIndexed(data.chunks_indexed || 0);
        setLastIndexed(data.indexed !== false);
        setMetadata({ ...metadata, ...data.metadata });
        setState('success');
      }
    } catch (err) {
      setProcessingSteps(failSteps(3));
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Indexing failed.');
    }
  };

  // Multi-file: when a queue is set up, auto-advance to next file after success/skip
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
    const pdfs = Array.from(files).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length === 0) { setMessage('Only PDF files are supported.'); return; }
    setMessage('');
    if (pdfs.length === 1) {
      setQueue([]);
      void analyzeFile(pdfs[0]);
    } else {
      startQueue(pdfs);
    }
  };

  const updateField = (key: keyof Metadata, value: string) => {
    setMetadata(c => ({ ...c, [key]: key === 'year' ? Number(value) || '' : value }));
  };

  const updateListField = (key: 'topics_covered' | 'lecturer_names', value: string) => {
    setMetadata(c => ({ ...c, [key]: value.split(',').map(t => t.trim()).filter(Boolean) }));
  };

  // Drag-and-drop handlers
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = (e: React.DragEvent) => { if (!dropRef.current?.contains(e.relatedTarget as Node)) setDragOver(false); };
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); };

  const hasQueue = queue.length > 1;
  const queueLabel = hasQueue ? ` (${queueIndex + 1} of ${queue.length})` : '';
  const extractionMethod = metadata.extraction_method || 'embedded_text';
  const extractionConfidence = Math.round((metadata.extraction_confidence || 0) * 100);
  const extractionBadge =
    extractionMethod === 'ocr' || extractionMethod === 'mixed'
      ? 'Read using OCR'
      : extractionMethod === 'manual'
        ? 'Manual metadata'
        : 'Text-based PDF';
  const lowConfidence = extractionMethod === 'failed' || extractionMethod === 'manual' || (metadata.extraction_confidence || 0) < 0.45;
  const rescueReason = rescueMessage(metadata.extraction_failure_reason);

  return (
    <div className="page" id="s-upload">
      <div className="pg-head">
        <div className="pg-title">Upload <em>Knowledge</em></div>
        <div className="pg-sub">Drop one or more PDFs. ExamMind auto-detects whether each is a past question or lecture note, checks duplicates, then indexes for everyone.</div>
      </div>

      {message && <div className="upload-alert" style={{ marginBottom: 16 }}>{message}</div>}

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
            <input
              id="file-input"
              type="file"
              accept="application/pdf"
              multiple
              style={{ display: 'none' }}
              onChange={e => handleFiles(e.target.files)}
            />
            <div className="drop-icon">+</div>
            <div className="drop-title">Drop past questions or lecture notes here</div>
            <div className="drop-sub">
              Drag &amp; drop one or multiple PDFs, or click to browse.
              The AI auto-detects document type, course, year, and topics.
            </div>
          </div>

          <div className="upload-side">
            <div className="card">
              <div className="card-hd"><div className="card-ttl">What the AI reads</div></div>
              {[
                ['Document type', 'Past Question or Lecture Note — auto-detected'],
                ['Course code', 'e.g. CSC301, MTH201'],
                ['Course title', 'Detected from headers and cover pages'],
                ['Lecturer', 'Only when explicitly written in the PDF'],
                ['Year & semester', 'e.g. 2023 / Second semester'],
                ['Department', 'From document header'],
                ['Faculty / College', 'School, faculty, or college names'],
                ['Topics covered', 'Key subject areas indexed for search'],
                ['Extraction method', 'Text-based PDF or OCR scan reading'],
                ['Confidence', 'How sure ExamMind is about the extraction'],
              ].map(([item, desc]) => (
                <div className="upload-read" key={item}>
                  <span>◆</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{item}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>{desc}</div>
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
                    <span style={{
                      marginLeft: 7, fontSize: 11, padding: '1px 6px', borderRadius: 4,
                      background: u.metadata_json?.document_type === 'lecture_note' ? 'rgba(62,207,178,0.1)' : 'rgba(155,135,245,0.1)',
                      color: u.metadata_json?.document_type === 'lecture_note' ? 'var(--teal)' : 'var(--purple)',
                    }}>
                      {DOC_TYPE_LABEL[u.metadata_json?.document_type ?? ''] ?? 'Document'}
                    </span>
                  </div>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{u.year ?? '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {(state === 'processing' || state === 'error') && (
        <div className="card upload-processing">
          <div className="upload-file">{file?.name || 'PDF'}{queueLabel} is being processed</div>
          {processingSteps.map((step, i) => (
            <div className={`upload-step ${step.status}`} key={step.label}>
              <span className="upload-step-dot">{i + 1}</span>
              <span>{step.label}</span>
            </div>
          ))}
          {state === 'error' && (
            <div className="confirm-actions">
              <button className="cta cta-ghost" onClick={() => setState(lastAction === 'index' ? 'confirm' : 'idle')}>
                {lastAction === 'index' ? 'Back to metadata' : 'Choose another PDF'}
              </button>
              {file && <button className="cta" onClick={() => void (lastAction === 'index' ? confirmUpload() : analyzeFile(file))}>Try again</button>}
            </div>
          )}
        </div>
      )}

      {(state === 'confirm' || state === 'manual_metadata_required') && (
        <div className="card confirm-card">
          <div className="card-hd">
            <div>
              <div className="card-ttl" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {state === 'manual_metadata_required' ? 'Manual metadata rescue' : 'AI-detected metadata'}
                <span style={{
                  fontSize: 12, padding: '2px 10px', borderRadius: 20, fontWeight: 600,
                  background: metadata.document_type === 'lecture_note' ? 'rgba(62,207,178,0.12)' : 'rgba(155,135,245,0.12)',
                  color: metadata.document_type === 'lecture_note' ? 'var(--teal)' : 'var(--purple)',
                  border: `1px solid ${metadata.document_type === 'lecture_note' ? 'rgba(62,207,178,0.3)' : 'rgba(155,135,245,0.3)'}`,
                }}>
                  {DOC_TYPE_LABEL[metadata.document_type] ?? metadata.document_type}
                </span>
                {metadata.confidence_score !== undefined && (
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {Math.round(metadata.confidence_score * 100)}% confidence
                  </span>
                )}
              </div>
              <div className="confirm-sub">
                {state === 'manual_metadata_required'
                  ? 'ExamMind could not extract enough readable text from this PDF. You can still save the document record manually, but the content will not be searchable until a clearer file is uploaded.'
                  : 'Correct anything wrong, then index.'}
              </div>
            </div>
          </div>
          <div className="upload-badges">
            {state === 'manual_metadata_required' && <span className="upload-badge warn">Not indexed</span>}
            <span className={`upload-badge ${lowConfidence ? 'warn' : ''}`}>{lowConfidence ? 'Low confidence scan' : extractionBadge}</span>
            <span className="upload-badge">{extractionConfidence}% extraction confidence</span>
            {state === 'manual_metadata_required' && <span className="upload-badge">{rescueReason}</span>}
            {metadata.source_file && <span className="upload-badge">{metadata.source_file}</span>}
          </div>
          {state === 'manual_metadata_required' && (
            <div className="upload-rescue-note">
              This file will be stored, but it will not appear in AI answers or semantic search until readable text is available.
            </div>
          )}
          <div className="metadata-grid">
            {fields.map(([key, label]) => {
              const value = key === 'lecturer_names' ? metadata.lecturer_names.join(', ') : String(metadata[key] ?? '');
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
                  ) : key === 'lecturer_names' ? (
                    <input value={value} onChange={e => updateListField('lecturer_names', e.target.value)} />
                  ) : (
                    <input value={value} onChange={e => updateField(key, e.target.value)} />
                  )}
                </label>
              );
            })}
            <label className="meta-field wide">
              <span>Topics covered</span>
              <input
                value={metadata.topics_covered.join(', ')}
                onChange={e => updateListField('topics_covered', e.target.value)}
              />
            </label>
            <label className="meta-field">
              <span>Extraction method</span>
              <input value={extractionMethod} readOnly />
            </label>
            <label className="meta-field">
              <span>Extraction confidence</span>
              <input value={`${extractionConfidence}%`} readOnly />
            </label>
          </div>
          <div className="confirm-actions">
            <button className="cta cta-ghost" onClick={() => hasQueue ? nextInQueue() : setState('idle')}>
              {hasQueue ? 'Skip this file' : 'Cancel'}
            </button>
            {state === 'manual_metadata_required' && file && (
              <>
                <button className="cta cta-ghost" onClick={() => { setMessage(''); setState('idle'); }}>Upload clearer PDF</button>
                <button className="cta cta-ghost" onClick={() => void confirmUpload(true)}>Save as unindexed record</button>
                <button className="cta" onClick={() => void analyzeFile(file)}>Retry OCR</button>
              </>
            )}
            {state !== 'manual_metadata_required' && (
              <button className="cta" onClick={() => void confirmUpload(false)}>Confirm and index</button>
            )}
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
            <button className="cta cta-ghost" onClick={() => setState('idle')}>Upload another PDF</button>
          </div>
        </div>
      )}

      {state === 'success' && (
        <div className="success-card">
          <div className="success-label">{lastIndexed ? 'Indexed successfully' : 'Saved as unindexed record'}</div>
          <div className="success-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {lastIndexed ? `${metadata.course_code || 'Document'} is now searchable.` : `${metadata.course_code || 'Document'} needs a readable file.`}
            <span style={{
              fontSize: 12, padding: '2px 10px', borderRadius: 20, fontWeight: 600,
              background: metadata.document_type === 'lecture_note' ? 'rgba(62,207,178,0.12)' : 'rgba(155,135,245,0.12)',
              color: metadata.document_type === 'lecture_note' ? 'var(--teal)' : 'var(--purple)',
            }}>
              {DOC_TYPE_LABEL[metadata.document_type] ?? metadata.document_type}
            </span>
          </div>
          <div className="success-body">
            {lastIndexed
              ? `${chunksIndexed} chunks embedded and indexed.`
              : 'The document record was saved, but it will not appear in AI answers or semantic search until a clearer PDF is uploaded.'}
          </div>
          <div className="empty-actions">
            {hasQueue && queueIndex + 1 < queue.length && (
              <button className="cta" onClick={nextInQueue}>
                Next file ({queueIndex + 2}/{queue.length})
              </button>
            )}
            <button className="cta" onClick={() => go('assistant')}>Ask AI about it</button>
            <button className="cta cta-ghost" onClick={() => setState('idle')}>Upload another</button>
          </div>
        </div>
      )}
    </div>
  );
}
