import { h } from './dom.js';

/** Read-only stars, e.g. ★★★★☆ */
export function ratingDisplay(rating) {
  if (!rating) return null;
  return h('span', { class: 'stars-static', role: 'img', 'aria-label': `${rating} out of 5` },
    '★'.repeat(rating) + '☆'.repeat(5 - rating));
}

/** Five tappable stars. Tapping the selected star again clears the rating. */
export function ratingInput(initial, onChange) {
  let value = initial ?? null;
  const buttons = [1, 2, 3, 4, 5].map((n) =>
    h('button', {
      type: 'button',
      class: 'star',
      role: 'radio',
      'aria-label': `${n} star${n > 1 ? 's' : ''}`,
      onclick: () => {
        value = value === n ? null : n;
        paint();
        onChange(value);
      },
    }, '★'));

  function paint() {
    buttons.forEach((button, i) => {
      button.classList.toggle('on', value !== null && i < value);
      button.setAttribute('aria-checked', String(value === i + 1));
    });
  }

  const root = h('div', { class: 'rating', role: 'radiogroup', 'aria-label': 'Rating' }, buttons);
  paint();
  return root;
}
