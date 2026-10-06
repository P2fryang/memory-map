// App-wide constants.

/** Schema version written to (and required in) exported JSON files. */
export const SCHEMA_VERSION = 3;

/**
 * Optional: bake your own tile server into the app so every device uses it by default.
 * Either a raster template ("https://tiles.example.com/{z}/{x}/{y}.png") or the URL of a
 * MapLibre style file ("https://tiles.example.com/style.json"). Leave '' to use OpenStreetMap.
 * A value saved in Settings on a device overrides this.
 */
export const SELF_HOSTED_TILES = '';

/**
 * OpenStreetMap's public raster tiles. Fine for light personal use. Their policy requires
 * attribution, forbids bulk/offline downloading, and expects caching of at least 7 days
 * (the service worker does this for tiles you have actually looked at).
 * https://operations.osmfoundation.org/policies/tiles/
 */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Initial camera when there are no saved places. [lng, lat] */
export const DEFAULT_VIEW = { center: [10, 25], zoom: 1.6 };

/** Timeline view is deliberately low-detail: it never zooms in past this, which keeps tile use small. */
export const TIMELINE_ZOOM = { minZoom: 1, maxZoom: 8 };

/** A new pin this close to a saved place offers "add a visit" instead of a duplicate place. */
export const NEARBY_METERS = 75;

/** Width of the desktop sidebar in px (keep in sync with --sidebar in styles.css). */
export const SIDEBAR_WIDTH = 360;
