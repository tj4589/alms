import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChatMessage, ScreenType } from '../types';
import type { OfflineStudyPack, PendingUpload, SavedItem, PendingPracticeAttempt } from '../offline';
import { hasLegacyOfflineData, listItems, listRecords, removeItem, removePendingUpload, removeStudyPack, removePracticeAttempt } from '../offline';
import './Offline.css';
import './WorkspacePage.css';

type MaterialsProps = {
  go: (s: ScreenType, arg?: string | number | null) => void;
  onOpenConversation?: (messages: ChatMessage[]) => void;
  onOpenResource: (kind: 'lecture_note' | 'past_question', id: number) => void;
  onReviewUpload: (upload: PendingUpload) => void;
};

const DOCUMENT_TYPES: SavedItem['itemType'][] = ['lecture_note', 'past_question'];
type MaterialFilter = 'all' | 'documents' | 'conversations' | 'results' | 'offline';
type MaterialSort = 'recent' | 'title';

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

export default function Materials({ go, onOpenConversation, onOpenResource, onReviewUpload }: MaterialsProps) {
  const [saved, setSaved] = useState<SavedItem[]>([]);
  const [packs, setPacks] = useState<OfflineStudyPack[]>([]);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [legacyData, setLegacyData] = useState(false);
  const [oldAttempts, setOldAttempts] = useState<PendingPracticeAttempt[]>([]);
  const [openPack, setOpenPack] = useState<string | null>(null);
  const [cachedDocument, setCachedDocument] = useState<SavedItem | null>(null);
  const [libraryError, setLibraryError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MaterialFilter>('all');
  const [sort, setSort] = useState<MaterialSort>('recent');

  const load = useCallback(() => {
    listItems().then(setSaved).catch(() => setSaved([]));
    listRecords<OfflineStudyPack>('studyPacks').then(setPacks).catch(() => setPacks([]));
    listRecords<PendingUpload>('pendingUploads').then(setUploads).catch(() => setUploads([]));
    hasLegacyOfflineData().then(setLegacyData).catch(() => undefined);
    listRecords<PendingPracticeAttempt>('practiceAttempts').then(setOldAttempts).catch(() => setOldAttempts([]));
  }, []);

  useEffect(load, [load]);

  const matchesQuery = useCallback((value: string) => {
    const normalizedQuery = query.trim().toLowerCase();
    return !normalizedQuery || value.toLowerCase().includes(normalizedQuery);
  }, [query]);

  const sortSaved = useCallback((items: SavedItem[]) => [...items].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    return new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime();
  }), [sort]);

  const offlineOnly = filter === 'offline';
  const documents = useMemo(() => sortSaved(saved.filter((item) => DOCUMENT_TYPES.includes(item.itemType) && (!offlineOnly || item.cachedOffline) && matchesQuery(`${item.title} ${item.meta}`))), [matchesQuery, offlineOnly, saved, sortSaved]);
  const conversations = useMemo(() => sortSaved(saved.filter((item) => item.itemType === 'maxe_conversation' && (!offlineOnly || item.cachedOffline) && matchesQuery(`${item.title} ${item.meta}`))), [matchesQuery, offlineOnly, saved, sortSaved]);
  const results = useMemo(() => sortSaved(saved.filter((item) => item.itemType === 'practice_result' && (!offlineOnly || item.cachedOffline) && matchesQuery(`${item.title} ${item.meta}`))), [matchesQuery, offlineOnly, saved, sortSaved]);
  const visibleSections = {
    documents: filter === 'all' || filter === 'documents' || offlineOnly,
    conversations: filter === 'all' || filter === 'conversations' || offlineOnly,
    results: filter === 'all' || filter === 'results' || offlineOnly,
    offline: filter === 'all' || filter === 'offline',
  };

  const visiblePacks = useMemo(() => [...packs]
    .filter((pack) => matchesQuery(`${pack.title} ${pack.courseCode}`))
    .sort((a, b) => sort === 'title'
      ? a.title.localeCompare(b.title)
      : new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()), [matchesQuery, packs, sort]);
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

  return (
    <div className="page workspace-page" id="s-offline">
      <div className="pg-head">
        <div className="pg-title">Saved <em>library</em></div>
        <div className="pg-sub">Everything you have saved, in one place. Anything marked offline opens with no connection.</div>
      </div>

      <button type="button" className="shelf-action" onClick={() => go('workspace')}>Back to study materials</button>
      {libraryError && <p role="alert">{libraryError}</p>}
      {legacyData && <p role="status">Older offline data has no verified account owner. It remains stored on this device, but cannot be opened or synced safely. Contact support for recovery; it has not been deleted.</p>}
      {cachedDocument && <section className="shelf" aria-label="Cached document"><h2>{cachedDocument.title}</h2><p>Offline snapshot saved {savedDate(cachedDocument.savedAt)}. Reconnect to check current access and updates.</p><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{String((cachedDocument.snapshot as Record<string, unknown>).content_text || (cachedDocument.snapshot as Record<string, unknown>).contentText || 'No reading text was cached for this item.')}</p><button type="button" onClick={() => setCachedDocument(null)}>Close cached document</button></section>}
      {oldAttempts.length > 0 && <section className="shelf"><h2>Older quiz records need review</h2><p>Direct scores cannot be counted as readiness evidence. Reconnect and complete a new quiz; these records will not be submitted automatically.</p>{oldAttempts.map(attempt => <div key={attempt.id}><span>{attempt.topic || 'Older practice result'}</span><button type="button" onClick={() => void removePracticeAttempt(attempt.id).then(load).catch(() => setLibraryError('The older record could not be removed. Try again.'))}>Discard older record</button></div>)}</section>}

      <div className="materials-toolbar" role="search" aria-label="Material filters">
        <label className="materials-search">
          <span>Search your materials</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search saved materials" />
        </label>
        <label className="materials-control">
          <span>Show</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value as MaterialFilter)}>
            <option value="all">Everything</option>
            <option value="documents">Documents</option>
            <option value="conversations">Conversations</option>
            <option value="results">Practice results</option>
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

      <div className="shelf-grid">
        {visibleSections.documents && <section className="shelf" aria-labelledby="mat-docs-title">
          <div className="shelf-head">
            <p className="shelf-label">Saved</p>
            <span className="shelf-count">{documents.length}</span>
          </div>
          <h2 className="shelf-title" id="mat-docs-title">Documents</h2>

          {documents.length === 0 ? (
            <p className="shelf-empty">Nothing saved yet. Use Save on any note or past question and it lands here, ready to open without searching for it again.</p>
          ) : (
            <ul className="shelf-list">
              {documents.map((item) => (
                <li key={item.id}>
                  <div className="shelf-item-body">
                    <div className="shelf-item-title">{item.title}</div>
                    <p className="shelf-item-meta">
                      {item.meta}{item.meta ? ' · ' : ''}{savedDate(item.savedAt)}
                      {item.cachedOffline && <span className="shelf-offline-tag">offline</span>}
                    </p>
                  </div>
                  <div className="shelf-row-actions">
                    <button type="button" className="shelf-row-btn" onClick={() => openDocument(item)}>Open</button>
                    <button type="button" className="shelf-row-btn is-quiet" onClick={() => void forget(item.id)}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <button className="shelf-action" onClick={() => go('questions')}>Find more materials</button>
        </section>}

        {visibleSections.conversations && <section className="shelf" aria-labelledby="mat-convos-title">
          <div className="shelf-head">
            <p className="shelf-label">Saved</p>
            <span className="shelf-count">{conversations.length}</span>
          </div>
          <h2 className="shelf-title" id="mat-convos-title">Conversations with Maxe</h2>

          {conversations.length === 0 ? (
            <p className="shelf-empty">No conversations kept. Save one from Maxe and the whole exchange is stored here as it stood.</p>
          ) : (
            <ul className="shelf-list">
              {conversations.map((item) => {
                const messages = messagesOf(item);
                return (
                  <li key={item.id}>
                    <div className="shelf-item-body">
                      <div className="shelf-item-title">{item.title}</div>
                      <p className="shelf-item-meta">
                        {item.meta}{item.meta ? ' · ' : ''}{savedDate(item.savedAt)}
                      </p>
                    </div>
                    <div className="shelf-row-actions">
                      {messages && onOpenConversation ? (
                        <button type="button" className="shelf-row-btn" onClick={() => onOpenConversation(messages)}>Reopen</button>
                      ) : (
                        <span className="shelf-status is-queued">No messages kept</span>
                      )}
                      <button type="button" className="shelf-row-btn is-quiet" onClick={() => void forget(item.id)}>Remove</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>}

        {visibleSections.results && <section className="shelf" aria-labelledby="mat-results-title">
          <div className="shelf-head">
            <p className="shelf-label">Saved</p>
            <span className="shelf-count">{results.length}</span>
          </div>
          <h2 className="shelf-title" id="mat-results-title">Practice results</h2>

          {results.length === 0 ? (
            <p className="shelf-empty">No results kept. Save one after a practice run and the score and debrief stay here.</p>
          ) : (
            <ul className="shelf-list">
              {results.map((item) => (
                <li key={item.id}>
                  <div className="shelf-item-body">
                    <div className="shelf-item-title">{item.title}</div>
                    <p className="shelf-item-meta">
                      {item.meta}{item.meta ? ' · ' : ''}{savedDate(item.savedAt)}
                      {item.cachedOffline && <span className="shelf-offline-tag">offline</span>}
                    </p>
                  </div>
                  <div className="shelf-row-actions">
                    <button type="button" className="shelf-row-btn" onClick={() => go('progress')}>Progress</button>
                    <button type="button" className="shelf-row-btn is-quiet" onClick={() => void forget(item.id)}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <button className="shelf-action" onClick={() => go('practice')}>Practise again</button>
        </section>}

        {visibleSections.offline && <section className="shelf" aria-labelledby="mat-packs-title">
          <div className="shelf-head">
            <p className="shelf-label">Available offline</p>
            <span className="shelf-count">{visiblePacks.length}</span>
          </div>
          <h2 className="shelf-title" id="mat-packs-title">Study packs</h2>

          {visiblePacks.length === 0 ? (
            <p className="shelf-empty">Nothing saved yet. Save a pack from Past Questions and it stays readable with no connection.</p>
          ) : (
            <ul className="shelf-list">
              {visiblePacks.map((pack) => (
                <li key={pack.id} className="is-stacked">
                  <div className="shelf-item-row">
                    <div className="shelf-item-body">
                      <div className="shelf-item-title">{pack.title}</div>
                      <p className="shelf-item-meta">{pack.courseCode} · {pack.questions.length} questions · {savedDate(pack.savedAt)}</p>
                    </div>
                    <div className="shelf-row-actions">
                      <button
                        type="button"
                        className="shelf-row-btn"
                        aria-expanded={openPack === pack.id}
                        onClick={() => setOpenPack((current) => current === pack.id ? null : pack.id)}
                      >
                        {openPack === pack.id ? 'Close' : 'Open'}
                      </button>
                      <button
                        type="button"
                        className="shelf-row-btn is-quiet"
                        onClick={() => { void removeStudyPack(pack.id).then(load).catch(() => setLibraryError('The study pack could not be removed. Try again.')); }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {/* The questions are already in the browser, so opening a pack
                      reads them from storage rather than asking the network. */}
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
          )}

          <button className="shelf-action" onClick={() => go('questions')}>Save more packs</button>
        </section>}

        {visibleSections.offline && <section className="shelf" aria-labelledby="mat-queue-title">
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
