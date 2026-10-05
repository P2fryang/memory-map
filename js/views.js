// Panel views: functions that build DOM from data and call back into main.js.
// (On phones the panel is a bottom sheet; on desktop it's the left sidebar.)
import { h } from './dom.js';
import { formatDate, todayLocal } from './dates.js';
import { ratingDisplay, ratingInput } from './rating.js';
import { latestVisit, sortVisits } from './schema.js';
import { validatePlaceBase, validateVisitFields } from './validation.js';
import { validateTileUrl } from './tiles.js';

const formatCoords = (lat, lng) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function setInvalid(input, message) {
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

const closeButton = (onClose, label = 'Close') =>
  h('button', { type: 'button', class: 'btn ghost close', onclick: onClose }, label);

export const EMPTY_TITLE = 'No places yet.';
export const EMPTY_TEXT = "Pin somewhere you've been to start building your personal map. You can also tap the map to pin any spot.";

/* ---------- list ---------- */

export function renderList({ places, onSelect, onClose }) {
  const rows = places
    .map((p) => ({ place: p, last: latestVisit(p) }))
    .sort((a, b) => b.last.date.localeCompare(a.last.date) || b.place.createdAt.localeCompare(a.place.createdAt));
  return h('section', { class: 'view' },
    h('header', { class: 'view-head' }, h('h2', {}, 'Places'), onClose ? closeButton(onClose) : null),
    rows.length === 0
      ? h('div', { class: 'empty-inline' }, h('p', { class: 'strong' }, EMPTY_TITLE), h('p', {}, EMPTY_TEXT))
      : h('ul', { class: 'place-list' }, rows.map(({ place, last }) =>
          h('li', {},
            h('button', { type: 'button', class: 'place-row', onclick: () => onSelect(place.id) },
              h('span', { class: 'place-row-name' }, place.name),
              h('span', { class: 'place-row-meta' },
                h('span', {}, formatDate(last.date)),
                ratingDisplay(last.rating),
                place.visits.length > 1 ? h('span', {}, plural(place.visits.length, 'visit')) : null,
              ),
            ),
          ))),
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
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn primary', onclick: onAddVisit }, 'Add visit'),
      h('button', { type: 'button', class: 'btn', onclick: onEditPlace }, 'Edit place'),
    ),

    h('h3', {}, visits.length === 1 ? 'Visit' : 'Visits'),
    h('ul', { class: 'visit-list' }, visits.map((v) =>
      h('li', {},
        h('div', { class: 'visit-head' },
          h('span', { class: 'visit-date' }, formatDate(v.date)),
          ratingDisplay(v.rating),
        ),
        v.notes ? h('p', { class: 'place-notes' }, v.notes) : null,
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
 * One form for all four jobs. `show` picks the sections: { place: name + map location, visit: date/rating/notes }.
 * onSave(values) resolves true on success; values holds only the shown sections' fields.
 * Returns { el, setCoords, focus }.
 */
export function renderForm({ title, subtitle, show, initial = {}, coords, onSave, onCancel }) {
  let rating = initial.rating ?? null;
  let current = { latitude: coords?.latitude ?? 0, longitude: coords?.longitude ?? 0 };

  const nameInput = h('input', {
    id: 'f-name', type: 'text', autocomplete: 'off', autocapitalize: 'words', maxlength: '120',
    value: initial.name ?? '', 'aria-describedby': 'e-name',
  });
  const dateInput = h('input', { id: 'f-date', type: 'date', value: initial.date ?? todayLocal(), 'aria-describedby': 'e-date' });
  const notesInput = h('textarea', { id: 'f-notes', rows: '4' }, initial.notes ?? '');
  const coordsText = h('span', {}, formatCoords(current.latitude, current.longitude));
  const errName = h('p', { class: 'field-error', id: 'e-name', role: 'alert' });
  const errDate = h('p', { class: 'field-error', id: 'e-date', role: 'alert' });
  const saveButton = h('button', { type: 'submit', class: 'btn primary' }, 'Save');

  const form = h('form', { class: 'view form', novalidate: true },
    h('header', { class: 'view-head' }, h('h2', {}, title)),
    subtitle ? h('p', { class: 'form-subtitle' }, subtitle) : null,

    show.place ? h('div', { class: 'field' }, h('label', { for: 'f-name' }, 'Name'), nameInput, errName) : null,
    show.visit ? h('div', { class: 'field' }, h('label', { for: 'f-date' }, 'Date'), dateInput, errDate) : null,
    show.visit ? h('div', { class: 'field' },
      h('span', { class: 'label' }, 'Rating (optional)'),
      ratingInput(rating, (v) => { rating = v; }),
    ) : null,
    show.visit ? h('div', { class: 'field' }, h('label', { for: 'f-notes' }, 'Notes (optional)'), notesInput) : null,

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
      const r = validateVisitFields({ date: dateInput.value, rating, notes: notesInput.value });
      Object.assign(errors, r.errors);
      Object.assign(values, r.value);
    }
    errName.textContent = errors.name ?? '';
    errDate.textContent = errors.date ?? '';
    setInvalid(nameInput, errors.name);
    setInvalid(dateInput, errors.date);
    if (Object.keys(errors).length) {
      (errors.name ? nameInput : dateInput).focus();
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

export function renderSettings({
  count, lastExport, onExport, onImportFile, onClose,
  tiles, onSaveTiles, onClearTileCache,
}) {
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

    h('h3', {}, 'Privacy'),
    h('p', {}, 'Your places never leave this device. Your location is read only when you tap Pin location, and only saved if you save the place.'),
    h('p', { class: 'hint' }, 'Map tiles are fetched from your tile server or from OpenStreetMap, which can see the area you are viewing.'),
  );
}

/* ---------- timeline ---------- */

/**
 * Slider over the dates of every visit. onChange(state) is called with timeline.stateAt(i).
 * Returns { el, ready, destroy, showPlace }. Call ready() once mounted to apply the first state.
 */
export function renderTimeline({ model, onChange, onClose }) {
  const n = model.dates.length;
  const head = h('header', { class: 'view-head' }, h('h2', {}, 'Timeline'), closeButton(onClose));

  if (n === 0) {
    return {
      el: h('section', { class: 'view' }, head,
        h('div', { class: 'empty-inline' }, h('p', { class: 'strong' }, EMPTY_TITLE), h('p', {}, 'Pin a place and it will appear here.'))),
      ready() {}, destroy() {}, showPlace() {},
    };
  }

  let index = n - 1;
  let timer = null;

  const dateLabel = h('p', { class: 'timeline-date' });
  const summary = h('p', { class: 'timeline-summary' });
  const caption = h('p', { class: 'hint timeline-caption' });
  const slider = h('input', {
    type: 'range', min: '0', max: String(n - 1), step: '1', value: String(n - 1),
    'aria-label': 'Date', disabled: n === 1,
  });
  const playButton = h('button', { type: 'button', class: 'btn primary', disabled: n === 1 }, 'Play');

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

  function stop() {
    clearInterval(timer);
    timer = null;
    playButton.textContent = 'Play';
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

  return {
    el: h('section', { class: 'view timeline' }, head, dateLabel, summary, slider,
      h('div', { class: 'actions' }, playButton), caption),
    ready() { apply(index); },
    destroy: stop,
    showPlace(place) {
      caption.textContent = `${place.name} · ${plural(place.visits.length, 'visit')}`;
    },
  };
}
