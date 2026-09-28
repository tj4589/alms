import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine, BookOpen, File, FileQuestion, FileText, Image as ImageIcon,
  LoaderCircle, Music, PanelLeftClose, PanelLeftOpen, PanelRightClose,
  PanelRightOpen, Plus, Presentation, RefreshCw, Search, Upload, Video,
} from 'lucide-react';
import type { ChatMessage, ScreenType, User } from '../types';
import { apiBlob, apiDownload, apiGet } from '../lib/api';
import Assistant from './Assistant';
import './Workspace.css';

type ResourceKind = 'lecture_note' | 'past_question';
type ResourceStatus = 'ready' | 'review' | 'unavailable';
type RawResource = {
  id: number; title?: string | null; topic?: string | null; file_name?: string | null;
  file_size?: number | null; has_file?: boolean; content_text?: string | null;
  course_id?: number | null; year?: number | null; semester?: string | null;
  visibility?: 'public' | 'group' | 'private'; metadata_json?: Record<string, unknown> | null;
  created_at?: string | null;
};
type Resource = {
  key: string; id: number; kind: ResourceKind; title: string; fileName: string | null;
  fileSize: number | null; hasFile: boolean; contentText: string; courseCode: string | null;
  courseTitle: string | null; year: number | null; semester: string | null;
  visibility: 'public' | 'group' | 'private'; metadata: Record<string, unknown>;
  status: ResourceStatus; statusLabel: string; createdAt: string | null;
};
type ReaderDetail = Resource & { sections: { id: number; heading: string | null; body: string; page_from?: number | null; page_to?: number | null }[] };
type WorkspaceProps = {
  go: (screen: ScreenType) => void;
  notifyUnavailable: (feature: string) => void;
  messages: ChatMessage[];
  onMessagesChange: (updater: (current: ChatMessage[]) => ChatMessage[]) => void;
  onNewThread: () => void;
  user: User | null;
};

function metadataValue(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function extensionOf(fileName: string | null): string { return fileName?.split('.').pop()?.toLowerCase() || ''; }
function typeLabel(resource: Pick<Resource, 'fileName' | 'kind' | 'metadata'>): string {
  const extension = extensionOf(resource.fileName);
  if (['ppt', 'pptx'].includes(extension)) return 'PowerPoint';
  if (['doc', 'docx'].includes(extension)) return 'Word document';
  if (extension === 'pdf') return 'PDF';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) return 'Image';
  if (['mp3', 'wav', 'm4a', 'ogg'].includes(extension)) return 'Audio';
  if (['mp4', 'webm', 'mov'].includes(extension)) return 'Video';
  return resource.kind === 'past_question' ? 'Past question' : metadataValue(resource.metadata, 'document_type') || 'Study note';
}
function statusFor(raw: RawResource): Pick<Resource, 'status' | 'statusLabel'> {
  const metadata = raw.metadata_json || {};
  const indexedStatus = metadataValue(metadata, 'indexed_status');
  if (indexedStatus === 'indexed_review_required' || metadata.needs_review === true) return { status: 'review', statusLabel: 'Review recommended' };
  if (indexedStatus === 'unindexed' || metadata.searchable === false) return { status: 'unavailable', statusLabel: 'Not indexed' };
  return { status: 'ready', statusLabel: 'Ready to study' };
}
function normalizeResource(raw: RawResource, kind: ResourceKind): Resource {
  const metadata = raw.metadata_json || {};
  const title = raw.title?.trim() || metadataValue(metadata, 'document_title') || raw.file_name?.trim() || (kind === 'past_question' ? 'Past question' : 'Study note');
  const status = statusFor(raw);
  const documentKey = metadataValue(metadata, 'source_checksum') || `${raw.file_name || title}:${raw.course_id || 'archive'}:${raw.year || ''}:${raw.semester || ''}`;
  return {
    key: `${kind}:${documentKey}`, id: raw.id, kind, title, fileName: raw.file_name || null,
    fileSize: raw.file_size || null, hasFile: Boolean(raw.has_file || raw.file_size), contentText: raw.content_text || '',
    courseCode: metadataValue(metadata, 'course_code'), courseTitle: metadataValue(metadata, 'course_title'),
    year: raw.year || null, semester: raw.semester || null, visibility: raw.visibility || 'private', metadata,
    status: status.status, statusLabel: status.statusLabel, createdAt: raw.created_at || null,
  };
}
function iconFor(resource: Resource) {
  const extension = extensionOf(resource.fileName);
  if (resource.kind === 'past_question') return FileQuestion;
  if (['ppt', 'pptx'].includes(extension)) return Presentation;
  if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) return ImageIcon;
  if (['mp3', 'wav', 'm4a', 'ogg'].includes(extension)) return Music;
  if (['mp4', 'webm', 'mov'].includes(extension)) return Video;
  if (extension === 'pdf') return FileText;
  return File;
}
function visibilityLabel(visibility: Resource['visibility']): string { return visibility === 'public' ? 'Academy archive' : visibility === 'group' ? 'Study group' : 'Only me'; }
function splitParagraphs(value: string): string[] { return value.split(/\n\s*\n|\n/).map(item => item.trim()).filter(Boolean); }
function resourceDownloadPath(resource: Resource): string { return resource.kind === 'lecture_note' ? `/materials/lecture-notes/${resource.id}/download` : `/materials/past-questions/${resource.id}/download`; }

