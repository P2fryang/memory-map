# Personal Places Map

A private, local-first map of places you chose to remember. Static site: no backend, no accounts, no tracking.
Data lives in your browser (IndexedDB); JSON export/import is the backup and the way to move between devices.

## Run locally

Serve the folder over HTTP (ES modules and the service worker don't work from `file://`):

    python3 -m http.server 8080      # then open http://localhost:8080

Geolocation works on `localhost` and on HTTPS sites only.

## Deploy on GitHub Pages (no build step)

1. Push the contents of this folder to a GitHub repo (`index.html` at the root).
2. **Settings → Pages → Deploy from a branch → `main` / `(root)`**.
3. Open `https://<you>.github.io/<repo>/`. On a phone, use **Add to Home Screen**.

All paths are relative, so it works under the `/<repo>/` sub-path. **Shipping an update:** change `VERSION` in `sw.js`.

## How the data works (schema v2)

A **place** is a location (name + coordinates) with one or more **visits** (date, rating, notes, photo URLs).
Revisiting adds a visit to the same place, so it stays a single selectable pin (a badge shows the visit count).
Pinning within ~75 m of a saved place offers "Add a visit" instead of creating a duplicate.

Version-1 data (the first MVP) is upgraded automatically: local data on load, and v1 export files on import.
Each old pin becomes a place with one visit; the visit id is derived from the place id, so re-importing an
old export into already-upgraded data recognises it as identical instead of duplicating it.

## Import: Add or Replace

- **Add to my places**: new places are added; places already here are skipped; if the file only adds visits to a place
  you have, they are combined automatically. Anything that genuinely disagrees (different name or location, or the
  same visit edited differently) is listed for you to decide: *Combine both*, *Keep mine*, or *Use the file's version*.
  Nothing is written until you confirm, and the whole import is saved in one step.
- **Replace everything**: asks for confirmation first.

## Map tiles: your server first, OpenStreetMap as the fallback

Settings → **Map tiles**. Enter either a raster address like `https://tiles.example.com/{z}/{x}/{y}.png` or the address
of a MapLibre style file (`.json`). The server must use HTTPS and send CORS headers (`Access-Control-Allow-Origin`).
To make it the default for every device, set `SELF_HOSTED_TILES` in `js/config.js`.

On start the app checks that your server answers. If it doesn't, you are asked whether to use OpenStreetMap
(this time, always, or keep trying your server); you can preset that choice in Settings. If the server goes away
mid-session (several failed tiles, then a reachability check) you get the same prompt. A server that is up but simply
has no tile for some area (e.g. a regional extract) does **not** trigger the prompt.

**Tile caching** (`sw.js`): tiles you actually view are kept for 7 days (OpenStreetMap's minimum for caching), refreshed
afterwards, and served as a stale copy if you're offline. The cache is capped at 1,200 tiles, oldest dropped first, and has
a "Clear cached map tiles" button. There is deliberately no prefetching or "download this area": OpenStreetMap's policy
forbids bulk/offline downloading from tile.openstreetmap.org. https://operations.osmfoundation.org/policies/tiles/

## Timeline

Toolbar → **Timeline**: a slider over every visit date. Pins appear as you reach their first visit and the badge counts
revisits so far; **Play** replays it. It is intentionally low-detail (zoom limited to 1–8 in `TIMELINE_ZOOM`) and the camera
stays still while it plays, so it loads few tiles.

## Layout

    index.html, styles.css, manifest.webmanifest, sw.js, icons/
    js/
      main.js          controller: wires store, map and panel views together
      views.js         list / detail / form / settings / timeline
      store.js         app state, validation, v1->v2 upgrade on load
      repository.js    IndexedDB (the only file that touches it)
      schema.js        data shape + v1->v2 migration     validation.js  field rules
      exportImport.js  versioned JSON export/import       merge.js       "Add" import planning + resolution
      timeline.js      timeline state by date             geo.js         distance / nearby lookup
      mapView.js       MapLibre adapter (only file that touches the map library)
      tiles.js         tile sources, style building, reachability probe
      settings.js      per-device settings                config.js      constants
      geolocation.js, dates.js, dom.js, dialog.js, importReview.js, toast.js, rating.js
    tests/run.mjs      node tests (npm test)

## Notes

- MapLibre GL JS 4.7.1 is loaded from jsDelivr and cached by the service worker after the first visit.
- Photos: each visit has a `photos: string[]` of URLs, preserved by import/export; no UI yet.
