// The only file (besides tiles.js) that knows which map library is in use.
// The rest of the app sees this small interface:
//
//   setTileSource(source)         switch between your tile server and OpenStreetMap
//   setPlaces(places)             one marker per place (badge shows the visit count)
//   setVisibility(counts | null)  timeline: show only places in the Map(id -> visits so far)
//   setSelected(id | null)        highlight one marker
//   setDraft(lat, lng) / clearDraft()   the draggable "new place" pin
//   flyTo(lat, lng, {zoom, minZoom})
//   fitToPlaces(places, {maxZoom, singleZoom})
//   enterOverview(places, {minZoom, maxZoom}) / leaveOverview()   low-detail whole-world view
//   setZoomLimits({minZoom, maxZoom})   change the zoom range while in the overview
//   setRoute([[lng, lat], ...], colours)   the timeline's line through the pins, in order (empty clears it)
//   setPinColors(Map(id -> colour) | null)   timeline: colour pins by age (null restores the default)
//
// Callbacks: onMapClick(lat, lng), onPlaceClick(id), onDraftMove(lat, lng),
// onTileError(), getPadding() -> {top,right,bottom,left}.
import { DEFAULT_VIEW } from './config.js';
import { DEFAULT_RAMP } from './ramp.js';
import { BLANK_STYLE, styleFor } from './tiles.js';

const PIN_SVG =
  '<svg viewBox="-1 -1 30 38" aria-hidden="true" focusable="false">' +
  '<path d="M14 0C6.3 0 0 6.2 0 13.8 0 24 14 36 14 36s14-12 14-22.2C28 6.2 21.7 0 14 0z" fill="currentColor" stroke="#fff" stroke-width="1.5"/>' +
  '<circle cx="14" cy="14" r="5" fill="#fff"/></svg>';

function pinElement(kind, label) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `pin ${kind}`.trim();
  if (label) el.setAttribute('aria-label', label);
  el.innerHTML = PIN_SVG; // static markup, no user content
  return el;
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function unavailableMap(container) {
  container.classList.add('map-failed');
  const message = document.createElement('p');
  message.className = 'map-failed-message';
  message.textContent = "The map couldn't load. Check your connection and reload. Your saved places are still in the list.";
  container.append(message);
  const noop = () => {};
  return {
    available: false, setTileSource: noop, setPlaces: noop, setVisibility: noop, setSelected: noop,
    setDraft: noop, clearDraft: noop, flyTo: noop, fitToPlaces: noop, enterOverview: noop, leaveOverview: noop,
    setZoomLimits: noop, setRoute: noop, setPinColors: noop,
  };
}

