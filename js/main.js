// Controller: wires the store, the map and the panel views together.
import { $ } from './dom.js';
import { NEARBY_METERS, SELF_HOSTED_TILES, SIDEBAR_WIDTH, TIMELINE_ZOOM } from './config.js';
import { formatDate, todayLocal } from './dates.js';
import { createPlaceRepository } from './repository.js';
import { createStore } from './store.js';
import { createMapView } from './mapView.js';
import { getCurrentPosition } from './geolocation.js';
import { buildExport, parseImport, ImportError } from './exportImport.js';
import { applyMerge, planMerge } from './merge.js';
import { nearestPlace } from './geo.js';
import { buildTimeline } from './timeline.js';
import { ValidationError } from './validation.js';
import { customSource, localSource, osmSource, probeSource, sourceLabel, validateTileUrl } from './tiles.js';
import { createMapFileStore } from './mapFiles.js';
import { MapFileError } from './pmtilesHeader.js';
import { localMapsSupported, registerLocalFiles } from './localMaps.js';
import { loadSettings, saveSettings } from './settings.js';
import { renderList, renderDetail, renderForm, renderSettings, renderTimeline, EMPTY_TITLE, EMPTY_TEXT } from './views.js';
import { choiceDialog, confirmDialog } from './dialog.js';
import { reviewImport } from './importReview.js';
import { toast } from './toast.js';

const LAST_EXPORT_KEY = 'places-map:last-export';
const TILE_CACHE = 'tiles-places-map';
const desktop = matchMedia('(min-width: 800px)');

const panelBody = $('#panel-body');
const panel = $('#panel');
const pinButton = $('#pin-button');
const emptyCard = $('#empty');

const store = createStore(createPlaceRepository());
const mapFiles = createMapFileStore();

/**
 * view: 'none' | 'list' | 'detail' | 'form' | 'settings' | 'timeline'
 * formCtx: { mode: 'add-place' | 'edit-place' | 'add-visit' | 'edit-visit', placeId, visitId }
 */
const state = {
  view: 'none', selectedId: null,
  form: null, formCtx: null, draft: null,
  timeline: null,
  tileSource: null, tileErrors: 0, checkingTiles: false,
  online: null, // the online map in use (OpenStreetMap or your server), or null when offline files are used alone
  mapMetas: [], localFiles: [], // offline map files: stored descriptions / registered with the map
};

const mapView = createMapView($('#map'), {
  onMapClick,
  onPlaceClick,
  onDraftMove: (lat, lng) => { state.draft = { latitude: lat, longitude: lng }; state.form?.setCoords(lat, lng); },
  onTileError,
  getPadding,
});

/* ---------- helpers ---------- */

function getPadding() {
  if (desktop.matches) return { top: 0, right: 0, bottom: 0, left: SIDEBAR_WIDTH };
  let bottom = 0;
  if (state.view === 'detail' || state.view === 'form') bottom = Math.round(innerHeight * 0.45);
  else if (state.view === 'timeline') bottom = 260;
  return { top: 0, right: 0, left: 0, bottom };
}

/** Places drawn as normal markers (the one being relocated is shown as the draft pin instead). */
const visiblePlaces = () =>
  store.places.filter((p) => !(state.formCtx?.mode === 'edit-place' && state.formCtx.placeId === p.id));

const count = (n, one = 'place') => `${n} ${n === 1 ? one : `${one}s`}`;

function userMessage(err) {
  if (err instanceof ValidationError) return err.message;
  if (err instanceof Error && /no longer exists|at least one visit/.test(err.message)) return err.message;
  return "Couldn't save to this device. If you're in a private window, saving may be blocked.";
}

function readLastExport() {
  try { return localStorage.getItem(LAST_EXPORT_KEY); } catch { return null; }
}
function writeLastExport() {
  try { localStorage.setItem(LAST_EXPORT_KEY, new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })); } catch { /* optional convenience */ }
}

/* ---------- panel / view switching ---------- */

