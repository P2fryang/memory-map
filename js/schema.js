// Data shape helpers and the v1 -> v2 migration.
//
// v1: one record per pin, with date/rating/notes/photos on the place itself.
// v2: one record per LOCATION, with a list of visits (each with its own date/rating/notes/photos).
//
// @typedef {Object} Visit  { id, date, rating?, notes?, photos?, createdAt, updatedAt }
// @typedef {Object} Place  { id, name, latitude, longitude, visits: Visit[], createdAt, updatedAt }

export const isLegacyPlace = (p) =>
  Boolean(p) && typeof p === 'object' && !Array.isArray(p) && !Array.isArray(p.visits) && 'date' in p;

/**
 * Turns a v1 place into a v2 place with one visit. The visit id is derived from the place id,
 * so migrating the same data twice (e.g. an old export imported later) produces matching ids.
 * Anything that isn't a v1 place is returned untouched.
 */
export function migratePlaceV1(p) {
  if (!isLegacyPlace(p)) return p;
  const { date, rating, notes, photos, ...rest } = p;
  const visit = {
    id: `${p.id}:v1`,
    date,
    photos: Array.isArray(photos) ? photos : [],
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
  if (rating !== undefined && rating !== null) visit.rating = rating;
  if (notes) visit.notes = notes;
  return { ...rest, visits: [visit] };
}

/** Newest first (by visit date, then by when it was entered). */
export function sortVisits(visits) {
  return [...visits].sort(
    (a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)),
  );
}

export const latestVisit = (place) => sortVisits(place.visits)[0];
