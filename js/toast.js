import { $ } from './dom.js';

let timer;

/** Shows a short message at the bottom of the screen (announced to screen readers). */
export function toast(message, ms = 3800) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), ms);
}