function setView(view) {
  if (view === 'none' && desktop.matches) view = 'list';
  const leaving = state.view === 'timeline' && view !== 'timeline';
  const entering = view === 'timeline' && state.view !== 'timeline';
  state.view = view;
  document.body.dataset.view = view;
  if (leaving) leaveTimeline();
  panel.inert = view === 'none'; // only reachable on phones, where the sheet is hidden
  renderPanel();
  updateEmpty();
  if (entering) enterTimeline();
}

/** Chip buttons: toggle a panel, but never silently throw away a form in progress. */
function navigate(view) {
  if (state.view === 'form') { toast('Save or cancel this form first.'); return; }
  setView(state.view === view ? 'none' : view);
}

function renderPanel() {
  switch (state.view) {
    case 'list':
      panelBody.replaceChildren(renderList({
        places: store.places,
        onSelect: selectPlace,
        onClose: desktop.matches ? null : () => setView('none'),
      }));
      break;
    case 'detail': {
      const place = store.get(state.selectedId);
      if (!place) { closeDetail(); return; }
      panelBody.replaceChildren(renderDetail({
        place,
        onAddVisit: () => openForm('add-visit', { place }),
        onEditPlace: () => openForm('edit-place', { place }),
        onDeletePlace: () => deletePlace(place),
        onEditVisit: (visit) => openForm('edit-visit', { place, visit }),
        onDeleteVisit: (visit) => deleteVisit(place, visit),
        onClose: closeDetail,
      }));
      break;
    }
    case 'form':
      panelBody.replaceChildren(state.form.el);
      break;
    case 'settings':
      panelBody.replaceChildren(renderSettings({
        count: store.places.length,
        lastExport: readLastExport(),
        onExport: exportData,
        onImportFile: importFile,
        onClose: () => setView('none'),
        tiles: {
          url: loadSettings().tileUrl,
          attribution: loadSettings().tileAttribution,
          fallback: loadSettings().fallback,
          activeLabel: state.tileSource ? sourceLabel(state.tileSource) : 'OpenStreetMap',
        },
        onSaveTiles: saveTileSettings,
        onClearTileCache: clearTileCache,
        maps: { supported: localMapsSupported(), files: state.mapMetas, localOnline: loadSettings().localOnline },
        onAddMapFile: addMapFile,
        onRemoveMapFile: removeMapFile,
        onToggleLocalOnline: toggleLocalOnline,
      }));
      break;
    case 'timeline': {
      const model = buildTimeline(store.places);
      state.timeline = renderTimeline({
        model,
        onChange: (s) => mapView.setVisibility(s.counts),
        onClose: () => setView('none'),
      });
      panelBody.replaceChildren(state.timeline.el);
      break;
    }
    default:
      panelBody.replaceChildren();
  }
  panel.scrollTop = 0;
}

function updateEmpty() {
  // Phone-only card shown over the map when there is nothing saved and no sheet is open.
  emptyCard.hidden = !(store.places.length === 0 && state.view === 'none');
}

/* ---------- timeline ---------- */

function enterTimeline() {
  mapView.setSelected(null);
  mapView.enterOverview(store.places, TIMELINE_ZOOM);
  state.timeline?.ready();
}

function leaveTimeline() {
  state.timeline?.destroy();
  state.timeline = null;
  mapView.setVisibility(null);
  mapView.leaveOverview();
}

/* ---------- selecting ---------- */

function onPlaceClick(id) {
  if (state.view === 'form') return;
  if (state.view === 'timeline') { state.timeline?.showPlace(store.get(id)); return; }
  selectPlace(id);
}

function selectPlace(id) {
  const place = store.get(id);
  if (!place) return;
  state.selectedId = id;
  mapView.setSelected(id);
  setView('detail');
  mapView.flyTo(place.latitude, place.longitude, { minZoom: 13 });
}

function closeDetail() {
  state.selectedId = null;
  mapView.setSelected(null);
  setView('none');
}

