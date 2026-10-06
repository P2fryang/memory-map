// "Add" import: combine an incoming list of places with the ones already saved.
//
// Places are matched by id. For a place that exists on both sides:
//   - nothing new in the file                          -> identical (skipped)
//   - file only ADDS visits (same name/location)       -> merged automatically
//   - name/location differ, or the same visit differs  -> conflict: the user chooses
//       'merge'  combine visits; newer edit wins for name/location and for clashing visits
//       'mine'   keep what's on this device
//       'theirs' use the file's version
//   On top of that choice, each visit that differs can be overridden: keep mine / use the file's.
//   A choice is { base, visits: { [visitId]: 'mine' | 'theirs' } } (a plain string means just the base).
import { distanceMeters } from './geo.js';
import { sortVisits } from './schema.js';

export const RESOLUTIONS = ['merge', 'mine', 'theirs'];

const visitKey = (v) => JSON.stringify([v.date, v.time ?? null, v.rating ?? null, v.notes ?? '', v.photos ?? [], [...(v.tags ?? [])].sort()]);
const sameVisit = (a, b) => visitKey(a) === visitKey(b);
const stamp = (iso) => Date.parse(iso) || 0;

export const sameName = (a, b) => a.name === b.name;
export const sameSpot = (a, b) => distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude) < 1;

/** Visits that exist on both sides (same id) but differ: [{ mine, theirs }]. */
export function clashingVisits(existing, incoming) {
  const mine = new Map(existing.visits.map((v) => [v.id, v]));
  return incoming.visits
    .filter((v) => mine.has(v.id) && !sameVisit(mine.get(v.id), v))
    .map((v) => ({ mine: mine.get(v.id), theirs: v }));
}

function classify(existing, incoming) {
  const have = new Set(existing.visits.map((v) => v.id));
  const newVisits = incoming.visits.filter((v) => !have.has(v.id)).length;
  if (!sameName(existing, incoming) || !sameSpot(existing, incoming) || clashingVisits(existing, incoming).length) {
    return { kind: 'conflict' };
  }
  return newVisits === 0 ? { kind: 'identical' } : { kind: 'merge', newVisits };
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

/** Resolves one conflict: the place-level choice first, then any per-visit overrides on top. */
function resolveConflict({ existing, incoming }, choice) {
  const { base = 'merge', visits = {} } = typeof choice === 'string' ? { base: choice } : (choice ?? {});
  const result = base === 'theirs' ? incoming : base === 'mine' ? existing : mergePlaces(existing, incoming);
  if (!Object.keys(visits).length) return result;
  const side = { mine: existing, theirs: incoming };
  return {
    ...result,
    visits: result.visits.map((v) => side[visits[v.id]]?.visits.find((x) => x.id === v.id) ?? v),
  };
}

/** Builds the final list. `choices[i]` is the resolution for plan.conflicts[i] (default 'merge'). */
export function applyMerge(existing, plan, choices = []) {
  const replacement = new Map();
  for (const m of plan.merged) replacement.set(m.existing.id, mergePlaces(m.existing, m.incoming));
  plan.conflicts.forEach((c, i) => replacement.set(c.existing.id, resolveConflict(c, choices[i])));
  return [...existing.map((p) => replacement.get(p.id) ?? p), ...plan.added];
}
