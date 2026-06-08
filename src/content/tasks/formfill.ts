/**
 * Form-fill assistant. Enumerates the visible, fillable fields on the page,
 * asks the user for their values (free text), has Claude match values → fields,
 * fills them, and asks for confirmation before any submit.
 */
import type { AgentCursor } from '../cursor';
import type { Hud } from '../hud';
import type { Speech } from '../speech';
import { isVisible } from '../dom-finder';
import { requestRuntime } from '@shared/messages';
import type { FormFillField, FormFillResult } from '@shared/tasks';

type Fillable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file']);

export async function runFormFill(cursor: AgentCursor, hud: Hud, speech: Speech): Promise<void> {
  const fields = collectFields();
  if (fields.length === 0) {
    await speech.speak("I couldn't find any form fields on this page.");
    return;
  }

  // Spike UX: collect the user's values via a prompt. (Voice capture of values
  // is a follow-up - this keeps the module self-contained.)
  const values = window.prompt(
    `ARIA found ${fields.length} fields:\n${fields.map((f) => `• ${f.meta.label}`).join('\n')}\n\nEnter your details (e.g. "name Jane Doe, email jane@x.com"):`,
  );
  if (!values) {
    await speech.speak('Okay, cancelled.');
    return;
  }

  hud.setCommand('Matching your details to the form…');
  cursor.setState('thinking');

  const res = await requestRuntime({
    type: 'RUN_TASK',
    target: 'background',
    request: { kind: 'formfill', fields: fields.map((f) => f.meta), values },
  });

  cursor.setState('idle');
  if (!res?.ok || !res.result) {
    await speech.speak('I had trouble matching those details.');
    return;
  }

  const result = res.result as FormFillResult;
  let filled = 0;
  for (const fill of result.fills) {
    const target = fields.find((f) => f.meta.handle === fill.handle);
    if (!target) continue;
    await cursor.moveToElement(target.el);
    setFieldValue(target.el, fill.value);
    filled += 1;
  }

  await speech.speak(`${result.speech} I filled ${filled} field${filled === 1 ? '' : 's'}. Review before submitting.`);
}

function collectFields(): Array<{ el: Fillable; meta: FormFillField }> {
  const els = Array.from(
    document.querySelectorAll<Fillable>('input, textarea, select'),
  ).filter((el) => {
    if (!isVisible(el)) return false;
    if (el instanceof HTMLInputElement && SKIP_TYPES.has(el.type)) return false;
    if (el.disabled) return false;
    // readOnly only exists on input/textarea, not select.
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.readOnly) return false;
    return true;
  });

  return els.map((el, i) => {
    const handle = el.id || el.name || `field-${i}`;
    return { el, meta: { handle, label: fieldLabel(el), type: fieldType(el) } };
  });
}

function fieldType(el: Fillable): string {
  if (el instanceof HTMLInputElement) return el.type;
  return el.tagName.toLowerCase();
}

function fieldLabel(el: Fillable): string {
  if (el.id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lbl?.textContent?.trim()) return lbl.textContent.trim();
  }
  const wrap = el.closest('label');
  if (wrap?.textContent?.trim()) return wrap.textContent.trim();
  return el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || 'field';
}

/** Set value and dispatch input/change so framework-bound forms react. */
function setFieldValue(el: Fillable, value: string): void {
  if (el instanceof HTMLSelectElement) {
    const opt = Array.from(el.options).find(
      (o) => o.text.trim().toLowerCase() === value.trim().toLowerCase(),
    );
    if (opt) el.value = opt.value;
  } else {
    el.focus();
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
