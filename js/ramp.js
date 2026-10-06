// Older-to-newer colours for the timeline: the route line, the pins and the legend all use this one ramp.
export const RAMP = ['#2f6db5', '#9a4f9a', '#e8772e'];

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The ramp colour at t (0 = oldest, 1 = newest; clamped), as #rrggbb. */
export function rampColor(t) {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const [a, b] = [rgb(RAMP[i]), rgb(RAMP[i + 1])];
  return '#' + a.map((v, k) => Math.round(v + (b[k] - v) * (x - i)).toString(16).padStart(2, '0')).join('');
}
