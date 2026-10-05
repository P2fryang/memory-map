/** Great-circle distance in metres. */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The saved place closest to (lat, lng) within maxMeters, as { place, distance }, or null. */
export function nearestPlace(places, latitude, longitude, maxMeters) {
  let best = null;
  for (const place of places) {
    const distance = distanceMeters(latitude, longitude, place.latitude, place.longitude);
    if (distance <= maxMeters && (!best || distance < best.distance)) best = { place, distance };
  }
  return best;
}
