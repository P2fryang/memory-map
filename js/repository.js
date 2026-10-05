// The only file that talks to IndexedDB. Everything else uses the PlaceRepository
// interface below, so the storage backend can be swapped or extended later.
//
// interface PlaceRepository {
//   getAll(): Promise<Place[]>;
//   getById(id): Promise<Place | undefined>;
//   create(place): Promise<void>;
//   update(place): Promise<void>;
//   delete(id): Promise<void>;
//   replaceAll(places): Promise<void>;
// }

const DB_NAME = 'personal-places-map';
const DB_VERSION = 1;
const STORE = 'places';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database is blocked by another tab'));
  });
}

export function createPlaceRepository() {
  let dbPromise;
  const getDb = () => (dbPromise ??= openDatabase());

  /** Runs `work(store)` in one transaction; resolves when the transaction commits. */
  async function run(mode, work) {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let request;
      try {
        request = work(tx.objectStore(STORE));
      } catch (err) {
        try { tx.abort(); } catch { /* already aborted */ }
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
    });
  }

  return {
    getAll: () => run('readonly', (s) => s.getAll()),
    getById: (id) => run('readonly', (s) => s.get(id)),
    create: async (place) => { await run('readwrite', (s) => s.add(place)); },
    update: async (place) => { await run('readwrite', (s) => s.put(place)); },
    delete: async (id) => { await run('readwrite', (s) => s.delete(id)); },
    replaceAll: async (places) => {
      await run('readwrite', (s) => {
        s.clear();
        for (const p of places) s.put(p);
      });
    },
  };
}
