import { useEffect, useRef, useState } from 'react';
import { countRecords } from '../offline';
import { apiGet } from '../lib/api';

export default function OfflineStatus() {
  const [connection, setConnection] = useState<'connecting' | 'waking' | 'online' | 'offline'>('connecting');
  const [packs, setPacks] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const failuresRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const refreshCounts = async () => {
      try {
        const [saved, pending] = await Promise.all([countRecords('studyPacks'), countRecords('pendingUploads')]);
        if (!cancelled) { setPacks(saved); setPendingCount(pending); }
      } catch { if (!cancelled) { setPacks(0); setPendingCount(0); } }
    };
    void refreshCounts();
    window.addEventListener('exammind-offline-updated', refreshCounts);
    return () => { cancelled = true; window.removeEventListener('exammind-offline-updated', refreshCounts); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ping = async () => {
      if (cancelled || pending) return;
      if (timer) clearTimeout(timer);
      if (!navigator.onLine) { setConnection('offline'); return; }
      pending = true;
      try {
        await apiGet('/health');
        if (!cancelled) { failuresRef.current = 0; setConnection('online'); }
      } catch {
        if (!cancelled) {
          failuresRef.current += 1;
          setConnection(failuresRef.current < 3 ? 'waking' : 'offline');
        }
      } finally {
        pending = false;
        if (!cancelled) timer = setTimeout(() => void ping(), failuresRef.current > 0 && failuresRef.current < 3 ? 3000 : 30000);
      }
    };
    const online = () => { failuresRef.current = 0; void ping(); };
    const offline = () => { if (timer) clearTimeout(timer); setConnection('offline'); };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    void ping();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  // Connectivity is not consent to publish or permission to replay old scores.
  // Queued files require explicit review in the account/space-scoped library.
  const label = connection === 'connecting' ? 'Connecting' : connection === 'waking' ? 'Waking server…' : connection === 'online' ? 'Online' : 'Offline';
  return <div className={`offline-pill ${connection}`} role="status" aria-live="polite">
    <span className="offline-dot" /><span>{label}</span>
    <span className="offline-meta">{packs} packs · {pendingCount} awaiting review</span>
  </div>;
}
