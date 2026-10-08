// Reads selected files out of a .zip (like GitHub's "Download ZIP") without loading all of it into memory.
// Supports stored and deflate entries (everything zip tools produce by default); not ZIP64.

export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZipError';
  }
}

const u16 = (view, at) => view.getUint16(at, true);
const u32 = (view, at) => view.getUint32(at, true);
const bytesOf = (blob, start, end) => blob.slice(start, end).arrayBuffer();

/**
 * Returns [{ path, blob }] for every file entry whose name `pick(name)` maps to a path (null = skip it).
 * Entries are decompressed one at a time.
 */
export async function readZip(blob, pick) {
  const tailStart = Math.max(0, blob.size - 65557);
  const tail = new DataView(await bytesOf(blob, tailStart, blob.size));
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError("This isn't a ZIP file.");
  const count = u16(tail, eocd + 10);
  const dirSize = u32(tail, eocd + 12);
  const dirStart = u32(tail, eocd + 16);
  if (count === 0xffff || dirStart === 0xffffffff) throw new ZipError('This ZIP file is too large (ZIP64). Extract it and add the folder instead.');

  const dirBuffer = await bytesOf(blob, dirStart, dirStart + dirSize);
  const dir = new DataView(dirBuffer);
  const names = new TextDecoder();
  const entries = [];
  let at = 0;
  for (let n = 0; n < count && at + 46 <= dir.byteLength; n++) {
    if (u32(dir, at) !== 0x02014b50) throw new ZipError('This ZIP file is damaged.');
    const nameLength = u16(dir, at + 28);
    const extraLength = u16(dir, at + 30);
    const commentLength = u16(dir, at + 32);
    const name = names.decode(new Uint8Array(dirBuffer, at + 46, nameLength));
    const path = name.endsWith('/') ? null : pick(name);
    if (path) entries.push({ path, method: u16(dir, at + 10), size: u32(dir, at + 20), offset: u32(dir, at + 42) });
    at += 46 + nameLength + extraLength + commentLength;
  }

  const files = [];
  for (const entry of entries) {
    const head = new DataView(await bytesOf(blob, entry.offset, entry.offset + 30));
    if (u32(head, 0) !== 0x04034b50) throw new ZipError('This ZIP file is damaged.');
    const start = entry.offset + 30 + u16(head, 26) + u16(head, 28);
    const data = blob.slice(start, start + entry.size);
    if (entry.method === 0) files.push({ path: entry.path, blob: data });
    else if (entry.method === 8) {
      const inflated = new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw')));
      files.push({ path: entry.path, blob: await inflated.blob() });
    } else throw new ZipError('This ZIP file uses a compression method that is not supported.');
  }
  return files;
}
