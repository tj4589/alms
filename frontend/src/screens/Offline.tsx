import { useEffect, useState } from 'react';
import type { ScreenType } from '../types';
import type { OfflineStudyPack, PendingUpload } from '../offline';
import { listRecords } from '../offline';
import './Offline.css';

export default function Offline({ go }: { go: (s: ScreenType) => void }) {
  const [packs, setPacks] = useState<OfflineStudyPack[]>([]);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);

  useEffect(() => {
    listRecords<OfflineStudyPack>('studyPacks').then(setPacks).catch(() => setPacks([]));
    listRecords<PendingUpload>('pendingUploads').then(setUploads).catch(() => setUploads([]));
  }, []);

  return (
    <div className="page" id="s-offline">
      <div className="pg-head">
        <div className="pg-title">Offline <em>Library</em></div>
        <div className="pg-sub">Saved past-question packs and queued uploads stay available when the network drops.</div>
      </div>

      <div className="shelf-grid">
        <section className="shelf" aria-labelledby="offline-packs-title">
          <div className="shelf-head">
            <p className="shelf-label">Available offline</p>
            <span className="shelf-count">{packs.length}</span>
          </div>
          <h2 className="shelf-title" id="offline-packs-title">Saved study packs</h2>

          {packs.length === 0 ? (
            <p className="shelf-empty">Nothing saved yet. Save a pack from Past Questions and it stays readable with no connection.</p>
          ) : (
            <ul className="shelf-list">
              {packs.map((pack) => (
                <li key={pack.id}>
                  <div>
                    <div className="shelf-item-title">{pack.title}</div>
                    <p className="shelf-item-meta">{pack.courseCode} · {pack.questions.length} questions · saved {new Date(pack.savedAt).toLocaleDateString()}</p>
                  </div>
                  <span className="shelf-status is-ready">Ready</span>
                </li>
              ))}
            </ul>
          )}

          <button className="shelf-action" onClick={() => go('questions')}>Save more packs</button>
        </section>

        <section className="shelf" aria-labelledby="offline-queue-title">
          <div className="shelf-head">
            <p className="shelf-label">Waiting to sync</p>
            <span className="shelf-count">{uploads.length}</span>
          </div>
          <h2 className="shelf-title" id="offline-queue-title">Upload queue</h2>

          {uploads.length === 0 ? (
            <p className="shelf-empty">Nothing queued. Files added without a connection wait here until sync is possible.</p>
          ) : (
            <ul className="shelf-list">
              {uploads.map((upload) => (
                <li key={upload.id}>
                  <div>
                    <div className="shelf-item-title">{upload.fileName}</div>
                    <p className="shelf-item-meta">{Math.round(upload.fileSize / 1024)} KB</p>
                  </div>
                  <span className="shelf-status is-queued">Queued</span>
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
