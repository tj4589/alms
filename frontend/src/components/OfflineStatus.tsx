import { useEffect, useRef, useState } from 'react';
import type { PendingPracticeAttempt, PendingUpload } from '../offline';
import { countRecords, listRecords, removePendingUpload, removePracticeAttempt } from '../offline';
import { apiFormPost, apiPost, apiGet } from '../lib/api';

export default function OfflineStatus() {
  const [connection, setConnection] = useState<'connecting' | 'waking' | 'online' | 'offline'>('connecting');
  const [packs, setPacks] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncedMsg, setSyncedMsg] = useState('');
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failuresRef = useRef(0);

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
    const ping = async (retry = 0) => {
      if (!navigator.onLine) {
        failuresRef.current = 0;
        setConnection('offline');
        return;
      }
      setConnection(retry === 0 && failuresRef.current === 0 ? 'connecting' : 'waking');
      try {
        await apiGet('/');
        failuresRef.current = 0;
        setConnection('online');
        void syncAll();
      } catch {
        failuresRef.current += 1;
        if (failuresRef.current < 3) {
          setConnection('waking');
          pollRef.current = setTimeout(() => void ping(retry + 1), Math.min(15000, 3000 * (retry + 1)));
        } else {
          setConnection('offline');
          pollRef.current = setTimeout(() => void ping(), 30000);
        }
      }
    };

    const handleOnline = () => { failuresRef.current = 0; void ping(); };
    const handleOffline = () => { failuresRef.current = 0; setConnection('offline'); };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Poll every 30 s so the indicator stays accurate without a page refresh.
    void ping(); // initial check on mount

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  useEffect(() => {
    refreshCounts();
    window.addEventListener('exammind-offline-updated', refreshCounts);
    return () => window.removeEventListener('exammind-offline-updated', refreshCounts);
  }, []);

  const label = syncing
    ? 'Syncing...'
    : syncedMsg
      || (connection === 'connecting' ? 'Connecting' : connection === 'waking' ? 'Waking server…' : connection === 'online' ? 'Online' : 'Offline');

  return (
    <div className={`offline-pill ${connection}`} role="status" aria-live="polite">
      <span className={`offline-dot${syncing ? ' syncing' : ''}`}></span>
      <span>{label}</span>
      {!syncedMsg && <span className="offline-meta">{packs} packs · {pendingCount} queued</span>}
    </div>
  );
}
