// Reads the 127-byte header of a PMTiles v3 archive (https://github.com/protomaps/PMTiles).
// We parse it ourselves so a picked file can be checked, and described to the user, before
// it's stored, without needing the PMTiles library to have loaded.

export class MapFileError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MapFileError';
  }
}

export const HEADER_BYTES = 127;

/** Parses a header from the first 127 bytes. Returns a plain summary or throws MapFileError. */
export function parseHeader(buffer) {
  if (buffer.byteLength < HEADER_BYTES) throw new MapFileError("This file is too small to be a PMTiles map file.");
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 7));
  if (magic !== 'PMTiles') throw new MapFileError("This isn't a PMTiles map file (.pmtiles).");
  const version = view.getUint8(7);
  if (version !== 3) throw new MapFileError(`This PMTiles file is version ${version}; only version 3 is supported.`);

  const tileType = view.getUint8(99);
  let kind;
  if (tileType === 1) kind = 'vector';
  else if (tileType >= 2 && tileType <= 5) kind = 'raster';
  else throw new MapFileError("This map file doesn't say what kind of tiles it holds, so it can't be used.");

  return {
    version,
    kind,
    tileType,
    tileCompression: view.getUint8(98),
    minZoom: view.getUint8(100),
    maxZoom: view.getUint8(101),
    minLon: view.getInt32(102, true) / 1e7,
    minLat: view.getInt32(106, true) / 1e7,
    maxLon: view.getInt32(110, true) / 1e7,
    maxLat: view.getInt32(114, true) / 1e7,
  };
}

export async function readHeader(blob) {
  return parseHeader(await blob.slice(0, HEADER_BYTES).arrayBuffer());
}
