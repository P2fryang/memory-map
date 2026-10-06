// Panel views: functions that build DOM from data and call back into main.js.
// (On phones the panel is a bottom sheet; on desktop it's the left sidebar.)
import { h } from './dom.js';
import { DEFAULT_TIME, formatDate, formatTime, nowLocalTime, todayLocal } from './dates.js';
import { ratingDisplay, ratingInput } from './rating.js';
import { latestVisit, sortVisits } from './schema.js';
import { validatePlaceBase, validateVisitFields } from './validation.js';
import { validateTileUrl } from './tiles.js';
import { MAX_TAGS_PER_VISIT, filterPlaces, placeTags } from './tags.js';
import { renderTagPicker } from './tagPicker.js';

const formatCoords = (lat, lng) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function setInvalid(input, message) {
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

const tagChips = (tags) => (tags.length ? h('p', { class: 'tag-list' }, tags.map((t) => h('span', { class: 'tag' }, t))) : null);

const closeButton = (onClose, label = 'Close') =>
  h('button', { type: 'button', class: 'btn ghost close', onclick: onClose }, label);

export const EMPTY_TITLE = 'No places yet.';
export const EMPTY_TEXT = "Pin somewhere you've been to start building your personal map. You can also tap the map to pin any spot.";

/* ---------- tag filter (Places list and timeline) ---------- */

/** Tag picker plus an All/Any switch (shown once two tags are picked). onChange({ tags, match }). */
function renderTagFilter({ stats, filter: initial, onChange }) {
  let filter = { tags: [...initial.tags], match: initial.match };
  const picker = renderTagPicker({
    selected: filter.tags, stats, allowNew: false, label: 'Filter by tag', placeholder: 'Filter by tag',
    onChange: (tags) => { filter = { ...filter, tags }; paint(); emit(); },
  });
  const buttons = [['all', 'All of these'], ['any', 'Any of these']].map(([value, text]) =>
    h('button', {
      type: 'button', class: 'segment', role: 'radio', 'data-match': value,
      onclick: () => { filter = { ...filter, match: value }; paint(); emit(); },
    }, text));
  const control = h('div', { class: 'segments', role: 'radiogroup', 'aria-label': 'Match', hidden: true }, buttons);

  function emit() { onChange({ tags: [...filter.tags], match: filter.match }); }
  function paint() {
    control.hidden = filter.tags.length < 2;
    for (const b of buttons) {
      const on = b.dataset.match === filter.match;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
  }
  paint();
  return h('div', { class: 'tag-filter' }, picker.el, control);
}

/* ---------- list ---------- */

/** The filter is shared with the map and the timeline: onFilterChange(filter) tells the caller to keep it. */
export function renderList({ places, stats, filter, onFilterChange, onSelect, onClose }) {
  const results = h('div', { class: 'list-results' });

  function paint(f) {
    const rows = filterPlaces(places, f)
      .map((p) => ({ place: p, last: latestVisit(p) }))
      .sort((a, b) => b.last.date.localeCompare(a.last.date) || b.place.createdAt.localeCompare(a.place.createdAt));
    results.replaceChildren(rows.length === 0
      ? h('div', { class: 'empty-inline' },
          h('p', { class: 'strong' }, f.tags.length ? 'No places match these tags.' : EMPTY_TITLE),
          h('p', {}, f.tags.length ? 'Try fewer tags, or switch to “Any of these”.' : EMPTY_TEXT))
      : h('ul', { class: 'place-list' }, rows.map(({ place, last }) =>
          h('li', {},
            h('button', { type: 'button', class: 'place-row', onclick: () => onSelect(place.id) },
              h('span', { class: 'place-row-name' }, place.name),
              h('span', { class: 'place-row-meta' },
                h('span', {}, formatDate(last.date)),
                ratingDisplay(last.rating),
                place.visits.length > 1 ? h('span', {}, plural(place.visits.length, 'visit')) : null,
              ),
              placeTags(place).length
                ? h('span', { class: 'place-row-tags' },
                    placeTags(place).slice(0, 3).join(' · ') + (placeTags(place).length > 3 ? ` +${placeTags(place).length - 3}` : ''))
                : null,
            ),
          ))));
  }

  const filterEl = stats.length
    ? renderTagFilter({ stats, filter, onChange: (f) => { onFilterChange(f); paint(f); } })
    : null;
  paint(filter);
  return h('section', { class: 'view' },
    h('header', { class: 'view-head' }, h('h2', {}, 'Places'), onClose ? closeButton(onClose) : null),
    filterEl,
    results,
  );
}

/* ---------- detail ---------- */

export function renderDetail({ place, onAddVisit, onEditPlace, onDeletePlace, onEditVisit, onDeleteVisit, onClose }) {
  const visits = sortVisits(place.visits);
  const canDeleteVisit = visits.length > 1;
  return h('section', { class: 'view' },
    h('header', { class: 'view-head' }, h('span', { class: 'spacer' }), closeButton(onClose)),
    h('h2', { class: 'place-name' }, place.name),
    h('p', { class: 'place-date' },
      visits.length === 1 ? formatDate(visits[0].date) : `${plural(visits.length, 'visit')} · last ${formatDate(visits[0].date)}`),
    h('p', { class: 'coords' }, formatCoords(place.latitude, place.longitude)),
    tagChips(placeTags(place)),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn primary', onclick: onAddVisit }, 'Add visit'),
      h('button', { type: 'button', class: 'btn', onclick: onEditPlace }, 'Edit place'),
    ),

    h('h3', {}, visits.length === 1 ? 'Visit' : 'Visits'),
    h('ul', { class: 'visit-list' }, visits.map((v) =>
      h('li', {},
        h('div', { class: 'visit-head' },
          h('span', { class: 'visit-date' }, formatDate(v.date)),
          h('span', { class: 'hint' }, formatTime(v.time)),
          ratingDisplay(v.rating),
        ),
        v.notes ? h('p', { class: 'place-notes' }, v.notes) : null,
        tagChips(v.tags ?? []),
        h('div', { class: 'visit-actions' },
          h('button', { type: 'button', class: 'btn ghost small', onclick: () => onEditVisit(v) }, 'Edit'),
          canDeleteVisit ? h('button', { type: 'button', class: 'btn ghost small danger-text', onclick: () => onDeleteVisit(v) }, 'Delete') : null,
        ),
      ))),

    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn danger-outline', onclick: onDeletePlace }, 'Delete place'),
    ),
  );
}