export function createMapView(container, handlers) {
  const lib = globalThis.maplibregl;
  if (!lib) return unavailableMap(container);

  let map;
  try {
    map = new lib.Map({
      container,
      style: BLANK_STYLE,
      center: DEFAULT_VIEW.center,
      zoom: DEFAULT_VIEW.zoom,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    if (!matchMedia('(pointer: coarse)').matches) {
      map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
    }
  } catch (err) {
    console.error('Map failed to start', err);
    return unavailableMap(container);
  }

  map.on('click', (event) => handlers.onMapClick(event.lngLat.lat, event.lngLat.lng));
  map.on('error', (event) => { if (event && (event.tile || event.sourceId)) handlers.onTileError?.(); });

  // The route is a map layer, and a layer vanishes whenever the style is replaced, so it is redrawn on style.load.
  let route = [];
  let routeColors = DEFAULT_RAMP;
  let paintedColors = '';
  const gradient = (colors) =>
    ['interpolate', ['linear'], ['line-progress'], ...colors.flatMap((color, i) => [i / (colors.length - 1), color])];
  const paintRoute = () => {
    const data = {
      type: 'FeatureCollection',
      features: route.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route } }] : [],
    };
    try {
      const source = map.getSource('route');
      if (source) {
        source.setData(data);
        if (routeColors.join() !== paintedColors) {
          map.setPaintProperty('route', 'line-gradient', gradient(routeColors));
          paintedColors = routeColors.join();
        }
        return;
      }
      map.addSource('route', { type: 'geojson', data, lineMetrics: true }); // lineMetrics enables the gradient
      map.addLayer({
        id: 'route', type: 'line', source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-width': 3,
          'line-opacity': 0.85,
          'line-gradient': gradient(routeColors),
        },
      });
      paintedColors = routeColors.join();
    } catch { /* style still loading; style.load paints it */ }
  };
  map.on('style.load', paintRoute);

  const markers = new Map(); // id -> { marker, el, total }
  let selectedId = null;
  let pinColors = null; // timeline: Map(id -> colour)
  let visibility = null; // null = show everything; otherwise Map(id -> visits so far)
  let draft = null;
  let savedCamera = null;

  const paintBadge = (el, count) => {
    if (count > 1) el.dataset.count = String(count);
    else delete el.dataset.count;
  };

  const applyState = () => {
    for (const [id, entry] of markers) {
      const count = visibility ? visibility.get(id) ?? 0 : entry.total;
      entry.el.classList.toggle('hidden', visibility !== null && count === 0);
      entry.el.classList.toggle('selected', id === selectedId);
      entry.el.style.setProperty('--pin-color', pinColors?.get(id) ?? '');
      paintBadge(entry.el, count);
    }
  };

  const api = {
    available: true,

    setTileSource(source) {
      map.setStyle(styleFor(source), { diff: false });
    },

    setPlaces(places) {
      const ids = new Set(places.map((p) => p.id));
      for (const [id, entry] of markers) {
        if (!ids.has(id)) { entry.marker.remove(); markers.delete(id); }
      }
      for (const place of places) {
        const lngLat = [place.longitude, place.latitude];
        const existing = markers.get(place.id);
        if (existing) {
          existing.marker.setLngLat(lngLat);
          existing.el.setAttribute('aria-label', place.name);
          existing.total = place.visits.length;
          continue;
        }
        const el = pinElement('', place.name);
        el.addEventListener('click', (event) => {
          event.stopPropagation(); // don't also count as a map click
          handlers.onPlaceClick(place.id);
        });
        const marker = new lib.Marker({ element: el, anchor: 'bottom' }).setLngLat(lngLat).addTo(map);
        markers.set(place.id, { marker, el, total: place.visits.length });
      }
      applyState();
    },

    setVisibility(counts) {
      visibility = counts;
      applyState();
    },

    setSelected(id) {
      selectedId = id;
      applyState();
    },

    setDraft(latitude, longitude) {
      if (draft) { draft.setLngLat([longitude, latitude]); return; }
      const el = pinElement('draft', 'New place location');
      draft = new lib.Marker({ element: el, anchor: 'bottom', draggable: true })
        .setLngLat([longitude, latitude])
        .addTo(map);
      draft.on('dragend', () => {
        const { lat, lng } = draft.getLngLat();
        handlers.onDraftMove(lat, lng);
      });
    },

    clearDraft() {
      if (draft) { draft.remove(); draft = null; }
    },

    flyTo(latitude, longitude, { zoom, minZoom = 0 } = {}) {
      map.easeTo({
        center: [longitude, latitude],
        zoom: zoom ?? Math.max(map.getZoom(), minZoom),
        padding: handlers.getPadding(),
        duration: reducedMotion() ? 0 : 600,
      });
    },

    fitToPlaces(places, { maxZoom = 14, singleZoom = 13 } = {}) {
      if (places.length === 0) return;
      if (places.length === 1) {
        map.jumpTo({ center: [places[0].longitude, places[0].latitude], zoom: Math.min(singleZoom, maxZoom), padding: handlers.getPadding() });
        return;
      }
      const bounds = new lib.LngLatBounds();
      for (const p of places) bounds.extend([p.longitude, p.latitude]);
      const pad = handlers.getPadding();
      // flyTo/jumpTo padding stays on the map afterwards and would stack with the fit padding below
      // (a sheet's height counted twice leaves no room on a phone), so clear it before fitting.
      map.jumpTo({ padding: { top: 0, right: 0, bottom: 0, left: 0 } });
      let top = pad.top + 80;
      let bottom = pad.bottom + (pad.bottom > 0 ? 24 : 120); // an open sheet already clears the bottom
      const room = Math.max(40, map.getContainer().clientHeight - 140); // always leave some map to fit into
      if (top + bottom > room) { const k = room / (top + bottom); top *= k; bottom *= k; }
      map.fitBounds(bounds, {
        padding: { top, right: pad.right + 40, bottom, left: pad.left + 40 },
        maxZoom,
        duration: 0, // jump, don't animate: fewer tiles requested along the way
      });
    },

    /** Low-detail whole-collection view for the timeline. The camera stays put while it plays. */
    enterOverview(places, { minZoom, maxZoom }) {
      savedCamera = { center: map.getCenter(), zoom: map.getZoom() };
      this.setZoomLimits({ minZoom, maxZoom });
      this.fitToPlaces(places, { maxZoom });
    },

    setZoomLimits({ minZoom, maxZoom }) {
      map.setMinZoom(minZoom);
      map.setMaxZoom(maxZoom);
    },

    setPinColors(colors) {
      pinColors = colors;
      applyState();
    },

    setRoute(coordinates, colors = routeColors) {
      route = coordinates;
      routeColors = colors;
      paintRoute();
    },

    leaveOverview() {
      map.setMinZoom(null);
      map.setMaxZoom(null);
      if (savedCamera) {
        map.jumpTo({ center: savedCamera.center, zoom: savedCamera.zoom, padding: handlers.getPadding() });
        savedCamera = null;
      }
    },
  };
  return api;
}
