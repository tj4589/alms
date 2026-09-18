import { useEffect, useRef, useState } from 'react';
import type { ScreenType } from '../types';
import { countRecords } from '../offline';
import './NotificationPanel.css';

type NotificationPanelProps = {
  open: boolean;
  onClose: () => void;
  go: (screen: ScreenType) => void;
};

type Counts = {
  pendingUploads: number;
  practiceAttempts: number;
  studyPacks: number;
};

// Everything here is read from the real offline queues in IndexedDB. There is no
// notification model on the server yet, so rather than invent "@someone replied"
// this surfaces the work the app is actually holding on the student's behalf --
// which is the part they cannot otherwise see.
export default function NotificationPanel({ open, onClose, go }: NotificationPanelProps) {
  // Tracked here rather than lifted out of OfflineStatus, which owns the sync
  // logic and is working; this only needs to know reachable or not.
  const [online, setOnline] = useState(navigator.onLine);
  const [counts, setCounts] = useState<Counts | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      countRecords('pendingUploads'),
      countRecords('practiceAttempts'),
      countRecords('studyPacks'),
    ])
      .then(([pendingUploads, practiceAttempts, studyPacks]) => {
        if (!cancelled) setCounts({ pendingUploads, practiceAttempts, studyPacks });
      })
      .catch(() => {
        if (!cancelled) setCounts({ pendingUploads: 0, practiceAttempts: 0, studyPacks: 0 });
      });
    return () => { cancelled = true; };
  }, [open]);

  // Esc closes, and focus moves into the panel so a keyboard user is not
  // stranded behind it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) {
        const trigger = (target as HTMLElement).closest?.('[data-notification-trigger]');
        if (!trigger) onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const waiting = (counts?.pendingUploads ?? 0) + (counts?.practiceAttempts ?? 0);
  const items: { key: string; title: string; body: string; tone: string; action?: () => void; actionLabel?: string }[] = [];

  if (counts && counts.pendingUploads > 0) {
    items.push({
      key: 'uploads',
      title: `${counts.pendingUploads} upload${counts.pendingUploads === 1 ? '' : 's'} waiting to sync`,
      body: online ? 'These will send on the next successful request.' : 'These will send when you are back online.',
      tone: 'pending',
      action: () => { go('offline'); onClose(); },
      actionLabel: 'See the queue',
    });
  }

  if (counts && counts.practiceAttempts > 0) {
    items.push({
      key: 'attempts',
      title: `${counts.practiceAttempts} practice result${counts.practiceAttempts === 1 ? '' : 's'} not yet counted`,
      body: 'Your readiness score updates once these reach the server.',
      tone: 'pending',
      action: () => { go('progress'); onClose(); },
      actionLabel: 'Open progress',
    });
  }

  if (counts && counts.studyPacks > 0 && waiting === 0) {
    items.push({
      key: 'packs',
      title: `${counts.studyPacks} pack${counts.studyPacks === 1 ? '' : 's'} saved for offline`,
      body: 'These stay readable with no connection.',
      tone: 'ok',
      action: () => { go('offline'); onClose(); },
      actionLabel: 'Offline library',
    });
  }

  return (
    <div
      className="notif-panel"
      role="dialog"
      aria-label="Notifications"
      aria-modal="false"
      tabIndex={-1}
      ref={panelRef}
    >
      <div className="notif-head">
        <p className="notif-label">Notifications</p>
      </div>

      {counts === null ? (
        <p className="notif-empty">Checking...</p>
      ) : items.length === 0 ? (
        <p className="notif-empty">
          Nothing waiting. Uploads, practice results and anything saved for offline will show up here.
        </p>
      ) : (
        <ul className="notif-list">
          {items.map((item) => (
            <li key={item.key} className={`notif-item tone-${item.tone}`}>
              <p className="notif-title">{item.title}</p>
              <p className="notif-body">{item.body}</p>
              {item.action && (
                <button type="button" className="notif-action" onClick={item.action}>{item.actionLabel} &rarr;</button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="notif-foot">
        Replies and group activity are not sent here yet.
      </p>
    </div>
  );
}