/* ---------- form ---------- */

/**
 * One form for all four jobs. `show` picks the sections: { place: name + map location, visit: date/time/rating/notes/tags }.
 * onSave(values) resolves true on success; values holds only the shown sections' fields.
 * Returns { el, setCoords, focus }.
 */
export function renderForm({ title, subtitle, show, initial = {}, coords, tagStats = [], onSave, onCancel }) {
  let rating = initial.rating ?? null;
  let current = { latitude: coords?.latitude ?? 0, longitude: coords?.longitude ?? 0 };

  const nameInput = h('input', {
    id: 'f-name', type: 'text', autocomplete: 'off', autocapitalize: 'words', maxlength: '120',
    value: initial.name ?? '', 'aria-describedby': 'e-name',
  });
  const dateInput = h('input', { id: 'f-date', type: 'date', value: initial.date ?? todayLocal(), 'aria-describedby': 'e-date' });
  // New visits start at the current time; Reset puts the default (00:01) back.
  const timeInput = h('input', { id: 'f-time', type: 'time', value: initial.date ? (initial.time ?? DEFAULT_TIME) : nowLocalTime(), 'aria-describedby': 'e-time' });
  const clearTime = h('button', { type: 'button', class: 'btn small', onclick: () => { timeInput.value = DEFAULT_TIME; } }, 'Reset');
  const notesInput = h('textarea', { id: 'f-notes', rows: '4' }, initial.notes ?? '');
  const coordsText = h('span', {}, formatCoords(current.latitude, current.longitude));
  const errName = h('p', { class: 'field-error', id: 'e-name', role: 'alert' });
  const errDate = h('p', { class: 'field-error', id: 'e-date', role: 'alert' });
  const errTime = h('p', { class: 'field-error', id: 'e-time', role: 'alert' });
  const saveButton = h('button', { type: 'submit', class: 'btn primary' }, 'Save');
  const tagPicker = show.visit
    ? renderTagPicker({ selected: initial.tags ?? [], stats: tagStats, allowNew: true, label: 'Tags', placeholder: 'Add a tag', max: MAX_TAGS_PER_VISIT })
    : null;

  const form = h('form', { class: 'view form', novalidate: true },
    h('header', { class: 'view-head' }, h('h2', {}, title)),
    subtitle ? h('p', { class: 'form-subtitle' }, subtitle) : null,

    show.place ? h('div', { class: 'field' }, h('label', { for: 'f-name' }, 'Name'), nameInput, errName) : null,
    show.visit ? h('div', { class: 'field' }, h('label', { for: 'f-date' }, 'Date'), dateInput, errDate) : null,
    show.visit ? h('div', { class: 'field' },
      h('label', { for: 'f-time' }, 'Time'),
      h('div', { class: 'input-row' }, timeInput, clearTime),
      errTime,
    ) : null,
    show.visit ? h('div', { class: 'field' },
      h('span', { class: 'label' }, 'Rating (optional)'),
      ratingInput(rating, (v) => { rating = v; }),
    ) : null,
    show.visit ? h('div', { class: 'field' }, h('label', { for: 'f-notes' }, 'Notes (optional)'), notesInput) : null,
    show.visit ? h('div', { class: 'field' },
      h('span', { class: 'label' }, 'Tags (optional)'),
      tagPicker.el,
      h('p', { class: 'hint' }, 'Lowercase only. Examples: ramen, trip:japan-2026. Enter or comma adds a tag.'),
    ) : null,

    show.place ? h('p', { class: 'coords-line' },
      h('span', { class: 'coords' }, coordsText),
      h('span', { class: 'hint' }, 'Drag the pin or tap the map to move it.'),
    ) : null,

    h('div', { class: 'actions' },
      saveButton,
      h('button', { type: 'button', class: 'btn', onclick: onCancel }, 'Cancel'),
    ),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errors = {};
    const values = {};
    if (show.place) {
      const r = validatePlaceBase({ name: nameInput.value, ...current });
      Object.assign(errors, r.errors);
      Object.assign(values, r.value);
    }
    if (show.visit) {
      tagPicker.commitPending(); // a tag typed but not yet entered still counts
      const r = validateVisitFields({ date: dateInput.value, time: timeInput.value, rating, notes: notesInput.value, tags: tagPicker.getTags() });
      Object.assign(errors, r.errors);
      Object.assign(values, r.value);
    }
    errName.textContent = errors.name ?? '';
    errDate.textContent = errors.date ?? '';
    errTime.textContent = errors.time ?? '';
    setInvalid(nameInput, errors.name);
    setInvalid(dateInput, errors.date);
    setInvalid(timeInput, errors.time);
    if (Object.keys(errors).length) {
      (errors.name ? nameInput : errors.date ? dateInput : timeInput).focus();
      return;
    }
    saveButton.disabled = true;
    const ok = await onSave(values);
    if (!ok) saveButton.disabled = false;
  });

  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') onCancel();
  });

  return {
    el: form,
    setCoords(latitude, longitude) {
      current = { latitude, longitude };
      coordsText.textContent = formatCoords(latitude, longitude);
    },
    focus() { nameInput.focus(); },
  };
}

