import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScreenType } from '../types';
import { apiGet, apiPatch, apiPost } from '../lib/api';
import { countRecords, getOfflineScope } from '../offline';
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
  savedItems: number;
};

type NotificationItem = {
  key: string;
  title: string;
  body: string;
  tone: string;
  read: boolean;
  source: 'server' | 'local';
  serverId?: number;
  action?: () => void;
  actionLabel?: string;
};

type ServerNotification = {
  id: number;
  event_type: string;
  title: string;
  body: string;
  target_screen: string;
  target_id: number | null;
  created_at: string;
  read_at: string | null;
};

const READ_KEYS_PREFIX = 'exammind-notifications-read-v1:';

function readKeysStorageKey(scope: string): string {
  return `${READ_KEYS_PREFIX}${encodeURIComponent(scope)}`;
}

function readStoredKeys(scope: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(readKeysStorageKey(scope));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

function storeReadKeys(scope: string, keys: Set<string>): void {
  try {
    window.localStorage.setItem(readKeysStorageKey(scope), JSON.stringify([...keys]));
  } catch {
    // Notification state is a convenience; a blocked storage area must not
    // prevent the actual queue from opening.
  }
}

function serverItemsFromPayload(payload: unknown): ServerNotification[] {
  const items = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : [];
  return items.filter((item): item is ServerNotification => Boolean(
    item
    && typeof item === 'object'
    && typeof (item as ServerNotification).id === 'number'
    && typeof (item as ServerNotification).title === 'string'
    && typeof (item as ServerNotification).body === 'string',
  ));
}

function isKnownScreen(value: string): value is ScreenType {
  return [
    'dashboard', 'questions', 'assistant', 'upload', 'offline', 'practice', 'collab',
    'empty', 'progress', 'groups', 'search', 'settings', 'profile', 'reader',
    'onboarding', 'workspace', 'moderation', 'admin',
  ].includes(value);
}

// Local queue notices remain useful offline, while activity notifications are
// loaded from the authenticated, active learning-space API.
export default function NotificationPanel({ open, onClose, go }: NotificationPanelProps) {
  // Tracked here rather than lifted out of OfflineStatus, which owns the sync
  // logic and is working; this only needs to know reachable or not.
  const [online, setOnline] = useState(navigator.onLine);
  const [counts, setCounts] = useState<Counts | null>(null);
  const scope = getOfflineScope() || 'anonymous';
  const [readKeys, setReadKeys] = useState<Set<string>>(() => readStoredKeys(scope));
  const [serverItems, setServerItems] = useState<ServerNotification[]>([]);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState('');
  const [serverBusy, setServerBusy] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<number>>(() => new Set());
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setReadKeys(readStoredKeys(scope));
  }, [scope]);

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
      countRecords('savedItems'),
    ])
      .then(([pendingUploads, practiceAttempts, studyPacks, savedItems]) => {
        if (!cancelled) setCounts({ pendingUploads, practiceAttempts, studyPacks, savedItems });
      })
      .catch(() => {
        if (!cancelled) setCounts({ pendingUploads: 0, practiceAttempts: 0, studyPacks: 0, savedItems: 0 });
      });
    return () => { cancelled = true; };
  }, [open]);

  const refreshServer = useCallback(async () => {
    if (!open) return;
    setServerLoading(true);
    setServerError('');
    try {
      const payload = await apiGet('/notifications');
      setServerItems(serverItemsFromPayload(payload));
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Notifications could not be loaded.');
    } finally {
      setServerLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (open) void refreshServer();
  }, [open, refreshServer]);

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

  const waiting = (counts?.pendingUploads ?? 0) + (counts?.practiceAttempts ?? 0);
  const localItems = useMemo<NotificationItem[]>(() => {
    const nextItems: NotificationItem[] = [];

    if (counts && counts.pendingUploads > 0) {
      nextItems.push({
        key: `uploads:${counts.pendingUploads}`,
        title: `${counts.pendingUploads} upload${counts.pendingUploads === 1 ? '' : 's'} awaiting review`,
        body: online ? 'Review metadata and confirm access before uploading.' : 'Review and confirm these when you are back online.',
        tone: 'pending',
        read: readKeys.has(`uploads:${counts.pendingUploads}`),
        source: 'local',
        action: () => { go('offline'); onClose(); },
        actionLabel: 'See the queue',
      });
    }

    if (counts && counts.practiceAttempts > 0) {
      nextItems.push({
        key: `attempts:${counts.practiceAttempts}`,
        title: `${counts.practiceAttempts} practice result${counts.practiceAttempts === 1 ? '' : 's'} not yet counted`,
        body: 'Older direct scores cannot count as readiness. Review these in your saved library.',
        tone: 'pending',
        read: readKeys.has(`attempts:${counts.practiceAttempts}`),
        source: 'local',
        action: () => { go('offline'); onClose(); },
        actionLabel: 'Open saved library',
      });
    }

    if (counts && (counts.studyPacks > 0 || counts.savedItems > 0) && waiting === 0) {
      nextItems.push({
        key: `packs:${counts.studyPacks + counts.savedItems}`,
        title: `${counts.studyPacks + counts.savedItems} saved item${counts.studyPacks + counts.savedItems === 1 ? '' : 's'}`,
        body: 'Open your saved library. Items marked offline can be read without a connection.',
        tone: 'ok',
        read: readKeys.has(`packs:${counts.studyPacks + counts.savedItems}`),
        source: 'local',
        action: () => { go('offline'); onClose(); },
        actionLabel: 'Offline library',
      });
    }

    return nextItems;
  }, [counts, go, onClose, online, readKeys, waiting]);

  const serverNotificationItems = useMemo<NotificationItem[]>(() => serverItems.map(item => ({
    key: `server:${item.id}`,
    title: item.title,
    body: item.body,
    tone: 'ok',
    read: item.read_at !== null,
    source: 'server',
    serverId: item.id,
    action: () => {
      if (item.target_screen === 'discussions' && item.target_id) {
        window.history.pushState({}, '', `/?screen=discussions&thread=${item.target_id}`);
        go('collab');
      } else if (isKnownScreen(item.target_screen)) {
        go(item.target_screen);
      } else {
        go('collab');
      }
      onClose();
    },
    actionLabel: 'Open',
  })), [go, onClose, serverItems]);

  const items = useMemo(() => [...serverNotificationItems, ...localItems], [localItems, serverNotificationItems]);
  const unreadCount = items.filter(item => !item.read).length;

  const markRead = useCallback((keys: string[]) => {
    setReadKeys(previous => {
      const next = new Set(previous);
      keys.forEach(key => next.add(key));
      storeReadKeys(scope, next);
      return next;
    });
  }, [scope]);

  const markServerRead = useCallback(async (id: number) => {
    if (busyIds.has(id)) return;
    const previous = serverItems;
    setBusyIds(current => new Set(current).add(id));
    setServerItems(current => current.map(item => item.id === id ? { ...item, read_at: item.read_at || new Date().toISOString() } : item));
    try {
      const payload = await apiPatch(`/notifications/${id}/read`, {});
      const updated = serverItemsFromPayload([payload])[0];
      if (updated) setServerItems(current => current.map(item => item.id === id ? updated : item));
    } catch (error) {
      setServerItems(previous);
      setServerError(error instanceof Error ? error.message : 'That notification could not be marked as read.');
    } finally {
      setBusyIds(current => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, [busyIds, serverItems]);

  const markAllRead = useCallback(async () => {
    if (serverBusy) return;
    const serverUnread = serverItems.some(item => item.read_at === null);
    markRead(items.filter(item => !item.read && item.source === 'local').map(item => item.key));
    if (!serverUnread) return;
    const previous = serverItems;
    const readAt = new Date().toISOString();
    setServerBusy(true);
    setServerItems(current => current.map(item => ({ ...item, read_at: item.read_at || readAt })));
    try {
      await apiPost('/notifications/read-all', {});
    } catch (error) {
      setServerItems(previous);
      setServerError(error instanceof Error ? error.message : 'Notifications could not be marked as read.');
    } finally {
      setServerBusy(false);
    }
  }, [items, markRead, serverBusy, serverItems]);

  const markItemRead = useCallback((item: NotificationItem) => {
    if (item.source === 'server' && item.serverId !== undefined) {
      void markServerRead(item.serverId);
    } else {
      markRead([item.key]);
    }
  }, [markRead, markServerRead]);

  if (!open) return null;

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
        <div className="notif-head-actions">
          <span className="notif-count" aria-live="polite">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </span>
          {items.length > 0 && unreadCount > 0 && (
            <button type="button" className="notif-mark-all" onClick={() => void markAllRead()} disabled={serverBusy}>Mark all as read</button>
          )}
        </div>
      </div>

      {serverError && (
        <div className="notif-error" role="alert">
          <span>{serverError}</span>
          <button type="button" className="notif-retry" onClick={() => void refreshServer()} disabled={serverLoading}>Retry</button>
        </div>
      )}

      {counts === null || (serverLoading && items.length === 0) ? (
        <p className="notif-empty">Checking...</p>
      ) : items.length === 0 ? (
        <p className="notif-empty">
          Nothing waiting. Replies to your discussions and offline work will show up here.
        </p>
      ) : (
        <ul className="notif-list">
          {items.map((item) => {
            const isBusy = item.serverId !== undefined && busyIds.has(item.serverId);
            return (
              <li key={item.key} className={`notif-item tone-${item.tone} ${item.read ? 'is-read' : 'is-unread'}`}>
                <div className="notif-item-head">
                  <p className="notif-title">{item.title}</p>
                  {!item.read && <span className="notif-unread-label">Unread</span>}
                </div>
                <p className="notif-body">{item.body}</p>
                <div className="notif-item-actions">
                  {item.action && (
                    <button type="button" className="notif-action" onClick={() => { markItemRead(item); item.action?.(); }} disabled={isBusy || serverBusy}>{item.actionLabel} &rarr;</button>
                  )}
                  {!item.read && <button type="button" className="notif-mark-read" onClick={() => markItemRead(item)} disabled={isBusy || serverBusy}>Mark as read</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="notif-foot">
        Discussion replies are synced across your signed-in sessions. Email and browser-push delivery remain disabled.
      </p>
    </div>
  );
}
