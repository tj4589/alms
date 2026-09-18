import { useCallback, useEffect, useState } from 'react';
import type { ChatMessage, ScreenType } from '../types';
import type { OfflineStudyPack, PendingUpload, SavedItem } from '../offline';
import { listItems, listRecords, removeItem, removePendingUpload, removeStudyPack } from '../offline';
import './Offline.css';

type MaterialsProps = {
  go: (s: ScreenType, arg?: string | number | null) => void;
  onOpenConversation?: (messages: ChatMessage[]) => void;
};

const DOCUMENT_TYPES: SavedItem['itemType'][] = ['lecture_note', 'past_question'];

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

export default function Materials({ go, onOpenConversation }: MaterialsProps) {
  const [saved, setSaved] = useState<SavedItem[]>([]);
  const [packs, setPacks] = useState<OfflineStudyPack[]>([]);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [openPack, setOpenPack] = useState<string | null>(null);

  const load = useCallback(() => {
    listItems().then(setSaved).catch(() => setSaved([]));
    listRecords<OfflineStudyPack>('studyPacks').then(setPacks).catch(() => setPacks([]));
    listRecords<PendingUpload>('pendingUploads').then(setUploads).catch(() => setUploads([]));
  }, []);

  useEffect(load, [load]);

  const documents = saved.filter((item) => DOCUMENT_TYPES.includes(item.itemType));
  const conversations = saved.filter((item) => item.itemType === 'maxe_conversation');
  const results = saved.filter((item) => item.itemType === 'practice_result');

  const forget = useCallback(async (id: string) => {
    await removeItem(id).catch(() => undefined);
    load();
  }, [load]);

  const openDocument = useCallback((item: SavedItem) => {
    // Past questions are read through the same desk as notes; the reader takes
    // a numeric id, and a saved reference always carries one.
    const id = typeof item.refId === 'number' ? item.refId : Number(item.refId);
    if (Number.isFinite(id)) go('reader', id);
  }, [go]);

  return (
    <div className="page" id="s-offline">
      <div className="pg-head">
        <div className="pg-title">My <em>Materials</em></div>
        <div className="pg-sub">Everything you have saved, in one place. Anything marked offline opens with no connection.</div>
      </div>

      <div className="shelf-grid">
        <section className="shelf" aria-labelledby="mat-docs-title">
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
        </section>

        <section className="shelf" aria-labelledby="mat-convos-title">
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
        </section>

        <section className="shelf" aria-labelledby="mat-results-title">
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
        </section>

        <section className="shelf" aria-labelledby="mat-packs-title">
          <div className="shelf-head">
            <p className="shelf-label">Available offline</p>
            <span className="shelf-count">{packs.length}</span>
          </div>
          <h2 className="shelf-title" id="mat-packs-title">Study packs</h2>

          {packs.length === 0 ? (
            <p className="shelf-empty">Nothing saved yet. Save a pack from Past Questions and it stays readable with no connection.</p>
          ) : (
            <ul className="shelf-list">
              {packs.map((pack) => (
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
                        onClick={() => { void removeStudyPack(pack.id).then(load).catch(() => undefined); }}
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
        </section>

        <section className="shelf" aria-labelledby="mat-queue-title">
          <div className="shelf-head">
            <p className="shelf-label">Waiting to sync</p>
            <span className="shelf-count">{uploads.length}</span>
          </div>
          <h2 className="shelf-title" id="mat-queue-title">Upload queue</h2>

          {uploads.length === 0 ? (
            <p className="shelf-empty">Nothing queued. Files added without a connection wait here until sync is possible.</p>
          ) : (
            <ul className="shelf-list">
              {uploads.map((upload) => (
                <li key={upload.id}>
                  <div className="shelf-item-body">
                    <div className="shelf-item-title">{upload.fileName}</div>
                    <p className="shelf-item-meta">{Math.round(upload.fileSize / 1024)} KB · {savedDate(upload.queuedAt)}</p>
                  </div>
                  <div className="shelf-row-actions">
                    <span className="shelf-status is-queued">Queued</span>
                    <button
                      type="button"
                      className="shelf-row-btn is-quiet"
                      onClick={() => { void removePendingUpload(upload.id).then(load).catch(() => undefined); }}
                    >
                      Discard
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <button className="shelf-action" onClick={() => go('upload')}>Add materials</button>
        </section>
      </div>
    </div>
  );
}
