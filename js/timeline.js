// Pure logic for the timeline view: which places exist "as of" each visit date.
// With a tag filter, only matching visits count: a place appears at its first MATCHING visit
// and its count grows only with matching revisits.
import { filterPlaces } from './tags.js';

/** Chronological order of visits: date, time, then place name, visit created date, visit id as tie-breakers. */
const byOrder = (a, b) =>
  a.visit.date.localeCompare(b.visit.date)
  || (a.visit.time ?? '').localeCompare(b.visit.time ?? '')
  || a.place.name.localeCompare(b.place.name)
  || String(a.visit.createdAt).localeCompare(String(b.visit.createdAt))
  || a.visit.id.localeCompare(b.visit.id);

export function buildTimeline(allPlaces, filter = null) {
  const places = filterPlaces(allPlaces, filter);
  const steps = places.flatMap((place) => place.visits.map((visit) => ({ place, visit }))).sort(byOrder);
  const dates = [...new Set(places.flatMap((p) => p.visits.map((v) => v.date)))].sort();

  return {
    dates,
    places,
    placeCount: places.length,

    /**
     * State at dates[index]:
     *   counts   Map(placeId -> visits on or before that date) for places already pinned
     *   onDate   places visited exactly on that date
     *   route    [lng, lat] of each place in visit order up to that date (repeat stays at one place collapse)
     */
    stateAt(index) {
      const date = dates[Math.max(0, Math.min(index, dates.length - 1))];
      const counts = new Map();
      const onDate = [];
      for (const p of places) {
        const n = p.visits.filter((v) => v.date <= date).length;
        if (n > 0) counts.set(p.id, n);
        if (p.visits.some((v) => v.date === date)) onDate.push(p);
      }
      const route = [];
      let last = null;
      for (const { place, visit } of steps) {
        if (visit.date > date) break;
        if (place.id !== last) { route.push([place.longitude, place.latitude]); last = place.id; }
      }
      return { date, counts, onDate, route };
    },
  };
}
