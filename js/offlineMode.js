// Offline mode needs the service worker's cooperation (its background refreshes are network requests too),
// and a service worker can't read localStorage, so the on/off flag is shared as an entry in a small cache.
const FLAG_CACHE = 'offline-flag-places-map'; // not "places-map-*": sw.js deletes those on update
const flagUrl = () => new URL('offline-mode', location.href).href; // same address the worker computes from sw.js

export async function setOfflineFlag(on) {
  try {
    if (!('caches' in globalThis)) return;
    const cache = await caches.open(FLAG_CACHE);
    if (on) await cache.put(flagUrl(), new Response('1'));
    else await cache.delete(flagUrl());
  } catch { /* best effort: the setting itself still stops the page's own requests */ }
}

/** Are the map library files (script/style tags from another host) saved by the service worker? */
export async function libraryCached() {
  try {
    if (!('caches' in globalThis)) return false;
    const urls = [...document.querySelectorAll('script[src^="https://"], link[rel="stylesheet"][href^="https://"]')]
      .map((el) => el.src || el.href);
    const hits = await Promise.all(urls.map((url) => caches.match(url)));
    return hits.every(Boolean);
  } catch {
    return false;
  }
}
