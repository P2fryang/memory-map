// Plain-Node tests for everything without a DOM: validation, migration, store, export/import,
// merge, timeline, geo, tile-address checks.   Run with:  node tests/run.mjs
import assert from 'node:assert/strict';
import { validatePlaceBase, validateVisitFields } from '../js/validation.js';
import { buildExport, parseImport, ImportError } from '../js/exportImport.js';
import { createStore } from '../js/store.js';
import { DEFAULT_TIME, isValidDateString, isValidTimeString } from '../js/dates.js';
import { migratePlaceV1, isLegacyPlace, latestVisit, sortVisits } from '../js/schema.js';
import { planMerge, applyMerge, mergePlaces, clashingVisits } from '../js/merge.js';
import { buildTimeline } from '../js/timeline.js';
import { DEFAULT_RAMP as RAMP, isHexColor, rampColor } from '../js/ramp.js';
import { distanceMeters, nearestPlace } from '../js/geo.js';
import { validateTileUrl, noneSource, probeSource, BLANK_STYLE, styleFor, osmSource, customSource, localSource, localStyle, sourceLabel } from '../js/tiles.js';
import { parseHeader, MapFileError } from '../js/pmtilesHeader.js';
import { alphaToSdf, encodeGlyphRange, glyphRangeBytes } from '../js/glyphs.js';
import { keyFor } from '../js/localMaps.js';
import { loadSettings } from '../js/settings.js';
import { normalizeTag, normalizeTags, placeTags, tagStats, topTags, matchesTags, filterPlaces, pruneFilter } from '../js/tags.js';

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (err) { console.error('  FAIL', name, '\n', err); process.exitCode = 1; }
}

const T = '2026-10-04T17:32:00.000Z';
const visit = (id, date, extra = {}) => ({ id, date, photos: [], createdAt: T, updatedAt: T, ...extra });
const place = (id, name, visits, extra = {}) => ({ id, name, latitude: 35.6762, longitude: 139.6503, visits, createdAt: T, updatedAt: T, ...extra });
const base = { name: ' Ramen ', latitude: 35.6762, longitude: 139.6503 };
const v1 = { id: 'abc123', latitude: 35.6762, longitude: 139.6503, name: 'Some Restaurant', date: '2026-10-04', rating: 5, notes: 'Fantastic.', photos: [], createdAt: T, updatedAt: T };

/* ---------- validation ---------- */
await test('place base: name required, coordinates range-checked', () => {
  assert.equal(validatePlaceBase(base).value.name, 'Ramen');
  assert.ok(validatePlaceBase({ ...base, name: '  ' }).errors.name);
  assert.ok(validatePlaceBase({ ...base, latitude: 91 }).errors.latitude);
  assert.ok(validatePlaceBase({ ...base, longitude: -181 }).errors.longitude);
  assert.ok(validatePlaceBase({ ...base, latitude: NaN }).errors.latitude);
  assert.ok(validatePlaceBase({ ...base, latitude: '10' }).errors.latitude);
  assert.deepEqual(validatePlaceBase({ ...base, latitude: -90, longitude: 180 }).errors, {});
});
await test('visit: date required and real; rating optional integer 1-5; notes trimmed', () => {
  assert.ok(validateVisitFields({ date: '' }).errors.date);
  assert.ok(validateVisitFields({ date: '2026-02-29' }).errors.date);
  assert.equal(isValidDateString('2028-02-29'), true);
  for (const bad of [0, 6, 3.5, '4']) assert.ok(validateVisitFields({ date: '2026-01-01', rating: bad }).errors.rating, String(bad));
  const ok = validateVisitFields({ date: '2026-01-01', rating: null, notes: '  hi  ' });
  assert.deepEqual(ok.errors, {});
  assert.equal('rating' in ok.value, false);
  assert.equal(ok.value.notes, 'hi');
  assert.ok(validateVisitFields({ date: '2026-01-01', photos: [1] }).errors.photos);
});

/* ---------- migration ---------- */
await test('v1 place becomes a v2 place with one deterministic visit', () => {
  assert.equal(isLegacyPlace(v1), true);
  const m = migratePlaceV1(v1);
  assert.equal(isLegacyPlace(m), false);
  assert.equal(m.visits.length, 1);
  assert.deepEqual(m.visits[0], { id: 'abc123:v1', date: '2026-10-04', photos: [], createdAt: T, updatedAt: T, rating: 5, notes: 'Fantastic.' });
  assert.equal('date' in m || 'rating' in m || 'notes' in m, false);
  assert.deepEqual(migratePlaceV1(migratePlaceV1(v1)), m); // idempotent
});
await test('store.load upgrades v1 records already in the local database, once', async () => {
  const repo = memoryRepo([structuredClone(v1)]);
  const store = createStore(repo);
  await store.load();
  assert.equal(store.places[0].visits[0].date, '2026-10-04');
  assert.equal(repo._rows()[0].visits.length, 1); // written back
  assert.equal(repo._writes.replaceAll, 1);
  await createStore(repo).load();
  assert.equal(repo._writes.replaceAll, 1); // already v2: no rewrite
});

/* ---------- store ---------- */
function memoryRepo(seed = []) {
  let rows = structuredClone(seed);
  const writes = { replaceAll: 0 };
  return {
    getAll: async () => structuredClone(rows),
    create: async (p) => { rows.push(structuredClone(p)); },
    update: async (p) => { rows = rows.map((r) => (r.id === p.id ? structuredClone(p) : r)); },
    delete: async (id) => { rows = rows.filter((r) => r.id !== id); },
    replaceAll: async (ps) => { writes.replaceAll++; rows = structuredClone(ps); },
    _rows: () => rows,
    _writes: writes,
  };
}
const newPlace = (store, extra = {}) => store.addPlace({ ...base, visit: { date: '2026-10-04', rating: 5, notes: 'Great' }, ...extra });

