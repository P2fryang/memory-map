// Per-device settings (localStorage). Everything is optional; failures fall back to defaults.
import { TIMELINE_REGION } from './config.js';
import { DEFAULT_RAMP, isHexColor } from './ramp.js';
import { MAX_TAGS_PER_VISIT, normalizeTags } from './tags.js';

const KEY = 'places-map:settings';

export const DEFAULT_SETTINGS = {
  tileUrl: '',
  tileAttribution: '© OpenStreetMap contributors',
  fallback: 'ask', // what to do when the tile server can't be reached: 'ask' | 'always' | 'never'
  localOnline: true, // with offline map files: also use the online map for detail beyond them
  offlineLabels: true, // draw names (places, roads, water, points of interest) on offline map files
  defaultTags: [], // pre-filled on the form for every new place and new visit
  offline: false, // offline mode: never load anything from the internet
  rampColors: DEFAULT_RAMP, // timeline gradient, oldest to newest
  regionFitMax: TIMELINE_REGION.fitMaxZoom, // timeline zoom option: closest zoom when several pins are shown
  regionSingle: TIMELINE_REGION.singleZoom, // ... and the zoom for a single pin
};

const zoomOr = (value, fallback) => (Number.isInteger(value) && value >= 3 && value <= 18 ? value : fallback);

export function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      tileUrl: typeof stored.tileUrl === 'string' ? stored.tileUrl : DEFAULT_SETTINGS.tileUrl,
      tileAttribution: typeof stored.tileAttribution === 'string' ? stored.tileAttribution : DEFAULT_SETTINGS.tileAttribution,
      fallback: ['ask', 'always', 'never'].includes(stored.fallback) ? stored.fallback : DEFAULT_SETTINGS.fallback,
      localOnline: typeof stored.localOnline === 'boolean' ? stored.localOnline : DEFAULT_SETTINGS.localOnline,
      defaultTags: normalizeTags(Array.isArray(stored.defaultTags) ? stored.defaultTags : []).slice(0, MAX_TAGS_PER_VISIT),
      offlineLabels: typeof stored.offlineLabels === 'boolean' ? stored.offlineLabels : DEFAULT_SETTINGS.offlineLabels,
      offline: stored.offline === true,
      rampColors: Array.isArray(stored.rampColors) && stored.rampColors.length === 3 && stored.rampColors.every(isHexColor)
        ? stored.rampColors : [...DEFAULT_RAMP],
      regionFitMax: zoomOr(stored.regionFitMax, DEFAULT_SETTINGS.regionFitMax),
      regionSingle: zoomOr(stored.regionSingle, DEFAULT_SETTINGS.regionSingle),
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
