// Text on offline maps. MapLibre draws labels from "glyph" files (font data in a protobuf format) that normally come
// from a server. Offline there is no server, so this makes them on the fly from the fonts already on the device:
// each character is drawn on a canvas, turned into a signed distance field (what MapLibre expects), and packed into
// the same protobuf. MapLibre asks for them through the custom address GLYPH_URL (see localMaps.js).

export const GLYPH_SCHEME = 'fontsdf';
export const GLYPH_URL = `${GLYPH_SCHEME}://{fontstack}/{range}.pbf`;

const FONT_SIZE = 24; // MapLibre's own on-device glyph settings; its text layout assumes these
const BUFFER = 3; // the border MapLibre expects around every glyph bitmap
const RADIUS = 8;
const CUTOFF = 0.25;
const CANVAS_SIZE = FONT_SIZE + BUFFER * 4;
const TOP_OFFSET = 27; // MapLibre's own correction between a font's ascent and the glyph "top" in a glyph file
const INF = 1e20;

/* ---------- signed distance field (the Euclidean distance transform used by Mapbox's TinySDF) ---------- */

function edt1d(grid, offset, stride, length, f, v, z) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset];
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride];
    const q2 = q * q;
    do {
      const r = v[k];
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    const d = q - r;
    grid[offset + q * stride] = f[r] + d * d;
  }
}

function edt(data, width, height, f, v, z) {
  for (let x = 0; x < width; x++) edt1d(data, x, width, height, f, v, z);
  for (let y = 0; y < height; y++) edt1d(data, y * width, 1, width, f, v, z);
}

/** One-channel coverage (0-255, width x height) -> distance field bytes: 255 inside, ~191 at the edge, 0 far outside. */
export function alphaToSdf(alpha, width, height, radius = RADIUS, cutoff = CUTOFF) {
  const n = width * height;
  const outer = new Float64Array(n);
  const inner = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = alpha[i] / 255;
    outer[i] = a === 1 ? 0 : a === 0 ? INF : Math.max(0, 0.5 - a) ** 2;
    inner[i] = a === 1 ? INF : a === 0 ? 0 : Math.max(0, a - 0.5) ** 2;
  }
  const size = Math.max(width, height) + 1;
  const [f, v, z] = [new Float64Array(size), new Uint16Array(size), new Float64Array(size + 1)];
  edt(outer, width, height, f, v, z);
  edt(inner, width, height, f, v, z);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.sqrt(outer[i]) - Math.sqrt(inner[i]);
    out[i] = Math.max(0, Math.min(255, Math.round(255 - 255 * (d / radius + cutoff))));
  }
  return out;
}

/* ---------- the glyph file format (protobuf) ---------- */

const text = new TextEncoder();

function varint(out, n) {
  while (n > 127) { out.push((n & 127) | 128); n >>>= 7; }
  out.push(n);
}
const zigzag = (n) => ((n << 1) ^ (n >> 31)) >>> 0;
const numberField = (out, tag, n) => { varint(out, tag << 3); varint(out, n); };
function bytesField(out, tag, bytes) {
  varint(out, (tag << 3) | 2);
  varint(out, bytes.length);
  for (const b of bytes) out.push(b);
}

/**
 * glyphs: [{ id, width, height, left, top, advance, bitmap? }]. A bitmap (distance field including the 3 px border)
 * must be (width + 6) x (height + 6) bytes; glyphs with nothing to draw, such as a space, omit it.
 */
export function encodeGlyphRange(stackName, range, glyphs) {
  const stack = [];
  bytesField(stack, 1, text.encode(stackName));
  bytesField(stack, 2, text.encode(range));
  for (const g of glyphs) {
    const m = [];
    numberField(m, 1, g.id);
    if (g.bitmap) bytesField(m, 2, g.bitmap);
    numberField(m, 3, g.width ?? 0);
    numberField(m, 4, g.height ?? 0);
    numberField(m, 5, zigzag(g.left ?? 0));
    numberField(m, 6, zigzag(g.top ?? 0));
    numberField(m, 7, g.advance ?? 0);
    bytesField(stack, 3, m);
  }
  const out = [];
  bytesField(out, 1, stack);
  return Uint8Array.from(out);
}

/** The glyph file for characters start..end of a font stack. draw(char, stackName) -> a glyph without id, or null. */
export function glyphRangeBytes(stackName, start, end, draw) {
  const glyphs = [];
  for (let id = start; id <= end; id++) {
    if (id < 32 || (id >= 0x7f && id < 0xa0) || (id >= 0xd800 && id <= 0xdfff)) continue; // controls, lone surrogates
    const glyph = draw(String.fromCodePoint(id), stackName);
    if (glyph) glyphs.push({ id, ...glyph });
  }
  return encodeGlyphRange(stackName, `${start}-${end}`, glyphs);
}

/* ---------- drawing characters with the device's fonts (browser only) ---------- */

const FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';

/** Returns draw(char, stackName) for glyphRangeBytes. "Bold" / "Italic" in the font name pick that style. */
export function canvasGlyphDrawer() {
  let ctx = null;
  return (char, stackName) => {
    if (!ctx) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = CANVAS_SIZE;
      ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#000';
    }
    ctx.font = `${/italic/i.test(stackName) ? 'italic ' : ''}${/bold/i.test(stackName) ? 'bold ' : ''}${FONT_SIZE}px ${FAMILY}`;
    const m = ctx.measureText(char);
    const advance = Math.round(m.width);
    const ascent = Math.ceil(m.actualBoundingBoxAscent);
    const width = Math.min(CANVAS_SIZE - BUFFER, Math.ceil(m.actualBoundingBoxRight - m.actualBoundingBoxLeft));
    const height = Math.min(CANVAS_SIZE - BUFFER, Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent));
    const blank = { width: 0, height: 0, left: 0, top: 0, advance };
    if (width <= 0 || height <= 0) return blank;

    const w = width + BUFFER * 2;
    const h = height + BUFFER * 2;
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.fillText(char, BUFFER, BUFFER + ascent);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const alpha = new Uint8ClampedArray(w * h);
    let ink = false;
    for (let i = 0; i < alpha.length; i++) { alpha[i] = rgba[i * 4 + 3]; if (alpha[i]) ink = true; }
    if (!ink) return blank;
    return { width, height, left: 0, top: ascent - TOP_OFFSET, advance, bitmap: alphaToSdf(alpha, w, h) };
  };
}
