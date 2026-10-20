import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ChatMessage, ScreenType } from '../types';
import type { OfflineStudyPack, PendingUpload, SavedCollection, SavedItem, PendingPracticeAttempt } from '../offline';
import { hasLegacyOfflineData, listCollections, listItems, listRecords, removeCollection, removeItem, removePendingUpload, removeStudyPack, removePracticeAttempt, saveCollection, saveItem, saveStudyPack } from '../offline';
import './Offline.css';
import './WorkspacePage.css';

type MaterialsProps = {
  go: (s: ScreenType, arg?: string | number | null) => void;
  onOpenConversation?: (messages: ChatMessage[]) => void;
  onOpenResource: (kind: 'lecture_note' | 'past_question', id: number) => void;
  onReviewUpload: (upload: PendingUpload) => void;
};

type MaterialFilter = 'all' | 'offline';
type MaterialSort = 'recent' | 'title';
type FolderView = 'all' | 'past_questions' | 'lecture_notes' | 'maxe_conversations' | 'practice_offline' | `collection:${string}`;
type OrganizeTarget = { kind: 'saved' | 'pack'; id: string; title: string; collectionIds: string[] };

const SYSTEM_FOLDERS: Array<{ id: Exclude<FolderView, 'all' | `collection:${string}`>; label: string }> = [
  { id: 'past_questions', label: 'Past questions' },
  { id: 'lecture_notes', label: 'Lecture notes' },
  { id: 'maxe_conversations', label: 'Maxe conversations' },
  { id: 'practice_offline', label: 'Practice offline questions' },
];

function savedDate(iso: string): string {
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? 'saved' : `saved ${when.toLocaleDateString()}`;
}

/** A saved conversation only replays if its snapshot really holds messages. */
function messagesOf(item: SavedItem): ChatMessage[] | null {
  const snapshot = item.snapshot;
  if (!Array.isArray(snapshot) || snapshot.length === 0) return null;
  return snapshot as ChatMessage[];
}

function cachedText(item: SavedItem): string {
  if (!item.snapshot || typeof item.snapshot !== 'object') return 'No readable text was cached for this item.';
  const snapshot = item.snapshot as Record<string, unknown>;
  const content = snapshot.content_text || snapshot.contentText;
  if (typeof content === 'string' && content.trim()) return content;
  if (Array.isArray(snapshot.segments)) {
    return snapshot.segments
      .map(segment => {
        if (!segment || typeof segment !== 'object') return '';
        const value = segment as Record<string, unknown>;
        const start = typeof value.start_time === 'number' ? `${Math.floor(value.start_time / 60)}:${String(Math.floor(value.start_time % 60)).padStart(2, '0')} ` : '';
        return `${start}${typeof value.text === 'string' ? value.text : ''}`.trim();
      })
      .filter(Boolean)
      .join('\n\n');
  }
  return 'No readable text was cached for this item.';
}

