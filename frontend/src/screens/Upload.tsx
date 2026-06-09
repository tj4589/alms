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
  } | null;
};

type UploadState = 'idle' | 'processing' | 'confirm' | 'duplicate' | 'success' | 'error';
type UploadAction = 'analyze' | 'index';
type StepStatus = 'pending' | 'active' | 'done' | 'error';
type ProcessingStep = { label: string; status: StepStatus };

type Metadata = {
  document_type: string;
  course_code: string;
  course_title: string;
  year: number | '';
  semester: string;
  department: string;
  faculty: string;
  topics_covered: string[];
  confidence_score?: number;
};

const emptyMetadata: Metadata = {
  document_type: 'past_question',
  course_code: '',
  course_title: '',
  year: '',
  semester: '',
  department: '',
  faculty: '',
  topics_covered: [],
};

const STEP_LABELS = ['Document received', 'AI reading document', 'Duplicate check', 'Chunking and embedding'];

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
};

export default function Upload({ go, user }: { go: (s: ScreenType) => void; user: User | null }) {
  const [state, setState] = useState<UploadState>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<Metadata>(emptyMetadata);
  const [message, setMessage] = useState('');
  const [chunksIndexed, setChunksIndexed] = useState(0);
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
    ['document_type', 'Document type'],
    ['course_code', 'Course code'],
    ['course_title', 'Course title'],
    ['year', 'Year'],
    ['semester', 'Semester'],
    ['department', 'Department'],
    ['faculty', 'Faculty'],
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
      } else {
        setProcessingSteps(doneSteps(2));
        setState('confirm');
      }
    } catch (err) {
      setProcessingSteps(failSteps(2));
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Upload analysis failed.');
    }
  };

  const confirmUpload = async () => {
    if (!file) return;
    setState('processing');
    setMessage('');
    setProcessingSteps(mkSteps(0));
    setLastAction('index');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('confirm', 'true');
    formData.append('confirmed_metadata', JSON.stringify(metadata));

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

  // Drag-and-drop handlers
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = (e: React.DragEvent) => { if (!dropRef.current?.contains(e.relatedTarget as Node)) setDragOver(false); };
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); };

  const hasQueue = queue.length > 1;
  const queueLabel = hasQueue ? ` (${queueIndex + 1} of ${queue.length})` : '';

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
                ['Year & semester', 'e.g. 2023 / Second semester'],
                ['Department & faculty', 'From document header'],
                ['Topics covered', 'Key subject areas indexed for search'],
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

      {state === 'confirm' && (
        <div className="card confirm-card">
          <div className="card-hd">
            <div>
              <div className="card-ttl" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                AI-detected metadata
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
              <div className="confirm-sub">Correct anything wrong, then index.</div>
            </div>
          </div>
          <div className="metadata-grid">
            {fields.map(([key, label]) => (
              <label className="meta-field" key={key}>
                <span>{label}</span>
                <input value={String(metadata[key] ?? '')} onChange={e => updateField(key, e.target.value)} />
              </label>
            ))}
            <label className="meta-field wide">
              <span>Topics covered</span>
              <input
                value={metadata.topics_covered.join(', ')}
                onChange={e => setMetadata(c => ({ ...c, topics_covered: e.target.value.split(',').map(t => t.trim()).filter(Boolean) }))}
              />
            </label>
          </div>
          <div className="confirm-actions">
            <button className="cta cta-ghost" onClick={() => hasQueue ? nextInQueue() : setState('idle')}>
              {hasQueue ? 'Skip this file' : 'Cancel'}
            </button>
            <button className="cta" onClick={() => void confirmUpload()}>Confirm and index</button>
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
          <div className="success-label">Indexed successfully</div>
          <div className="success-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {metadata.course_code || 'Document'} is now searchable.
            <span style={{
              fontSize: 12, padding: '2px 10px', borderRadius: 20, fontWeight: 600,
              background: metadata.document_type === 'lecture_note' ? 'rgba(62,207,178,0.12)' : 'rgba(155,135,245,0.12)',
              color: metadata.document_type === 'lecture_note' ? 'var(--teal)' : 'var(--purple)',
            }}>
              {DOC_TYPE_LABEL[metadata.document_type] ?? metadata.document_type}
            </span>
          </div>
          <div className="success-body">{chunksIndexed} chunks embedded and indexed.</div>
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
