// Where the map's picture tiles come from: your own server, or OpenStreetMap.
// The rest of the app only deals in "sources": { kind: 'osm' } or { kind: 'custom', url, attribution }.
import { OSM_ATTRIBUTION, OSM_TILE_URL } from './config.js';
import { GLYPH_URL } from './glyphs.js';

/** MapLibre appends .json / .png / @2x.png to this; localMaps.js answers from the user's uploaded sprite files. */
export const spriteUrl = (theme) => `spriteasset://sprites/${theme}`;

export const osmSource = () => ({ kind: 'osm' });
export const customSource = (url, attribution) => ({ kind: 'custom', url: url.trim(), attribution: attribution ?? '' });
/** Offline map files drawn first; `online` (an osm/custom source, or null) fills in beyond them. */
/** Offline mode with no map files: nothing to draw but the background. */
export const noneSource = () => ({ kind: 'none' });
export const localSource = (files, online, labels = false, sprite = null) => ({ kind: 'local', files, online: online ?? null, labels, sprite });

export function sourceLabel(source) {
  if (source.kind === 'osm') return 'OpenStreetMap';
  if (source.kind === 'none') return 'no map (offline mode, no map files added)';
  if (source.kind === 'custom') return 'your tile server';
  if (!source.online) return 'your offline map files only';
  return `your offline map files, with ${sourceLabel(source.online)} beyond them`;
}

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

/** Raster tile address + attribution for an online source, or null (a whole-style .json can't be layered). */
function onlineRaster(source) {
  if (!source) return null;
  if (source.kind === 'osm') return { tiles: OSM_TILE_URL, attribution: OSM_ATTRIBUTION };
  if (source.kind === 'custom' && !isStyleUrl(source.url)) return { tiles: source.url, attribution: source.attribution };
  return null;
}

// Plain colours. Text is optional (labels: true) and uses glyphs made on the device (glyphs.js), so it needs no server.
const LAND = '#e9e6dc';
const WATER = '#bcd7e6';
const ROAD = '#cfc9ba';
const BORDER = '#8e9aa3';

// Layer and property names follow the Protomaps basemap schema. Text uses the font names of Protomaps' basemaps-assets
// (Noto Sans Regular / Medium / Italic): if the user added those files they are used, otherwise glyphs.js makes
// look-alikes from the device's fonts. Points of interest are dots, plus icons when a sprite sheet was added.
const kind = ['to-string', ['coalesce', ['get', 'pmap:kind'], ['get', 'kind'], '']];
const oneOf = (...values) => ['in', kind, ['literal', values]];
const zoomSize = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];

function labelLayers(prefix, source, sprite) {
  const text = (id, sourceLayer, filter, layout, paint = {}, extra = {}) => ({
    id: `${prefix}${id}`, type: 'symbol', source, 'source-layer': sourceLayer, filter,
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], ...layout },
    paint: { 'text-color': '#33444b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5, ...paint },
    ...extra,
  });
  return [
    text('water-label', 'water', ['has', 'name'], { 'text-size': 12, 'text-font': ['Noto Sans Italic'] }, { 'text-color': '#3f7396' }, { minzoom: 3 }),
    text('roads-label', 'roads', ['all', ['has', 'name'], oneOf('highway', 'major_road', 'medium_road', 'minor_road')],
      { 'symbol-placement': 'line', 'text-size': zoomSize(12, 10, 18, 14) }, {}, { minzoom: 12 }),
    { id: `${prefix}pois-dot`, type: 'circle', source, 'source-layer': 'pois', minzoom: 14, ...(sprite ? { maxzoom: 15 } : {}),
      paint: { 'circle-radius': 3, 'circle-color': '#8a6d3b', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } },
    text('pois-label', 'pois', ['has', 'name'],
      sprite
        ? { 'text-size': 11, 'text-anchor': 'left', 'text-offset': [1.3, 0], 'text-optional': true, 'icon-optional': true, 'icon-image': ['image', kind] }
        : { 'text-size': 11, 'text-anchor': 'left', 'text-offset': [0.7, 0] },
      { 'text-color': '#6b5a3a' }, { minzoom: 15 }),
    text('neighbourhood-label', 'places', oneOf('neighbourhood', 'macrohood'),
      { 'text-size': 11, 'text-transform': 'uppercase', 'text-letter-spacing': 0.08 }, { 'text-color': '#5a6b72' }, { minzoom: 12 }),
    text('locality-label', 'places', ['==', kind, 'locality'],
      { 'text-size': zoomSize(5, 12, 12, 16), 'symbol-sort-key': ['*', -1, ['to-number', ['coalesce', ['get', 'population'], 0], 0]] }, {}, { minzoom: 4 }),
    text('region-label', 'places', ['==', kind, 'region'],
      { 'text-size': 12, 'text-transform': 'uppercase', 'text-letter-spacing': 0.1 }, { 'text-color': '#6a7a82' }, { minzoom: 4, maxzoom: 9 }),
    text('country-label', 'places', ['==', kind, 'country'],
      { 'text-size': zoomSize(1, 11, 6, 18), 'text-font': ['Noto Sans Medium'] }, { 'text-color': '#44545c' }),
  ];
}

