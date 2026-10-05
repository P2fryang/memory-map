// Per-device settings (localStorage). Everything is optional; failures fall back to defaults.
const KEY = 'places-map:settings';

export const DEFAULT_SETTINGS = {
  tileUrl: '',
  tileAttribution: '© OpenStreetMap contributors',
  fallback: 'ask', // what to do when the tile server can't be reached: 'ask' | 'always' | 'never'
};

export function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      tileUrl: typeof stored.tileUrl === 'string' ? stored.tileUrl : DEFAULT_SETTINGS.tileUrl,
      tileAttribution: typeof stored.tileAttribution === 'string' ? stored.tileAttribution : DEFAULT_SETTINGS.tileAttribution,
      fallback: ['ask', 'always', 'never'].includes(stored.fallback) ? stored.fallback : DEFAULT_SETTINGS.fallback,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