/* ---------- add / edit forms ---------- */

function openForm(mode, { place, visit, latitude, longitude, zoom } = {}) {
  const hasPin = mode === 'add-place' || mode === 'edit-place';
  if (hasPin) {
    latitude ??= place.latitude;
    longitude ??= place.longitude;
    state.draft = { latitude, longitude };
  }
  const config = {
    'add-place': { title: 'Add place', show: { place: true, visit: true }, initial: {} },
    'edit-place': { title: 'Edit place', show: { place: true, visit: false }, initial: { name: place?.name } },
    'add-visit': { title: 'Add visit', subtitle: place?.name, show: { place: false, visit: true }, initial: {} },
    'edit-visit': { title: 'Edit visit', subtitle: place?.name, show: { place: false, visit: true }, initial: visit },
  }[mode];

  state.formCtx = { mode, placeId: place?.id ?? null, visitId: visit?.id ?? null };
  state.form = renderForm({ ...config, coords: state.draft, onSave: saveForm, onCancel: () => endForm() });
  state.selectedId = hasPin ? null : place.id;
  mapView.setSelected(state.selectedId);
  mapView.setPlaces(visiblePlaces());
  if (hasPin) mapView.setDraft(latitude, longitude);
  setView('form');
  mapView.flyTo(latitude ?? place.latitude, longitude ?? place.longitude, zoom ? { zoom } : {});
  if (mode === 'add-place') requestAnimationFrame(() => state.form?.focus());
}

/** Leaves the form (saved or cancelled). Edits return to the place; a new place returns to the map. */
function endForm() {
  const ctx = state.formCtx;
  state.formCtx = null;
  state.form = null;
  state.draft = null;
  mapView.clearDraft();
  mapView.setPlaces(store.places);
  const target = ctx && ctx.mode !== 'add-place' ? ctx.placeId : null;
  if (target && store.get(target)) selectPlace(target);
  else setView('none');
}

async function saveForm(values) {
  const ctx = state.formCtx;
  const visit = { date: values.date, rating: values.rating, notes: values.notes };
  const base = { name: values.name, latitude: values.latitude, longitude: values.longitude };
  try {
    switch (ctx.mode) {
      case 'add-place':
        await store.addPlace({ ...base, visit });
        toast('Saved to your map.');
        break;
      case 'edit-place':
        await store.updatePlace(ctx.placeId, base);
        toast('Changes saved.');
        break;
      case 'add-visit':
        await store.addVisit(ctx.placeId, visit);
        toast('Visit added.');
        break;
      default:
        await store.updateVisit(ctx.placeId, ctx.visitId, visit);
        toast('Changes saved.');
    }
    navigator.storage?.persist?.().catch(() => {}); // ask the browser not to evict our data
    endForm();
    return true;
  } catch (err) {
    console.error(err);
    toast(userMessage(err));
    return false;
  }
}

/** Starts a new pin, first offering to add a visit if a saved place is already right here. */
async function beginPin(latitude, longitude, { zoom, accuracy } = {}) {
  const radius = Math.max(NEARBY_METERS, Math.min(accuracy ?? 0, 150));
  const near = nearestPlace(store.places, latitude, longitude, radius);
  if (near) {
    const choice = await choiceDialog({
      title: `You've saved “${near.place.name}” here`,
      message: `It's about ${Math.round(near.distance)} m from this spot. Add a new visit to it, or pin this as a separate place?`,
      choices: [
        { value: 'cancel', label: 'Cancel' },
        { value: 'new', label: 'Separate place' },
        { value: 'visit', label: 'Add a visit', kind: 'primary' },
      ],
    });
    if (choice === 'visit') { openForm('add-visit', { place: near.place }); return; }
    if (choice !== 'new') return;
  }
  openForm('add-place', { latitude, longitude, zoom });
}