function ResourceSidebar({ resources, activeKey, search, onSearch, onSelect, onUpload, onRefresh, loading }: {
  resources: Resource[]; activeKey: string | null; search: string; onSearch: (value: string) => void;
  onSelect: (resource: Resource) => void; onUpload: () => void; onRefresh: () => void; loading: boolean;
}) {
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return resources;
    return resources.filter(resource => [resource.title, resource.fileName, resource.courseCode, resource.courseTitle, typeLabel(resource)].some(value => value?.toLowerCase().includes(query)));
  }, [resources, search]);
  return <div className="ws-sidebar-content">
    <div className="ws-panel-heading"><div><p className="ws-eyebrow">Sources</p><h2>Study materials</h2></div><button type="button" className="ws-icon-button" onClick={onRefresh} aria-label="Refresh sources" title="Refresh sources"><RefreshCw size={15} className={loading ? 'ws-spin' : ''} aria-hidden="true" /></button></div>
    <button type="button" className="ws-add-button" onClick={onUpload}><Plus size={16} aria-hidden="true" /> Add resource</button>
    <label className="ws-source-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Filter sources</span><input value={search} onChange={event => onSearch(event.target.value)} placeholder="Filter sources" /></label>
    <div className="ws-source-meta"><span>{filtered.length} source{filtered.length === 1 ? '' : 's'}</span><span>Accessible here</span></div>
    <div className="ws-source-list" aria-live="polite">
      {loading && resources.length === 0 && <p className="ws-muted">Gathering your sources...</p>}
      {!loading && filtered.length === 0 && <div className="ws-empty-small"><BookOpen size={22} aria-hidden="true" /><strong>{resources.length ? 'No source matches' : 'Your workspace is empty'}</strong><span>{resources.length ? 'Try a different title, course or file type.' : 'Add a note, slide deck or past question to begin.'}</span></div>}
      {filtered.map(resource => { const Icon = iconFor(resource); return <button type="button" className={`ws-source-row${activeKey === resource.key ? ' is-active' : ''}`} key={resource.key} onClick={() => onSelect(resource)}>
        <span className={`ws-source-icon is-${resource.status}`}><Icon size={17} strokeWidth={1.7} aria-hidden="true" /></span><span className="ws-source-copy"><strong>{resource.title}</strong><small>{[resource.courseCode, typeLabel(resource)].filter(Boolean).join(' · ')}</small><span className={`ws-status ws-status-${resource.status}`}><i aria-hidden="true" />{resource.statusLabel}</span></span><span className={`ws-visibility ws-visibility-${resource.visibility}`}>{visibilityLabel(resource.visibility)}</span>
      </button>; })}
    </div>
  </div>;
}

