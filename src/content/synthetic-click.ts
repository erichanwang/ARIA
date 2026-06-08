/**
 * Synthetic click dispatch, shared by the DOM executor (voice) and the eye/hand
 * drivers. Fires the full pointer→mouse→click sequence plus the native
 * .click() so it works on both native controls and JS-driven widgets.
 */
export function clickElement(el: Element): void {
  const r = el.getBoundingClientRect();
  clickAtPoint(r.left + r.width / 2, r.top + r.height / 2, el);
}

export function clickAtPoint(x: number, y: number, target?: Element | null): void {
  const el = target ?? document.elementFromPoint(x, y);
  if (!el) return;
  const opts: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
  };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
  if (el instanceof HTMLElement) el.click();
}
