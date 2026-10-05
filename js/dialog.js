import { h } from './dom.js';

/**
 * Modal with any number of buttons. Resolves to the clicked button's `value`,
 * or null if dismissed (Escape).  choices: [{ value, label, kind?: 'primary'|'danger' }]
 * If `read` is given, resolves to { value, data: read() } instead.
 */
export function choiceDialog({ title, message, choices, content = null, read = null }) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': 'dialog-title' },
      h('form', { method: 'dialog' },
        h('h2', { id: 'dialog-title' }, title),
        message ? h('p', {}, message) : null,
        content,
        h('div', { class: 'actions wrap' },
          choices.map((c) => h('button', { class: `btn ${c.kind ?? ''}`.trim(), value: c.value }, c.label)),
        ),
      ),
    );
    dialog.addEventListener('close', () => {
      const value = dialog.returnValue || null;
      const data = read ? read() : undefined; // read form state before the dialog is removed
      dialog.remove();
      resolve(read ? { value, data } : value);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * Yes/no confirmation. Resolves true if the confirm button was chosen.
 * Pass cancelLabel: null for a plain "OK" notice.
 */
export async function confirmDialog({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  const choices = [];
  if (cancelLabel) choices.push({ value: 'cancel', label: cancelLabel });
  choices.push({ value: 'ok', label: confirmLabel, kind: danger ? 'danger' : 'primary' });
  return (await choiceDialog({ title, message, choices })) === 'ok';
}
