import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDownToLine, BookOpen, Check, Clock3, Copy, File, FileQuestion,
  FileText, Image as ImageIcon, Link2, LoaderCircle, LockKeyhole, Music,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus,
  Presentation, RefreshCw, Search, ShieldCheck, Trash2, Users, Video, X,
} from 'lucide-react';
import type { ChatMessage, MaxeCitation, ScreenType, User } from '../types';
import { apiBlob, apiDelete, apiDownload, apiGet, apiPost, apiUrl } from '../lib/api';
import Assistant, { type MaxeResourceContext } from './Assistant';
import SaveButton from '../components/SaveButton';
import './Workspace.css';
import './WorkspaceCitation.css';

type ResourceKind = 'lecture_note' | 'past_question';
type ResourceStatus = 'ready' | 'review' | 'unavailable' | 'processing' | 'warning' | 'failed';
type TranscriptSegment = {
  id: number;
  segment_index: number;
  start_time: number;
  end_time: number;
  text: string;
  speaker?: string | null;
  confidence?: number | null;
  topic?: string | null;
};
type AudioTranscriptPayload = {
  resource_id: number;
  title: string;
  processing_status?: string;
  transcription_status?: string;
  message?: string;
  segments?: TranscriptSegment[];
};
type RawResource = {
  id: number; title?: string | null; topic?: string | null; file_name?: string | null;
  file_size?: number | null; has_file?: boolean; content_text?: string | null;
  is_owner?: boolean; course_id?: number | null; year?: number | null; semester?: string | null;
  visibility?: 'space_shared' | 'official' | 'public' | 'group' | 'private'; metadata_json?: Record<string, unknown> | null;
  created_at?: string | null;
};
type Resource = {
  key: string; id: number; kind: ResourceKind; title: string; fileName: string | null;
  fileSize: number | null; hasFile: boolean; isOwner: boolean; contentText: string; courseCode: string | null;
  courseTitle: string | null; year: number | null; semester: string | null;
  visibility: 'space_shared' | 'official' | 'public' | 'group' | 'private'; metadata: Record<string, unknown>;
  status: ResourceStatus; statusLabel: string; createdAt: string | null; isAudio: boolean;
};
type SharePolicy = 'owner' | 'space' | 'group' | 'anyone';
type ShareGroup = { id: number; name: string; is_member?: boolean; status?: string };
type ShareLink = {
  id: number; content_type: string; access_policy: SharePolicy; expires_at?: string | null;
  revoked_at?: string | null; created_at?: string | null; token?: string; url?: string; title?: string;
};
type ReaderDetail = Resource & { sections: { id: number; heading: string | null; body: string; page_from?: number | null; page_to?: number | null }[] };
type WorkspaceProps = {
  go: (screen: ScreenType) => void;
  notifyUnavailable: (feature: string) => void;
  messages: ChatMessage[];
  onMessagesChange: (updater: (current: ChatMessage[]) => ChatMessage[]) => void;
  onNewThread: () => void;
  user: User | null;
  initialResource?: { kind: 'lecture_note' | 'past_question'; id: number } | null;
};
type CitationTarget = { resourceId: number; resourceType: string; startTime?: number; pageFrom?: number; slideFrom?: number } | null;

