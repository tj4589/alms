const DB_NAME = 'exammind-offline';
// Preserve old records but index only records with verified ownership.
const DB_VERSION = 3;
const OFFLINE_CLEANUP_TIMEOUT_MS = 5000;
const openConnections = new Set<IDBDatabase>();
let offlineCleanupPromise: Promise<void> | null = null;
let activeScope: string | null = null;
let activeOwner: number | null = null;
let pendingCleanupOwner: number | null = null;

/** Set only from a verified ExamMind identity and active membership. Never
 * infer ownership of legacy records from whichever account happens to log in. */
export function setOfflineScope(userId: number | null, spaceId: number | null): void {
  activeOwner = userId;
  activeScope = userId && spaceId ? `${userId}:${spaceId}` : null;
}

export function getOfflineScope(): string | null { return activeScope; }

function requireScope(): string {
  if (!activeScope) throw new Error('Sign in and select a learning space before saving offline.');
  return activeScope;
}

function checkScope(scope: string): void {
  if (scope !== activeScope) throw new Error('Your account or learning space changed. Try again.');
}

type ScopedRecord = { id: string; _scope?: string; _recordId?: string };

export type OfflineStudyPack = {
  id: string;
  courseCode: string;
  title: string;
  savedAt: string;
  questions: Array<{
    year: string;
    topic: string;
    difficulty: string;
    text: string;
  }>;
};

export type PendingUpload = {
  id: string;
  fileName: string;
  fileSize: number;
  queuedAt: string;
  status: 'waiting_to_sync';
  fileData: ArrayBuffer; // actual bytes so sync can re-POST the file
  mimeType?: string;
};

export type StoreName = 'studyPacks' | 'pendingUploads' | 'practiceAttempts' | 'savedItems';

/**
 * Something the student chose to keep.
 *
 * `cachedOffline` is the honest bit: it is true only when `snapshot` actually
 * holds readable content. A bookmark without a snapshot still opens, but it
 * needs the network, and the library says so rather than promising offline
 * access it cannot deliver.
 */
export type SavedItem = {
  id: string;
  itemType: 'lecture_note' | 'past_question' | 'maxe_conversation' | 'practice_result';
  refId: string | number;
  title: string;
  meta: string;
  savedAt: string;
  cachedOffline: boolean;
  snapshot?: unknown;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Offline storage is unavailable.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    const timeout = window.setTimeout(() => {
      settled = true;
      reject(new Error('Offline storage is busy. Close other ExamMind tabs and try again.'));
    }, OFFLINE_CLEANUP_TIMEOUT_MS);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('studyPacks')) {
        db.createObjectStore('studyPacks', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('pendingUploads')) {
        db.createObjectStore('pendingUploads', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('practiceAttempts')) {
        db.createObjectStore('practiceAttempts', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('savedItems')) {
        db.createObjectStore('savedItems', { keyPath: 'id' });
      }
      for (const name of ['studyPacks', 'pendingUploads', 'practiceAttempts', 'savedItems']) {
        const store = request.transaction!.objectStore(name);
        if (!store.indexNames.contains('scope')) store.createIndex('scope', '_scope');
      }
    };

    request.onerror = () => {
      window.clearTimeout(timeout);
      if (!settled) { settled = true; reject(request.error || new Error('Offline storage could not be opened.')); }
    };
    request.onsuccess = () => {
      window.clearTimeout(timeout);
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true;
      openConnections.add(db);
      db.onclose = () => openConnections.delete(db);
      db.onversionchange = () => {
        db.close();
        openConnections.delete(db);
      };
      resolve(db);
    };
  });
}

function closeDb(db: IDBDatabase): void {
  db.close();
  openConnections.delete(db);
}

/**
 * Remove this verified account's records across its learning spaces, without
 * deleting another account's work or unattributed legacy records.
 */
export function clearOfflineAccountData(): Promise<void> {
  if (offlineCleanupPromise) return offlineCleanupPromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  let savedOwner: number | null = null;
  try { savedOwner = Number(window.sessionStorage.getItem('exammind-offline-cleanup-owner')) || null; } catch { /* Storage may be blocked. */ }
  const owner = activeOwner ?? pendingCleanupOwner ?? savedOwner;
  if (!owner) return Promise.reject(new Error('Account identity is required to clear offline data.'));
  pendingCleanupOwner = owner;
  try { window.sessionStorage.setItem('exammind-offline-cleanup-owner', String(owner)); } catch { /* In-memory retry still works. */ }
  offlineCleanupPromise = (async () => {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['studyPacks', 'pendingUploads', 'practiceAttempts', 'savedItems'], 'readwrite');
      const timeout = window.setTimeout(() => tx.abort(), OFFLINE_CLEANUP_TIMEOUT_MS);
      for (const name of ['studyPacks', 'pendingUploads', 'practiceAttempts', 'savedItems']) {
        const request = tx.objectStore(name).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if ((cursor.value as ScopedRecord)._scope?.startsWith(`${owner}:`)) cursor.delete();
          cursor.continue();
        };
      }
      const finish = (error?: unknown) => {
        window.clearTimeout(timeout);
        closeDb(db);
        if (error) reject(error); else resolve();
      };
      tx.oncomplete = () => {
        pendingCleanupOwner = null;
        try { window.sessionStorage.removeItem('exammind-offline-cleanup-owner'); } catch { /* Not required for record deletion. */ }
        finish();
      };
      tx.onerror = () => finish(tx.error || new Error('Offline account data could not be cleared.'));
      tx.onabort = () => finish(tx.error || new Error('Offline account cleanup was interrupted.'));
    });
  })().finally(() => {
    offlineCleanupPromise = null;
  });

  return offlineCleanupPromise;
}

