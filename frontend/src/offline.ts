const DB_NAME = 'exammind-offline';
const DB_VERSION = 1;

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
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

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
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function writeRecord<T>(storeName: string, value: T) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function saveStudyPack(pack: OfflineStudyPack) {
  await writeRecord('studyPacks', pack);
}

export async function queuePendingUpload(meta: Omit<PendingUpload, 'fileData'>, file: File) {
  const fileData = await file.arrayBuffer();
  await writeRecord('pendingUploads', { ...meta, fileData });
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
  await writeRecord('practiceAttempts', {
    ...attempt,
    id: `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    queuedAt: new Date().toISOString(),
  });
}

export async function removePracticeAttempt(id: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('practiceAttempts', 'readwrite');
    tx.objectStore('practiceAttempts').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removePendingUpload(id: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('pendingUploads', 'readwrite');
    tx.objectStore('pendingUploads').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function countRecords(storeName: 'studyPacks' | 'pendingUploads' | 'practiceAttempts') {
  const db = await openDb();
  return new Promise<number>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listRecords<T>(storeName: 'studyPacks' | 'pendingUploads' | 'practiceAttempts') {
  const db = await openDb();
  return new Promise<T[]>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
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