function metadataValue(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function extensionOf(fileName: string | null): string { return fileName?.split('.').pop()?.toLowerCase() || ''; }
function typeLabel(resource: Pick<Resource, 'fileName' | 'kind' | 'metadata'>): string {
  if (metadataValue(resource.metadata, 'document_type') === 'audio') return 'Audio recording';
  const extension = extensionOf(resource.fileName);
  if (['ppt', 'pptx'].includes(extension)) return 'PowerPoint';
  if (['doc', 'docx'].includes(extension)) return 'Word document';
  if (extension === 'pdf') return 'PDF';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) return 'Image';
  if (['mp3', 'wav', 'm4a', 'ogg', 'flac', 'webm'].includes(extension)) return 'Audio';
  if (['mp4', 'webm', 'mov'].includes(extension)) return 'Video';
  return resource.kind === 'past_question' ? 'Past question' : metadataValue(resource.metadata, 'document_type') || 'Study note';
}
function statusFor(raw: RawResource): Pick<Resource, 'status' | 'statusLabel'> {
  const metadata = raw.metadata_json || {};
  const processingStatus = metadataValue(metadata, 'processing_status');
  const transcriptionStatus = metadataValue(metadata, 'transcription_status');
  if (processingStatus === 'processing' || processingStatus === 'awaiting_confirmation' || transcriptionStatus === 'processing') return { status: 'processing', statusLabel: 'Processing audio' };
  if (processingStatus === 'failed' || transcriptionStatus === 'failed') return { status: 'failed', statusLabel: 'Transcript unavailable' };
  if (processingStatus === 'warning') return { status: 'warning', statusLabel: 'Ready with warning' };
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
    fileSize: raw.file_size || null, hasFile: Boolean(raw.has_file || raw.file_size), isOwner: Boolean(raw.is_owner), contentText: raw.content_text || '',
    courseCode: metadataValue(metadata, 'course_code'), courseTitle: metadataValue(metadata, 'course_title'),
    year: raw.year || null, semester: raw.semester || null, visibility: raw.visibility || 'private', metadata,
    status: status.status, statusLabel: status.statusLabel, createdAt: raw.created_at || null,
    isAudio: metadataValue(metadata, 'document_type') === 'audio' || ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'webm'].includes(extensionOf(raw.file_name || null)),
  };
}
function iconFor(resource: Resource) {
  const extension = extensionOf(resource.fileName);
  if (resource.kind === 'past_question') return FileQuestion;
  if (['ppt', 'pptx'].includes(extension)) return Presentation;
  if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) return ImageIcon;
  if (['mp3', 'wav', 'm4a', 'ogg', 'flac', 'webm'].includes(extension)) return Music;
  if (['mp4', 'webm', 'mov'].includes(extension)) return Video;
  if (extension === 'pdf') return FileText;
  return File;
}
function visibilityLabel(visibility: Resource['visibility']): string {
  if (visibility === 'official') return 'Official resource';
  if (visibility === 'space_shared') return 'Learning space';
  return visibility === 'public' ? 'Academy archive' : visibility === 'group' ? 'Study group' : 'Only me';
}
function splitParagraphs(value: string): string[] { return value.split(/\n\s*\n|\n/).map(item => item.trim()).filter(Boolean); }
function resourceDownloadPath(resource: Resource): string { return resource.isAudio ? `/materials/audio/${resource.id}/download` : resource.kind === 'lecture_note' ? `/materials/lecture-notes/${resource.id}/download` : `/materials/past-questions/${resource.id}/download`; }

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

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
      {!loading && filtered.length === 0 && <div className="ws-empty-small"><BookOpen size={22} aria-hidden="true" /><strong>{resources.length ? 'No source matches' : 'Your workspace is empty'}</strong><span>{resources.length ? 'Try a different title, course or file type.' : 'Add a note, slide deck, recording or past question to begin.'}</span></div>}
      {filtered.map(resource => { const Icon = iconFor(resource); return <button type="button" className={`ws-source-row${activeKey === resource.key ? ' is-active' : ''}`} key={resource.key} onClick={() => onSelect(resource)}>
        <span className={`ws-source-icon is-${resource.status}`}><Icon size={17} strokeWidth={1.7} aria-hidden="true" /></span><span className="ws-source-copy"><strong>{resource.title}</strong><small>{[resource.courseCode, typeLabel(resource)].filter(Boolean).join(' · ')}</small><span className={`ws-status ws-status-${resource.status}`}><i aria-hidden="true" />{resource.statusLabel}</span></span><span className={`ws-visibility ws-visibility-${resource.visibility}`}>{visibilityLabel(resource.visibility)}</span>
      </button>; })}
    </div>
  </div>;
}

function AudioTranscriptReader({ resource, sourceUrl, seekTo }: { resource: Resource; sourceUrl: string | null; seekTo?: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const autoScrolling = useRef(false);
  const [payload, setPayload] = useState<AudioTranscriptPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [following, setFollowing] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiGet(`/materials/audio/${resource.id}/transcript`).then(value => {
      if (!cancelled) setPayload(value as AudioTranscriptPayload);
    }).catch(failure => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : 'The transcript could not be opened.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [resource.id]);

  const segments = useMemo(() => payload?.segments || [], [payload?.segments]);
  const filteredSegments = useMemo(() => {
    const value = query.trim().toLowerCase();
    return value ? segments.filter(segment => segment.text.toLowerCase().includes(value) || segment.topic?.toLowerCase().includes(value)) : segments;
  }, [query, segments]);
  const activeSegment = segments.find(segment => currentTime >= segment.start_time && currentTime <= segment.end_time) || null;

  useEffect(() => {
    if (!following || !activeSegment) return;
    const target = segmentRefs.current[activeSegment.id];
    if (!target) return;
    autoScrolling.current = true;
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const timer = window.setTimeout(() => { autoScrolling.current = false; }, 450);
    return () => window.clearTimeout(timer);
  }, [activeSegment, following]);

  const seek = (seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    setCurrentTime(seconds);
    void audioRef.current.play().catch(() => undefined);
  };

  useEffect(() => {
    if (seekTo == null || !audioRef.current) return;
    audioRef.current.currentTime = seekTo;
  }, [seekTo]);

  return <section className="ws-audio-reader" aria-labelledby="audio-transcript-heading">
    <div className="ws-audio-player-shell">
      <audio ref={audioRef} className="ws-audio-player" controls preload="metadata" src={sourceUrl || undefined} onLoadedMetadata={event => setDuration(event.currentTarget.duration)} onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)} aria-label={`Play ${resource.title}`} />
      <div className="ws-audio-player-meta"><span>{formatTimestamp(currentTime)}{duration && Number.isFinite(duration) ? ` / ${formatTimestamp(duration)}` : ''}</span><span className={`ws-status ws-status-${resource.status}`}><i aria-hidden="true" />{resource.statusLabel}</span></div>
    </div>
    <div className="ws-transcript-heading"><div><p className="ws-eyebrow">Timestamped source</p><h2 id="audio-transcript-heading">Transcript</h2></div>{!following && <button type="button" className="ws-follow-button" onClick={() => setFollowing(true)}>Resume following</button>}</div>
    <label className="ws-transcript-search"><Search size={14} aria-hidden="true" /><span className="sr-only">Search transcript</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search transcript" /></label>
    {loading && <div className="ws-audio-state"><LoaderCircle size={17} className="ws-spin" aria-hidden="true" /> Loading transcript...</div>}
    {!loading && error && <div className="ws-audio-state is-error" role="alert">{error}</div>}
    {!loading && !error && segments.length === 0 && <div className="ws-audio-state"><strong>{payload?.transcription_status === 'failed' ? 'Transcript unavailable' : 'Transcript is still processing'}</strong><span>{payload?.message || 'ExamMind will show timestamped text here when processing finishes.'}</span></div>}
    {!loading && !error && segments.length > 0 && filteredSegments.length === 0 && <div className="ws-audio-state"><strong>No transcript matches</strong><span>Try another word or clear the search.</span></div>}
    {!loading && !error && filteredSegments.length > 0 && <div className="ws-transcript-list" ref={transcriptScrollRef} onScroll={() => { if (!autoScrolling.current) setFollowing(false); }} aria-label="Transcript segments">
      {filteredSegments.map(segment => <button
        type="button"
        key={segment.id}
        ref={node => { segmentRefs.current[segment.id] = node; }}
        className={`ws-transcript-segment${activeSegment?.id === segment.id ? ' is-active' : ''}`}
        aria-current={activeSegment?.id === segment.id ? 'true' : undefined}
        onClick={() => seek(segment.start_time)}
      >
        <span className="ws-transcript-time">{formatTimestamp(segment.start_time)}</span>
        <span className="ws-transcript-copy">{segment.speaker && <small>{segment.speaker}</small>}<span>{segment.text}</span>{segment.topic && <small className="ws-transcript-topic">{segment.topic}</small>}</span>
      </button>)}
    </div>}
  </section>;
}

