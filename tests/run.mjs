// Plain-Node tests for everything without a DOM: validation, migration, store, export/import,
// merge, timeline, geo, tile-address checks.   Run with:  node tests/run.mjs
import assert from 'node:assert/strict';
import { validatePlaceBase, validateVisitFields } from '../js/validation.js';
import { buildExport, parseImport, ImportError } from '../js/exportImport.js';
import { createStore } from '../js/store.js';
import { isValidDateString } from '../js/dates.js';
import { migratePlaceV1, isLegacyPlace, latestVisit } from '../js/schema.js';
import { planMerge, applyMerge, mergePlaces, describeConflict } from '../js/merge.js';
import { buildTimeline } from '../js/timeline.js';
import { distanceMeters, nearestPlace } from '../js/geo.js';
import { validateTileUrl, styleFor, osmSource, customSource, localSource, localStyle, sourceLabel } from '../js/tiles.js';
import { parseHeader, MapFileError } from '../js/pmtilesHeader.js';
import { keyFor } from '../js/localMaps.js';

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
  assert.equal(exported.version, 2);
  const { places } = parseImport(JSON.stringify(exported));
  assert.deepEqual(places.map((x) => x.id), store.places.map((x) => x.id));
  assert.equal(places[0].visits.length, 2);
});
await test('import accepts an OLD version-1 export from the first MVP and upgrades it', () => {
  const { version, places } = parseImport(JSON.stringify({ version: 1, places: [v1] }));
  assert.equal(version, 2);
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
await test('merge: a differing name or edited visit is a conflict, with a readable reason', () => {
  const renamed = { ...mine(), name: 'Ramen House' };
  const edited = place('p1', 'Ramen Shop', [visit('v1', '2026-01-10', { rating: 1 })]);
  const plan = planMerge([mine()], [renamed]);
  assert.equal(plan.conflicts.length, 1);
  assert.match(describeConflict(plan.conflicts[0]).join(' '), /Ramen Shop.*Ramen House/);
  assert.match(describeConflict(planMerge([mine()], [edited]).conflicts[0]).join(' '), /1 visit edited differently/);
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
await test('merge: re-importing an old v1 export into already-migrated data adds nothing', () => {
  const local = [migratePlaceV1(v1)];
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

console.log(`\n${passed} passed${process.exitCode ? ', with failures' : ''}`);