async function pinCurrentLocation() {
  if (state.view === 'form' || state.view === 'timeline') return;
  const label = pinButton.querySelector('.label');
  pinButton.disabled = true;
  label.textContent = 'Finding you…';
  try {
    const { latitude, longitude, accuracy } = await getCurrentPosition();
    await beginPin(latitude, longitude, { zoom: 16, accuracy });
  } catch (err) {
    toast(err.message);
  } finally {
    pinButton.disabled = false;
    label.textContent = 'Pin location';
  }
}

function onMapClick(latitude, longitude) {
  switch (state.view) {
    case 'form':
      if (state.formCtx?.mode === 'add-place' || state.formCtx?.mode === 'edit-place') {
        mapView.setDraft(latitude, longitude);
        state.draft = { latitude, longitude };
        state.form.setCoords(latitude, longitude);
      }
      break;
    case 'timeline':
      break;
    case 'detail':
      closeDetail();
      break;
    case 'settings':
      setView('none');
      break;
    case 'list':
      if (!desktop.matches) setView('none');
      else beginPin(latitude, longitude);
      break;
    default:
      beginPin(latitude, longitude);
  }
}

/* ---------- delete ---------- */

async function deletePlace(place) {
  const confirmed = await confirmDialog({
    title: 'Delete this place?',
    message: place.visits.length > 1
      ? `“${place.name}” and its ${place.visits.length} visits will be removed from your map. This can't be undone.`
      : `“${place.name}” will be removed from your map. This can't be undone.`,
    confirmLabel: 'Delete',
    cancelLabel: 'Keep',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await store.remove(place.id);
    closeDetail();
    toast('Place deleted.');
  } catch (err) {
    console.error(err);
    toast("Couldn't delete that place. Try again.");
  }
}

async function deleteVisit(place, visit) {
  const confirmed = await confirmDialog({
    title: 'Delete this visit?',
    message: `The visit on ${formatDate(visit.date)} will be removed from “${place.name}”. This can't be undone.`,
    confirmLabel: 'Delete',
    cancelLabel: 'Keep',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await store.removeVisit(place.id, visit.id);
    renderPanel();
    mapView.setPlaces(store.places);
    toast('Visit deleted.');
  } catch (err) {
    console.error(err);
    toast(userMessage(err));
  }
}

/* ---------- export / import ---------- */

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function exportData() {
  const json = JSON.stringify(buildExport(store.places), null, 2);
  const file = new File([json], `places-${todayLocal()}.json`, { type: 'application/json' });
  try {
    // On phones the share sheet is the reliable way to get a file out of an installed app.
    const canShare = matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] });
    if (canShare) await navigator.share({ files: [file], title: 'Personal Places Map backup' });
    else downloadFile(file);
    writeLastExport();
    toast('Backup exported.');
    if (state.view === 'settings') renderPanel();
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error(err);
      toast("Couldn't export your places. Try again.");
    }
  }
}

async function importFile(file) {
  let parsed;
  try {
    parsed = parseImport(await file.text());
  } catch (err) {
    await confirmDialog({
      title: "Can't import this file",
      message: err instanceof ImportError ? err.message : "The file couldn't be read.",
      confirmLabel: 'OK',
      cancelLabel: null,
    });
    return;
  }
  const incoming = parsed.places;

  let mode = 'replace';
  if (store.places.length > 0) {
    mode = await choiceDialog({
      title: 'How should this file be imported?',
      message: `The file has ${count(incoming.length)}. You have ${count(store.places.length)} saved.`,
      choices: [
        { value: 'cancel', label: 'Cancel' },
        { value: 'replace', label: 'Replace everything', kind: 'danger' },
        { value: 'add', label: 'Add to my places', kind: 'primary' },
      ],
    });
    if (mode !== 'add' && mode !== 'replace') return;
  }

  if (mode === 'replace') await replaceFromFile(incoming);
  else await addFromFile(incoming);
}