await test('store: addPlace creates one place with one visit; same spot twice gets distinct ids', async () => {
  const repo = memoryRepo();
  const store = createStore(repo);
  const a = await newPlace(store);
  const b = await newPlace(store);
  assert.notEqual(a.id, b.id);
  assert.equal(a.visits.length, 1);
  assert.notEqual(a.visits[0].id, b.visits[0].id);
  assert.deepEqual(a.visits[0].photos, []);
  assert.equal(repo._rows().length, 2);
});
await test('store: invalid input is rejected without saving', async () => {
  const repo = memoryRepo();
  const store = createStore(repo);
  await assert.rejects(() => store.addPlace({ ...base, name: '', visit: { date: '2026-10-04' } }), /Name is required/);
  await assert.rejects(() => store.addPlace({ ...base, visit: { date: 'nope' } }), /valid date/);
  assert.equal(repo._rows().length, 0);
});
await test('store: revisits: add, edit (clearing optional fields), remove; last visit cannot be removed', async () => {
  const store = createStore(memoryRepo());
  const p = await newPlace(store);
  const p2 = await store.addVisit(p.id, { date: '2026-11-01', rating: 3, notes: 'Slower service' });
  assert.equal(p2.visits.length, 2);
  assert.equal(store.places.length, 1); // still ONE location
  const edited = await store.updateVisit(p.id, p2.visits[1].id, { date: '2026-11-02' });
  const v = edited.visits[1];
  assert.equal(v.date, '2026-11-02');
  assert.equal('rating' in v || 'notes' in v, false);
  assert.equal(v.id, p2.visits[1].id);
  const after = await store.removeVisit(p.id, v.id);
  assert.equal(after.visits.length, 1);
  await assert.rejects(() => store.removeVisit(p.id, after.visits[0].id), /at least one visit/);
});
await test('store: updatePlace changes name/location but keeps visits and ids', async () => {
  const store = createStore(memoryRepo());
  const p = await newPlace(store);
  const q = await store.updatePlace(p.id, { name: 'Renamed', latitude: 1, longitude: 2 });
  assert.equal(q.id, p.id);
  assert.equal(q.visits.length, 1);
  assert.equal(q.name, 'Renamed');
  assert.equal(q.createdAt, p.createdAt);
});
await test('store: remove deletes the place and all its visits', async () => {
  const repo = memoryRepo();
  const store = createStore(repo);
  const p = await newPlace(store);
  await store.addVisit(p.id, { date: '2026-11-01' });
  await store.remove(p.id);
  assert.equal(store.places.length, 0);
  assert.equal(repo._rows().length, 0);
});
await test('latestVisit picks the newest date', () => {
  const p = place('p', 'P', [visit('a', '2026-01-01'), visit('b', '2026-03-01'), visit('c', '2026-02-01')]);
  assert.equal(latestVisit(p).id, 'b');
});

