// Glue between stored .pmtiles files and MapLibre, via the `pmtiles` library (loaded by a
// script tag in index.html). Each file is exposed to the map as  pmtiles://<key>.

import { GLYPH_SCHEME, canvasGlyphDrawer, glyphRangeBytes } from './glyphs.js';

let protocol = null;

export const localMapsSupported = () =>
  Boolean(globalThis.pmtiles?.Protocol && globalThis.pmtiles?.PMTiles && globalThis.maplibregl?.addProtocol);

/** Reads byte ranges straight from a File/Blob (the PMTiles library's "Source" interface). */
class BlobSource {
  constructor(blob, key) {
    this.blob = blob;
    this.key = key;
  }

  getKey() { return this.key; }

  async getBytes(offset, length) {
    return { data: await this.blob.slice(offset, offset + length).arrayBuffer() };
  }
}

/** Serves MapLibre's glyph requests (fontsdf://<font>/<start>-<end>.pbf) from the device's own fonts. */
function registerGlyphProtocol() {
  const draw = canvasGlyphDrawer();
  const cache = new Map();
  globalThis.maplibregl.addProtocol(GLYPH_SCHEME, async (params) => {
    const match = /\/\/(.+)\/(\d+)-(\d+)\.pbf/.exec(params.url);
    if (!match) throw new Error(`Unexpected glyph address: ${params.url}`);
    let stack = match[1];
    try { stack = decodeURIComponent(stack); } catch { /* already plain */ }
    const key = `${stack}/${match[2]}`;
    if (!cache.has(key)) cache.set(key, glyphRangeBytes(stack, Number(match[2]), Number(match[3]), draw));
    return { data: cache.get(key).slice().buffer };
  });
}

export const keyFor = (name) => 'local-' + name.replace(/[^A-Za-z0-9._-]/g, '_');

/**
 * Makes the stored files readable by the map. Returns descriptors for tiles.js:
 * [{ key, name, kind, minZoom, maxZoom }]. Files that can't be opened are skipped.
 */
export async function registerLocalFiles(fileStore, metas) {
  if (!localMapsSupported()) return [];
  if (!protocol) {
    protocol = new globalThis.pmtiles.Protocol();
    globalThis.maplibregl.addProtocol('pmtiles', protocol.tile);
    registerGlyphProtocol();
  }
  const files = [];
  for (const meta of metas) {
    const blob = await fileStore.get(meta.name);
    if (!blob) continue;
    const key = keyFor(meta.name);
    protocol.add(new globalThis.pmtiles.PMTiles(new BlobSource(blob, key)));
    files.push({ key, name: meta.name, kind: meta.header.kind, minZoom: meta.header.minZoom, maxZoom: meta.header.maxZoom });
  }
  return files;
}
