// Dates are stored as plain "YYYY-MM-DD" strings (no time zone), so a place visited on
// Oct 4 is always Oct 4 no matter where the device is later.

const pad = (n) => String(n).padStart(2, '0');

/** Today's date in the device's local time zone, as YYYY-MM-DD. */
export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "2026-10-04" -> "October 4, 2026" (in the user's locale). */
export function formatDate(value) {
  if (!isValidDateString(value)) return String(value ?? '');
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** True for an ISO-8601 timestamp string such as 2026-10-04T17:32:00.000Z. */
export function isValidTimestamp(value) {
  return typeof value === 'string' && value.length >= 10 && !Number.isNaN(Date.parse(value));
}
