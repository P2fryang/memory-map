// Pure logic for the timeline view: which places exist "as of" each visit date.
// With a tag filter, only matching visits count: a place appears at its first MATCHING visit
// and its count grows only with matching revisits.
import { filterPlaces } from './tags.js';

export function buildTimeline(allPlaces, filter = null) {
  const places = filterPlaces(allPlaces, filter);
  const dates = [...new Set(places.flatMap((p) => p.visits.map((v) => v.date)))].sort();

  return {
    dates,
    places,
    placeCount: places.length,

    /**
     * State at dates[index]:
     *   counts   Map(placeId -> visits on or before that date) for places already pinned
     *   onDate   places visited exactly on that date
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
      return { date, counts, onDate };
    },
  };
}
