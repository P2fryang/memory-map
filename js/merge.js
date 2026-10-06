// "Add" import: combine an incoming list of places with the ones already saved.
//
// Places are matched by id. For a place that exists on both sides:
//   - nothing new in the file                          -> identical (skipped)
//   - file only ADDS visits (same name/location)       -> merged automatically
//   - name/location differ, or the same visit differs  -> conflict: the user chooses
//       'merge'  combine visits; newer edit wins for name/location and for clashing visits
//       'mine'   keep what's on this device
//       'theirs' use the file's version
import { distanceMeters } from './geo.js';
import { sortVisits } from './schema.js';

export const RESOLUTIONS = ['merge', 'mine', 'theirs'];

const visitKey = (v) => JSON.stringify([v.date, v.rating ?? null, v.notes ?? '', v.photos ?? [], [...(v.tags ?? [])].sort()]);
const sameVisit = (a, b) => visitKey(a) === visitKey(b);
const stamp = (iso) => Date.parse(iso) || 0;

const sameName = (a, b) => a.name === b.name;
const sameSpot = (a, b) => distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude) < 1;

function classify(existing, incoming) {
  const mine = new Map(existing.visits.map((v) => [v.id, v]));
  let visitsDiffer = false;
  let newVisits = 0;
  for (const v of incoming.visits) {
    const m = mine.get(v.id);
    if (!m) newVisits++;
    else if (!sameVisit(m, v)) visitsDiffer = true;
  }
  if (!sameName(existing, incoming) || !sameSpot(existing, incoming) || visitsDiffer) return { kind: 'conflict' };
  return newVisits === 0 ? { kind: 'identical' } : { kind: 'merge', newVisits };
}

/** Why a conflict is a conflict, in plain words. */
export function describeConflict({ existing, incoming }) {
  const reasons = [];
  if (!sameName(existing, incoming)) reasons.push(`Name: “${existing.name}” here, “${incoming.name}” in the file`);
  if (!sameSpot(existing, incoming)) {
    const m = Math.round(distanceMeters(existing.latitude, existing.longitude, incoming.latitude, incoming.longitude));
    reasons.push(`Location differs by ${m} m`);
  }
  const mine = new Map(existing.visits.map((v) => [v.id, v]));
  const edited = incoming.visits.filter((v) => mine.has(v.id) && !sameVisit(mine.get(v.id), v)).length;
  if (edited) reasons.push(`${edited} visit${edited === 1 ? '' : 's'} edited differently`);
  return reasons;
}

/** Sorts incoming places into: added, merged (auto), identical (count), conflicts. */
export function planMerge(existing, incoming) {
  const byId = new Map(existing.map((p) => [p.id, p]));
  const plan = { added: [], merged: [], identical: 0, conflicts: [] };
  for (const inc of incoming) {
    const ex = byId.get(inc.id);
    if (!ex) { plan.added.push(inc); continue; }
    const result = classify(ex, inc);
    if (result.kind === 'identical') plan.identical++;
    else if (result.kind === 'merge') plan.merged.push({ existing: ex, incoming: inc, newVisits: result.newVisits });
    else plan.conflicts.push({ existing: ex, incoming: inc });
  }
  return plan;
}

/** Union of visits by id; the newer edit wins on clashes. Name/location come from the newer place. */
export function mergePlaces(a, b) {
  const newer = stamp(b.updatedAt) > stamp(a.updatedAt) ? b : a;
  const visits = new Map(a.visits.map((v) => [v.id, v]));
  for (const v of b.visits) {
    const current = visits.get(v.id);
    if (!current || stamp(v.updatedAt) > stamp(current.updatedAt)) visits.set(v.id, v);
  }
  return {
    ...newer,
    visits: sortVisits([...visits.values()]).reverse(), // oldest first, like the order they happened
    createdAt: stamp(a.createdAt) <= stamp(b.createdAt) ? a.createdAt : b.createdAt,
    updatedAt: stamp(a.updatedAt) >= stamp(b.updatedAt) ? a.updatedAt : b.updatedAt,
  };
}

/** Builds the final list. `choices[i]` is the resolution for plan.conflicts[i] (default 'merge'). */
export function applyMerge(existing, plan, choices = []) {
  const replacement = new Map();
  for (const m of plan.merged) replacement.set(m.existing.id, mergePlaces(m.existing, m.incoming));
  plan.conflicts.forEach((c, i) => {
    const choice = choices[i] ?? 'merge';
    if (choice === 'theirs') replacement.set(c.existing.id, c.incoming);
    else if (choice === 'merge') replacement.set(c.existing.id, mergePlaces(c.existing, c.incoming));
  });
  return [...existing.map((p) => replacement.get(p.id) ?? p), ...plan.added];
}
