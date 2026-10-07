// Older-to-newer colours for the timeline: the route line, the pins and the legend all use one ramp
// (three colours; the user can change them in the timeline options).
export const DEFAULT_RAMP = ['#2f6db5', '#9a4f9a', '#e8772e'];

export const isHexColor = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The ramp colour at t (0 = oldest, 1 = newest; clamped), as #rrggbb. */
export function rampColor(t, ramp = DEFAULT_RAMP) {
  const x = Math.min(1, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  const [a, b] = [rgb(ramp[i]), rgb(ramp[i + 1])];
  return '#' + a.map((v, k) => Math.round(v + (b[k] - v) * (x - i)).toString(16).padStart(2, '0')).join('');
}

export const rampCss = (ramp) => `linear-gradient(to right, ${ramp.join(', ')})`;
