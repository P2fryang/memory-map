// One tag control, two uses:
//   allowNew: true   the visit form: type a new tag (Enter or comma), or pick an existing one
//   allowNew: false  the timeline filter: only tags that exist
//
// Selected tags show as chips you can tap to remove. The dropdown lists the three most-used
// tags that aren't selected yet; typing narrows it to matching tags.
import { h } from './dom.js';
import { MAX_TAG_LENGTH, normalizeTag } from './tags.js';

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

export function renderTagPicker({ selected = [], stats = [], allowNew, label, placeholder, max = Infinity, onChange = () => {} }) {
  let tags = [...selected];
  let knownTags = stats;
  let open = false;

  const chips = h('div', { class: 'tag-chips' });
  const input = h('input', {
    type: 'text', class: 'tag-input', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off',
    spellcheck: 'false', enterkeyhint: 'done', maxlength: '40', placeholder, 'aria-label': label,
  });
  const toggle = h('button', { type: 'button', class: 'btn small tag-toggle', 'aria-expanded': 'false', 'aria-label': `${label}: show tags` }, '▾');
  const menu = h('ul', { class: 'tag-menu', hidden: true });
  const root = h('div', { class: 'tag-picker' }, chips, h('div', { class: 'tag-row' }, input, toggle), menu);

  const query = () => normalizeTag(input.value);
  const available = () => knownTags.filter((s) => !tags.includes(s.tag));

  /** What the dropdown offers right now. */
  function menuItems() {
    const q = query();
    const pool = available();
    if (!q) return { heading: pool.length ? 'Most used' : null, items: pool.slice(0, 3), more: Math.max(0, pool.length - 3) };
    const starts = pool.filter((s) => s.tag.startsWith(q));
    const contains = pool.filter((s) => !s.tag.startsWith(q) && s.tag.includes(q));
    return { heading: 'Matching tags', items: [...starts, ...contains].slice(0, 6), more: 0 };
  }

  function paintChips() {
    chips.replaceChildren(...tags.map((tag) =>
      h('button', { type: 'button', class: 'tag tag-removable', 'aria-label': `Remove tag ${tag}`, onclick: () => remove(tag) },
        tag, h('span', { 'aria-hidden': 'true' }, ' ×'))));
  }

  function paintMenu() {
    const { heading, items, more } = menuItems();
    const q = query();
    const rows = [];
    if (heading && items.length) rows.push(h('li', { class: 'tag-menu-heading' }, heading));
    for (const s of items) {
      rows.push(h('li', {}, h('button', { type: 'button', class: 'tag-option', onclick: () => add(s.tag) },
        h('span', {}, s.tag), h('span', { class: 'hint' }, plural(s.visits, 'visit')))));
    }
    if (allowNew && q && !knownTags.some((s) => s.tag === q) && !tags.includes(q)) {
      rows.push(h('li', {}, h('button', { type: 'button', class: 'tag-option tag-new', onclick: () => add(q) }, `Add “${q}”`)));
    }
    if (more) rows.push(h('li', { class: 'hint tag-menu-note' }, `Type to search ${more} more`));
    if (!rows.length) {
      rows.push(h('li', { class: 'hint tag-menu-note' },
        allowNew ? 'Type a tag and press Enter.' : (knownTags.length ? 'No matching tags.' : 'No tags yet.')));
    }
    menu.replaceChildren(...rows);
  }

  function setOpen(value) {
    open = value;
    menu.hidden = !value;
    toggle.setAttribute('aria-expanded', String(value));
    if (value) paintMenu();
  }

  function emit() { onChange([...tags]); }

  function add(raw) {
    const tag = normalizeTag(raw);
    if (!tag || tags.includes(tag) || [...tag].length > MAX_TAG_LENGTH || tags.length >= max) return false;
    tags = [...tags, tag];
    input.value = '';
    paintChips();
    if (open) paintMenu();
    emit();
    return true;
  }

  function remove(tag) {
    tags = tags.filter((t) => t !== tag);
    paintChips();
    if (open) paintMenu();
    emit();
  }

  /** Turns whatever is typed but not yet entered into a tag (so Save doesn't lose it). */
  function commitPending() {
    const q = query();
    if (!q) return;
    if (allowNew || knownTags.some((s) => s.tag === q)) add(q);
    else input.value = '';
  }

  input.addEventListener('focus', () => setOpen(true));
  input.addEventListener('input', () => {
    if (input.value.includes(',')) {
      const parts = input.value.split(',');
      input.value = parts.pop();
      for (const part of parts) if (allowNew || knownTags.some((s) => s.tag === normalizeTag(part))) add(part);
    }
    setOpen(true);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault(); // never submit the surrounding form from here
      const q = query();
      if (allowNew && q) add(q);
      else if (!allowNew && q) { const first = menuItems().items[0]; if (first) add(first.tag); }
    } else if (event.key === 'Backspace' && !input.value && tags.length) {
      remove(tags[tags.length - 1]);
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation(); // close the menu, not the whole form
      setOpen(false);
    }
  });
  toggle.addEventListener('click', () => setOpen(!open));
  // Keep focus where it is when tapping the menu, so it doesn't close before the tap lands (iOS).
  for (const el of [menu, toggle]) el.addEventListener('mousedown', (event) => event.preventDefault());
  root.addEventListener('focusout', () => setTimeout(() => { if (!root.contains(document.activeElement)) setOpen(false); }, 0));

  paintChips();

  return {
    el: root,
    getTags: () => [...tags],
    commitPending,
    setStats(next) { knownTags = next; if (open) paintMenu(); },
  };
}
