// Where the map's picture tiles come from: your own server, or OpenStreetMap.
// The rest of the app only deals in "sources": { kind: 'osm' } or { kind: 'custom', url, attribution }.
import { OSM_ATTRIBUTION, OSM_TILE_URL } from './config.js';

export const osmSource = () => ({ kind: 'osm' });
export const customSource = (url, attribution) => ({ kind: 'custom', url: url.trim(), attribution: attribution ?? '' });
export const sourceLabel = (source) => (source.kind === 'osm' ? 'OpenStreetMap' : 'your tile server');

export const isStyleUrl = (url) => /\.json(\?.*)?$/i.test(url);

/** Returns an error message for a bad tile address, or null if it's fine (or empty). */
export function validateTileUrl(url) {
  const value = (url ?? '').trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return 'Start the address with https://';
  if (!isStyleUrl(value) && !['{z}', '{x}', '{y}'].every((token) => value.includes(token))) {
    return 'A tile address needs {z}, {x} and {y} in it, or point to a style .json file.';
  }
  const onHttps = globalThis.location?.protocol === 'https:';
  if (onHttps && /^http:\/\//i.test(value) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(value)) {
    return 'Browsers block plain http:// addresses from an https site. Use https://.';
  }
  return null;
}

const rasterStyle = (tiles, attribution) => ({
  version: 8,
  sources: { basemap: { type: 'raster', tiles: [tiles], tileSize: 256, maxzoom: 19, attribution } },
  layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
});

/** Shown while we work out which source to use. */
export const BLANK_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dfe7ea' } }],
};

/** A MapLibre `style` value (object or URL string) for a source. */
export function styleFor(source) {
  if (source.kind === 'osm') return rasterStyle(OSM_TILE_URL, OSM_ATTRIBUTION);
  if (isStyleUrl(source.url)) return source.url;
  return rasterStyle(source.url, source.attribution);
}

/**
 * Is the server reachable at all? Uses a no-cors request, which succeeds on ANY HTTP answer
 * (even a 404 for a tile outside a regional extract) and fails only when the server can't be
 * reached, so "no tile here" isn't mistaken for "server down".
 */
export async function probeSource(source, timeoutMs = 4000) {
  if (source.kind === 'osm') return true;
  const url = isStyleUrl(source.url)
    ? source.url
    : source.url.split('{z}').join('0').split('{x}').join('0').split('{y}').join('0');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
