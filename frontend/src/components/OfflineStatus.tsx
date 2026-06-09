import { useEffect, useRef, useState } from 'react';
import type { PendingPracticeAttempt, PendingUpload } from '../offline';
import { countRecords, listRecords, removePendingUpload, removePracticeAttempt } from '../offline';
import { apiFormPost, apiPost, apiGet } from '../lib/api';

export default function OfflineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [packs, setPacks] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncedMsg, setSyncedMsg] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshCounts = () => {
    countRecords('studyPacks').then(setPacks).catch(() => setPacks(0));
    countRecords('pendingUploads').then(setPendingCount).catch(() => setPendingCount(0));
  };

  useEffect(() => {
    const syncAll = async () => {
      const uploads = await listRecords<PendingUpload>('pendingUploads');
      const attempts = await listRecords<PendingPracticeAttempt>('practiceAttempts');
      if (uploads.length === 0 && attempts.length === 0) return;

      setSyncing(true);
      let syncedUploads = 0;
      let syncedAttempts = 0;

      for (const upload of uploads) {
        try {
          const file = new File([upload.fileData], upload.fileName, { type: 'application/pdf' });
          const formData = new FormData();
          formData.append('file', file);
          formData.append('confirm', 'true');
          await apiFormPost('/ingest/upload', formData);
          await removePendingUpload(upload.id);
          syncedUploads++;
        } catch {
          // leave in queue — retry on next online event
        }
      }

      for (const attempt of attempts) {
        try {
          await apiPost('/practice/submit', {
            course_id: attempt.course_id,
            topic: attempt.topic,
            score: attempt.score,
            total_questions: attempt.total_questions,
          });
          await removePracticeAttempt(attempt.id);
          syncedAttempts++;
        } catch {
          // leave in queue — retry on next online event
        }
      }

      setSyncing(false);
      window.dispatchEvent(new Event('exammind-offline-updated'));

      const parts: string[] = [];
      if (syncedUploads > 0) parts.push(`${syncedUploads} upload${syncedUploads > 1 ? 's' : ''} synced`);
      if (syncedAttempts > 0) parts.push(`${syncedAttempts} practice attempt${syncedAttempts > 1 ? 's' : ''} synced`);
      if (parts.length > 0) {
        setSyncedMsg(parts.join(' · '));
        setTimeout(() => setSyncedMsg(''), 5000);
      }
    };

    // Ping the backend to verify actual connectivity (navigator.onLine only
    // detects a network interface — it stays true even when the internet is down).
    const ping = async () => {
      try {
        await apiGet('/');
        setOnline(true);
      } catch {
        setOnline(false);
      }
    };

    const handleOnline = () => { void ping(); void syncAll(); };
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Poll every 30 s so the indicator stays accurate without a page refresh.
    pollRef.current = setInterval(() => void ping(), 30_000);
    void ping(); // initial check on mount

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    refreshCounts();
    window.addEventListener('exammind-offline-updated', refreshCounts);
    return () => window.removeEventListener('exammind-offline-updated', refreshCounts);
  }, []);

  const label = syncing ? 'Syncing...' : syncedMsg || (online ? 'Online' : 'Offline mode');

  return (
    <div className={`offline-pill ${online ? 'online' : 'offline'}`}>
      <span className={`offline-dot${syncing ? ' syncing' : ''}`}></span>
      <span>{label}</span>
      {!syncedMsg && <span className="offline-meta">{packs} packs · {pendingCount} queued</span>}
    </div>
  );
}