function ResourceReader({ resource, go }: { resource: Resource; go: (screen: ScreenType) => void }) {
  const [detail, setDetail] = useState<ReaderDetail | null>(resource.kind === 'past_question' ? { ...resource, sections: [] } : null);
  const [loading, setLoading] = useState(resource.kind === 'lecture_note');
  const [error, setError] = useState(''); const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false); const [downloadError, setDownloadError] = useState(''); const [previewError, setPreviewError] = useState(false);
  useEffect(() => {
    let cancelled = false; setError(''); setPreviewError(false); setSourceUrl(null);
    if (resource.kind === 'past_question') { setDetail({ ...resource, sections: [] }); setLoading(false); return () => { cancelled = true; }; }
    setLoading(true); apiGet(`/materials/lecture-notes/${resource.id}`).then(payload => {
      if (cancelled) return; const data = payload as RawResource & { sections?: ReaderDetail['sections'] };
      setDetail({ ...resource, ...normalizeResource(data, 'lecture_note'), sections: data.sections || [] });
    }).catch(() => { if (!cancelled) setError('That source could not be opened. It may have been removed or the connection dropped.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [resource]);
  const extension = extensionOf(resource.fileName);
  const canNativePreview = resource.hasFile && ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'mp3', 'wav', 'm4a', 'ogg', 'mp4', 'webm', 'mov'].includes(extension);
  useEffect(() => {
    let cancelled = false; if (!canNativePreview) return () => { cancelled = true; };
    apiBlob(resourceDownloadPath(resource)).then(blob => { if (!cancelled) setSourceUrl(URL.createObjectURL(blob)); }).catch(() => { if (!cancelled) setPreviewError(true); });
    return () => { cancelled = true; setSourceUrl(current => { if (current) URL.revokeObjectURL(current); return null; }); };
  }, [canNativePreview, resource]);
  const download = async () => { setDownloading(true); setDownloadError(''); try { await apiDownload(resourceDownloadPath(resource), resource.fileName || `${resource.title}.${extension || 'pdf'}`); } catch (failure) { setDownloadError(failure instanceof Error ? failure.message : 'That file could not be downloaded.'); } finally { setDownloading(false); } };
  const body = detail?.contentText || resource.contentText;
  return <div className="ws-reader-content">
    <header className="ws-reader-header"><div className="ws-reader-kicker"><span>{resource.courseCode || 'Archive'}</span><span>{typeLabel(resource)}</span><span className={`ws-status ws-status-${resource.status}`}><i aria-hidden="true" />{resource.statusLabel}</span></div><h1>{resource.title}</h1><p>{[resource.courseTitle, resource.year && String(resource.year), resource.semester, visibilityLabel(resource.visibility)].filter(Boolean).join(' · ')}</p><div className="ws-reader-actions">{resource.hasFile && <button type="button" className="ws-download-button" onClick={() => void download()} disabled={downloading}><ArrowDownToLine size={15} aria-hidden="true" />{downloading ? 'Preparing...' : 'Download original'}</button>}<button type="button" className="ws-text-action" onClick={() => go('upload')}>Add another source <Plus size={15} aria-hidden="true" /></button></div>{downloadError && <p className="ws-reader-error" role="alert">{downloadError}</p>}</header>
    {loading && <div className="ws-reader-state"><LoaderCircle size={19} className="ws-spin" aria-hidden="true" /> Opening source...</div>}{error && <div className="ws-reader-state is-error" role="alert">{error}</div>}
    {!loading && !error && <>{canNativePreview && sourceUrl && extension === 'pdf' && <iframe className="ws-native-preview" title={`Preview of ${resource.title}`} src={sourceUrl} />}{canNativePreview && sourceUrl && ['png', 'jpg', 'jpeg', 'webp'].includes(extension) && <img className="ws-image-preview" src={sourceUrl} alt={`Preview of ${resource.title}`} />}{canNativePreview && sourceUrl && ['mp3', 'wav', 'm4a', 'ogg'].includes(extension) && <audio className="ws-media-preview" controls src={sourceUrl} />}{canNativePreview && sourceUrl && ['mp4', 'webm', 'mov'].includes(extension) && <video className="ws-media-preview" controls src={sourceUrl} />}{resource.hasFile && !canNativePreview && <div className="ws-format-note"><FileText size={18} aria-hidden="true" /><span><strong>{typeLabel(resource)} source</strong><small>ExamMind is showing the extracted reading text here. Download the original when you need the source file.</small></span></div>}{previewError && <p className="ws-muted">The original preview is unavailable, but the extracted text is still available below.</p>}{detail?.sections?.length ? detail.sections.map(section => <section className="ws-reading-section" key={section.id}><div className="ws-section-label">{section.heading || 'Section'}{section.page_from ? <span>Pages {section.page_from}{section.page_to && section.page_to !== section.page_from ? `–${section.page_to}` : ''}</span> : null}</div>{splitParagraphs(section.body).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>) : body ? <section className="ws-reading-section"><div className="ws-section-label">Extracted text</div>{splitParagraphs(body).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section> : <div className="ws-reader-state">No readable text was kept for this source.</div>}</>}
  </div>;
}

function MaxePanel({ activeResource, go, notifyUnavailable, messages, onMessagesChange, onNewThread, user }: { activeResource: Resource | null; go: (screen: ScreenType) => void; notifyUnavailable: (feature: string) => void; messages: ChatMessage[]; onMessagesChange: (updater: (current: ChatMessage[]) => ChatMessage[]) => void; onNewThread: () => void; user: User | null }) {
  return <div className="ws-maxe-content"><header className="ws-maxe-header"><div className="ws-maxe-brand"><span className="ws-maxe-mark">M</span><div><strong>Maxe</strong><small>Study beside your source</small></div></div><button type="button" className="ws-text-action" onClick={onNewThread}>New thread</button></header><div className="ws-maxe-context" aria-live="polite"><span className="ws-eyebrow">Active source</span><strong>{activeResource?.title || 'No source selected'}</strong><small>{activeResource ? `${typeLabel(activeResource)} · ${activeResource.courseCode || 'Archive'}` : 'Choose a source so the context stays visible while you study.'}</small></div><div className="ws-maxe-assistant"><Assistant go={go} selectedQuestion="" notifyUnavailable={notifyUnavailable} messages={messages} onMessagesChange={onMessagesChange} user={user} /></div></div>;
}

export default function Workspace({ go, notifyUnavailable, messages, onMessagesChange, onNewThread, user }: WorkspaceProps) {
  const [resources, setResources] = useState<Resource[]>([]); const [selectedKey, setSelectedKey] = useState<string | null>(null); const [search, setSearch] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [sourceWidth, setSourceWidth] = useState(() => Number(localStorage.getItem('exammind-workspace-source-width')) || 288); const [maxeWidth, setMaxeWidth] = useState(() => Number(localStorage.getItem('exammind-workspace-maxe-width')) || 344); const [sourcesCollapsed, setSourcesCollapsed] = useState(false); const [maxeCollapsed, setMaxeCollapsed] = useState(false); const [mobilePanel, setMobilePanel] = useState<'sources' | 'reader' | 'maxe'>('sources');
  const loadResources = async () => { setLoading(true); setError(''); try { const [notesPayload, questionsPayload] = await Promise.all([apiGet('/lecture-notes'), apiGet('/past-questions')]); const notes = (notesPayload as RawResource[]).map(item => normalizeResource(item, 'lecture_note')); const questionMap = new Map<string, Resource>(); (questionsPayload as RawResource[]).forEach(item => { const resource = normalizeResource(item, 'past_question'); const current = questionMap.get(resource.key); if (!current || resource.fileSize || resource.contentText.length > current.contentText.length) questionMap.set(resource.key, resource); }); const next = [...notes, ...questionMap.values()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || a.title.localeCompare(b.title)); setResources(next); setSelectedKey(current => current && next.some(item => item.key === current) ? current : next[0]?.key || null); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Sources could not be loaded.'); } finally { setLoading(false); } };
  useEffect(() => { void loadResources(); }, []); useEffect(() => { localStorage.setItem('exammind-workspace-source-width', String(sourceWidth)); }, [sourceWidth]); useEffect(() => { localStorage.setItem('exammind-workspace-maxe-width', String(maxeWidth)); }, [maxeWidth]);
  const activeResource = resources.find(resource => resource.key === selectedKey) || null;
  const startResize = (panel: 'sources' | 'maxe', event: React.PointerEvent<HTMLButtonElement>) => { event.preventDefault(); const startX = event.clientX; const startWidth = panel === 'sources' ? sourceWidth : maxeWidth; const onMove = (moveEvent: PointerEvent) => { const delta = moveEvent.clientX - startX; if (panel === 'sources') setSourceWidth(Math.min(420, Math.max(220, startWidth + delta))); else setMaxeWidth(Math.min(460, Math.max(280, startWidth - delta))); }; const stop = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', stop); document.body.classList.remove('ws-is-resizing'); }; window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', stop, { once: true }); document.body.classList.add('ws-is-resizing'); };
  const adjustWidth = (panel: 'sources' | 'maxe', direction: number) => { if (panel === 'sources') setSourceWidth(value => Math.min(420, Math.max(220, value + direction * 16))); else setMaxeWidth(value => Math.min(460, Math.max(280, value - direction * 16))); };
  const gridStyle = { '--ws-source-width': sourcesCollapsed ? '52px' : `${sourceWidth}px`, '--ws-maxe-width': maxeCollapsed ? '52px' : `${maxeWidth}px` } as React.CSSProperties;
  return <div className="page workspace-page" id="s-workspace"><header className="workspace-heading"><div><p className="ws-eyebrow">{user?.name ? `${user.name.split(' ')[0]}'s` : 'Your'} learning space</p><h1>Study desk</h1><p>Keep your sources, reading and questions in one calm place.</p></div><button type="button" className="ws-heading-upload" onClick={() => go('upload')}><Upload size={16} aria-hidden="true" /> Add resource</button></header><div className="ws-mobile-tabs" role="tablist" aria-label="Workspace panels">{(['sources', 'reader', 'maxe'] as const).map(panel => <button type="button" role="tab" aria-selected={mobilePanel === panel} className={mobilePanel === panel ? 'is-active' : ''} key={panel} onClick={() => setMobilePanel(panel)}>{panel === 'sources' ? 'Sources' : panel === 'reader' ? 'Reader' : 'Maxe'}</button>)}</div>{error && <div className="ws-load-error" role="alert"><span>{error}</span><button type="button" onClick={() => void loadResources()}><RefreshCw size={14} aria-hidden="true" /> Try again</button></div>}<div className="ws-workbench" style={gridStyle}><aside className={`ws-panel ws-sources-panel${sourcesCollapsed ? ' is-collapsed' : ''}${mobilePanel === 'sources' ? ' is-mobile-active' : ''}`} aria-label="Sources"><ResourceSidebar resources={resources} activeKey={selectedKey} search={search} onSearch={setSearch} onSelect={resource => { setSelectedKey(resource.key); setMobilePanel('reader'); }} onUpload={() => go('upload')} onRefresh={() => void loadResources()} loading={loading} /><button type="button" className="ws-collapse-button" onClick={() => setSourcesCollapsed(value => !value)} aria-label={sourcesCollapsed ? 'Expand sources' : 'Collapse sources'} title={sourcesCollapsed ? 'Expand sources' : 'Collapse sources'}>{sourcesCollapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}</button></aside><button type="button" className="ws-divider" role="separator" aria-orientation="vertical" aria-label="Resize sources panel" aria-valuenow={sourcesCollapsed ? 52 : sourceWidth} aria-valuemin={220} aria-valuemax={420} onPointerDown={event => startResize('sources', event)} onKeyDown={event => { if (event.key === 'ArrowLeft') adjustWidth('sources', -1); if (event.key === 'ArrowRight') adjustWidth('sources', 1); }} /><main className={`ws-panel ws-reader-panel${mobilePanel === 'reader' ? ' is-mobile-active' : ''}`} aria-label="Reader">{activeResource ? <ResourceReader resource={activeResource} go={go} /> : <div className="ws-reader-empty"><BookOpen size={28} aria-hidden="true" /><h2>Select a source</h2><p>Choose a note or past question from the left to open its reading view.</p><button type="button" onClick={() => go('upload')}>Add your first source <Plus size={15} aria-hidden="true" /></button></div>}</main><button type="button" className="ws-divider" role="separator" aria-orientation="vertical" aria-label="Resize Maxe panel" aria-valuenow={maxeCollapsed ? 52 : maxeWidth} aria-valuemin={280} aria-valuemax={460} onPointerDown={event => startResize('maxe', event)} onKeyDown={event => { if (event.key === 'ArrowLeft') adjustWidth('maxe', -1); if (event.key === 'ArrowRight') adjustWidth('maxe', 1); }} /><aside className={`ws-panel ws-maxe-panel${maxeCollapsed ? ' is-collapsed' : ''}${mobilePanel === 'maxe' ? ' is-mobile-active' : ''}`} aria-label="Maxe assistant"><MaxePanel activeResource={activeResource} go={go} notifyUnavailable={notifyUnavailable} messages={messages} onMessagesChange={onMessagesChange} onNewThread={onNewThread} user={user} /><button type="button" className="ws-collapse-button" onClick={() => setMaxeCollapsed(value => !value)} aria-label={maxeCollapsed ? 'Expand Maxe' : 'Collapse Maxe'} title={maxeCollapsed ? 'Expand Maxe' : 'Collapse Maxe'}>{maxeCollapsed ? <PanelRightOpen size={16} aria-hidden="true" /> : <PanelRightClose size={16} aria-hidden="true" />}</button></aside></div></div>;
}