function vectorLayers(prefix, source, minzoom, labels, sprite) {
  const layers = [
    { id: `${prefix}earth`, type: 'fill', source, 'source-layer': 'earth', paint: { 'fill-color': LAND } },
    { id: `${prefix}water`, type: 'fill', source, 'source-layer': 'water', paint: { 'fill-color': WATER } },
    { id: `${prefix}boundaries`, type: 'line', source, 'source-layer': 'boundaries',
      paint: { 'line-color': BORDER, 'line-opacity': 0.8, 'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.4, 10, 1.2] } },
    { id: `${prefix}roads`, type: 'line', source, 'source-layer': 'roads',
      paint: { 'line-color': ROAD, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 6, 0.3, 18, 10] } },
    ...(labels ? labelLayers(prefix, source, sprite) : []),
  ];
  return minzoom === undefined ? layers : layers.map((l) => ({ ...l, minzoom: Math.max(l.minzoom ?? 0, minzoom) }));
}

/**
 * Style for offline map files (Protomaps-schema vector files, or raster files).
 * Layer order, bottom to top:
 *   1. background (sea colour)
 *   2. the lowest-detail files (e.g. a worldwide z0-6 file), visible at every zoom (over-zoomed past their max)
 *   3. the online map, only from the zoom just past those files; if it can't load, the files below show through
 *   4. higher-detail files (regional extracts), from that same zoom, covering their own area
 * With labels, vector files also get place, road, water and point-of-interest names (and dots for the latter).
 */
export function localStyle(files, online, labels = false, sprite = null) {
  const sorted = [...files].sort((a, b) => a.maxZoom - b.maxZoom || a.name.localeCompare(b.name));
  const lowMax = sorted[0].maxZoom;
  const raster = onlineRaster(online);
  const sources = {};
  const layers = [{ id: 'background', type: 'background', paint: { 'background-color': WATER } }];

  const addFile = (file, index, minzoom) => {
    const id = `file${index}`;
    sources[id] = { type: file.kind === 'vector' ? 'vector' : 'raster', url: `pmtiles://${file.key}`, attribution: OSM_ATTRIBUTION };
    if (file.kind === 'raster') sources[id].tileSize = 256;
    layers.push(...(file.kind === 'vector'
      ? vectorLayers(`${id}-`, id, minzoom, labels, sprite)
      : [{ id: `${id}-raster`, type: 'raster', source: id, ...(minzoom === undefined ? {} : { minzoom }) }]));
  };

  sorted.forEach((file, i) => { if (file.maxZoom === lowMax) addFile(file, i); });
  if (raster) {
    sources.online = { type: 'raster', tiles: [raster.tiles], tileSize: 256, maxzoom: 19, attribution: raster.attribution };
    layers.push({ id: 'online', type: 'raster', source: 'online', minzoom: lowMax + 1 });
  }
  sorted.forEach((file, i) => { if (file.maxZoom !== lowMax) addFile(file, i, lowMax + 1); });
  const text = labels && files.some((f) => f.kind === 'vector');
  return { version: 8, sources, layers, ...(text ? { glyphs: GLYPH_URL } : {}), ...(text && sprite ? { sprite: spriteUrl(sprite) } : {}) };
}

/** A MapLibre `style` value (object or URL string) for a source. */
export function styleFor(source) {
  if (source.kind === 'osm') return rasterStyle(OSM_TILE_URL, OSM_ATTRIBUTION);
  if (source.kind === 'none') return BLANK_STYLE;
  if (source.kind === 'local') return localStyle(source.files, source.online, source.labels, source.sprite);
  if (isStyleUrl(source.url)) return source.url;
  return rasterStyle(source.url, source.attribution);
}

/**
 * Is the server reachable at all? Uses a no-cors request, which succeeds on ANY HTTP answer
 * (even a 404 for a tile outside a regional extract) and fails only when the server can't be
 * reached, so "no tile here" isn't mistaken for "server down".
 */
export async function probeSource(source, timeoutMs = 4000) {
  if (source.kind === 'osm' || source.kind === 'local' || source.kind === 'none') return true;
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