/* ---------- settings ---------- */

const formatBytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export function renderSettings({
  count, lastExport, onExport, onImportFile, onClose,
  tiles, onSaveTiles, onClearTileCache,
  maps, onAddMapFile, onRemoveMapFile, onToggleLocalOnline,
}) {
  const mapFileInput = h('input', {
    type: 'file', hidden: true, // no `accept`: phones grey out unknown extensions like .pmtiles
    onchange: (event) => {
      const file = event.target.files[0];
      event.target.value = '';
      if (file) onAddMapFile(file);
    },
  });

  const fileInput = h('input', {
    type: 'file', accept: 'application/json,.json', hidden: true,
    onchange: (event) => {
      const file = event.target.files[0];
      event.target.value = '';
      if (file) onImportFile(file);
    },
  });

  const urlInput = h('input', {
    id: 's-url', type: 'text', value: tiles.url, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
    placeholder: 'https://tiles.example.com/{z}/{x}/{y}.png', 'aria-describedby': 's-url-help s-url-error',
  });
  const attributionInput = h('input', { id: 's-attr', type: 'text', value: tiles.attribution, autocomplete: 'off' });
  const fallbackSelect = h('select', { id: 's-fallback', class: 'select' },
    [['ask', 'Ask me'], ['always', 'Use OpenStreetMap automatically'], ['never', 'Keep using my server']]
      .map(([value, text]) => h('option', { value, selected: value === tiles.fallback }, text)));
  const urlError = h('p', { class: 'field-error', id: 's-url-error', role: 'alert' });
  const saveTiles = h('button', { type: 'button', class: 'btn primary' }, 'Save and test');

  saveTiles.addEventListener('click', async () => {
    const error = validateTileUrl(urlInput.value);
    urlError.textContent = error ?? '';
    setInvalid(urlInput, error);
    if (error) { urlInput.focus(); return; }
    saveTiles.disabled = true;
    try {
      await onSaveTiles({ url: urlInput.value.trim(), attribution: attributionInput.value.trim(), fallback: fallbackSelect.value });
    } finally {
      saveTiles.disabled = false;
    }
  });

  return h('section', { class: 'view' },
    h('header', { class: 'view-head' }, h('h2', {}, 'Settings'), closeButton(onClose)),

    h('h3', {}, 'Backup'),
    h('p', {}, `${plural(count, 'place')} saved on this device. They live only in this browser, so export a backup now and then.`),
    h('p', { class: 'hint' }, lastExport ? `Last backup: ${lastExport}` : "You haven't exported a backup yet."),
    h('div', { class: 'actions stack' },
      h('button', { type: 'button', class: 'btn primary', onclick: onExport }, 'Export places (JSON)'),
      h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, 'Import places…'),
    ),
    fileInput,

    h('h3', {}, 'Map tiles'),
    h('p', {}, `Currently using ${tiles.activeLabel}.`),
    h('div', { class: 'field' },
      h('label', { for: 's-url' }, 'Your tile server (optional)'),
      urlInput,
      h('p', { class: 'hint', id: 's-url-help' }, 'A tile address with {z}/{x}/{y}, or a style .json address. It must use https:// and allow cross-origin requests. Leave empty to use OpenStreetMap.'),
      urlError,
    ),
    h('div', { class: 'field' }, h('label', { for: 's-attr' }, 'Attribution'), attributionInput),
    h('div', { class: 'field' }, h('label', { for: 's-fallback' }, "If my server can't be reached"), fallbackSelect),
    h('div', { class: 'actions stack' },
      saveTiles,
      h('button', { type: 'button', class: 'btn', onclick: onClearTileCache }, 'Clear cached map tiles'),
    ),
    h('p', { class: 'hint' }, 'Tiles you have looked at are kept on this device for about a week, so revisiting a place loads faster and can work briefly offline.'),

    h('h3', {}, 'Offline map files'),
    h('p', {}, 'Add .pmtiles files and the map is drawn from this device with no network. A small worldwide file plus files for regions you pin often works well.'),
    maps.supported ? null : h('p', { class: 'hint' }, "The map-file reader didn't load. Connect once and reload to turn this on."),
    maps.files.length
      ? h('ul', { class: 'file-list' }, maps.files.map((f) =>
          h('li', {},
            h('div', {},
              h('span', { class: 'strong file-name' }, f.name),
              h('span', { class: 'hint' }, `${f.header.kind} · zoom ${f.header.minZoom}–${f.header.maxZoom} · ${formatBytes(f.size)}`),
            ),
            h('button', { type: 'button', class: 'btn ghost small danger-text', onclick: () => onRemoveMapFile(f.name) }, 'Remove'),
          )))
      : h('p', { class: 'hint' }, 'No map files added yet.'),
    h('div', { class: 'actions stack' },
      h('button', { type: 'button', class: 'btn', disabled: !maps.supported, onclick: () => mapFileInput.click() }, 'Add map file…'),
    ),
    mapFileInput,
    maps.files.length
      ? h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: maps.localOnline, onchange: (event) => onToggleLocalOnline(event.target.checked) }),
          h('span', {}, 'Use the online map for detail beyond these files'))
      : null,
    h('p', { class: 'hint' }, 'Files are copied into this browser and never uploaded. Labels are not drawn on offline maps. Keep an eye on file sizes, especially on a phone.'),

    h('h3', {}, 'Privacy'),
    h('p', {}, 'Your places never leave this device. Your location is read only when you tap Pin location, and only saved if you save the place.'),
    h('p', { class: 'hint' }, 'Map tiles are fetched from your tile server or from OpenStreetMap, which can see the area you are viewing.'),
  );
}

