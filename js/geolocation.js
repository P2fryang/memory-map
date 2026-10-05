// One-shot location lookup. Only ever called from an explicit tap on "Pin location".
// There is deliberately no watchPosition and nothing is called on startup.

export class LocationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LocationError';
  }
}

export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new LocationError("This browser can't share your location. Tap the map to choose a spot instead."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (err) => {
        if (err.code === 1) {
          reject(new LocationError('Location access is blocked. Allow it in your browser settings, or tap the map to choose a spot instead.'));
        } else if (err.code === 3) {
          reject(new LocationError('Finding your location took too long. Try again, or tap the map to choose a spot.'));
        } else {
          reject(new LocationError("Your location isn't available right now. Try again, or tap the map to choose a spot."));
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}
