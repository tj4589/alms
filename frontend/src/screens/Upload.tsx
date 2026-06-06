import { useMemo, useState } from 'react';
import type { ScreenType } from '../types';
import { queuePendingUpload } from '../offline';
import { apiFormPost } from '../lib/api';

type UploadState = 'idle' | 'processing' | 'confirm' | 'duplicate' | 'success';

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

export default function Upload({ go }: { go: (s: ScreenType) => void }) {
  const [state, setState] = useState<UploadState>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<Metadata>(emptyMetadata);
  const [message, setMessage] = useState('');
  const [chunksIndexed, setChunksIndexed] = useState(0);

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

    if (!navigator.onLine) {
      await queuePendingUpload({
        id: `${selected.name}-${Date.now()}`,
        fileName: selected.name,
        fileSize: selected.size,
        queuedAt: new Date().toISOString(),
        status: 'waiting_to_sync',
      });
      window.dispatchEvent(new Event('exammind-offline-updated'));
      setState('idle');
      setMessage('You are offline, so this PDF was added to the sync queue. Metadata extraction will run when the backend is reachable.');
      return;
    }

    const formData = new FormData();
    formData.append('file', selected);

    try {
      const data = await apiFormPost('/ingest/upload', formData);

      setMetadata({ ...emptyMetadata, ...data.metadata });
      if (data.status === 'duplicate') {
        setState('duplicate');
        setMessage(`Already uploaded as ${data.existing_document?.title || 'an existing document'}.`);
      } else {
        setState('confirm');
      }
    } catch (error) {
      setState('idle');
      setMessage(error instanceof Error ? error.message : 'Upload analysis failed.');
    }
  };

  const confirmUpload = async () => {
    if (!file) return;
    setState('processing');
    setMessage('');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('confirm', 'true');
    formData.append('confirmed_metadata', JSON.stringify(metadata));

    try {
      const data = await apiFormPost('/ingest/upload', formData);

      if (data.status === 'duplicate') {
        setState('duplicate');
        setMessage('A matching document already exists, so indexing was blocked.');
      } else {
        setChunksIndexed(data.chunks_indexed || 0);
        setState('success');
      }
    } catch (error) {
      setState('confirm');
      setMessage(error instanceof Error ? error.message : 'Indexing failed.');
    }
  };

  const updateField = (key: keyof Metadata, value: string) => {
    setMetadata((current) => ({
      ...current,
      [key]: key === 'year' ? Number(value) || '' : value,
    }));
  };

  return (
    <div className="page" id="s-upload">
      <div className="pg-head">
        <div className="pg-title">Upload <em>Knowledge</em></div>
        <div className="pg-sub">Drop a PDF. ExamMind reads the metadata, checks duplicates, then indexes it for everyone.</div>
      </div>

      {message && <div className="upload-alert">{message}</div>}

      {state === 'idle' && (
        <div className="upload-grid">
          <label className="drop-zone">
            <input type="file" accept="application/pdf" onChange={(event) => event.target.files?.[0] && analyzeFile(event.target.files[0])} />
            <div className="drop-icon">+</div>
            <div className="drop-title">Drop a past question or lecture-note PDF</div>
            <div className="drop-sub">No form first. The AI extracts course, year, semester, department, faculty, type and topics.</div>
          </label>

          <div className="upload-side">
            <div className="card">
              <div className="card-hd"><div className="card-ttl">What the AI reads</div></div>
              {['Course code', 'Document type', 'Year and semester', 'Department', 'Faculty', 'Topics covered'].map((item) => (
                <div className="upload-read" key={item}><span>◆</span>{item}</div>
              ))}
            </div>
            <div className="card">
              <div className="card-hd"><div className="card-ttl">Recent uploads</div></div>
              <div className="upload-history">CSC 204 past question · 2023 · verified</div>
              <div className="upload-history">CSC 301 graph notes · unverified</div>
            </div>
          </div>
        </div>
      )}

      {state === 'processing' && (
        <div className="card upload-processing">
          <div className="upload-file">{file?.name || 'PDF'} is being processed</div>
          {['Document received', 'AI reading document', 'Duplicate check', 'Chunking and embedding'].map((step, index) => (
            <div className="upload-step" key={step}>
              <span className="upload-step-dot">{index + 1}</span>
              <span>{step}</span>
            </div>
          ))}
        </div>
      )}

      {state === 'confirm' && (
        <div className="card confirm-card">
          <div className="card-hd">
            <div>
              <div className="card-ttl">Confirm AI-extracted metadata</div>
              <div className="confirm-sub">Correct only what looks wrong, then index the PDF.</div>
            </div>
          </div>
          <div className="metadata-grid">
            {fields.map(([key, label]) => (
              <label className="meta-field" key={key}>
                <span>{label}</span>
                <input value={String(metadata[key] ?? '')} onChange={(event) => updateField(key, event.target.value)} />
              </label>
            ))}
            <label className="meta-field wide">
              <span>Topics covered</span>
              <input
                value={metadata.topics_covered.join(', ')}
                onChange={(event) => setMetadata((current) => ({ ...current, topics_covered: event.target.value.split(',').map((topic) => topic.trim()).filter(Boolean) }))}
              />
            </label>
          </div>
          <div className="confirm-actions">
            <button className="cta cta-ghost" onClick={() => setState('idle')}>Cancel</button>
            <button className="cta" onClick={confirmUpload}>Confirm and index</button>
          </div>
        </div>
      )}

      {state === 'duplicate' && (
        <div className="duplicate-card">
          <div className="duplicate-label">Duplicate detected</div>
          <div className="duplicate-title">This {metadata.document_type.replace('_', ' ')} is already in ExamMind.</div>
          <div className="duplicate-body">Same course, year, semester and document type. Indexing was stopped so the knowledge base stays clean.</div>
          <button className="cta cta-ghost" onClick={() => setState('idle')}>Upload another PDF</button>
        </div>
      )}

      {state === 'success' && (
        <div className="success-card">
          <div className="success-label">Indexed successfully</div>
          <div className="success-title">{metadata.course_code || 'Document'} is now searchable.</div>
          <div className="success-body">{chunksIndexed} chunks were embedded and tagged as {metadata.document_type.replace('_', ' ')}.</div>
          <div className="empty-actions">
            <button className="cta" onClick={() => go('assistant')}>Ask AI about it</button>
            <button className="cta cta-ghost" onClick={() => setState('idle')}>Upload another</button>
          </div>
        </div>
      )}
    </div>
  );
}
