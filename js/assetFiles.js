// Optional map assets the user supplies: fonts (glyph .pbf files) and sprite sheets, e.g. from Protomaps'
// basemaps-assets. They are NOT bundled with the app (their licences ask to be kept with them), so they live
// in this browser only (IndexedDB, own database), exactly as uploaded, plus any licence files found with them.
//
// Stored paths:  fonts/<font name>/<start>-<end>.pbf    sprites/<theme>[@2x].png|json    licenses/<group>/<file>

const DB_NAME = 'personal-places-map-assets';
const STORE = 'assets';

const FONT = /(?:^|\/)fonts\/([^/]+)\/(\d+-\d+)\.pbf$/i;
const SPRITE = /(?:^|\/)sprites\/(?:v\d+\/)?([^/@]+)(@2x)?\.(png|json)$/i;
const LICENSE = /(?:^|\/)(fonts|sprites)\/(OFL\.txt|LICEN[CS]E[^/]*)$/i;

/** Where a file from an upload belongs (or null if it isn't one of ours). Works for zip entries and folder paths. */
export function classifyAssetPath(raw) {
  const path = String(raw).replace(/\\/g, '/');
  let m = FONT.exec(path);
  if (m) return `fonts/${m[1]}/${m[2]}.pbf`;
  m = SPRITE.exec(path);
  if (m) return `sprites/${m[1]}${m[2] ? '@2x' : ''}.${m[3].toLowerCase()}`;
  m = LICENSE.exec(path);
  if (m) return `licenses/${m[1].toLowerCase()}/${m[2]}`;
  return null;
}

/** { fonts: [names], sprites: [themes with both a picture and a description], licenses: [paths] } */
export function summarizeAssets(paths) {
  const fonts = new Set();
  const sheets = new Map();
  const licenses = [];
  for (const path of paths) {
    const [group, name] = path.split('/');
    if (group === 'fonts') fonts.add(name);
    else if (group === 'licenses') licenses.push(path);
    else if (group === 'sprites') {
      const [, theme, ext] = /^sprites\/(.+?)(?:@2x)?\.(png|json)$/.exec(path) ?? [];
      if (theme) sheets.set(theme, new Set([...(sheets.get(theme) ?? []), ext]));
    }
  }
  const sprites = [...sheets].filter(([, exts]) => exts.has('png') && exts.has('json')).map(([theme]) => theme).sort();
  return { fonts: [...fonts].sort(), sprites, licenses: licenses.sort() };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('IndexedDB is not available')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'path' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = resolve;
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
});

export function createAssetStore() {
  let dbPromise;
  const db = () => (dbPromise ??= openDatabase());

  return {
    /** Stored paths (never loads file contents). */
    async list() {
      const tx = (await db()).transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAllKeys();
      await done(tx);
      return request.result;
    },

    /** The stored file as a Blob, or undefined. */
    async get(path) {
      const tx = (await db()).transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(path);
      await done(tx);
      return request.result?.blob;
    },

    /** entries: [{ path, blob }] stored in one step (replacing files with the same path). */
    async putMany(entries) {
      const tx = (await db()).transaction(STORE, 'readwrite');
      for (const { path, blob } of entries) tx.objectStore(STORE).put({ path, blob });
      await done(tx);
    },

    async clear() {
      const tx = (await db()).transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      await done(tx);
    },
  };
}