/* ---------- export / import ---------- */
await test('export (v2) -> import round-trips', async () => {
  const store = createStore(memoryRepo());
  const p = await newPlace(store);
  await store.addVisit(p.id, { date: '2026-11-01', rating: 2 });
  await newPlace(store, { name: 'Other' });
  const exported = JSON.parse(JSON.stringify(buildExport(store.places)));
  assert.equal(exported.version, 4);
  const { places } = parseImport(JSON.stringify(exported));
  assert.deepEqual(places.map((x) => x.id), store.places.map((x) => x.id));
  assert.equal(places[0].visits.length, 2);
});
await test('import accepts an OLD version-1 export from the first MVP and upgrades it', () => {
  const { version, places } = parseImport(JSON.stringify({ version: 1, places: [v1] }));
  assert.equal(version, 4);
  assert.equal(places[0].visits[0].id, 'abc123:v1');
  assert.equal(places[0].visits[0].rating, 5);
});
await test('import rejects bad files with readable errors', () => {
  const bad = (text, pattern) => assert.throws(() => parseImport(text), (e) => e instanceof ImportError && pattern.test(e.message), text.slice(0, 60));
  bad('not json', /valid JSON/);
  bad('[]', /doesn't look like/);
  bad('{"places":[]}', /version/);
  bad('{"version":99,"places":[]}', /newer version/);
  bad('{"version":2}', /no list of places/);
  bad(JSON.stringify({ version: 2, places: [{ ...place('x', '', [visit('a', '2026-01-01')]) }] }), /Place 1: Name is required/);
  bad(JSON.stringify({ version: 2, places: [{ ...place('x', 'A', []) }] }), /no visits/);
  bad(JSON.stringify({ version: 2, places: [place('x', 'A', [visit('a', 'bad')])] }), /visit 1: Enter a valid date/);
  bad(JSON.stringify({ version: 2, places: [place('x', 'A', [visit('a', '2026-01-01'), visit('a', '2026-01-02')])] }), /same id/);
  bad(JSON.stringify({ version: 2, places: [{ name: 'A', latitude: 0, longitude: 0, visits: [] }] }), /no id/);
  const dup = place('x', 'A', [visit('a', '2026-01-01')]);
  bad(JSON.stringify({ version: 2, places: [dup, dup] }), /share the same id/);
  bad(JSON.stringify({ version: 1, places: [{ ...v1, date: '' }] }), /Enter a valid date/);
});

/* ---------- merge ("add" import) ---------- */
const mine = () => place('p1', 'Ramen Shop', [visit('v1', '2026-01-10', { rating: 4 })]);

await test('merge: new places are added, identical ones skipped', () => {
  const plan = planMerge([mine()], [mine(), place('p2', 'Park', [visit('w1', '2026-02-01')])]);
  assert.equal(plan.identical, 1);
  assert.equal(plan.added.length, 1);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(applyMerge([mine()], plan).length, 2);
});
await test('merge: extra visits on the same place are combined automatically (no prompt)', () => {
  const incoming = place('p1', 'Ramen Shop', [visit('v1', '2026-01-10', { rating: 4 }), visit('v2', '2026-06-01', { rating: 2 })]);
  const plan = planMerge([mine()], [incoming]);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.merged.length, 1);
  assert.equal(plan.merged[0].newVisits, 1);
  const [result] = applyMerge([mine()], plan);
  assert.deepEqual(result.visits.map((v) => v.id), ['v1', 'v2']);
});
await test('merge: both sides added different visits -> union', () => {
  const a = place('p1', 'Ramen Shop', [visit('v1', '2026-01-10', { rating: 4 }), visit('onA', '2026-03-01')]);
  const b = place('p1', 'Ramen Shop', [visit('v1', '2026-01-10', { rating: 4 }), visit('onB', '2026-04-01')]);
  const [r] = applyMerge([a], planMerge([a], [b]));
  assert.deepEqual(r.visits.map((v) => v.id).sort(), ['onA', 'onB', 'v1']);
});
await test('merge: a differing name or edited visit is a conflict, and the differing visits can be listed', () => {
  const renamed = { ...mine(), name: 'Ramen House' };
  const edited = place('p1', 'Ramen Shop', [visit('v1', '2026-01-10', { rating: 1 })]);
  const plan = planMerge([mine()], [renamed]);
  assert.equal(plan.conflicts.length, 1);
  assert.deepEqual(clashingVisits(mine(), renamed), []); // only the name differs
  assert.deepEqual(clashingVisits(mine(), edited).map((c) => [c.mine.rating, c.theirs.rating]), [[4, 1]]);
  assert.equal(planMerge([mine()], [edited]).conflicts.length, 1);
});
await test('merge: each conflict resolves by the user choice (mine / theirs / merge)', () => {
  const older = { ...mine(), updatedAt: '2026-01-01T00:00:00.000Z' };
  const incoming = { ...mine(), name: 'Ramen House', updatedAt: '2026-09-01T00:00:00.000Z', visits: [visit('v1', '2026-01-10', { rating: 4 }), visit('v2', '2026-05-05')] };
  const plan = planMerge([older], [incoming]);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(applyMerge([older], plan, ['mine'])[0].name, 'Ramen Shop');
  assert.equal(applyMerge([older], plan, ['mine'])[0].visits.length, 1);
  assert.equal(applyMerge([older], plan, ['theirs'])[0].name, 'Ramen House');
  const merged = applyMerge([older], plan, ['merge'])[0];
  assert.equal(merged.name, 'Ramen House'); // newer edit wins on name
  assert.equal(merged.visits.length, 2); // and no visit is lost
  assert.equal(applyMerge([older], plan)[0].visits.length, 2); // default is merge
});
await test('merge: per-visit overrides apply on top of the place-level choice', () => {
  const t1 = '2026-01-01T00:00:00.000Z';
  const t2 = '2026-09-01T00:00:00.000Z';
  const a = place('p1', 'Ramen Shop', [visit('v1', '2026-01-10', { rating: 4, updatedAt: t1 }), visit('v2', '2026-02-10', { rating: 3, updatedAt: t1 })], { updatedAt: t1 });
  const b = place('p1', 'Ramen House', [visit('v1', '2026-01-10', { rating: 1, updatedAt: t2 }), visit('v2', '2026-02-10', { rating: 5, updatedAt: t2 }), visit('v3', '2026-03-01')], { updatedAt: t2 });
  const plan = planMerge([a], [b]);
  assert.deepEqual(clashingVisits(a, b).map((c) => c.mine.id), ['v1', 'v2']);
  const rating = (p, id) => p.visits.find((v) => v.id === id)?.rating;

  const merged = applyMerge([a], plan, [{ base: 'merge', visits: { v1: 'mine' } }])[0];
  assert.deepEqual([merged.name, merged.visits.length, rating(merged, 'v1'), rating(merged, 'v2')], ['Ramen House', 3, 4, 5]);
  const keepMine = applyMerge([a], plan, [{ base: 'mine', visits: { v2: 'theirs' } }])[0];
  assert.deepEqual([keepMine.name, keepMine.visits.length, rating(keepMine, 'v1'), rating(keepMine, 'v2')], ['Ramen Shop', 2, 4, 5]);
  const useFile = applyMerge([a], plan, [{ base: 'theirs', visits: { v1: 'mine' } }])[0];
  assert.deepEqual([useFile.name, useFile.visits.length, rating(useFile, 'v1'), rating(useFile, 'v2')], ['Ramen House', 3, 4, 5]);
  assert.equal(applyMerge([a], plan, [{ base: 'mine', visits: {} }])[0].visits.length, 2); // no overrides: base only
});
await test('merge: re-importing an old v1 export into already-migrated data adds nothing', () => {
  const local = [migratePlaceV1(v1)].map((p) => ({ ...p, visits: p.visits.map((v) => ({ ...v, time: DEFAULT_TIME })) })); // as store.load leaves it
  const { places } = parseImport(JSON.stringify({ version: 1, places: [v1] }));
  const plan = planMerge(local, places);
  assert.equal(plan.added.length + plan.merged.length + plan.conflicts.length, 0);
  assert.equal(plan.identical, 1);
});
await test('merge never drops or reorders existing places', () => {
  const ex = [mine(), place('p9', 'Zed', [visit('z', '2026-01-01')])];
  const out = applyMerge(ex, planMerge(ex, [place('n', 'New', [visit('q', '2026-01-02')])]));
  assert.deepEqual(out.map((p) => p.id), ['p1', 'p9', 'n']);
});
await test('mergePlaces: createdAt is the earliest, updatedAt the latest', () => {
  const a = { ...mine(), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' };
  const b = { ...mine(), createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z' };
  const m = mergePlaces(a, b);
  assert.equal(m.createdAt, a.createdAt);
  assert.equal(m.updatedAt, b.updatedAt);
});

/* ---------- timeline ---------- */
await test('timeline: places appear at their first visit; counts grow with revisits', () => {
  const a = place('a', 'A', [visit('a1', '2026-01-01'), visit('a2', '2026-03-01')]);
  const b = place('b', 'B', [visit('b1', '2026-02-01')]);
  const t = buildTimeline([a, b]);
  assert.deepEqual(t.dates, ['2026-01-01', '2026-02-01', '2026-03-01']);
  assert.deepEqual([...t.stateAt(0).counts], [['a', 1]]);
  assert.deepEqual([...t.stateAt(1).counts], [['a', 1], ['b', 1]]);
  assert.deepEqual([...t.stateAt(2).counts], [['a', 2], ['b', 1]]);
  assert.deepEqual(t.stateAt(2).onDate.map((p) => p.id), ['a']);
  assert.equal(t.stateAt(99).date, '2026-03-01'); // clamps
  assert.equal(buildTimeline([]).dates.length, 0);
});

/* ---------- geo ---------- */
await test('geo: distance and nearest-place lookup', () => {
  assert.ok(Math.abs(distanceMeters(0, 0, 0, 1) - 111195) < 200);
  assert.equal(distanceMeters(10, 10, 10, 10), 0);
  const ps = [place('a', 'A', [visit('a1', '2026-01-01')], { latitude: 48.8584, longitude: 2.2945 })];
  assert.equal(nearestPlace(ps, 48.8586, 2.2947, 75).place.id, 'a'); // ~25 m
  assert.equal(nearestPlace(ps, 48.8600, 2.2945, 75), null); // ~180 m
});

/* ---------- tiles ---------- */
await test('tile address validation', () => {
  assert.equal(validateTileUrl(''), null);
  assert.equal(validateTileUrl('https://t.example.com/{z}/{x}/{y}.png'), null);
  assert.equal(validateTileUrl('https://t.example.com/style.json'), null);
  assert.equal(validateTileUrl('http://localhost:8080/{z}/{x}/{y}.png'), null);
  assert.match(validateTileUrl('tiles.example.com/{z}/{x}/{y}.png'), /https/);
  assert.match(validateTileUrl('https://t.example.com/tiles.png'), /\{z\}/);
});
await test('tile styles: OpenStreetMap vs custom raster vs style URL', () => {
  assert.match(styleFor(osmSource()).sources.basemap.tiles[0], /tile\.openstreetmap\.org/);
  const c = styleFor(customSource(' https://t.example.com/{z}/{x}/{y}.png ', '© me'));
  assert.equal(c.sources.basemap.tiles[0], 'https://t.example.com/{z}/{x}/{y}.png');
  assert.equal(c.sources.basemap.attribution, '© me');
  assert.equal(styleFor(customSource('https://t.example.com/style.json')), 'https://t.example.com/style.json');
});

/* ---------- offline map files ---------- */
function pmHeader({ version = 3, tileType = 1, minZoom = 0, maxZoom = 6, bbox = [-180, -85, 180, 85], magic = 'PMTiles', size = 127 } = {}) {
  const buf = new ArrayBuffer(127);
  const view = new DataView(buf);
  [...magic].forEach((c, i) => view.setUint8(i, c.charCodeAt(0)));
  view.setUint8(7, version);
  view.setUint8(98, 2); // gzip
  view.setUint8(99, tileType);
  view.setUint8(100, minZoom);
  view.setUint8(101, maxZoom);
  bbox.forEach((deg, i) => view.setInt32(102 + i * 4, Math.round(deg * 1e7), true));
  return buf.slice(0, size);
}

await test('pmtiles header: vector and raster files are described', () => {
  const v = parseHeader(pmHeader({ maxZoom: 12, bbox: [139.5, 35.5, 140.0, 35.9] }));
  assert.deepEqual([v.kind, v.minZoom, v.maxZoom], ['vector', 0, 12]);
  assert.ok(Math.abs(v.minLon - 139.5) < 1e-6 && Math.abs(v.maxLat - 35.9) < 1e-6);
  assert.equal(parseHeader(pmHeader({ tileType: 2 })).kind, 'raster');
  assert.equal(parseHeader(pmHeader({ tileType: 3 })).kind, 'raster');
  assert.equal(parseHeader(pmHeader({ bbox: [-122.5, -33.9, -70.1, 5.5] })).minLon, -122.5); // negative coordinates
});
await test('pmtiles header: wrong files give readable errors', () => {
  const bad = (buf, pattern) => assert.throws(() => parseHeader(buf), (e) => e instanceof MapFileError && pattern.test(e.message));
  bad(pmHeader({ size: 50 }), /too small/);
  bad(pmHeader({ magic: 'SQLite3' }), /isn't a PMTiles/);
  bad(pmHeader({ version: 2 }), /version 2/);
  bad(pmHeader({ tileType: 0 }), /what kind of tiles/);
});

const world = { key: 'local-world.pmtiles', name: 'world.pmtiles', kind: 'vector', minZoom: 0, maxZoom: 6 };
const tokyo = { key: 'local-tokyo.pmtiles', name: 'tokyo.pmtiles', kind: 'vector', minZoom: 0, maxZoom: 12 };
const ids = (style) => style.layers.map((l) => l.id);

await test('offline style: world file below, online detail from the next zoom, regions on top', () => {
  const style = localStyle([tokyo, world], osmSource());
  assert.deepEqual(Object.keys(style.sources), ['file0', 'online', 'file1']);
  assert.equal(style.sources.file0.url, 'pmtiles://local-world.pmtiles'); // lowest detail first, whatever the input order
  assert.equal(style.sources.file1.url, 'pmtiles://local-tokyo.pmtiles');
  const order = ids(style);
  assert.ok(order.indexOf('file0-roads') < order.indexOf('online') && order.indexOf('online') < order.indexOf('file1-earth'));
  const byId = Object.fromEntries(style.layers.map((l) => [l.id, l]));
  assert.equal(byId.online.minzoom, 7); // no online tile requests while zoomed out
  assert.equal(byId['file0-earth'].minzoom, undefined); // world shows at every zoom, so it's the offline fallback
  assert.equal(byId['file1-earth'].minzoom, 7); // region only where it adds detail
  assert.equal(style.layers[0].type, 'background');
});
await test('offline style: online part is optional and follows your server', () => {
  assert.equal(localStyle([world], null).sources.online, undefined);
  const mine = localStyle([world], customSource('https://t.example.com/{z}/{x}/{y}.png', '© me'));
  assert.equal(mine.sources.online.tiles[0], 'https://t.example.com/{z}/{x}/{y}.png');
  assert.equal(mine.sources.online.attribution, '© me');
  assert.equal(localStyle([world], customSource('https://t.example.com/style.json')).sources.online, undefined); // a whole style can't be layered
  assert.deepEqual(styleFor(localSource([world], null)).sources.file0.type, 'vector');
});
await test('offline style: raster files and every vector file get attribution; labels never required', () => {
  const style = localStyle([{ ...world, kind: 'raster' }], null);
  assert.equal(style.sources.file0.type, 'raster');
  assert.ok(style.layers.some((l) => l.id === 'file0-raster' && l.type === 'raster'));
  assert.ok(localStyle([world], null).sources.file0.attribution.includes('OpenStreetMap'));
  assert.equal(localStyle([world, tokyo], null).layers.some((l) => l.type === 'symbol'), false); // no text, so no font files needed
});
await test('source labels and map-file keys', () => {
  assert.equal(sourceLabel(localSource([world], null)), 'your offline map files only');
  assert.match(sourceLabel(localSource([world], osmSource())), /offline map files, with OpenStreetMap/);
  assert.equal(keyFor('My Map (v2).pmtiles'), 'local-My_Map__v2_.pmtiles');
});

await test('offline mode with no map files: blank background, nothing to fetch or probe', async () => {
  assert.equal(styleFor(noneSource()), BLANK_STYLE);
  assert.match(sourceLabel(noneSource()), /offline mode/);
  assert.equal(await probeSource(noneSource()), true);
});

await test('settings: default tags are normalised, de-duplicated and limited', () => {
  const stored = { defaultTags: ['USA', 'oregon', 'usa', '!!!', ...Array.from({ length: 15 }, (_, i) => `t${i}`)] };
  globalThis.localStorage = { getItem: () => JSON.stringify(stored) };
  const tags = loadSettings().defaultTags;
  assert.deepEqual(tags.slice(0, 3), ['usa', 'oregon', 't0']);
  assert.equal(tags.length, 12);
  globalThis.localStorage = { getItem: () => JSON.stringify({ defaultTags: 'usa' }) };
  assert.deepEqual(loadSettings().defaultTags, []);
  delete globalThis.localStorage;
});

await test('offline labels: off by default; on adds names, dots and a glyph address, region files only from their zoom', () => {
  assert.equal(localStyle([world], null).glyphs, undefined);
  const style = localStyle([world, tokyo], null, true);
  assert.equal(style.glyphs, 'fontsdf://{fontstack}/{range}.pbf');
  const labels = style.layers.filter((l) => l.type === 'symbol');
  assert.ok(labels.some((l) => l.id === 'file0-country-label' && l.minzoom === undefined)); // world: every zoom
  assert.ok(labels.some((l) => l.id === 'file1-roads-label' && l.minzoom === 12)); // region: own minzoom kept (> 7)
  assert.ok(labels.some((l) => l.id === 'file1-country-label' && l.minzoom === 7)); // region: bumped to where it starts
  assert.equal(new Set(style.layers.map((l) => l.id)).size, style.layers.length); // ids unique
  assert.ok(style.layers.some((l) => l.id === 'file0-pois-dot' && l.type === 'circle'));
  assert.equal(localStyle([{ ...world, kind: 'raster' }], null, true).glyphs, undefined); // raster files have no names
  assert.equal(styleFor(localSource([world], null, true)).glyphs !== undefined, true);
});

/* ---------- glyphs (offline text) ---------- */

/** Minimal protobuf reader for the glyph file: [{ name, range, glyphs: [{ id, bitmap, width, ... }] }] */
function readGlyphFile(bytes) {
  let pos = 0;
  const varint = () => { let n = 0, shift = 0, b; do { b = bytes[pos++]; n += (b & 127) * 2 ** shift; shift += 7; } while (b & 128); return n; };
  const unzig = (n) => (n >>> 1) ^ -(n & 1);
  const message = (end, onField) => { while (pos < end) { const key = varint(); onField(key >> 3, key & 7); } };
  const chunk = () => { const len = varint(); const start = pos; pos += len; return [start, pos]; };
  const stacks = [];
  message(bytes.length, (tag) => {
    const [, stackEnd] = [0, (() => { const len = varint(); return pos + len; })()];
    const stack = { glyphs: [] };
    message(stackEnd, (t) => {
      if (t === 1) { const [a, b] = chunk(); stack.name = new TextDecoder().decode(bytes.slice(a, b)); }
      else if (t === 2) { const [a, b] = chunk(); stack.range = new TextDecoder().decode(bytes.slice(a, b)); }
      else {
        const glyphEnd = (() => { const len = varint(); return pos + len; })();
        const g = {};
        message(glyphEnd, (gt) => {
          if (gt === 2) { const [a, b] = chunk(); g.bitmap = bytes.slice(a, b); }
          else { const n = varint(); g[{ 1: 'id', 3: 'width', 4: 'height', 5: 'left', 6: 'top', 7: 'advance' }[gt]] = gt === 5 || gt === 6 ? unzig(n) : n; }
        });
        stack.glyphs.push(g);
      }
    });
    stacks.push(stack);
  });
  return stacks;
}

await test('glyph file: encodes and reads back (negative offsets, empty glyphs, bitmaps)', () => {
  const bitmap = new Uint8Array((5 + 6) * (4 + 6)).map((_, i) => i % 256);
  const [stack] = readGlyphFile(encodeGlyphRange('Sans Regular', '0-255', [
    { id: 65, bitmap, width: 5, height: 4, left: 0, top: -8, advance: 14 },
    { id: 32, advance: 6 },
    { id: 300, bitmap, width: 5, height: 4, left: -2, top: 11, advance: 300 },
  ]));
  assert.deepEqual([stack.name, stack.range, stack.glyphs.length], ['Sans Regular', '0-255', 3]);
  const [a, space, c] = stack.glyphs;
  assert.deepEqual([a.id, a.width, a.height, a.left, a.top, a.advance], [65, 5, 4, 0, -8, 14]);
  assert.deepEqual([...a.bitmap], [...bitmap]);
  assert.equal(space.bitmap, undefined); // a blank glyph has no bitmap, as MapLibre expects
  assert.deepEqual([c.id, c.left, c.top, c.advance], [300, -2, 11, 300]);
});
await test('glyph range: skips control characters and surrogates, asks the drawer for the rest', () => {
  const asked = [];
  const bytes = glyphRangeBytes('Sans Bold', 0, 255, (char, stack) => { asked.push(char.codePointAt(0)); return { advance: stack === 'Sans Bold' ? 7 : 0 }; });
  const [stack] = readGlyphFile(bytes);
  assert.equal(stack.glyphs[0].id, 32);
  assert.equal(stack.glyphs.some((g) => g.id === 0x7f || g.id < 32), false);
  assert.equal(asked.length, stack.glyphs.length);
  assert.equal(glyphRangeBytes('S', 0xd800, 0xd8ff, () => ({ advance: 1 })).length > 0, true);
  assert.equal(readGlyphFile(glyphRangeBytes('S', 0xd800, 0xd8ff, () => ({ advance: 1 })))[0].glyphs.length, 0);
});
await test('distance field: solid inside, edge near the 0.75 mark, nothing far outside', () => {
  const w = 21, h = 21;
  const alpha = new Uint8ClampedArray(w * h);
  for (let y = 6; y < 15; y++) for (let x = 6; x < 15; x++) alpha[y * w + x] = 255; // a 9x9 square
  const sdf = alphaToSdf(alpha, w, h);
  assert.equal(sdf[10 * w + 10], 255); // centre: deep inside
  assert.ok(sdf[10 * w + 6] >= 180 && sdf[10 * w + 6] <= 230); // first pixel inside the edge
  assert.ok(sdf[10 * w + 5] < 180 && sdf[10 * w + 5] > 100); // first pixel outside it
  assert.equal(sdf[0], 0); // far corner
  const half = alphaToSdf(new Uint8ClampedArray([0, 128, 255]), 3, 1);
  assert.ok(half[0] < half[1] && half[1] < half[2]); // anti-aliased pixels land in between
});

/* ---------- tags ---------- */
const tagged = (id, tags, date = '2026-01-01') => visit(id, date, tags ? { tags } : {});

await test('tags: normalised to lowercase words; junk removed; empties dropped', () => {
  assert.equal(normalizeTag('  #Trip:Japan 2026! '), 'trip:japan-2026');
  assert.equal(normalizeTag('RAMEN'), 'ramen');
  assert.equal(normalizeTag('very   long   words'), 'very-long-words');
  assert.equal(normalizeTag('--:x:--'), 'x');
  assert.equal(normalizeTag('日本'), '日本'); // not Latin: kept
  assert.equal(normalizeTag('!!!'), '');
  assert.equal(normalizeTag(5), '');
  assert.deepEqual(normalizeTags(['Ramen', 'ramen', ' RAMEN ', '', 'sushi']), ['ramen', 'sushi']);
});
await test('tags: validation normalises, limits length and count, omits when empty', () => {
  assert.deepEqual(validateVisitFields({ date: '2026-01-01', tags: ['Ramen', 'ramen', 'Trip 1'] }).value.tags, ['ramen', 'trip-1']);
  assert.equal('tags' in validateVisitFields({ date: '2026-01-01', tags: [] }).value, false);
  assert.equal('tags' in validateVisitFields({ date: '2026-01-01', tags: ['!!!'] }).value, false);
  assert.ok(validateVisitFields({ date: '2026-01-01', tags: ['x'.repeat(31)] }).errors.tags);
  assert.ok(validateVisitFields({ date: '2026-01-01', tags: Array.from({ length: 13 }, (_, i) => `t${i}`) }).errors.tags);
  assert.ok(validateVisitFields({ date: '2026-01-01', tags: 'ramen' }).errors.tags);
  assert.ok(validateVisitFields({ date: '2026-01-01', tags: [1] }).errors.tags);
});

const A = place('a', 'A', [tagged('a1', ['ramen', 'trip:japan']), tagged('a2', ['ramen'], '2026-02-01'), tagged('a3', null, '2026-03-01')]);
const B = place('b', 'B', [tagged('b1', ['ramen', 'sushi', 'food']), tagged('b2', ['sushi'], '2026-02-02')]);
const C = place('c', 'C', [tagged('c1', ['trip:japan'], '2026-04-01')]);

await test('tags: place tags are the union of its visits; stats rank by visits, then places, then name', () => {
  assert.deepEqual(placeTags(A), ['ramen', 'trip:japan']);
  assert.deepEqual(placeTags(place('x', 'X', [tagged('x1', null)])), []);
  const stats = tagStats([A, B, C]);
  assert.deepEqual(stats.map((s) => [s.tag, s.visits, s.places]), [
    ['ramen', 3, 2], ['trip:japan', 2, 2], ['sushi', 2, 1], ['food', 1, 1], // equal visits: more places ranks first
  ]);
  assert.deepEqual(topTags(stats).map((s) => s.tag), ['ramen', 'trip:japan', 'sushi']); // top three
  assert.deepEqual(topTags(stats, 3, ['ramen']).map((s) => s.tag), ['trip:japan', 'sushi', 'food']); // selected ones don't take a slot
});
await test('tags: a tag nobody uses disappears (the list is derived from the visits)', () => {
  assert.ok(tagStats([A, B, C]).some((s) => s.tag === 'food'));
  const withoutFood = { ...B, visits: [tagged('b1', ['ramen', 'sushi']), B.visits[1]] }; // the only visit with "food" was edited
  assert.equal(tagStats([A, withoutFood, C]).some((s) => s.tag === 'food'), false);
  assert.deepEqual(tagStats([]), []);
  assert.deepEqual(pruneFilter({ tags: ['food', 'ramen'], match: 'all' }, tagStats([A, withoutFood, C])), { tags: ['ramen'], match: 'all' });
});
await test('tags: filtering by several tags, all or any', () => {
  const v = tagged('v', ['ramen', 'sushi']);
  assert.equal(matchesTags(v, [], 'all'), true);
  assert.equal(matchesTags(v, ['ramen', 'sushi'], 'all'), true);
  assert.equal(matchesTags(v, ['ramen', 'food'], 'all'), false);
  assert.equal(matchesTags(v, ['ramen', 'food'], 'any'), true);
  assert.equal(matchesTags(tagged('u', null), ['ramen'], 'any'), false);
  assert.equal(matchesTags(v, ['food', 'trip:japan'], 'none'), true);
  assert.equal(matchesTags(v, ['food', 'ramen'], 'none'), false);
  assert.equal(matchesTags(tagged('u', null), ['ramen'], 'none'), true); // untagged visits are "none of these"
  assert.equal(matchesTags(v, [], 'none'), true); // no tags picked: no filter
  assert.deepEqual(filterPlaces([A, B, C], { tags: ['ramen'], match: 'none' }).map((p) => [p.id, p.visits.map((x) => x.id)]), [['a', ['a3']], ['b', ['b2']], ['c', ['c1']]]);
  const all = filterPlaces([A, B, C], { tags: ['ramen', 'sushi'], match: 'all' });
  assert.deepEqual(all.map((p) => [p.id, p.visits.map((x) => x.id)]), [['b', ['b1']]]);
  const any = filterPlaces([A, B, C], { tags: ['ramen', 'sushi'], match: 'any' });
  assert.deepEqual(any.map((p) => [p.id, p.visits.length]), [['a', 2], ['b', 2]]);
  assert.equal(filterPlaces([A], { tags: [], match: 'all' })[0], A); // no filter: untouched
});
await test('timeline route: visits in order (date, time, place name, created, id); stays at one place collapse', () => {
  const at = (lng) => ({ longitude: lng, latitude: 0 });
  const C = place('c', 'Charlie', [visit('c1', '2026-01-01', { time: '09:00' })], at(3));
  const Al = place('a', 'Alpha', [visit('a1', '2026-01-01', { time: '10:00' }), visit('a2', '2026-01-03', { time: '10:00' }), visit('a3', '2026-01-03', { time: '11:00' })], at(1));
  const Br = place('b', 'Bravo', [visit('b1', '2026-01-01', { time: '10:00' })], at(2));
  const t = buildTimeline([Br, Al, C]);
  assert.deepEqual(t.stateAt(0).route, [[3, 0], [1, 0], [2, 0]]); // same time: Alpha before Bravo by name
  assert.deepEqual(t.stateAt(1).route, [[3, 0], [1, 0], [2, 0], [1, 0]]); // a2, a3 are one stay
  assert.deepEqual(t.stateAt(1).routeIds, ['c', 'a', 'b', 'a']);
  const early = { ...place('e', 'Same', [visit('e1', '2026-02-01', { time: '08:00' })], at(5)), };
  const late = place('l', 'Same', [visit('l1', '2026-02-01', { time: '08:00', createdAt: '2026-10-05T00:00:00.000Z' })], at(6));
  assert.deepEqual(buildTimeline([late, early]).stateAt(0).route, [[5, 0], [6, 0]]); // same name: earlier created first
  const x = place('x', 'Same', [visit('v-b', '2026-02-01', { time: '08:00' })], at(7));
  const y = place('y', 'Same', [visit('v-a', '2026-02-01', { time: '08:00' })], at(8));
  assert.deepEqual(buildTimeline([x, y]).stateAt(0).route, [[8, 0], [7, 0]]); // same created: visit id
  assert.deepEqual(buildTimeline([A, B, C], { tags: ['ramen'], match: 'all' }).stateAt(1).route.length, 3); // follows the filter: A, B, back to A (c1 and a3 are filtered out)
});
await test('age colour ramp: ends, middle and clamping', () => {
  assert.equal(rampColor(0), RAMP[0]);
  assert.equal(rampColor(0.5), RAMP[1]);
  assert.equal(rampColor(1), RAMP[2]);
  assert.equal(rampColor(-3), RAMP[0]);
  assert.equal(rampColor(9), RAMP[2]);
  assert.match(rampColor(0.25), /^#[0-9a-f]{6}$/);
  assert.equal(rampColor(0.5, ['#000000', '#ffffff']), '#808080'); // a user ramp
  assert.equal(rampColor(1, ['#000000', '#ff0000', '#00ff00']), '#00ff00');
  assert.deepEqual(['#a1B2c3', 'red', '#fff', 5].map(isHexColor), [true, false, false, false]);
});
await test('timeline with a tag filter counts only matching visits and dates', () => {
  const t = buildTimeline([A, B, C], { tags: ['ramen'], match: 'all' });
  assert.deepEqual(t.dates, ['2026-01-01', '2026-02-01']); // a3 / b2 / c1 don't match, so their dates are skipped
  assert.equal(t.placeCount, 2);
  assert.deepEqual([...t.stateAt(1).counts], [['a', 2], ['b', 1]]);
  assert.equal(buildTimeline([A], { tags: ['nothing'], match: 'all' }).dates.length, 0);
  assert.equal(buildTimeline([A, B, C]).placeCount, 3); // no filter: as before
});
await test('tags: stored via the store, cleared on edit, and part of export/import', async () => {
  const store = createStore(memoryRepo());
  const p = await store.addPlace({ ...base, visit: { date: '2026-10-04', tags: ['Ramen', 'trip:japan'] } });
  assert.deepEqual(p.visits[0].tags, ['ramen', 'trip:japan']);
  const edited = await store.updateVisit(p.id, p.visits[0].id, { date: '2026-10-04' }); // user removed every tag
  assert.equal('tags' in edited.visits[0], false);
  const again = await store.updateVisit(p.id, p.visits[0].id, { date: '2026-10-04', tags: ['sushi'] });
  const { places, version } = parseImport(JSON.stringify(JSON.parse(JSON.stringify(buildExport([again])))));
  assert.equal(version, 4);
  assert.deepEqual(places[0].visits[0].tags, ['sushi']);
});
await test('import: tags in a file are normalised; a v2 file (no tags) still imports as v3', () => {
  const file = { version: 3, places: [place('x', 'X', [{ ...visit('x1', '2026-01-01'), tags: ['Ramen', ' Trip 1 '] }])] };
  assert.deepEqual(parseImport(JSON.stringify(file)).places[0].visits[0].tags, ['ramen', 'trip-1']);
  const v2 = parseImport(JSON.stringify({ version: 2, places: [place('y', 'Y', [visit('y1', '2026-01-01')])] }));
  assert.equal(v2.version, 4);
  assert.equal('tags' in v2.places[0].visits[0], false);
  assert.throws(() => parseImport(JSON.stringify({ version: 5, places: [] })), /newer version/);
});
await test('merge: a visit whose only difference is its tags is a conflict (not silently "identical")', () => {
  const mineP = place('p1', 'Ramen', [visit('v1', '2026-01-10', { tags: ['ramen'] })]);
  const theirs = place('p1', 'Ramen', [visit('v1', '2026-01-10', { tags: ['ramen', 'trip:japan'] })]);
  assert.equal(planMerge([mineP], [theirs]).conflicts.length, 1);
  assert.equal(planMerge([mineP], [structuredClone(mineP)]).identical, 1);
  const sameDifferentOrder = place('p1', 'Ramen', [visit('v1', '2026-01-10', { tags: ['ramen'] })]);
  assert.equal(planMerge([place('p1', 'Ramen', [visit('v1', '2026-01-10', { tags: ['a', 'b'] })])], [place('p1', 'Ramen', [visit('v1', '2026-01-10', { tags: ['b', 'a'] })])]).identical, 1);
  assert.equal(planMerge([mineP], [sameDifferentOrder]).identical, 1);
});

/* ---------- visit time ---------- */
await test('visit time: always set (default 00:01), HH:MM, validated, kept or cleared through the store', async () => {
  for (const ok of ['00:00', '09:30', '23:59']) assert.equal(isValidTimeString(ok), true, ok);
  for (const bad of ['9:30', '24:00', '12:60', '12:30:00', '', null, 930]) assert.equal(isValidTimeString(bad), false, String(bad));
  assert.ok(validateVisitFields({ date: '2026-01-01', time: '25:00' }).errors.time);
  assert.equal(validateVisitFields({ date: '2026-01-01', time: '' }).value.time, '00:01'); // missing -> default
  const store = createStore(memoryRepo());
  const p = await store.addPlace({ ...base, visit: { date: '2026-10-04', time: '08:15' } });
  assert.equal(p.visits[0].time, '08:15');
  const edited = await store.updateVisit(p.id, p.visits[0].id, { date: '2026-10-04', time: '' }); // Reset / cleared
  assert.equal(edited.visits[0].time, DEFAULT_TIME);
  assert.equal((await store.addPlace({ ...base, visit: { date: '2026-10-04' } })).visits[0].time, DEFAULT_TIME);
  const { places } = parseImport(JSON.stringify(buildExport([{ ...p }])));
  assert.equal(places[0].visits[0].time, '08:15');
});
await test('visit time: files and stored data without it get the default', async () => {
  const { places } = parseImport(JSON.stringify({ version: 1, places: [v1] }));
  assert.equal(places[0].visits[0].time, '00:01');
  const repo = memoryRepo([place('x', 'X', [visit('a', '2026-01-01'), visit('b', '2026-01-02', { time: '07:30' })])]);
  const store = createStore(repo);
  await store.load();
  assert.deepEqual(store.places[0].visits.map((v) => v.time), ['00:01', '07:30']);
  assert.equal(repo._writes.replaceAll, 1);
  await createStore(repo).load();
  assert.equal(repo._writes.replaceAll, 1); // already upgraded: no rewrite
});
await test('visits on the same day sort by time, newest first; a time difference is a merge conflict', () => {
  const vs = [visit('a', '2026-01-01', { time: '09:00' }), visit('b', '2026-01-01', { time: '18:30' }), visit('c', '2026-01-01'), visit('d', '2026-01-02')];
  assert.deepEqual(sortVisits(vs).map((v) => v.id), ['d', 'b', 'a', 'c']);
  const m = place('p1', 'R', [visit('v1', '2026-01-10', { time: '09:00' })]);
  const t = place('p1', 'R', [visit('v1', '2026-01-10', { time: '10:00' })]);
  assert.equal(planMerge([m], [t]).conflicts.length, 1);
});

console.log(`\n${passed} passed${process.exitCode ? ', with failures' : ''}`);