async function replaceFromFile(incoming) {
  if (store.places.length > 0) {
    const confirmed = await confirmDialog({
      title: 'Replace your places?',
      message: `Your current ${count(store.places.length)} will be removed and replaced by ${count(incoming.length)} from the file. Export first if you want to keep what you have now. Continue?`,
      confirmLabel: 'Replace',
      danger: true,
    });
    if (!confirmed) return;
  }
  try {
    await store.replaceAll(incoming);
    mapView.fitToPlaces(incoming);
    toast(`Imported ${count(incoming.length)}.`);
  } catch (err) {
    console.error(err);
    toast("Couldn't save the imported places. Your existing places were not changed.");
  }
}

async function addFromFile(incoming) {
  const plan = planMerge(store.places, incoming);
  if (!plan.added.length && !plan.merged.length && !plan.conflicts.length) {
    await confirmDialog({
      title: 'Nothing new to import',
      message: 'Everything in this file is already on this device.',
      confirmLabel: 'OK',
      cancelLabel: null,
    });
    return;
  }
  const choices = await reviewImport(plan);
  if (!choices) return;
  try {
    await store.replaceAll(applyMerge(store.places, plan, choices));
    mapView.fitToPlaces(store.places);
    toast(`Done. ${count(plan.added.length)} added, ${count(plan.merged.length + plan.conflicts.length)} updated.`);
  } catch (err) {
    console.error(err);
    toast("Couldn't save the imported places. Your existing places were not changed.");
  }
}

/* ---------- map tiles: offline files, then your server, then OpenStreetMap ---------- */

function useSource(source) {
  state.tileSource = source;
  state.tileErrors = 0;
  mapView.setTileSource(source);
  if (state.view === 'settings') renderPanel();
}

/** Shows an online map (OpenStreetMap or your server), underneath the offline files if there are any. */
function showOnline(online) {
  state.online = online;
  const settings = loadSettings();
  useSource(state.localFiles.length
    ? localSource(state.localFiles, settings.localOnline ? online : null)
    : online);
}

/** The user's server didn't answer. Depending on their setting: fall back, stay, or ask. */
async function handleServerDown(custom) {
  const settings = loadSettings();
  if (settings.fallback === 'always') {
    showOnline(osmSource());
    toast("Your map server isn't reachable. Using OpenStreetMap.");
    return;
  }
  if (settings.fallback === 'never') {
    showOnline(custom);
    toast("Your map server isn't reachable.");
    return;
  }
  const choice = await choiceDialog({
    title: "Can't reach your map server",
    message: "Use OpenStreetMap's public map for now? It's a free, shared service, so it's best kept to light use.",
    choices: [
      { value: 'keep', label: 'Keep trying my server' },
      { value: 'always', label: 'Always fall back' },
      { value: 'osm', label: 'Use OpenStreetMap', kind: 'primary' },
    ],
  });
  if (choice === 'always') {
    saveSettings({ ...settings, fallback: 'always' });
    showOnline(osmSource());
  } else if (choice === 'osm') {
    showOnline(osmSource());
  } else {
    showOnline(custom);
  }
}

/** Reads the stored offline map files and registers them with the map. */
async function loadLocalFiles() {
  try { state.mapMetas = await mapFiles.list(); } catch { state.mapMetas = []; }
  try { state.localFiles = await registerLocalFiles(mapFiles, state.mapMetas); } catch (err) {
    console.warn('Could not open offline map files', err);
    state.localFiles = [];
  }
}

function configuredServer(settings) {
  const url = settings.tileUrl || SELF_HOSTED_TILES;
  return url && !validateTileUrl(url) ? customSource(url, settings.tileAttribution) : null;
}

/** Picks the map to show: offline files first (if any), then your server, then OpenStreetMap. */
async function setupTiles() {
  const settings = loadSettings();
  const server = configuredServer(settings);
  const hasLocal = state.localFiles.length > 0;

  if (hasLocal) {
    // Show the offline map straight away, then check the online part in the background.
    showOnline(settings.localOnline ? (server ?? osmSource()) : null);
    if (!settings.localOnline || !server) return;
  } else if (!server) {
    showOnline(osmSource());
    return;
  }
  if (await probeSource(server)) { showOnline(server); return; }
  await handleServerDown(server);
}