/* ---------- timeline ---------- */

/**
 * Slider over the dates of every (matching) visit, with an optional tag filter.
 *   getModel(filter)   -> timeline model for that filter (see timeline.js)
 *   filter             { tags, match }   remembered by the caller between openings
 *   onFilterChange(f)  called whenever the user changes the filter
 *   onChange(state)    called with { date, counts, onDate } whenever the slider moves
 * Returns { el, ready, destroy, showPlace }. Call ready() once mounted to apply the first state.
 */
export function renderTimeline({ getModel, stats, filter: initialFilter, onFilterChange, onChange, onClose }) {
  let filter = { tags: [...initialFilter.tags], match: initialFilter.match };
  let model = getModel(filter);
  let index = 0;
  let timer = null;
  let playButton = null;

  const body = h('div', { class: 'timeline-body' });
  const head = h('header', { class: 'view-head' }, h('h2', {}, 'Timeline'), closeButton(onClose));

  /* --- tag filter --- */
  const tagFilter = renderTagFilter({ stats, filter, onChange: (f) => { filter = f; refilter(); } });

  /* --- slider --- */
  function stop() {
    clearInterval(timer);
    timer = null;
    if (playButton) playButton.textContent = 'Play';
  }

  function buildBody() {
    stop();
    const n = model.dates.length;
    if (n === 0) {
      body.replaceChildren(h('div', { class: 'empty-inline' },
        h('p', { class: 'strong' }, filter.tags.length ? 'No visits match these tags.' : EMPTY_TITLE),
        h('p', {}, filter.tags.length ? 'Try fewer tags, or switch to “Any of these”.' : 'Pin a place and it will appear here.')));
      playButton = null;
      return { n, apply: () => onChange({ date: null, counts: new Map(), onDate: [] }) };
    }

    const dateLabel = h('p', { class: 'timeline-date' });
    const summary = h('p', { class: 'timeline-summary' });
    const caption = h('p', { class: 'hint timeline-caption' });
    const slider = h('input', {
      type: 'range', min: '0', max: String(n - 1), step: '1', value: String(n - 1),
      'aria-label': 'Date', disabled: n === 1,
    });
    playButton = h('button', { type: 'button', class: 'btn primary', disabled: n === 1 }, 'Play');

    function apply(i) {
      index = i;
      slider.value = String(i);
      const state = model.stateAt(i);
      dateLabel.textContent = formatDate(state.date);
      slider.setAttribute('aria-valuetext', formatDate(state.date));
      summary.textContent = `${state.counts.size} of ${plural(model.placeCount, 'place')}`;
      caption.textContent = state.onDate.length ? state.onDate.map((p) => p.name).join(' · ') : '';
      onChange(state);
    }

    function play() {
      if (index >= n - 1) apply(0);
      playButton.textContent = 'Pause';
      const stepMs = Math.max(250, Math.min(1200, Math.round(12000 / n)));
      timer = setInterval(() => {
        if (index >= n - 1) { stop(); return; }
        apply(index + 1);
      }, stepMs);
    }

    slider.addEventListener('input', () => { stop(); apply(Number(slider.value)); });
    playButton.addEventListener('click', () => (timer ? stop() : play()));
    body.replaceChildren(dateLabel, summary, slider, h('div', { class: 'actions' }, playButton), caption);
    index = n - 1;
    return { n, apply: () => apply(n - 1), caption };
  }

  let current = buildBody();

  function refilter() {
    onFilterChange({ tags: [...filter.tags], match: filter.match });
    model = getModel(filter);
    current = buildBody();
    current.apply();
  }

  return {
    el: h('section', { class: 'view timeline' }, head, tagFilter, body),
    ready() { current.apply(); },
    destroy: stop,
    showPlace(id) {
      const place = model.places.find((p) => p.id === id);
      if (place && current.caption) current.caption.textContent = `${place.name} · ${plural(place.visits.length, 'visit')}`;
    },
  };
}
