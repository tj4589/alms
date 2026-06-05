import { useEffect, useState } from 'react';
import { countRecords } from '../offline';

export default function OfflineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [packs, setPacks] = useState(0);
  const [pendingUploads, setPendingUploads] = useState(0);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => {
    const refreshCounts = () => {
      countRecords('studyPacks').then(setPacks).catch(() => setPacks(0));
      countRecords('pendingUploads').then(setPendingUploads).catch(() => setPendingUploads(0));
    };

    refreshCounts();
    window.addEventListener('exammind-offline-updated', refreshCounts);
    return () => window.removeEventListener('exammind-offline-updated', refreshCounts);
  }, []);

  return (
    <div className={`offline-pill ${online ? 'online' : 'offline'}`}>
      <span className="offline-dot"></span>
      <span>{online ? 'Online' : 'Offline mode'}</span>
      <span className="offline-meta">{packs} packs · {pendingUploads} queued</span>
    </div>
  );
}
