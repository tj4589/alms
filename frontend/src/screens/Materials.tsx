import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpenText, FileQuestion, FileText, FolderOpen, Plus, RefreshCw, Search } from 'lucide-react';
import type { ScreenType } from '../types';
import { apiGet } from '../lib/api';
import './Materials.css';
import './WorkspacePage.css';

type MaterialKind = 'lecture_note' | 'past_question';
type MaterialFilter = 'all' | MaterialKind;

type RawMaterial = {
  id: number;
  title?: string | null;
  topic?: string | null;
  content_text?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  course_id?: number | null;
  year?: number | null;
  semester?: string | null;
  visibility?: string | null;
  is_owner?: boolean;
  contributor_label?: string | null;
  metadata_json?: Record<string, unknown> | null;
  created_at?: string | null;
};

type Course = { id: number; code: string; name: string };

type Material = RawMaterial & {
  kind: MaterialKind;
  title: string;
  typeLabel: string;
  courseLabel: string;
  statusLabel: string;
  statusTone: 'ready' | 'review' | 'processing' | 'unavailable';
};

function metadataValue(metadata: Record<string, unknown> | null | undefined, key: string): string {
  const value = metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function extensionOf(fileName: string | null | undefined): string {
  return fileName?.split('.').pop()?.toLowerCase() || '';
}

function materialTitle(raw: RawMaterial, kind: MaterialKind): string {
  const metadataTitle = metadataValue(raw.metadata_json, 'document_title');
  const text = (raw.content_text || '').replace(/\s+/g, ' ').trim();
  const preview = text.length > 82 ? `${text.slice(0, 82).trim()}…` : text;
  return metadataTitle || raw.title?.trim() || raw.topic?.trim() || preview || (kind === 'past_question' ? 'Past question' : 'Study note');
}

function typeLabel(raw: RawMaterial, kind: MaterialKind): string {
  const documentType = metadataValue(raw.metadata_json, 'document_type');
  if (documentType === 'audio') return 'Audio recording';
  if (documentType === 'video') return 'Video recording';
  const extension = extensionOf(raw.file_name);
  if (['ppt', 'pptx'].includes(extension)) return 'PowerPoint';
  if (['doc', 'docx'].includes(extension)) return 'Word document';
  if (extension === 'pdf') return 'PDF';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) return 'Image';
  if (['mp3', 'wav', 'm4a', 'ogg', 'flac', 'webm'].includes(extension)) return 'Audio';
  if (['mp4', 'mov'].includes(extension)) return 'Video';
  return kind === 'past_question' ? 'Past question' : 'Study note';
}

function statusFor(raw: RawMaterial): Pick<Material, 'statusLabel' | 'statusTone'> {
  const processing = metadataValue(raw.metadata_json, 'processing_status');
  const transcription = metadataValue(raw.metadata_json, 'transcription_status');
  if (processing === 'processing' || processing === 'awaiting_confirmation' || transcription === 'processing') return { statusLabel: 'Processing', statusTone: 'processing' };
  if (processing === 'failed' || transcription === 'failed' || metadataValue(raw.metadata_json, 'indexed_status') === 'unindexed') return { statusLabel: 'Needs attention', statusTone: 'unavailable' };
  if (metadataValue(raw.metadata_json, 'indexed_status') === 'indexed_review_required' || raw.metadata_json?.needs_review === true) return { statusLabel: 'Review recommended', statusTone: 'review' };
  return { statusLabel: 'Ready to study', statusTone: 'ready' };
}

