import { SCHEMA_VERSION } from './config.js';
import { isValidTimestamp } from './dates.js';
import { migratePlaceV1 } from './schema.js';
import { validatePlaceBase, validateVisitFields } from './validation.js';

/** Thrown for any problem with an import file. The message is safe to show to the user. */
export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportError';
  }
}

/**
 * Migration steps, keyed by the version they upgrade FROM. Each takes the parsed file object
 * and returns it in the next version's shape (with `version` bumped).
 */
const migrations = {
  1: (data) => ({
    ...data,
    version: 2,
    places: Array.isArray(data.places) ? data.places.map(migratePlaceV1) : data.places,
  }),
};

/** Builds the object that gets written to the export file. */
export function buildExport(places) {
  return {
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    places: places.map((p) => ({ ...p, visits: p.visits.map((v) => ({ photos: [], ...v })) })),
  };
}

function migrate(data) {
  let current = data;
  while (current.version < SCHEMA_VERSION) {
    const step = migrations[current.version];
    if (!step) throw new ImportError(`This file uses an old format (version ${current.version}) that can't be upgraded.`);
    current = step(current);
  }
  return current;
}

function validateImportedVisit(raw, index, placeId, who) {
  const label = `${who}, visit ${index + 1}`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ImportError(`${label} isn't in the expected format.`);
  const { errors, value } = validateVisitFields(raw);
  const first = Object.values(errors)[0];
  if (first) throw new ImportError(`${label}: ${first}`);
  const now = new Date().toISOString();
  const createdAt = isValidTimestamp(raw.createdAt) ? raw.createdAt : now;
  const updatedAt = isValidTimestamp(raw.updatedAt) ? raw.updatedAt : createdAt;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `${placeId}:${index + 1}`;
  return { id, photos: [], ...value, createdAt, updatedAt };
}

function validateImportedPlace(raw, index) {
  const label = `Place ${index + 1}`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ImportError(`${label} isn't in the expected format.`);
  if (typeof raw.id !== 'string' || !raw.id.trim()) throw new ImportError(`${label} has no id.`);

  const who = typeof raw.name === 'string' && raw.name.trim() ? `${label} (“${raw.name.trim()}”)` : label;
  const { errors, value } = validatePlaceBase(raw);
  const first = Object.values(errors)[0];
  if (first) throw new ImportError(`${who}: ${first}`);
  if (!Array.isArray(raw.visits) || raw.visits.length === 0) throw new ImportError(`${who} has no visits.`);

  const id = raw.id.trim();
  const visits = raw.visits.map((v, i) => validateImportedVisit(v, i, id, who));
  if (new Set(visits.map((v) => v.id)).size !== visits.length) throw new ImportError(`${who} has two visits with the same id.`);

  const now = new Date().toISOString();
  const createdAt = isValidTimestamp(raw.createdAt) ? raw.createdAt : now;
  const updatedAt = isValidTimestamp(raw.updatedAt) ? raw.updatedAt : createdAt;
  return { id, ...value, visits, createdAt, updatedAt };
}

/**
 * Parses and validates the text of an import file (any supported version).
 * Returns { version, places } in the current shape, or throws an ImportError.
 */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError("This file isn't valid JSON, so it can't be imported.");
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ImportError("This file doesn't look like a Personal Places Map export.");
  }
  if (!Number.isInteger(data.version) || data.version < 1) {
    throw new ImportError("This file doesn't look like a Personal Places Map export (it has no version number).");
  }
  if (data.version > SCHEMA_VERSION) {
    throw new ImportError('This file was made by a newer version of the app. Update the app and try again.');
  }
  const migrated = migrate(data);
  if (!Array.isArray(migrated.places)) throw new ImportError('This file has no list of places.');

  const places = migrated.places.map(validateImportedPlace);
  const ids = new Set();
  for (const p of places) {
    if (ids.has(p.id)) throw new ImportError('Two places in this file share the same id.');
    ids.add(p.id);
  }
  return { version: migrated.version, places };
}
