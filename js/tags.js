// Tags live on visits. A place's tags are the union of its visits' tags, and the list of
// known tags is always DERIVED from the visits, so a tag nobody uses has nowhere to linger:
// it disappears from every menu the moment its last visit is deleted or edited.

export const MAX_TAG_LENGTH = 30;
export const MAX_TAGS_PER_VISIT = 12;

/**
 * Lowercase, words joined with hyphens, only letters/numbers/marks and : _ - kept.
 * "  #Trip:Japan 2026! " -> "trip:japan-2026".  Returns '' if nothing is left.
 */
export function normalizeTag(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, '-')
    .replace(/[^\p{L}\p{M}\p{N}:_-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-:_]+|[-:_]+$/g, '');
}

/** Normalizes a list, dropping empties and duplicates (first occurrence wins). */
export function normalizeTags(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list ?? []) {
    const tag = normalizeTag(raw);
    if (tag && !seen.has(tag)) { seen.add(tag); out.push(tag); }
  }
  return out;
}

export const visitTags = (visit) => visit.tags ?? [];

/** Union of a place's visit tags, alphabetical. */
export function placeTags(place) {
  return [...new Set(place.visits.flatMap(visitTags))].sort((a, b) => a.localeCompare(b));
}

/**
 * Every tag in use as [{ tag, visits, places }], most-used first:
 * by number of visits, then number of places, then alphabetically.
 */
export function tagStats(places) {
  const byTag = new Map();
  for (const place of places) {
    const countedForPlace = new Set();
    for (const visit of place.visits) {
      for (const tag of visitTags(visit)) {
        const entry = byTag.get(tag) ?? { tag, visits: 0, places: 0 };
        entry.visits += 1;
        if (!countedForPlace.has(tag)) { entry.places += 1; countedForPlace.add(tag); }
        byTag.set(tag, entry);
      }
    }
  }
  return [...byTag.values()].sort((a, b) => b.visits - a.visits || b.places - a.places || a.tag.localeCompare(b.tag));
}

/** The n most-used tags from `stats`, skipping any in `exclude`. */
export const topTags = (stats, n = 3, exclude = []) => stats.filter((s) => !exclude.includes(s.tag)).slice(0, n);

/** Does a visit match the selected tags? match: 'all' (every tag) or 'any' (at least one). */
export function matchesTags(visit, tags, match = 'all') {
  if (!tags.length) return true;
  const have = visitTags(visit);
  return match === 'any' ? tags.some((t) => have.includes(t)) : tags.every((t) => have.includes(t));
}

/** Places reduced to their matching visits; places with no matching visit are dropped. */
export function filterPlaces(places, filter) {
  if (!filter?.tags?.length) return places;
  return places
    .map((p) => ({ ...p, visits: p.visits.filter((v) => matchesTags(v, filter.tags, filter.match)) }))
    .filter((p) => p.visits.length > 0);
}

/** Drops selected tags that no longer exist anywhere. */
export function pruneFilter(filter, stats) {
  const live = new Set(stats.map((s) => s.tag));
  return { ...filter, tags: filter.tags.filter((t) => live.has(t)) };
}
