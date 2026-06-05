import { useEffect, useState } from 'react';
import type { ScreenType } from '../types';
import type { OfflineStudyPack, PendingUpload } from '../offline';
import { listRecords } from '../offline';

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

      <div className="two-col">
        <div className="card">
          <div className="card-hd">
            <div className="card-ttl">Saved study packs</div>
            <button className="cta cta-ghost" onClick={() => go('questions')}>Save more</button>
          </div>
          {packs.length === 0 ? (
            <div className="offline-empty">No packs saved yet. Save one from Past Questions before you go offline.</div>
          ) : (
            packs.map((pack) => (
              <div className="offline-item" key={pack.id}>
                <div>
                  <div className="offline-item-title">{pack.title}</div>
                  <div className="offline-item-meta">{pack.courseCode} · {pack.questions.length} questions · {new Date(pack.savedAt).toLocaleDateString()}</div>
                </div>
                <span className="tag tag-e">Available</span>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="card-hd">
            <div className="card-ttl">Upload sync queue</div>
            <button className="cta cta-ghost" onClick={() => go('upload')}>Queue upload</button>
          </div>
          {uploads.length === 0 ? (
            <div className="offline-empty">No pending uploads. Offline PDFs will appear here until sync is available.</div>
          ) : (
            uploads.map((upload) => (
              <div className="offline-item" key={upload.id}>
                <div>
                  <div className="offline-item-title">{upload.fileName}</div>
                  <div className="offline-item-meta">{Math.round(upload.fileSize / 1024)} KB · waiting to sync</div>
                </div>
                <span className="tag tag-m">Queued</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