/** Many failed tiles on your server: is it down, or just missing tiles for this area? */
async function onTileError() {
  const source = state.tileSource;
  if (!source || source.kind !== 'custom' || state.checkingTiles) return;
  if (++state.tileErrors < 4) return;
  state.checkingTiles = true;
  try {
    if (!(await probeSource(source))) await handleServerDown(source);
    else state.tileErrors = 0; // reachable; some tiles just don't exist here
  } finally {
    state.checkingTiles = false;
  }
}

async function saveTileSettings({ url, attribution, fallback }) {
  const current = loadSettings();
  if (!saveSettings({ ...current, tileUrl: url, tileAttribution: attribution || current.tileAttribution, fallback })) {
    toast("Couldn't save settings on this device.");
    return;
  }
  if (!url) { showOnline(osmSource()); toast('Using OpenStreetMap.'); return; }
  const custom = customSource(url, attribution);
  if (await probeSource(custom)) {
    showOnline(custom);
    toast('Connected. Using your tile server.');
  } else {
    toast("Saved, but your server didn't respond.");
    await handleServerDown(custom);
  }
}

async function clearTileCache() {
  try {
    const removed = await caches.delete(TILE_CACHE);
    toast(removed ? 'Cached map tiles cleared.' : 'No cached tiles to clear yet.');
  } catch {
    toast("Couldn't clear cached tiles.");
  }
}

async function addMapFile(file) {
  try {
    const added = await mapFiles.add(file);
    navigator.storage?.persist?.().catch(() => {});
    toast(`Added ${added.name}.`);
  } catch (err) {
    if (!(err instanceof MapFileError)) console.error(err); // a wrong file type is expected, not a bug
    await confirmDialog({
      title: "Can't add this file",
      message: err instanceof MapFileError ? err.message : "The file couldn't be saved on this device. It may be too large.",
      confirmLabel: 'OK',
      cancelLabel: null,
    });
    return;
  }
  await loadLocalFiles();
  await setupTiles();
  if (state.view === 'settings') renderPanel();
}

async function removeMapFile(name) {
  const confirmed = await confirmDialog({
    title: 'Remove this map file?',
    message: `“${name}” will be removed from this device. You can add it again later.`,
    confirmLabel: 'Remove',
    cancelLabel: 'Keep',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await mapFiles.remove(name);
  } catch (err) {
    console.error(err);
    toast("Couldn't remove that file.");
    return;
  }
  await loadLocalFiles();
  await setupTiles();
  if (state.view === 'settings') renderPanel();
}

async function toggleLocalOnline(checked) {
  saveSettings({ ...loadSettings(), localOnline: checked });
  await setupTiles();
}

/* ---------- wiring ---------- */

store.subscribe(() => {
  mapView.setPlaces(visiblePlaces());
  if (state.view === 'list' || state.view === 'settings') renderPanel();
  updateEmpty();
});

pinButton.addEventListener('click', pinCurrentLocation);
$('#settings-button').addEventListener('click', () => navigate('settings'));
$('#timeline-button').addEventListener('click', () => navigate('timeline'));
$('#places-button').addEventListener('click', () => navigate('list'));

desktop.addEventListener('change', () => {
  if (desktop.matches && state.view === 'none') setView('list');
  else if (!desktop.matches && state.view === 'list') setView('none');
});

$('#empty .title').textContent = EMPTY_TITLE;
$('#empty .text').textContent = EMPTY_TEXT;

async function start() {
  setView('none');
  const tiles = loadLocalFiles().then(setupTiles); // runs alongside loading saved places
  try {
    await store.load();
    mapView.fitToPlaces(store.places);
  } catch (err) {
    console.error(err);
    toast("Couldn't open saved places on this device. Private windows can block storage.", 8000);
  }
  updateEmpty();
  await tiles;
}

start();

if ('serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker not registered', err));
  });
}
