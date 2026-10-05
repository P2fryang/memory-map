// The "Add to my places" review dialog: shows what will happen and lets the user decide
// how each real conflict is resolved.
import { h } from './dom.js';
import { choiceDialog } from './dialog.js';
import { describeConflict } from './merge.js';
import { formatDate } from './dates.js';
import { latestVisit } from './schema.js';

const OPTIONS = [
  ['merge', 'Combine (newest edit wins)'],
  ['mine', 'Keep mine'],
  ['theirs', "Use the file's version"],
];

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const summarize = (p) => `${plural(p.visits.length, 'visit')}, last ${formatDate(latestVisit(p).date)}`;

function select(id, label) {
  return h('select', { id, 'aria-label': label, class: 'select' },
    OPTIONS.map(([value, text]) => h('option', { value }, text)));
}

/**
 * Resolves to null (cancelled) or an array with one resolution per conflict.
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

  const selects = plan.conflicts.map((_, i) => select(`conflict-${i}`, 'How to resolve'));
  const setAll = plan.conflicts.length > 1 ? select('conflict-all', 'Apply to all conflicts') : null;
  if (setAll) setAll.addEventListener('change', () => selects.forEach((s) => { s.value = setAll.value; }));

  const content = h('div', { class: 'review' },
    lines.length ? h('ul', { class: 'review-summary' }, lines.map((l) => h('li', {}, l))) : null,
    plan.conflicts.length
      ? h('div', {},
          h('h3', {}, `${plural(plan.conflicts.length, 'place')} differ${plan.conflicts.length === 1 ? 's' : ''} from what you have`),
          setAll ? h('label', { class: 'review-all' }, 'For all of them: ', setAll) : null,
          h('ul', { class: 'conflicts' }, plan.conflicts.map((c, i) =>
            h('li', {},
              h('p', { class: 'strong' }, c.existing.name),
              h('p', { class: 'hint' }, `On this device: ${summarize(c.existing)}`),
              h('p', { class: 'hint' }, `In the file: ${summarize(c.incoming)}`),
              describeConflict(c).map((r) => h('p', { class: 'hint' }, r)),
              selects[i],
            ))),
        )
      : null,
  );
  const result = await choiceDialog({
    title: 'Add places from file',
    content,
    read: () => selects.map((s) => s.value),
    choices: [
      { value: 'cancel', label: 'Cancel' },
      { value: 'ok', label: plan.conflicts.length ? 'Import' : 'Add to my places', kind: 'primary' },
    ],
  });
  return result?.value === 'ok' ? result.data : null;
}