export default function Materials({ go, onOpenConversation, onOpenResource, onReviewUpload }: MaterialsProps) {
  const [saved, setSaved] = useState<SavedItem[]>([]);
  const [packs, setPacks] = useState<OfflineStudyPack[]>([]);
  const [collections, setCollections] = useState<SavedCollection[]>([]);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [legacyData, setLegacyData] = useState(false);
  const [oldAttempts, setOldAttempts] = useState<PendingPracticeAttempt[]>([]);
  const [openPack, setOpenPack] = useState<string | null>(null);
  const [cachedDocument, setCachedDocument] = useState<SavedItem | null>(null);
  const [libraryError, setLibraryError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MaterialFilter>('all');
  const [sort, setSort] = useState<MaterialSort>('recent');
  const [folderView, setFolderView] = useState<FolderView>('all');
  const [newCollectionOpen, setNewCollectionOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionKind, setNewCollectionKind] = useState<SavedCollection['kind']>('folder');
  const [organizeTarget, setOrganizeTarget] = useState<OrganizeTarget | null>(null);
  const [organizeIds, setOrganizeIds] = useState<string[]>([]);
  const [organizeBusy, setOrganizeBusy] = useState(false);

  const load = useCallback(() => {
    listItems().then(setSaved).catch(() => setSaved([]));
    listRecords<OfflineStudyPack>('studyPacks').then(setPacks).catch(() => setPacks([]));
    listCollections().then(setCollections).catch(() => setCollections([]));
    listRecords<PendingUpload>('pendingUploads').then(setUploads).catch(() => setUploads([]));
    hasLegacyOfflineData().then(setLegacyData).catch(() => undefined);
    listRecords<PendingPracticeAttempt>('practiceAttempts').then(setOldAttempts).catch(() => setOldAttempts([]));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener('exammind-offline-updated', load);
    return () => window.removeEventListener('exammind-offline-updated', load);
  }, [load]);

  const matchesQuery = useCallback((value: string) => {
    const normalizedQuery = query.trim().toLowerCase();
    return !normalizedQuery || value.toLowerCase().includes(normalizedQuery);
  }, [query]);

  const sortSaved = useCallback((items: SavedItem[]) => [...items].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    return new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime();
  }), [sort]);

  const offlineOnly = filter === 'offline';
  const selectedCollectionId = folderView.startsWith('collection:') ? folderView.slice('collection:'.length) : null;
  const isCollectionView = selectedCollectionId !== null;
  const matchesSaved = useCallback((item: SavedItem) => {
    const inCollection = selectedCollectionId ? item.collectionIds?.includes(selectedCollectionId) : true;
    return inCollection && (!offlineOnly || item.cachedOffline) && matchesQuery(`${item.title} ${item.meta}`);
  }, [matchesQuery, offlineOnly, selectedCollectionId]);
  const matchesPack = useCallback((pack: OfflineStudyPack) => {
    const inCollection = selectedCollectionId ? pack.collectionIds?.includes(selectedCollectionId) : true;
    return inCollection && matchesQuery(`${pack.title} ${pack.courseCode}`);
  }, [matchesQuery, selectedCollectionId]);
  const inFolder = useCallback((itemType: SavedItem['itemType'], folder: Exclude<FolderView, 'all' | `collection:${string}`>) => {
    if (folder === 'past_questions') return itemType === 'past_question';
    if (folder === 'lecture_notes') return itemType === 'lecture_note';
    if (folder === 'maxe_conversations') return itemType === 'maxe_conversation';
    return itemType === 'practice_result';
  }, []);
  const pastQuestions = useMemo(() => sortSaved(saved.filter((item) => (folderView === 'all' || folderView === 'past_questions') && inFolder(item.itemType, 'past_questions') && matchesSaved(item))), [folderView, inFolder, matchesSaved, saved, sortSaved]);
  const lectureNotes = useMemo(() => sortSaved(saved.filter((item) => (folderView === 'all' || folderView === 'lecture_notes') && inFolder(item.itemType, 'lecture_notes') && matchesSaved(item))), [folderView, inFolder, matchesSaved, saved, sortSaved]);
  const conversations = useMemo(() => sortSaved(saved.filter((item) => (folderView === 'all' || folderView === 'maxe_conversations') && inFolder(item.itemType, 'maxe_conversations') && matchesSaved(item))), [folderView, inFolder, matchesSaved, saved, sortSaved]);
  const results = useMemo(() => sortSaved(saved.filter((item) => (folderView === 'all' || folderView === 'practice_offline') && inFolder(item.itemType, 'practice_offline') && matchesSaved(item))), [folderView, inFolder, matchesSaved, saved, sortSaved]);
  const visiblePacks = useMemo(() => [...packs]
    .filter((pack) => (folderView === 'all' || folderView === 'practice_offline') && matchesPack(pack))
    .sort((a, b) => sort === 'title'
      ? a.title.localeCompare(b.title)
      : new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()), [folderView, matchesPack, packs, sort]);

  const selectedCollection = selectedCollectionId ? collections.find((collection) => collection.id === selectedCollectionId) : null;
  const collectionItems = useMemo(() => sortSaved(saved.filter(matchesSaved)), [matchesSaved, saved, sortSaved]);
  const collectionPacks = useMemo(() => [...packs].filter(matchesPack).sort((a, b) => sort === 'title'
    ? a.title.localeCompare(b.title)
    : new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()), [matchesPack, packs, sort]);
  const visibleUploads = useMemo(() => [...uploads]
    .filter((upload) => matchesQuery(upload.fileName))
    .sort((a, b) => sort === 'title'
      ? a.fileName.localeCompare(b.fileName)
      : new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime()), [matchesQuery, sort, uploads]);

  const forget = useCallback(async (id: string) => {
    setLibraryError('');
    try { await removeItem(id); load(); }
    catch { setLibraryError('The saved item could not be removed. Try again.'); }
  }, [load]);

  const openDocument = useCallback((item: SavedItem) => {
    if (item.cachedOffline && item.snapshot && typeof item.snapshot === 'object' && !navigator.onLine) { setCachedDocument(item); return; }
    // Keep kind and ID together: notes and past questions can have the same ID.
    const id = typeof item.refId === 'number' ? item.refId : Number(item.refId);
    if (Number.isFinite(id) && (item.itemType === 'lecture_note' || item.itemType === 'past_question')) onOpenResource(item.itemType, id);
  }, [onOpenResource]);

  const collectionCount = useCallback((collectionId: string) => (
    saved.filter((item) => item.collectionIds?.includes(collectionId)).length
    + packs.filter((pack) => pack.collectionIds?.includes(collectionId)).length
  ), [packs, saved]);

  const createCollection = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newCollectionName.trim().slice(0, 60);
    if (!name) { setLibraryError('Give your folder a name first.'); return; }
    if (collections.some((collection) => collection.name.toLowerCase() === name.toLowerCase())) {
      setLibraryError('A folder with that name already exists.');
      return;
    }
    const id = globalThis.crypto?.randomUUID?.() || `collection-${Date.now()}`;
    try {
      await saveCollection({ id, name, kind: newCollectionKind, createdAt: new Date().toISOString() });
      setCollections((current) => [...current, { id, name, kind: newCollectionKind, createdAt: new Date().toISOString() }].sort((a, b) => a.name.localeCompare(b.name)));
      setFolderView(`collection:${id}`);
      setNewCollectionName('');
      setNewCollectionOpen(false);
      setLibraryError('');
    } catch {
      setLibraryError('That folder could not be created. Try again.');
    }
  }, [collections, newCollectionKind, newCollectionName]);

  const openOrganizer = useCallback((target: OrganizeTarget) => {
    setOrganizeTarget(target);
    setOrganizeIds(target.collectionIds);
    setLibraryError('');
  }, []);

  const saveOrganization = useCallback(async () => {
    if (!organizeTarget) return;
    setOrganizeBusy(true);
    try {
      if (organizeTarget.kind === 'saved') {
        const item = saved.find((candidate) => candidate.id === organizeTarget.id);
        if (!item) throw new Error('Saved item not found.');
        await saveItem({ ...item, collectionIds: organizeIds });
      } else {
        const pack = packs.find((candidate) => candidate.id === organizeTarget.id);
        if (!pack) throw new Error('Study pack not found.');
        await saveStudyPack({ ...pack, collectionIds: organizeIds });
      }
      setOrganizeTarget(null);
      setOrganizeIds([]);
      load();
    } catch {
      setLibraryError('The folder changes could not be saved. Try again.');
    } finally {
      setOrganizeBusy(false);
    }
  }, [load, organizeIds, organizeTarget, packs, saved]);

  const deleteSelectedCollection = useCallback(async () => {
    if (!selectedCollection) return;
    try {
      await removeCollection(selectedCollection.id);
      setCollections((current) => current.filter((collection) => collection.id !== selectedCollection.id));
      setFolderView('all');
      setOrganizeTarget(null);
    } catch {
      setLibraryError('That folder could not be deleted. Try again.');
    }
  }, [selectedCollection]);

  const systemFolderCount = useCallback((folder: Exclude<FolderView, 'all' | `collection:${string}`>) => {
    if (folder === 'practice_offline') return saved.filter((item) => inFolder(item.itemType, folder)).length + packs.length;
    return saved.filter((item) => inFolder(item.itemType, folder)).length;
  }, [inFolder, packs.length, saved]);

  const folderNav = (
    <div className="materials-folder-nav" role="tablist" aria-label="Material folders">
      <button type="button" role="tab" aria-selected={folderView === 'all'} className={folderView === 'all' ? 'is-active' : ''} onClick={() => setFolderView('all')}>All materials <span>{saved.length + packs.length}</span></button>
      {SYSTEM_FOLDERS.map((folder) => (
        <button type="button" role="tab" aria-selected={folderView === folder.id} className={folderView === folder.id ? 'is-active' : ''} key={folder.id} onClick={() => setFolderView(folder.id)}>{folder.label} <span>{systemFolderCount(folder.id)}</span></button>
      ))}
      {collections.map((collection) => {
        const id = `collection:${collection.id}` as FolderView;
        return <button type="button" role="tab" aria-selected={folderView === id} className={folderView === id ? 'is-active' : ''} key={collection.id} onClick={() => setFolderView(id)}>{collection.name} <span>{collectionCount(collection.id)}</span></button>;
      })}
    </div>
  );

  const renderSavedRows = (items: SavedItem[], emptyMessage: string) => items.length === 0 ? (
    <p className="shelf-empty">{emptyMessage}</p>
  ) : (
    <ul className="shelf-list">
      {items.map((item) => {
        const messages = messagesOf(item);
        return (
          <li key={item.id}>
            <div className="shelf-item-body">
              <div className="shelf-item-title">{item.title}</div>
              <p className="shelf-item-meta">
                {item.meta}{item.meta ? ' · ' : ''}{savedDate(item.savedAt)}
                {item.cachedOffline && <span className="shelf-offline-tag">offline</span>}
              </p>
            </div>
            <div className="shelf-row-actions">
              {item.itemType === 'lecture_note' || item.itemType === 'past_question' ? (
                <button type="button" className="shelf-row-btn" onClick={() => openDocument(item)}>Open</button>
              ) : item.itemType === 'maxe_conversation' && messages && onOpenConversation ? (
                <button type="button" className="shelf-row-btn" onClick={() => onOpenConversation(messages)}>Reopen</button>
              ) : item.itemType === 'practice_result' ? (
                <button type="button" className="shelf-row-btn" onClick={() => go('progress')}>Progress</button>
              ) : (
                <span className="shelf-status is-queued">No messages kept</span>
              )}
              <button type="button" className="shelf-row-btn" onClick={() => openOrganizer({ kind: 'saved', id: item.id, title: item.title, collectionIds: item.collectionIds || [] })}>Organize</button>
              <button type="button" className="shelf-row-btn is-quiet" onClick={() => void forget(item.id)}>Remove</button>
            </div>
          </li>
        );
      })}
    </ul>
  );

  const renderPackRows = (items: OfflineStudyPack[]) => items.length === 0 ? (
    <p className="shelf-empty">No offline question packs in this folder yet. Save a pack from Past Questions to keep it available without a connection.</p>
  ) : (
    <ul className="shelf-list">
      {items.map((pack) => (
        <li key={pack.id} className="is-stacked">
          <div className="shelf-item-row">
            <div className="shelf-item-body">
              <div className="shelf-item-title">{pack.title}</div>
              <p className="shelf-item-meta">{pack.courseCode} · {pack.questions.length} questions · {savedDate(pack.savedAt)}</p>
            </div>
            <div className="shelf-row-actions">
              <button type="button" className="shelf-row-btn" aria-expanded={openPack === pack.id} onClick={() => setOpenPack((current) => current === pack.id ? null : pack.id)}>{openPack === pack.id ? 'Close' : 'Open'}</button>
              <button type="button" className="shelf-row-btn" onClick={() => openOrganizer({ kind: 'pack', id: pack.id, title: pack.title, collectionIds: pack.collectionIds || [] })}>Organize</button>
              <button type="button" className="shelf-row-btn is-quiet" onClick={() => { void removeStudyPack(pack.id).then(load).catch(() => setLibraryError('The question pack could not be removed. Try again.')); }}>Remove</button>
            </div>
          </div>
          {openPack === pack.id && (
            <ol className="shelf-pack">
              {pack.questions.map((question, position) => (
                <li key={position}>
                  <p className="shelf-pack-q">{question.text}</p>
                  <p className="shelf-pack-meta">{[question.year, question.topic, question.difficulty].filter(Boolean).join(' · ')}</p>
                </li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="page workspace-page" id="s-offline">
      <div className="pg-head">
        <div className="pg-title">My <em>materials</em></div>
        <div className="pg-sub">Your saved notes, past questions, Maxe conversations and study packs, in one place. Anything marked offline opens with no connection.</div>
      </div>

      <button type="button" className="shelf-action" onClick={() => go('workspace')}>Back to study desk</button>
      {libraryError && <p role="alert">{libraryError}</p>}
      {legacyData && <p role="status">Older offline data has no verified account owner. It remains stored on this device, but cannot be opened or synced safely. Contact support for recovery; it has not been deleted.</p>}
      {cachedDocument && <section className="shelf" aria-label="Cached document"><h2>{cachedDocument.title}</h2><p>Offline snapshot saved {savedDate(cachedDocument.savedAt)}. Reconnect to check current access and updates.</p><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{cachedText(cachedDocument)}</p><button type="button" onClick={() => setCachedDocument(null)}>Close cached document</button></section>}
      {oldAttempts.length > 0 && <section className="shelf"><h2>Older quiz records need review</h2><p>Direct scores cannot be counted as readiness evidence. Reconnect and complete a new quiz; these records will not be submitted automatically.</p>{oldAttempts.map(attempt => <div key={attempt.id}><span>{attempt.topic || 'Older practice result'}</span><button type="button" onClick={() => void removePracticeAttempt(attempt.id).then(load).catch(() => setLibraryError('The older record could not be removed. Try again.'))}>Discard older record</button></div>)}</section>}

      <section className="materials-folders" aria-labelledby="materials-folders-title">
        <div className="materials-folders-head">
          <div>
            <p className="shelf-label" id="materials-folders-title">Library folders</p>
            <p className="materials-folders-copy">Keep your saved study material together, then make smaller folders for a revision plan.</p>
          </div>
          <button type="button" className="shelf-row-btn materials-new-folder" onClick={() => setNewCollectionOpen((current) => !current)}>{newCollectionOpen ? 'Close' : 'New folder'}</button>
        </div>
        {folderNav}
        {newCollectionOpen && (
          <form className="materials-collection-form" onSubmit={(event) => void createCollection(event)}>
            <label>
              <span>Name</span>
              <input value={newCollectionName} onChange={(event) => setNewCollectionName(event.target.value)} maxLength={60} autoFocus placeholder="e.g. Week 3 revision" />
            </label>
            <label>
              <span>Type</span>
              <select value={newCollectionKind} onChange={(event) => setNewCollectionKind(event.target.value as SavedCollection['kind'])}>
                <option value="folder">Folder</option>
                <option value="playlist">Playlist</option>
              </select>
            </label>
            <button type="submit" className="shelf-row-btn is-primary">Create</button>
          </form>
        )}
      </section>

      <div className="materials-toolbar" role="search" aria-label="Material filters">
        <label className="materials-search">
          <span>Search your materials</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search saved materials" />
        </label>
        <label className="materials-control">
          <span>Show</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value as MaterialFilter)}>
            <option value="all">Everything</option>
            <option value="offline">Offline items</option>
          </select>
        </label>
        <label className="materials-control">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as MaterialSort)}>
            <option value="recent">Most recent</option>
            <option value="title">Title A–Z</option>
          </select>
        </label>
      </div>

      {organizeTarget && (
        <section className="materials-organize" aria-labelledby="materials-organize-title">
          <div>
            <p className="shelf-label">Organize saved material</p>
            <h2 className="shelf-title" id="materials-organize-title">{organizeTarget.title}</h2>
            <p className="materials-folders-copy">Choose any of your folders. The original system folder stays available too.</p>
          </div>
          {collections.length === 0 ? (
            <p className="shelf-empty">You have no custom folders yet. Create one above, then organize this item.</p>
          ) : (
            <div className="materials-checklist">
              {collections.map((collection) => (
                <label key={collection.id}>
                  <input type="checkbox" checked={organizeIds.includes(collection.id)} onChange={(event) => setOrganizeIds((current) => event.target.checked ? [...current, collection.id] : current.filter((id) => id !== collection.id))} />
                  <span>{collection.name}</span>
                  <small>{collection.kind}</small>
                </label>
              ))}
            </div>
          )}
          <div className="materials-organize-actions">
            <button type="button" className="shelf-row-btn is-quiet" onClick={() => setOrganizeTarget(null)}>Cancel</button>
            <button type="button" className="shelf-row-btn is-primary" disabled={organizeBusy || collections.length === 0} onClick={() => void saveOrganization()}>{organizeBusy ? 'Saving…' : 'Save folders'}</button>
          </div>
        </section>
      )}

      <div className="shelf-grid">
        {!isCollectionView && (folderView === 'all' || folderView === 'past_questions') && <section className="shelf" aria-labelledby="mat-past-title">
          <div className="shelf-head">
            <p className="shelf-label">System folder 01</p>
            <span className="shelf-count">{pastQuestions.length}</span>
          </div>
          <h2 className="shelf-title" id="mat-past-title">Past questions</h2>
          {renderSavedRows(pastQuestions, 'Nothing saved yet. Save a past question and it will stay here, ready to open again.')}
          <button className="shelf-action" onClick={() => go('questions')}>Find more past questions</button>
        </section>}

        {!isCollectionView && (folderView === 'all' || folderView === 'lecture_notes') && <section className="shelf" aria-labelledby="mat-notes-title">
          <div className="shelf-head">
            <p className="shelf-label">System folder 02</p>
            <span className="shelf-count">{lectureNotes.length}</span>
          </div>
          <h2 className="shelf-title" id="mat-notes-title">Lecture notes</h2>
          {renderSavedRows(lectureNotes, 'Nothing saved yet. Save a lecture note and it will stay here for your next study session.')}
        </section>}

        {!isCollectionView && (folderView === 'all' || folderView === 'maxe_conversations') && <section className="shelf" aria-labelledby="mat-convos-title">
          <div className="shelf-head">
            <p className="shelf-label">System folder 03</p>
            <span className="shelf-count">{conversations.length}</span>
          </div>
          <h2 className="shelf-title" id="mat-convos-title">Maxe saved conversations</h2>
          {renderSavedRows(conversations, 'No Maxe conversations saved yet. Save a useful exchange from the assistant to keep it here.')}
        </section>}

        {!isCollectionView && (folderView === 'all' || folderView === 'practice_offline') && <section className="shelf" aria-labelledby="mat-practice-title">
          <div className="shelf-head">
            <p className="shelf-label">System folder 04</p>
            <span className="shelf-count">{results.length + visiblePacks.length}</span>
          </div>
          <h2 className="shelf-title" id="mat-practice-title">Practice offline questions</h2>
          {renderSavedRows(results, 'No saved practice results yet. Save a result after a practice run to keep the debrief here.')}
          <div className="materials-subsection"><p className="shelf-label">Question packs</p>{renderPackRows(visiblePacks)}</div>
          <button className="shelf-action" onClick={() => go('questions')}>Save more questions</button>
        </section>}

        {isCollectionView && selectedCollection && <section className="shelf materials-custom-folder" aria-labelledby="mat-custom-title">
          <div className="shelf-head">
            <div>
              <p className="shelf-label">Your {selectedCollection.kind}</p>
              <h2 className="shelf-title" id="mat-custom-title">{selectedCollection.name}</h2>
            </div>
            <button type="button" className="shelf-row-btn is-quiet" onClick={() => void deleteSelectedCollection()}>Delete folder</button>
          </div>
          {collectionItems.length === 0 && collectionPacks.length === 0 ? (
            <p className="shelf-empty">This folder is empty. Use Organize on a saved item to add it here.</p>
          ) : (
            <>
              {renderSavedRows(collectionItems, 'No saved items in this folder yet.')}
              {collectionPacks.length > 0 && <div className="materials-subsection"><p className="shelf-label">Offline question packs</p>{renderPackRows(collectionPacks)}</div>}
            </>
          )}
        </section>}

        {folderView === 'all' && <section className="shelf" aria-labelledby="mat-queue-title">
          <div className="shelf-head">
            <p className="shelf-label">Waiting for your review</p>
            <span className="shelf-count">{visibleUploads.length}</span>
          </div>
          <h2 className="shelf-title" id="mat-queue-title">Upload queue</h2>

          {visibleUploads.length === 0 ? (
            <p className="shelf-empty">Nothing queued. Offline uploads wait here for metadata review and confirmation when you reconnect.</p>
          ) : (
            <ul className="shelf-list">
              {visibleUploads.map((upload) => (
                <li key={upload.id}>
                  <div className="shelf-item-body">
                    <div className="shelf-item-title">{upload.fileName}</div>
                    <p className="shelf-item-meta">{Math.round(upload.fileSize / 1024)} KB · {savedDate(upload.queuedAt)}</p>
                  </div>
                  <div className="shelf-row-actions">
                    <button type="button" className="shelf-row-btn" onClick={() => onReviewUpload(upload)}>Review upload</button>
                    <button
                      type="button"
                      className="shelf-row-btn is-quiet"
                      onClick={() => { void removePendingUpload(upload.id).then(load).catch(() => setLibraryError('The queued file could not be removed. Try again.')); }}
                    >
                      Discard
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <button className="shelf-action" onClick={() => go('upload')}>Add materials</button>
        </section>}
      </div>
    </div>
  );
}
