/**
 * The user's recordings, stored as Blobs in IndexedDB (localStorage is far too small for
 * hour-long files). One object store, keyed by track id.
 */
const DB_NAME = 'tsw-sounds';
const STORE = 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
  // A failed open (e.g. blocked storage) can be retried later.
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = op(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? req.error ?? new Error('IndexedDB error'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      }),
  );
}

export function putBlob(id: string, blob: Blob): Promise<void> {
  return run('readwrite', (s) => s.put(blob, id)).then(() => undefined);
}

export async function getBlob(id: string): Promise<Blob | null> {
  const v: unknown = await run('readonly', (s) => s.get(id));
  return v instanceof Blob ? v : null;
}

export function deleteBlob(id: string): Promise<void> {
  return run('readwrite', (s) => s.delete(id)).then(() => undefined);
}

/**
 * Asks the browser to keep this site's storage even when the disk runs low (otherwise Chrome
 * may evict it). Harmless if refused.
 */
export async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // Not supported: storage stays "best effort".
  }
}

/** True when the error means the disk quota is full. */
export function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}
