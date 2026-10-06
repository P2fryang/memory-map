import { DEFAULT_TIME } from './dates.js';
import { isLegacyPlace, migratePlaceV1 } from './schema.js';
import { assertValidPlaceBase, assertValidVisitFields } from './validation.js';

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // Fallback for non-secure contexts (e.g. plain http on a LAN address).
  return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const makeVisit = (fields, now) => ({ id: newId(), photos: [], ...fields, createdAt: now, updatedAt: now });

/**
 * Application state for places. The UI talks to this, never to the repository.
 * @param {import('./repository.js').PlaceRepository} repo
 */
export function createStore(repo) {
  let places = [];
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(places));
  const get = (id) => places.find((p) => p.id === id);

  function require(id) {
    const place = get(id);
    if (!place) throw new Error('That place no longer exists.');
    return place;
  }

  async function save(next) {
    await repo.update(next);
    places = places.map((p) => (p.id === next.id ? next : p));
    emit();
    return next;
  }

  return {
    get places() { return places; },
    get,

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Loads from storage, upgrading v1 records (one visit per place) and giving visits without a time the default. */
    async load() {
      const raw = await repo.getAll();
      const migrated = raw.map(migratePlaceV1).filter((p) => Array.isArray(p.visits) && p.visits.length > 0);
      const withTime = (p) => (p.visits.every((v) => v.time) ? p : { ...p, visits: p.visits.map((v) => (v.time ? v : { ...v, time: DEFAULT_TIME })) });
      const upgraded = migrated.map(withTime);
      if (raw.some(isLegacyPlace) || upgraded.some((p, i) => p !== migrated[i])) {
        try { await repo.replaceAll(upgraded); } catch (err) { console.warn('Could not save migrated data', err); }
      }
      places = upgraded;
      emit();
    },

    /** input: { name, latitude, longitude, visit: { date, time?, rating?, notes?, tags? } } */
    async addPlace(input) {
      const base = assertValidPlaceBase(input);
      const visit = assertValidVisitFields(input.visit);
      const now = new Date().toISOString();
      const place = { id: newId(), ...base, visits: [makeVisit(visit, now)], createdAt: now, updatedAt: now };
      await repo.create(place);
      places = [...places, place];
      emit();
      return place;
    },

    /** Changes name and/or location. input: { name, latitude, longitude } */
    async updatePlace(id, input) {
      const existing = require(id);
      const base = assertValidPlaceBase(input);
      return save({ ...existing, ...base, updatedAt: new Date().toISOString() });
    },

    async addVisit(placeId, fields) {
      const existing = require(placeId);
      const visit = assertValidVisitFields(fields);
      const now = new Date().toISOString();
      return save({ ...existing, visits: [...existing.visits, makeVisit(visit, now)], updatedAt: now });
    },

    async updateVisit(placeId, visitId, fields) {
      const existing = require(placeId);
      const old = existing.visits.find((v) => v.id === visitId);
      if (!old) throw new Error('That visit no longer exists.');
      const clean = assertValidVisitFields(fields);
      const now = new Date().toISOString();
      const next = { ...old, ...clean, updatedAt: now };
      for (const key of ['rating', 'notes', 'tags']) if (!(key in clean)) delete next[key]; // user cleared it
      return save({ ...existing, visits: existing.visits.map((v) => (v.id === visitId ? next : v)), updatedAt: now });
    },

    async removeVisit(placeId, visitId) {
      const existing = require(placeId);
      if (existing.visits.length <= 1) throw new Error('A place needs at least one visit. Delete the place instead.');
      return save({
        ...existing,
        visits: existing.visits.filter((v) => v.id !== visitId),
        updatedAt: new Date().toISOString(),
      });
    },

    async remove(id) {
      await repo.delete(id);
      places = places.filter((p) => p.id !== id);
      emit();
    },

    async replaceAll(list) {
      await repo.replaceAll(list);
      places = [...list];
      emit();
    },
  };
}
