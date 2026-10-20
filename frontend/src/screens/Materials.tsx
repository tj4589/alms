import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  File,
  FileQuestion,
  FileText,
  Image as ImageIcon,
  Music,
  Presentation,
  RefreshCw,
  Search,
  Upload,
  Video,
} from 'lucide-react';
import type { ScreenType } from '../types';
import { apiGet } from '../lib/api';
import './Materials.css';

type MaterialKind = 'lecture_note' | 'past_question';
type Filter = 'all' | MaterialKind;

type RawMaterial = {
  id: number;
  title?: string | null;
  topic?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  has_file?: boolean;
  is_owner?: boolean;
  course_id?: number | null;
  year?: number | null;
  semester?: string | null;
  visibility?: string | null;
  metadata_json?: Record<string, unknown> | null;
  created_at?: string | null;
};

type Material = {
  id: number;
  kind: MaterialKind;
  title: string;
  fileName: string | null;
  courseCode: string | null;
  courseTitle: string | null;
  year: number | null;
  semester: string | null;
  visibility: string;
  isOwner: boolean;
  createdAt: string | null;
  typeLabel: string;
};

function metadataText(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function extensionOf(fileName: string | null): string {
  return fileName?.split('.').pop()?.toLowerCase() || '';
}

function materialType(raw: RawMaterial, kind: MaterialKind): string {
  const documentType = metadataText(raw.metadata_json, 'document_type');
  if (documentType === 'audio') return 'Audio recording';
  if (documentType === 'video') return 'Video recording';
  const extension = extensionOf(raw.file_name || null);
  if (['ppt', 'pptx'].includes(extension)) return 'PowerPoint';
  if (['doc', 'docx'].includes(extension)) return 'Word document';
  if (extension === 'pdf') return 'PDF';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) return 'Image';
  if (['mp3', 'wav', 'm4a', 'ogg', 'flac'].includes(extension)) return 'Audio';
  if (['mp4', 'webm', 'mov'].includes(extension)) return 'Video';
  return kind === 'past_question' ? 'Past question' : 'Study note';
}

function normalize(raw: RawMaterial, kind: MaterialKind): Material {
  const metadata = raw.metadata_json || {};
  return {
    id: raw.id,
    kind,
    title: raw.title?.trim() || metadataText(metadata, 'document_title') || raw.file_name?.trim() || (kind === 'past_question' ? 'Past question' : 'Study note'),
    fileName: raw.file_name || null,
    courseCode: metadataText(metadata, 'course_code'),
    courseTitle: metadataText(metadata, 'course_title'),
    year: raw.year || null,
    semester: raw.semester || null,
    visibility: raw.visibility || 'private',
    isOwner: Boolean(raw.is_owner),
    createdAt: raw.created_at || null,
    typeLabel: materialType(raw, kind),
  };
}

function iconFor(material: Material) {
  if (material.kind === 'past_question') return FileQuestion;
  const extension = extensionOf(material.fileName);
  if (['ppt', 'pptx'].includes(extension)) return Presentation;
  if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) return ImageIcon;
  if (['mp3', 'wav', 'm4a', 'ogg', 'flac'].includes(extension)) return Music;
  if (['mp4', 'webm', 'mov'].includes(extension)) return Video;
  if (extension === 'pdf') return FileText;
  return File;
}

function formatDate(value: string | null): string {
  if (!value) return 'Recently added';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Recently added' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function visibilityLabel(value: string): string {
  if (value === 'official') return 'Official resource';
  if (value === 'space_shared') return 'Learning space';
  if (value === 'group') return 'Study group';
  if (value === 'public') return 'Academy archive';
  return 'Only me';
}

export default function Materials({ go, onOpenResource }: {
  go: (screen: ScreenType) => void;
  onOpenResource: (kind: MaterialKind, id: number) => void;
}) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadMaterials = async () => {
    setLoading(true);
    setError('');
    try {
      const [notesPayload, questionsPayload] = await Promise.all([
        apiGet('/lecture-notes'),
        apiGet('/past-questions'),
      ]);
      const notes = (Array.isArray(notesPayload) ? notesPayload : []).map(item => normalize(item as RawMaterial, 'lecture_note'));
      const questions = (Array.isArray(questionsPayload) ? questionsPayload : []).map(item => normalize(item as RawMaterial, 'past_question'));
      setMaterials([...notes, ...questions].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || a.title.localeCompare(b.title)));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Materials could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadMaterials(); }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return materials.filter(material => {
      if (filter !== 'all' && material.kind !== filter) return false;
      if (!needle) return true;
      return [material.title, material.fileName, material.courseCode, material.courseTitle, material.typeLabel]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(needle));
    });
  }, [filter, materials, query]);

  return (
    <div className="page materials-page" id="s-materials">
      <header className="materials-heading">
        <div>
          <p className="materials-eyebrow">Your sources</p>
          <h1>My materials</h1>
          <p>Browse the notes, recordings and past questions available in this learning space.</p>
        </div>
        <button type="button" className="materials-add" onClick={() => go('upload')}><Upload size={16} aria-hidden="true" /> Add material</button>
      </header>

      <section className="materials-toolbar" aria-label="Material filters">
        <label className="materials-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search materials</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search materials" /></label>
        <div className="materials-tabs" role="tablist" aria-label="Material type">
          {([['all', 'All materials'], ['lecture_note', 'Notes and media'], ['past_question', 'Past questions']] as const).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </div>
        <button type="button" className="materials-refresh" onClick={() => void loadMaterials()} disabled={loading} aria-label="Refresh materials" title="Refresh materials"><RefreshCw size={16} className={loading ? 'is-spinning' : ''} aria-hidden="true" /></button>
      </section>

      {error && <div className="materials-state materials-state-error" role="alert"><span>{error}</span><button type="button" onClick={() => void loadMaterials()}>Try again</button></div>}
      {loading && materials.length === 0 && <div className="materials-state" role="status">Gathering materials from this learning space...</div>}
      {!loading && !error && filtered.length === 0 && <div className="materials-empty"><FileText size={26} aria-hidden="true" /><h2>{materials.length ? 'No materials match that search.' : 'Your materials library is empty.'}</h2><p>{materials.length ? 'Try another title, course or material type.' : 'Upload a note, recording or past question to start building your library.'}</p><button type="button" className="materials-empty-action" onClick={() => go('upload')}>{materials.length ? 'Clear filters' : 'Add your first material'} <ArrowRight size={15} aria-hidden="true" /></button></div>}
      {!loading && !error && filtered.length > 0 && <div className="materials-list" aria-live="polite">
        {filtered.map(material => {
          const Icon = iconFor(material);
          return <article className="materials-card" key={`${material.kind}:${material.id}`}>
            <button type="button" className="materials-card-open" onClick={() => onOpenResource(material.kind, material.id)}>
              <span className="materials-icon"><Icon size={20} aria-hidden="true" /></span>
              <span className="materials-card-copy"><span className="materials-card-type">{material.typeLabel}</span><strong>{material.title}</strong><small>{[material.courseCode, material.courseTitle, material.year && String(material.year)].filter(Boolean).join(' · ') || 'No course details yet'}</small></span>
              <ArrowRight className="materials-card-arrow" size={18} aria-hidden="true" />
            </button>
            <footer className="materials-card-footer"><span>{visibilityLabel(material.visibility)}{material.isOwner ? ' · Added by you' : ''}</span><time dateTime={material.createdAt || undefined}>{formatDate(material.createdAt)}</time></footer>
          </article>;
        })}
      </div>}
    </div>
  );
}
