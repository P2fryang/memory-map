// Stores the user's .pmtiles map files on this device (IndexedDB, in its own database so the
// places database is never touched). Files stay in the browser; nothing is uploaded.
import { MapFileError, readHeader } from './pmtilesHeader.js';

const DB_NAME = 'personal-places-map-files';
const STORE = 'files';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('IndexedDB is not available')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'name' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = resolve;
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
});

export function createMapFileStore() {
  let dbPromise;
  const db = () => (dbPromise ??= openDatabase());

  return {
    /** Descriptions of the stored files (never loads the file contents). */
    async list() {
      const database = await db();
      const metas = [];
      const tx = database.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const { name, size, addedAt, header } = cursor.value;
        metas.push({ name, size, addedAt, header });
        cursor.continue();
      };
      await done(tx);
      return metas.sort((a, b) => a.name.localeCompare(b.name));
    },

    async get(name) {
      const database = await db();
      const tx = database.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(name);
      await done(tx);
      return request.result?.blob;
    },

    /** Validates the file's header, checks there is room, and stores it (replacing a file of the same name). */
    async add(file) {
      const header = await readHeader(file); // throws MapFileError for non-PMTiles files
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.quota && estimate.usage + file.size > estimate.quota * 0.9) {
        throw new MapFileError("There isn't enough free space on this device for that file.");
      }
      const database = await db();
      const tx = database.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ name: file.name, size: file.size, addedAt: new Date().toISOString(), header, blob: file });
      await done(tx);
      return { name: file.name, size: file.size, header };
    },

    async remove(name) {
      const database = await db();
      const tx = database.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(name);
      await done(tx);
    },
  };
}