function sharePolicyLabel(policy: SharePolicy): string {
  if (policy === 'space') return 'Learning space';
  if (policy === 'group') return 'Study group';
  if (policy === 'anyone') return 'Anyone with the link';
  return 'Only me';
}

function shareLinkStatus(link: ShareLink): { label: string; className: string; active: boolean } {
  if (link.revoked_at) return { label: 'Revoked', className: 'is-revoked', active: false };
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) return { label: 'Expired', className: 'is-expired', active: false };
  return { label: 'Active', className: 'is-active', active: true };
}

function shareDate(value?: string | null): string {
  if (!value) return 'No expiry';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Expiry unavailable';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function ShareLinksPanel({ resource, onClose }: { resource: Resource; onClose: () => void }) {
  const initialPolicy: SharePolicy = resource.visibility === 'official'
    ? 'anyone'
    : resource.visibility === 'space_shared'
      ? 'space'
      : 'owner';
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [groups, setGroups] = useState<ShareGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [policy, setPolicy] = useState<SharePolicy>(initialPolicy);
  const [groupId, setGroupId] = useState<number | ''>('');
  const [expiresInHours, setExpiresInHours] = useState<number | null>(72);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [copyingId, setCopyingId] = useState<number | null>(null);
  const [latest, setLatest] = useState<ShareLink | null>(null);
  const creatingRef = useRef(false);

  const loadLinks = useCallback(async () => {
    setLoading(true);
    setError('');
    const [linksResult, groupsResult] = await Promise.allSettled([
      apiGet('/collaboration/share-links'),
      apiGet('/study-groups'),
    ]);
    if (linksResult.status === 'fulfilled') {
      setLinks(Array.isArray(linksResult.value) ? linksResult.value as ShareLink[] : []);
    } else {
      setError(linksResult.reason instanceof Error ? linksResult.reason.message : 'Your share links could not be loaded.');
    }
    if (groupsResult.status === 'fulfilled') {
      const available = Array.isArray(groupsResult.value) ? groupsResult.value as ShareGroup[] : [];
      setGroups(available.filter(group => group.is_member !== false && group.status !== 'inactive'));
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadLinks(); }, [loadLinks, resource.id]);

  const displayedLinks = useMemo(() => {
    const withLatest = latest && !links.some(link => link.id === latest.id) ? [latest, ...links] : links;
    return withLatest.map(link => link.id === latest?.id ? { ...latest, ...link } : link);
  }, [latest, links]);

  const copyLink = async (link: ShareLink) => {
    const status = shareLinkStatus(link);
    if (!link.url || !status.active) {
      setActionError('This link is no longer active. Create a new link to share this source.');
      return;
    }
    setCopyingId(link.id);
    setActionError('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(link.url);
      setNotice('Share link copied.');
    } catch {
      setActionError('Clipboard access is unavailable. Select the link below and copy it manually.');
    } finally {
      setCopyingId(null);
    }
  };

  const createLink = async (event: FormEvent) => {
    event.preventDefault();
    if (creating || creatingRef.current) return;
    if (policy === 'group' && !groupId) {
      setActionError('Choose a study group before creating the link.');
      return;
    }
    creatingRef.current = true;
    setCreating(true);
    setActionError('');
    setNotice('');
    try {
      const result = await apiPost('/collaboration/share-links', {
        content_type: 'resource',
        material_type: resource.kind,
        material_id: resource.id,
        access_policy: policy,
        group_id: policy === 'group' ? groupId : null,
        expires_in_hours: expiresInHours,
      }) as { id?: number; token?: string; expires_at?: string | null; access_policy?: SharePolicy; content_type?: string };
      const token = typeof result.token === 'string' ? result.token : '';
      const created: ShareLink = {
        id: Number(result.id || Date.now()),
        content_type: result.content_type || 'resource',
        access_policy: result.access_policy || policy,
        expires_at: result.expires_at,
        title: resource.title,
        token,
        url: token ? apiUrl(`/collaboration/share/${encodeURIComponent(token)}`) : undefined,
      };
      setLatest(created);
      setNotice('Share link created. Copy it now—the token is only returned once.');
      await loadLinks();
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : 'The share link could not be created.');
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const revokeLink = async (link: ShareLink) => {
    if (revokingId !== null) return;
    setRevokingId(link.id);
    setActionError('');
    setNotice('');
    try {
      await apiDelete(`/collaboration/share-links/${link.id}`);
      setNotice('Share link revoked.');
      await loadLinks();
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : 'The share link could not be revoked.');
    } finally {
      setRevokingId(null);
    }
  };

  const canShareWithSpace = resource.visibility === 'space_shared' || resource.visibility === 'official';
  const canShareWithAnyone = resource.visibility === 'official';
  const canShareWithGroup = groups.length > 0;

  return <section className="ws-share-panel" aria-labelledby="ws-share-title">
    <header className="ws-share-header">
      <div><h2 id="ws-share-title">Share this source</h2><p>Links keep ExamMind access checks in place. Private source content is never placed in the link itself.</p></div>
      <button type="button" className="ws-icon-button" onClick={onClose} aria-label="Close sharing" title="Close sharing"><X size={16} aria-hidden="true" /></button>
    </header>
    <form className="ws-share-form" onSubmit={event => void createLink(event)}>
      <fieldset disabled={creating}>
        <legend>Who should be able to open it?</legend>
        <label className={`ws-share-policy${policy === 'owner' ? ' is-selected' : ''}`}>
          <input type="radio" name={`share-policy-${resource.id}`} checked={policy === 'owner'} onChange={() => setPolicy('owner')} />
          <LockKeyhole size={16} aria-hidden="true" /><span><strong>Only me</strong><small>Keep this link private to your ExamMind account.</small></span>
        </label>
        {canShareWithSpace && <label className={`ws-share-policy${policy === 'space' ? ' is-selected' : ''}`}>
          <input type="radio" name={`share-policy-${resource.id}`} checked={policy === 'space'} onChange={() => setPolicy('space')} />
          <ShieldCheck size={16} aria-hidden="true" /><span><strong>Learning space</strong><small>Let members of this approved learning space open it.</small></span>
        </label>}
        {canShareWithGroup && <label className={`ws-share-policy${policy === 'group' ? ' is-selected' : ''}`}>
          <input type="radio" name={`share-policy-${resource.id}`} checked={policy === 'group'} onChange={() => setPolicy('group')} />
          <Users size={16} aria-hidden="true" /><span><strong>Study group</strong><small>Limit access to a group you belong to.</small></span>
        </label>}
        {canShareWithAnyone && <label className={`ws-share-policy${policy === 'anyone' ? ' is-selected' : ''}`}>
          <input type="radio" name={`share-policy-${resource.id}`} checked={policy === 'anyone'} onChange={() => setPolicy('anyone')} />
          <Link2 size={16} aria-hidden="true" /><span><strong>Anyone with the link</strong><small>Available only for official resources.</small></span>
        </label>}
      </fieldset>
      {policy === 'group' && <label className="ws-share-field"><span>Study group</span><select value={groupId} onChange={event => setGroupId(event.target.value ? Number(event.target.value) : '')} disabled={creating}><option value="">Choose a group</option>{groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>}
      <label className="ws-share-field"><span>Link expires</span><select value={expiresInHours === null ? 'none' : String(expiresInHours)} onChange={event => setExpiresInHours(event.target.value === 'none' ? null : Number(event.target.value))} disabled={creating}><option value="72">In 3 days</option><option value="168">In 7 days</option><option value="720">In 30 days</option><option value="none">No expiry</option></select></label>
      {actionError && <div className="ws-share-alert is-error" role="alert">{actionError}</div>}
      {notice && <div className="ws-share-alert is-success" role="status"><Check size={14} aria-hidden="true" />{notice}</div>}
      <button type="submit" className="ws-share-create" disabled={creating || (policy === 'group' && !groupId)}><Link2 size={15} aria-hidden="true" />{creating ? 'Creating link...' : 'Create share link'}</button>
    </form>
    {latest?.url && <div className="ws-share-latest"><div><strong>New link ready</strong><small>Copy it now. The token will not be shown again by the server.</small></div><div className="ws-share-copy-row"><input readOnly value={latest.url} aria-label="New share link" onFocus={event => event.currentTarget.select()} /><button type="button" onClick={() => void copyLink(latest)} disabled={!shareLinkStatus(latest).active || copyingId === latest.id} aria-label="Copy new share link" title="Copy new share link"><Copy size={15} aria-hidden="true" />{copyingId === latest.id ? 'Copying...' : 'Copy'}</button></div></div>}
    <div className="ws-share-list" aria-live="polite"><div className="ws-share-list-heading"><div><h3>Your share links</h3><p>Links created by your account for accessible content.</p></div><button type="button" className="ws-icon-button" onClick={() => void loadLinks()} disabled={loading} aria-label="Refresh share links" title="Refresh share links"><RefreshCw size={15} className={loading ? 'ws-spin' : ''} aria-hidden="true" /></button></div>
      {loading && <div className="ws-share-state"><LoaderCircle size={16} className="ws-spin" aria-hidden="true" /> Loading your links...</div>}
      {!loading && error && <div className="ws-share-state is-error" role="alert"><span>{error}</span><button type="button" onClick={() => void loadLinks()}>Try again</button></div>}
      {!loading && !error && displayedLinks.length === 0 && <div className="ws-share-state"><Clock3 size={18} aria-hidden="true" /><strong>No share links yet</strong><span>Create one above when you are ready to share this source.</span></div>}
      {!loading && !error && displayedLinks.length > 0 && <ul className="ws-share-link-list">{displayedLinks.map(link => { const status = shareLinkStatus(link); return <li className="ws-share-link" key={link.id}><div className="ws-share-link-top"><div><strong>{link.title || 'Resource share link'}</strong><small>{sharePolicyLabel(link.access_policy)} · Created {shareDate(link.created_at)}</small></div><span className={`ws-share-status ${status.className}`}><i aria-hidden="true" />{status.label}</span></div><div className="ws-share-link-meta"><span>{link.expires_at ? `Expires ${shareDate(link.expires_at)}` : 'No expiry'}</span>{link.url && status.active && <button type="button" className="ws-share-inline-action" onClick={() => void copyLink(link)} disabled={copyingId === link.id}><Copy size={13} aria-hidden="true" />{copyingId === link.id ? 'Copying...' : 'Copy'}</button>}{status.active && <button type="button" className="ws-share-inline-action is-danger" onClick={() => void revokeLink(link)} disabled={revokingId === link.id}>{revokingId === link.id ? 'Revoking...' : <><Trash2 size={13} aria-hidden="true" /> Revoke</>}</button>}</div></li>; })}</ul>}
    </div>
  </section>;
}

function ResourceReader({ resource, go, onSelection, citationTarget, user }: { resource: Resource; go: (screen: ScreenType) => void; onSelection: (text: string, source: string) => void; citationTarget: CitationTarget; user: User | null }) {
  const [detail, setDetail] = useState<ReaderDetail | null>(resource.kind === 'past_question' ? { ...resource, sections: [] } : null);
  const [loading, setLoading] = useState(resource.kind === 'lecture_note' && !resource.isAudio);
  const [error, setError] = useState(''); const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false); const [downloadError, setDownloadError] = useState(''); const [previewError, setPreviewError] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const canManageSharing = Boolean(user && resource.isOwner);
  useEffect(() => {
    let cancelled = false; setError(''); setPreviewError(false); setSourceUrl(null);
    if (resource.kind === 'past_question' || resource.isAudio) { setDetail({ ...resource, sections: [] }); setLoading(false); return () => { cancelled = true; }; }
    setLoading(true); apiGet(`/materials/lecture-notes/${resource.id}`).then(payload => {
      if (cancelled) return; const data = payload as RawResource & { sections?: ReaderDetail['sections'] };
      setDetail({ ...resource, ...normalizeResource(data, 'lecture_note'), sections: data.sections || [] });
    }).catch(() => { if (!cancelled) setError('That source could not be opened. It may have been removed or the connection dropped.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [resource]);
  const extension = extensionOf(resource.fileName);
  const canNativePreview = resource.hasFile && (resource.isAudio || ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'mov'].includes(extension));
  useEffect(() => {
    let cancelled = false; if (!canNativePreview) return () => { cancelled = true; };
    apiBlob(resourceDownloadPath(resource)).then(blob => { if (!cancelled) setSourceUrl(URL.createObjectURL(blob)); }).catch(() => { if (!cancelled) setPreviewError(true); });
    return () => { cancelled = true; setSourceUrl(current => { if (current) URL.revokeObjectURL(current); return null; }); };
  }, [canNativePreview, resource]);
  useEffect(() => { setShareOpen(false); }, [resource.key]);
  const download = async () => { setDownloading(true); setDownloadError(''); try { await apiDownload(resourceDownloadPath(resource), resource.fileName || `${resource.title}.${extension || 'pdf'}`); } catch (failure) { setDownloadError(failure instanceof Error ? failure.message : 'That file could not be downloaded.'); } finally { setDownloading(false); } };
  const exportSource = (format: 'md' | 'txt') => apiDownload(
    `/collaboration/materials/${resource.kind}/${resource.id}/export?format=${format}`,
    `resource-${resource.id}.${format}`,
  );
  const body = detail?.contentText || resource.contentText;
  const selectedCitationPage = citationTarget?.resourceId === resource.id ? citationTarget.pageFrom : undefined;
  const selectedCitationSlide = citationTarget?.resourceId === resource.id ? citationTarget.slideFrom : undefined;
  const citationTargetLabel = selectedCitationPage ? `Opened at Page ${selectedCitationPage}` : selectedCitationSlide ? `Opened at Slide ${selectedCitationSlide}` : '';
  return <div className="ws-reader-content" onMouseUp={() => {
    const text = window.getSelection()?.toString().trim() || '';
    if (text.length > 1) onSelection(text.slice(0, 4000), resource.title);
  }}>
    {citationTargetLabel && <p className="ws-citation-target" role="status">{citationTargetLabel}</p>}
    {canManageSharing && <div className="ws-share-strip"><button type="button" className="ws-share-button" onClick={() => setShareOpen(value => !value)} aria-expanded={shareOpen} aria-controls="ws-share-title"><Link2 size={15} aria-hidden="true" />{shareOpen ? 'Close sharing' : 'Share this source'}</button></div>}
    {shareOpen && <ShareLinksPanel key={resource.key} resource={resource} onClose={() => setShareOpen(false)} />}
    <header className="ws-reader-header"><div className="ws-reader-kicker"><span>{resource.courseCode || 'Archive'}</span><span>{typeLabel(resource)}</span><span className={`ws-status ws-status-${resource.status}`}><i aria-hidden="true" />{resource.statusLabel}</span></div><h1>{resource.title}</h1><p>{[resource.courseTitle, resource.year && String(resource.year), resource.semester, visibilityLabel(resource.visibility)].filter(Boolean).join(' · ')}</p><div className="ws-reader-actions">{resource.hasFile && <button type="button" className="ws-download-button" onClick={() => void download()} disabled={downloading}><ArrowDownToLine size={15} aria-hidden="true" />{downloading ? 'Preparing...' : 'Download original'}</button>}<SaveButton compact triggerLabel="Export" menuLabel="Export" hideSaveActions target={{ itemType: resource.kind, refId: resource.id, title: resource.title, meta: typeLabel(resource), exports: [{ label: 'Export Markdown', description: 'Download the authorized reading as Markdown', run: () => exportSource('md') }, { label: 'Export plain text', description: 'Download the authorized reading as text', run: () => exportSource('txt') }] }} /><button type="button" className="ws-text-action" onClick={() => go('upload')}>Add another source <Plus size={15} aria-hidden="true" /></button></div>{downloadError && <p className="ws-reader-error" role="alert">{downloadError}</p>}</header>
    {loading && <div className="ws-reader-state"><LoaderCircle size={19} className="ws-spin" aria-hidden="true" /> Opening source...</div>}{error && <div className="ws-reader-state is-error" role="alert">{error}</div>}
    {!loading && !error && <>{resource.isAudio ? <AudioTranscriptReader key={resource.id} resource={resource} sourceUrl={sourceUrl} seekTo={citationTarget?.resourceId === resource.id ? citationTarget.startTime : undefined} /> : <>{canNativePreview && sourceUrl && extension === 'pdf' && <iframe className="ws-native-preview" title={`Preview of ${resource.title}`} src={`${sourceUrl}${selectedCitationPage ? `#page=${selectedCitationPage}` : ''}`} />}{canNativePreview && sourceUrl && ['png', 'jpg', 'jpeg', 'webp'].includes(extension) && <img className="ws-image-preview" src={sourceUrl} alt={`Preview of ${resource.title}`} />}{canNativePreview && sourceUrl && ['mp4', 'webm', 'mov'].includes(extension) && <video className="ws-media-preview" controls src={sourceUrl} />}{resource.hasFile && !canNativePreview && <div className="ws-format-note"><FileText size={18} aria-hidden="true" /><span><strong>{typeLabel(resource)} source</strong><small>ExamMind is showing the extracted reading text here. Download the original when you need the source file.</small></span></div>}{previewError && <p className="ws-muted">The original preview is unavailable, but the extracted text is still available below.</p>}{detail?.sections?.length ? detail.sections.map(section => <section className="ws-reading-section" key={section.id}><div className="ws-section-label">{section.heading || 'Section'}{section.page_from ? <span>Pages {section.page_from}{section.page_to && section.page_to !== section.page_from ? `–${section.page_to}` : ''}</span> : null}</div>{splitParagraphs(section.body).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>) : body ? <section className="ws-reading-section"><div className="ws-section-label">Extracted text</div>{splitParagraphs(body).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section> : <div className="ws-reader-state">No readable text was kept for this source.</div>}</>}</>}
  </div>;
}

function MaxePanel({ activeResource, selectedText, go, notifyUnavailable, messages, onMessagesChange, onNewThread, onCitationClick, user }: { activeResource: Resource | null; selectedText: string; go: (screen: ScreenType) => void; notifyUnavailable: (feature: string) => void; messages: ChatMessage[]; onMessagesChange: (updater: (current: ChatMessage[]) => ChatMessage[]) => void; onNewThread: () => void; onCitationClick: (citation: MaxeCitation) => void; user: User | null }) {
  const maxeResource: MaxeResourceContext | null = activeResource ? { id: activeResource.id, kind: activeResource.kind, title: activeResource.title, courseCode: activeResource.courseCode, isAudio: activeResource.isAudio } : null;
  return <div className="ws-maxe-content"><header className="ws-maxe-header"><div className="ws-maxe-brand"><span className="ws-maxe-mark">M</span><div><strong>Maxe</strong><small>Study beside your source</small></div></div><button type="button" className="ws-text-action" onClick={onNewThread}>New thread</button></header><div className="ws-maxe-context" aria-live="polite"><span className="ws-eyebrow">Active source</span><strong>{activeResource?.title || 'No source selected'}</strong><small>{activeResource ? `${typeLabel(activeResource)} · ${activeResource.courseCode || 'Archive'}` : 'Choose a source so the context stays visible while you study.'}</small>{selectedText && <small className="ws-selection-note">Selected text is ready for Maxe</small>}</div><div className="ws-maxe-assistant"><Assistant go={go} selectedQuestion="" notifyUnavailable={notifyUnavailable} messages={messages} onMessagesChange={onMessagesChange} user={user} activeResource={maxeResource} selectedText={selectedText} selectedTextSource={selectedText ? activeResource?.title : null} onCitationClick={onCitationClick} /></div></div>;
}

export default function Workspace({ go, notifyUnavailable, messages, onMessagesChange, onNewThread, user, initialResource }: WorkspaceProps) {
  const [resources, setResources] = useState<Resource[]>([]); const [selectedKey, setSelectedKey] = useState<string | null>(null); const [selectedText, setSelectedText] = useState(''); const [citationTarget, setCitationTarget] = useState<CitationTarget>(null); const [search, setSearch] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [sourceWidth, setSourceWidth] = useState(() => Number(localStorage.getItem('exammind-workspace-source-width')) || 288); const [maxeWidth, setMaxeWidth] = useState(() => Number(localStorage.getItem('exammind-workspace-maxe-width')) || 344); const [sourcesCollapsed, setSourcesCollapsed] = useState(false); const [maxeCollapsed, setMaxeCollapsed] = useState(false); const [mobilePanel, setMobilePanel] = useState<'sources' | 'reader' | 'maxe'>('sources');
  const loadResources = async () => { setLoading(true); setError(''); try { const [notesPayload, questionsPayload] = await Promise.all([apiGet('/lecture-notes'), apiGet('/past-questions')]); const notes = (notesPayload as RawResource[]).map(item => normalizeResource(item, 'lecture_note')); const questionMap = new Map<string, Resource>(); (questionsPayload as RawResource[]).forEach(item => { const resource = normalizeResource(item, 'past_question'); const current = questionMap.get(resource.key); if (!current || resource.fileSize || resource.contentText.length > current.contentText.length) questionMap.set(resource.key, resource); }); const next = [...notes, ...questionMap.values()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || a.title.localeCompare(b.title)); setResources(next); setSelectedKey(current => current && next.some(item => item.key === current) ? current : next[0]?.key || null); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Sources could not be loaded.'); } finally { setLoading(false); } };
  useEffect(() => { void loadResources(); }, []); useEffect(() => { localStorage.setItem('exammind-workspace-source-width', String(sourceWidth)); }, [sourceWidth]); useEffect(() => { localStorage.setItem('exammind-workspace-maxe-width', String(maxeWidth)); }, [maxeWidth]);
  const activeResource = resources.find(resource => resource.key === selectedKey) || null;
  useEffect(() => {
    if (!initialResource || loading) return;
    const resource = resources.find(item => item.kind === initialResource.kind && item.id === initialResource.id);
    if (!resource) { setError('That source is unavailable in this learning space.'); return; }
    setSelectedKey(resource.key);
    setSelectedText('');
    setCitationTarget(null);
    setMobilePanel('reader');
  }, [initialResource, loading, resources]);
  const handleCitationClick = (citation: MaxeCitation) => {
    const target = citation.target || {};
    const resourceId = Number(target.resource_id || citation.resource_id || citation.material_id || 0);
    if (!resourceId) return;
    const resource = resources.find(item => item.id === resourceId && (target.resource_type ? (target.resource_type === 'audio' ? item.isAudio : item.kind === target.resource_type) : true));
    if (!resource) return;
    setSelectedKey(resource.key);
    setSelectedText('');
    setCitationTarget({ resourceId, resourceType: target.resource_type || citation.resource_type || resource.kind, startTime: target.start_time ?? citation.timestamp_start ?? undefined, pageFrom: target.page_from ?? citation.page_from ?? undefined, slideFrom: target.slide_from ?? citation.slide_from ?? undefined });
    setMobilePanel('reader');
  };
  const startResize = (panel: 'sources' | 'maxe', event: React.PointerEvent<HTMLButtonElement>) => { event.preventDefault(); const startX = event.clientX; const startWidth = panel === 'sources' ? sourceWidth : maxeWidth; const onMove = (moveEvent: PointerEvent) => { const delta = moveEvent.clientX - startX; if (panel === 'sources') setSourceWidth(Math.min(420, Math.max(220, startWidth + delta))); else setMaxeWidth(Math.min(460, Math.max(280, startWidth - delta))); }; const stop = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', stop); document.body.classList.remove('ws-is-resizing'); }; window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', stop, { once: true }); document.body.classList.add('ws-is-resizing'); };
  const adjustWidth = (panel: 'sources' | 'maxe', direction: number) => { if (panel === 'sources') setSourceWidth(value => Math.min(420, Math.max(220, value + direction * 16))); else setMaxeWidth(value => Math.min(460, Math.max(280, value - direction * 16))); };
  const gridStyle = { '--ws-source-width': sourcesCollapsed ? '52px' : `${sourceWidth}px`, '--ws-maxe-width': maxeCollapsed ? '52px' : `${maxeWidth}px` } as React.CSSProperties;
  return <div className="page workspace-page" id="s-workspace"><header className="workspace-heading"><div><p className="ws-eyebrow">{user?.name ? `${user.name.split(' ')[0]}'s` : 'Your'} learning space</p><h1>Study desk</h1><p>Keep your sources, reading and questions in one calm place.</p></div><button type="button" className="ws-heading-upload" onClick={() => go('offline')}><BookOpen size={16} aria-hidden="true" /> Saved library</button></header><div className="ws-mobile-tabs" role="tablist" aria-label="Workspace panels">{(['sources', 'reader', 'maxe'] as const).map(panel => <button type="button" role="tab" aria-selected={mobilePanel === panel} className={mobilePanel === panel ? 'is-active' : ''} key={panel} onClick={() => setMobilePanel(panel)}>{panel === 'sources' ? 'Sources' : panel === 'reader' ? 'Reader' : 'Maxe'}</button>)}</div>{error && <div className="ws-load-error" role="alert"><span>{error}</span><button type="button" onClick={() => void loadResources()}><RefreshCw size={14} aria-hidden="true" /> Try again</button></div>}<div className="ws-workbench" style={gridStyle}><aside className={`ws-panel ws-sources-panel${sourcesCollapsed ? ' is-collapsed' : ''}${mobilePanel === 'sources' ? ' is-mobile-active' : ''}`} aria-label="Sources"><ResourceSidebar resources={resources} activeKey={selectedKey} search={search} onSearch={setSearch} onSelect={resource => { setSelectedKey(resource.key); setSelectedText(''); setCitationTarget(null); setMobilePanel('reader'); }} onUpload={() => go('upload')} onRefresh={() => void loadResources()} loading={loading} /><button type="button" className="ws-collapse-button" onClick={() => setSourcesCollapsed(value => !value)} aria-label={sourcesCollapsed ? 'Expand sources' : 'Collapse sources'} title={sourcesCollapsed ? 'Expand sources' : 'Collapse sources'}>{sourcesCollapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}</button></aside><button type="button" className="ws-divider" role="separator" aria-orientation="vertical" aria-label="Resize sources panel" aria-valuenow={sourcesCollapsed ? 52 : sourceWidth} aria-valuemin={220} aria-valuemax={420} onPointerDown={event => startResize('sources', event)} onKeyDown={event => { if (event.key === 'ArrowLeft') adjustWidth('sources', -1); if (event.key === 'ArrowRight') adjustWidth('sources', 1); }} /><main className={`ws-panel ws-reader-panel${mobilePanel === 'reader' ? ' is-mobile-active' : ''}`} aria-label="Reader">{activeResource ? <ResourceReader resource={activeResource} go={go} onSelection={text => { setSelectedText(text); setCitationTarget(null); }} citationTarget={citationTarget} user={user} /> : <div className="ws-reader-empty"><BookOpen size={28} aria-hidden="true" /><h2>Select a source</h2><p>Choose a note or past question from the left to open its reading view.</p><button type="button" onClick={() => go('upload')}>Add your first source <Plus size={15} aria-hidden="true" /></button></div>}</main><button type="button" className="ws-divider" role="separator" aria-orientation="vertical" aria-label="Resize Maxe panel" aria-valuenow={maxeCollapsed ? 52 : maxeWidth} aria-valuemin={280} aria-valuemax={460} onPointerDown={event => startResize('maxe', event)} onKeyDown={event => { if (event.key === 'ArrowLeft') adjustWidth('maxe', -1); if (event.key === 'ArrowRight') adjustWidth('maxe', 1); }} /><aside className={`ws-panel ws-maxe-panel${maxeCollapsed ? ' is-collapsed' : ''}${mobilePanel === 'maxe' ? ' is-mobile-active' : ''}`} aria-label="Maxe assistant"><MaxePanel activeResource={activeResource} selectedText={selectedText} go={go} notifyUnavailable={notifyUnavailable} messages={messages} onMessagesChange={onMessagesChange} onNewThread={onNewThread} onCitationClick={handleCitationClick} user={user} /><button type="button" className="ws-collapse-button" onClick={() => setMaxeCollapsed(value => !value)} aria-label={maxeCollapsed ? 'Expand Maxe' : 'Collapse Maxe'} title={maxeCollapsed ? 'Expand Maxe' : 'Collapse Maxe'}>{maxeCollapsed ? <PanelRightOpen size={16} aria-hidden="true" /> : <PanelRightClose size={16} aria-hidden="true" />}</button></aside></div></div>;
}
