// Service worker: installable PWA, offline app shell, and a polite cache for map tiles.
//
// App files + MapLibre library: stale-while-revalidate.
// Map tiles (any GET whose path ends in /z/x/y[.ext]): cache-first for 7 days, which is
//   OpenStreetMap's stated minimum for caching, then refreshed; if the network fails the
//   old copy is served. Only tiles that were actually requested are stored: no prefetching,
//   no bulk download. The cache is capped, oldest tiles dropped first.
//
// To ship an app update: change VERSION. Old app caches are deleted on activate.
// (The tile cache has its own name, so updates don't throw your cached tiles away.)
//
// Offline mode (a setting the page mirrors into the small OFFLINE_FLAG cache, since a worker can't read
// localStorage): nothing is fetched from the network for other hosts, ever, and app files are served from
// the cache without the background refresh. A request for one of our own files that was never cached still
// goes to our own host as a last resort; anything else just fails.
const VERSION = 'v8';
const CACHE = `places-map-${VERSION}`;
const TILE_CACHE = 'tiles-places-map';
const OFFLINE_FLAG = 'offline-flag-places-map';
const OFFLINE_URL = new URL('./offline-mode', self.location).href;

const TILE_PATH = /\/\d{1,2}\/\d+\/\d+(\.[a-z0-9]+)?$/i;
const TILE_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const TILE_MAX_ENTRIES = 1200; // roughly 25-40 MB of raster tiles
const LIBRARY_HOST = 'cdn.jsdelivr.net';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/main.js',
  './js/config.js',
  './js/dates.js',
  './js/dialog.js',
  './js/dom.js',
  './js/exportImport.js',
  './js/geo.js',
  './js/geolocation.js',
  './js/importReview.js',
  './js/mapFiles.js',
  './js/localMaps.js',
  './js/mapView.js',
  './js/merge.js',
  './js/pmtilesHeader.js',
  './js/offlineMode.js',
  './js/rating.js',
  './js/ramp.js',
  './js/repository.js',
  './js/schema.js',
  './js/settings.js',
  './js/store.js',
  './js/tagPicker.js',
  './js/tags.js',
  './js/tiles.js',
  './js/timeline.js',
  './js/toast.js',
  './js/validation.js',
  './js/views.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('places-map-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(respond(event));
});

async function offlineMode() {
  try { return Boolean(await (await caches.open(OFFLINE_FLAG)).match(OFFLINE_URL)); } catch { return false; }
}

async function respond(event) {
  const { request } = event;
  const url = new URL(request.url);
  const ours = url.origin === self.location.origin;

  if (await offlineMode()) return cacheOnly(request, ours);
  // Reachability probes ask for a fresh answer; never answer those from cache.
  if (request.cache === 'no-store' || request.cache === 'reload') return fetch(request);
  if (TILE_PATH.test(url.pathname)) return tileResponse(event);
  if (!ours && url.hostname !== LIBRARY_HOST) return fetch(request);
  return staleWhileRevalidate(event);
}

/** Offline mode: whatever is saved (app files, library, tiles), with no refresh. */
async function cacheOnly(request, ours) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  if (request.mode === 'navigate') return (await caches.match('./index.html')) ?? Response.error();
  return ours ? fetch(request).catch(() => Response.error()) : Response.error();
}

async function staleWhileRevalidate(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const response = await refresh;
  if (response) return response;
  if (request.mode === 'navigate') return (await cache.match('./index.html')) ?? Response.error();
  return Response.error();
}

async function tileResponse(event) {
  const { request } = event;
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  const age = cached ? Date.now() - Number(cached.headers.get('x-cached-at') || 0) : Infinity;
  if (cached && age < TILE_FRESH_MS) return cached;
  try {
    const response = await fetch(request);
    // Opaque responses can't be re-wrapped with a timestamp, so they are passed through uncached.
    if (response.ok && response.type !== 'opaque') event.waitUntil(storeTile(cache, request, response.clone()));
    return response;
  } catch {
    return cached ?? Response.error(); // offline: an old tile beats no tile
  }
}

async function storeTile(cache, request, response) {
  const headers = new Headers(response.headers);
  headers.set('x-cached-at', String(Date.now()));
  headers.delete('vary'); // we key on the URL alone
  const body = await response.blob();
  await cache.put(request, new Response(body, { status: response.status, statusText: response.statusText, headers }));
  const keys = await cache.keys();
  if (keys.length > TILE_MAX_ENTRIES) {
    await Promise.all(keys.slice(0, keys.length - TILE_MAX_ENTRIES).map((key) => cache.delete(key)));
  }
}