async function writeRecord<T extends { id: string }>(storeName: StoreName, value: T, scope = requireScope()) {
  const db = await openDb();
  try { checkScope(scope); } catch (error) { closeDb(db); throw error; }
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put({ ...value, id: `${scope}|${value.id}`, _scope: scope, _recordId: value.id });
    const finish = (error?: unknown) => {
      closeDb(db);
      if (error) reject(error);
      else resolve();
    };
    transaction.oncomplete = () => finish();
    transaction.onerror = () => finish(transaction.error || new Error('Offline write failed.'));
    transaction.onabort = () => finish(transaction.error || new Error('Offline write was aborted.'));
  });
}

export async function saveStudyPack(pack: OfflineStudyPack) {
  await writeRecord('studyPacks', pack);
}

export async function queuePendingUpload(meta: Omit<PendingUpload, 'fileData'>, file: File) {
  const scope = requireScope();
  const fileData = await file.arrayBuffer();
  await writeRecord('pendingUploads', { ...meta, mimeType: file.type, fileData }, scope);
}

export type PendingPracticeAttempt = {
  id: string;
  queuedAt: string;
  course_id: number | undefined;
  topic: string | undefined;
  score: number;
  total_questions: number;
};

export async function queuePracticeAttempt(attempt: Omit<PendingPracticeAttempt, 'id' | 'queuedAt'>) {
  void attempt;
  throw new Error('Offline quiz scores cannot be submitted. Reconnect to complete a source-grounded quiz.');
}

async function removeRecord(storeName: StoreName, id: string) {
  const scope = requireScope();
  const db = await openDb();
  try { checkScope(scope); } catch (error) { closeDb(db); throw error; }
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(`${scope}|${id}`);
    const finish = (error?: unknown) => { closeDb(db); if (error) reject(error); else resolve(); };
    tx.oncomplete = () => finish();
    tx.onerror = () => finish(tx.error || new Error('Offline delete failed.'));
    tx.onabort = () => finish(tx.error || new Error('Offline delete was aborted.'));
  });
}

export const removePracticeAttempt = (id: string) => removeRecord('practiceAttempts', id);
export const removeStudyPack = (id: string) => removeRecord('studyPacks', id);
export const removePendingUpload = (id: string) => removeRecord('pendingUploads', id);

export async function countRecords(storeName: StoreName) {
  const scope = activeScope;
  if (!scope) return 0;
  const db = await openDb();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).index('scope').count(scope);
    request.onsuccess = () => { closeDb(db); resolve(activeScope === scope ? request.result : 0); };
    request.onerror = () => { closeDb(db); reject(request.error); };
  });
}

export async function listRecords<T>(storeName: StoreName) {
  const scope = activeScope;
  if (!scope) return [] as T[];
  const db = await openDb();
  return new Promise<T[]>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).index('scope').getAll(scope);
    request.onsuccess = () => {
      closeDb(db);
      if (scope !== activeScope) { resolve([]); return; }
      resolve((request.result as ScopedRecord[]).filter(value => value._scope === scope).map(value => {
        const { _scope, _recordId, ...record } = value;
        void _scope;
        return { ...record, id: _recordId } as T;
      }));
    };
    request.onerror = () => { closeDb(db); reject(request.error || new Error('Offline read failed.')); };
    transaction.onerror = () => { closeDb(db); reject(transaction.error || new Error('Offline read failed.')); };
    transaction.onabort = () => { closeDb(db); reject(transaction.error || new Error('Offline read was aborted.')); };
  });
}

/** Saving the same item twice replaces it rather than adding a duplicate. */
export async function saveItem(item: SavedItem, scope = requireScope()) {
  await writeRecord('savedItems', item, scope);
}

export async function removeItem(id: string) {
  await removeRecord('savedItems', id);
}

/** Only a count is disclosed. Unattributed legacy contents are never shown,
 * adopted by the current account, synced or deleted automatically. */
export async function hasLegacyOfflineData(): Promise<boolean> {
  const db = await openDb();
  try {
    const names: StoreName[] = ['studyPacks', 'pendingUploads', 'practiceAttempts', 'savedItems'];
    const tx = db.transaction(names, 'readonly');
    const results = await Promise.all(names.map(async name => {
      const store = tx.objectStore(name);
      const count = (request: IDBRequest<number>) => new Promise<number>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [total, attributed] = await Promise.all([count(store.count()), count(store.index('scope').count())]);
      return total > attributed;
    }));
    return results.some(Boolean);
  } finally { closeDb(db); }
}

/** Newest first, the order a library of saved things is read in. */
export async function listItems(): Promise<SavedItem[]> {
  const items = await listRecords<SavedItem>('savedItems');
  return items.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
}

/** A stable id, so re-saving a document updates its entry instead of doubling it. */
export function savedItemId(itemType: SavedItem['itemType'], refId: string | number): string {
  return `${itemType}:${refId}`;
}

export function registerServiceWorker() {
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Offline support is progressive; the app still works without SW registration.
      });
    });
  }
}
