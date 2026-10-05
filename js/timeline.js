// Pure logic for the timeline view: which places exist "as of" each visit date.

export function buildTimeline(places) {
  const dates = [...new Set(places.flatMap((p) => p.visits.map((v) => v.date)))].sort();

  return {
    dates,
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
