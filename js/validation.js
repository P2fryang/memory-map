import { DEFAULT_TIME, isValidDateString, isValidTimeString } from './dates.js';
import { MAX_TAGS_PER_VISIT, MAX_TAG_LENGTH, normalizeTags } from './tags.js';

export class ValidationError extends Error {
  constructor(message, errors = {}) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

const isBlank = (v) => v === undefined || v === null || v === '';

/** Name and coordinates: the fields that belong to the location itself. Returns { errors, value }. */
export function validatePlaceBase(input) {
  const errors = {};
  const src = input ?? {};

  const name = typeof src.name === 'string' ? src.name.trim() : '';
  if (!name) errors.name = 'Name is required.';

  const { latitude, longitude } = src;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    errors.latitude = 'Latitude must be a number between -90 and 90.';
  }
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    errors.longitude = 'Longitude must be a number between -180 and 180.';
  }
  return { errors, value: { name, latitude, longitude } };
}

/** Date, time, rating, notes, tags, photos: the fields that belong to one visit. Returns { errors, value }. */
export function validateVisitFields(input) {
  const errors = {};
  const src = input ?? {};

  if (!isValidDateString(src.date)) errors.date = 'Enter a valid date.';

  let time = DEFAULT_TIME; // every visit has a time; a missing one gets the default
  if (!isBlank(src.time)) {
    if (isValidTimeString(src.time)) time = src.time;
    else errors.time = 'Enter a valid time.';
  }

  let rating;
  if (!isBlank(src.rating)) {
    if (Number.isInteger(src.rating) && src.rating >= 1 && src.rating <= 5) rating = src.rating;
    else errors.rating = 'Rating must be a whole number from 1 to 5.';
  }

  let notes;
  if (!isBlank(src.notes)) {
    if (typeof src.notes !== 'string') errors.notes = 'Notes must be text.';
    else if (src.notes.trim()) notes = src.notes.trim();
  }

  let photos;
  if (!isBlank(src.photos)) {
    if (Array.isArray(src.photos) && src.photos.every((p) => typeof p === 'string')) {
      photos = src.photos.map((p) => p.trim()).filter(Boolean);
    } else {
      errors.photos = 'Photos must be a list of URLs.';
    }
  }

  let tags;
  if (!isBlank(src.tags)) {
    if (!Array.isArray(src.tags) || !src.tags.every((t) => typeof t === 'string')) {
      errors.tags = 'Tags must be a list of words.';
    } else {
      const list = normalizeTags(src.tags);
      if (list.some((t) => [...t].length > MAX_TAG_LENGTH)) errors.tags = `Tags can be at most ${MAX_TAG_LENGTH} characters.`;
      else if (list.length > MAX_TAGS_PER_VISIT) errors.tags = `A visit can have at most ${MAX_TAGS_PER_VISIT} tags.`;
      else if (list.length) tags = list;
    }
  }

  const value = { date: src.date, time };
  if (rating !== undefined) value.rating = rating;
  if (notes !== undefined) value.notes = notes;
  if (tags !== undefined) value.tags = tags;
  if (photos !== undefined) value.photos = photos;
  return { errors, value };
}

function assertValid({ errors, value }) {
  const first = Object.values(errors)[0];
  if (first) throw new ValidationError(first, errors);
  return value;
}

export const assertValidPlaceBase = (input) => assertValid(validatePlaceBase(input));
export const assertValidVisitFields = (input) => assertValid(validateVisitFields(input));
