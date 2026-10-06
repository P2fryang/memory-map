// The "Add to my places" review dialog: shows what will happen and lets the user decide
// how each real conflict is resolved: once for the place, then optionally per differing visit.
import { h } from './dom.js';
import { choiceDialog } from './dialog.js';
import { clashingVisits, sameName, sameSpot } from './merge.js';
import { formatDate, formatTime } from './dates.js';
import { latestVisit } from './schema.js';

const OPTIONS = [
  ['merge', 'Combine (newest edit wins)'],
  ['mine', 'Keep mine'],
  ['theirs', "Use the file's version"],
];
const VISIT_OPTIONS = [['', 'Same as above'], ['mine', 'Keep mine'], ['theirs', "Use the file's version"]];

const VISIT_FIELDS = [
  ['Date', (v) => formatDate(v.date)],
  ['Time', (v) => (v.time ? formatTime(v.time) : '')],
  ['Rating', (v) => (v.rating ? `${v.rating} of 5` : '')],
  ['Notes', (v) => v.notes ?? ''],
  ['Tags', (v) => [...(v.tags ?? [])].sort().join(', ')],
  ['Photos', (v) => (v.photos ?? []).join(', ')],
];

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const summarize = (p) => `${plural(p.visits.length, 'visit')}, last ${formatDate(latestVisit(p).date)}`;
const coords = (p) => `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;

function select(label, options) {
  return h('select', { 'aria-label': label, class: 'select' },
    options.map(([value, text]) => h('option', { value }, text)));
}

/** Side-by-side values. rows: [[label, mine, theirs], ...] */
function compareTable(rows) {
  return h('table', { class: 'compare' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Field'), h('th', {}, 'On this device'), h('th', {}, 'In the file'))),
    h('tbody', {}, rows.map(([label, mine, theirs]) =>
      h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, mine || '—'), h('td', {}, theirs || '—')))));
}

const placeRows = ({ existing, incoming }) => [
  ...(sameName(existing, incoming) ? [] : [['Name', existing.name, incoming.name]]),
  ...(sameSpot(existing, incoming) ? [] : [['Location', coords(existing), coords(incoming)]]),
];

const visitRows = ({ mine, theirs }) =>
  VISIT_FIELDS.map(([label, show]) => [label, show(mine), show(theirs)]).filter(([, a, b]) => a !== b);

/** One conflict: its differences side by side, a choice for the place, and one per differing visit. */
function conflictItem(conflict) {
  const { existing, incoming } = conflict;
  const base = select('How to resolve', OPTIONS);
  const clashes = clashingVisits(existing, incoming).map((pair) => ({
    pair,
    select: select(`How to resolve the visit on ${formatDate(pair.mine.date)}`, VISIT_OPTIONS),
  }));
  const rows = placeRows(conflict);
  const el = h('li', {},
    h('p', { class: 'strong' }, existing.name),
    h('p', { class: 'hint' }, `On this device: ${summarize(existing)}`),
    h('p', { class: 'hint' }, `In the file: ${summarize(incoming)}`),
    rows.length ? compareTable(rows) : null,
    clashes.map(({ pair, select: choice }) =>
      h('div', { class: 'clash' },
        h('p', { class: 'strong' }, `Visit on ${formatDate(pair.mine.date)}`),
        compareTable(visitRows(pair)),
        choice)),
    clashes.length ? h('label', { class: 'review-all' }, 'Everything else in this place', base) : base,
  );
  return {
    el,
    read: () => ({
      base: base.value,
      visits: Object.fromEntries(clashes.filter((c) => c.select.value).map((c) => [c.pair.mine.id, c.select.value])),
    }),
    setBase: (value) => { base.value = value; },
  };
}

/**
 * Resolves to null (cancelled) or an array with one resolution per conflict:
 * { base: 'merge' | 'mine' | 'theirs', visits: { [visitId]: 'mine' | 'theirs' } }.
 * `plan` comes from planMerge().
 */
export async function reviewImport(plan) {
  const lines = [];
  if (plan.added.length) lines.push(`${plural(plan.added.length, 'new place')} will be added.`);
  if (plan.merged.length) {
    const visits = plan.merged.reduce((n, m) => n + m.newVisits, 0);
    lines.push(`${plural(plan.merged.length, 'place')} will get ${plural(visits, 'new visit')}.`);
  }
  if (plan.identical) lines.push(`${plural(plan.identical, 'place')} ${plan.identical === 1 ? 'is' : 'are'} already here and will be skipped.`);

  const items = plan.conflicts.map(conflictItem);
  const setAll = items.length > 1 ? select('Apply to all conflicts', OPTIONS) : null;
  if (setAll) setAll.addEventListener('change', () => items.forEach((item) => item.setBase(setAll.value)));

  const content = h('div', { class: 'review' },
    lines.length ? h('ul', { class: 'review-summary' }, lines.map((l) => h('li', {}, l))) : null,
    items.length
      ? h('div', {},
          h('h3', {}, `${plural(items.length, 'place')} differ${items.length === 1 ? 's' : ''} from what you have`),
          setAll ? h('label', { class: 'review-all' }, 'For all of them: ', setAll) : null,
          h('ul', { class: 'conflicts' }, items.map((item) => item.el)),
        )
      : null,
  );
  const result = await choiceDialog({
    title: 'Add places from file',
    content,
    read: () => items.map((item) => item.read()),
    choices: [
      { value: 'cancel', label: 'Cancel' },
      { value: 'ok', label: items.length ? 'Import' : 'Add to my places', kind: 'primary' },
    ],
  });
  return result?.value === 'ok' ? result.data : null;
}