function visibilityLabel(value: string | null | undefined): string {
  if (value === 'official') return 'Official';
  if (value === 'space_shared') return 'Shared in this space';
  if (value === 'group') return 'Study group';
  if (value === 'public') return 'Archive';
  return 'Only you';
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return 'Recently added';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Recently added' : `Added ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

export default function Materials({
  go,
  learningSpaceName,
  onOpenResource,
}: {
  go: (screen: ScreenType) => void;
  learningSpaceName?: string;
  onOpenResource: (kind: MaterialKind, id: number) => void;
}) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [filter, setFilter] = useState<MaterialFilter>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [notesPayload, questionsPayload, coursesPayload] = await Promise.all([
        apiGet('/lecture-notes'),
        apiGet('/past-questions'),
        apiGet('/courses'),
      ]);
      const courseRows = Array.isArray(coursesPayload) ? coursesPayload as Course[] : [];
      const courseMap = new Map(courseRows.map((course) => [course.id, course]));
      const normalize = (raw: RawMaterial, kind: MaterialKind): Material => {
        const course = raw.course_id ? courseMap.get(raw.course_id) : undefined;
        return {
          ...raw,
          kind,
          title: materialTitle(raw, kind),
          typeLabel: typeLabel(raw, kind),
          courseLabel: metadataValue(raw.metadata_json, 'course_code') || course?.code || 'Unsorted source',
          ...statusFor(raw),
        };
      };
      const next = [
        ...(Array.isArray(notesPayload) ? (notesPayload as RawMaterial[]).map((row) => normalize(row, 'lecture_note')) : []),
        ...(Array.isArray(questionsPayload) ? (questionsPayload as RawMaterial[]).map((row) => normalize(row, 'past_question')) : []),
      ].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '') || a.title.localeCompare(b.title));
      setCourses(courseRows);
      setMaterials(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Your materials could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visibleMaterials = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return materials.filter((material) => {
      if (filter !== 'all' && material.kind !== filter) return false;
      if (!normalizedQuery) return true;
      return [material.title, material.typeLabel, material.courseLabel, material.topic || '', material.file_name || '']
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [filter, materials, query]);

  const countFor = (kind: MaterialFilter) => kind === 'all' ? materials.length : materials.filter((material) => material.kind === kind).length;

  return (
    <div className="page workspace-page materials-page" id="s-materials">
      <header className="materials-heading">
        <div>
          <p className="materials-eyebrow">{learningSpaceName || 'Current learning space'}</p>
          <h1>My <em>Materials</em></h1>
          <p>Browse the sources you can access here. Open one in Workspace when you want the Reader and Maxe together.</p>
        </div>
        <div className="materials-heading-actions">
          <button type="button" className="materials-secondary-action" onClick={() => go('workspace')}><BookOpenText size={16} aria-hidden="true" /> Open workspace</button>
          <button type="button" className="materials-primary-action" onClick={() => go('upload')}><Plus size={16} aria-hidden="true" /> Add material</button>
        </div>
      </header>

      <section className="materials-library" aria-labelledby="materials-library-title">
        <div className="materials-library-head">
          <div>
            <p className="materials-eyebrow">Authorized library</p>
            <h2 id="materials-library-title">Sources in this space</h2>
            <p>Your private sources stay private. This list is filtered by the server for your current learning space.</p>
          </div>
          <button type="button" className="materials-refresh" onClick={() => void load()} disabled={loading} aria-label="Refresh materials" title="Refresh materials"><RefreshCw size={15} className={loading ? 'materials-spin' : ''} aria-hidden="true" /></button>
        </div>

        <div className="materials-toolbar" role="search" aria-label="Filter materials">
          <label className="materials-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search materials</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, topic or course" /></label>
          <div className="materials-filters" role="group" aria-label="Material type">
            {([['all', 'All'], ['lecture_note', 'Notes'], ['past_question', 'Past questions']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{countFor(value)}</span></button>)}
          </div>
        </div>

        {error && <div className="materials-alert" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Try again <ArrowRight size={15} aria-hidden="true" /></button></div>}
        {loading && <div className="materials-state" role="status"><RefreshCw size={17} className="materials-spin" aria-hidden="true" /> Gathering your authorized sources…</div>}
        {!loading && !error && visibleMaterials.length === 0 && <div className="materials-empty"><FolderOpen size={28} aria-hidden="true" /><h3>{materials.length ? 'No materials match that filter' : 'No materials here yet'}</h3><p>{materials.length ? 'Try another title, topic or type.' : 'Add a note or past question to start building this space.'}</p><button type="button" onClick={() => go('upload')}>Add first material <ArrowRight size={15} aria-hidden="true" /></button></div>}
        {!loading && !error && visibleMaterials.length > 0 && <ul className="materials-list" aria-label="Authorized materials">{visibleMaterials.map((material) => <li key={`${material.kind}-${material.id}`}><button type="button" className="materials-row" onClick={() => onOpenResource(material.kind, material.id)}><span className={`materials-icon is-${material.kind}`} aria-hidden="true">{material.kind === 'past_question' ? <FileQuestion size={18} /> : <FileText size={18} />}</span><span className="materials-row-main"><strong>{material.title}</strong><span>{[material.courseLabel, material.typeLabel, material.topic].filter(Boolean).join(' · ')}</span><small>{material.is_owner ? 'Added by you' : material.contributor_label || visibilityLabel(material.visibility)} · {dateLabel(material.created_at)}</small></span><span className={`materials-status is-${material.statusTone}`}><i aria-hidden="true" />{material.statusLabel}</span><ArrowRight className="materials-row-arrow" size={17} aria-hidden="true" /></button></li>)}</ul>}
      </section>

      <p className="materials-footnote">{visibleMaterials.length} of {materials.length} authorized source{materials.length === 1 ? '' : 's'} shown · {courses.length} course{courses.length === 1 ? '' : 's'} available</p>
    </div>
  );
}
