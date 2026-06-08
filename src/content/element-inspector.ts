/**
 * Developer/accessibility element inspector.
 * Hold Ctrl and hover any element to see its tag, role, labels, and
 * relevant ARIA attributes in a floating tooltip.
 * Enabled while ARIA is mounted; does not interfere with page events.
 */

let tooltip: HTMLDivElement | null = null;
let active = false;

export function mountElementInspector(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Control' && !e.repeat) {
      active = true;
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Control') {
      active = false;
      dismissTooltip();
    }
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!active) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === document.body || el === document.documentElement) {
      dismissTooltip();
      return;
    }
    showTooltip(el, e.clientX, e.clientY);
  };

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove, { passive: true });

  return () => {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('mousemove', onMouseMove);
    dismissTooltip();
  };
}

function showTooltip(el: Element, x: number, y: number): void {
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'aria-inspector-tip';
    tooltip.style.cssText = [
      'position:fixed', 'z-index:2147483647',
      'max-width:320px', 'pointer-events:none',
      'background:rgba(10,10,16,0.97)', 'border:1px solid rgba(100,200,255,0.3)',
      'border-radius:8px', 'padding:8px 12px',
      'font-family:ui-monospace,monospace', 'font-size:11px', 'line-height:1.5',
      'color:#c0d8f4', 'box-shadow:0 4px 20px rgba(0,0,0,0.6)',
    ].join(';');
    document.documentElement.appendChild(tooltip);
  }

  tooltip.innerHTML = buildInspectorHtml(el);

  // Position below/right of cursor, keeping within viewport.
  const tipW = 320;
  const tipH = 140;
  let left = x + 14;
  let top = y + 14;
  if (left + tipW > window.innerWidth - 8) left = x - tipW - 8;
  if (top + tipH > window.innerHeight - 8) top = y - tipH - 8;
  tooltip.style.left = `${Math.max(4, left)}px`;
  tooltip.style.top = `${Math.max(4, top)}px`;
}

function dismissTooltip(): void {
  tooltip?.remove();
  tooltip = null;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildInspectorHtml(el: Element): string {
  const tag = esc(el.tagName.toLowerCase());
  const id = el.id ? `#${esc(el.id)}` : '';
  const cls = el.className && typeof el.className === 'string'
    ? el.className.trim().split(/\s+/).slice(0, 3).map((c) => `.${esc(c)}`).join('')
    : '';

  const attrs: Array<[string, string]> = [];
  const track = (name: string) => {
    const v = el.getAttribute(name);
    if (v !== null) attrs.push([name, v]);
  };

  ['role', 'aria-label', 'aria-labelledby', 'aria-describedby',
   'aria-hidden', 'aria-expanded', 'aria-selected', 'aria-checked',
   'aria-disabled', 'aria-haspopup', 'aria-live', 'aria-atomic',
   'tabindex', 'href', 'type', 'name', 'placeholder'].forEach(track);

  const text = el.textContent?.trim().slice(0, 60);
  const rows = attrs
    .map(([k, v]) => `<tr><td style="color:#9aa0aa;padding-right:8px">${esc(k)}</td><td style="color:#e0ecff">${esc(v.slice(0, 80))}</td></tr>`)
    .join('');

  return `
    <div style="color:#64c8ff;font-weight:700;margin-bottom:5px">&lt;${tag}${id}${cls}&gt;</div>
    ${rows ? `<table style="border-collapse:collapse">${rows}</table>` : ''}
    ${text ? `<div style="margin-top:5px;color:#8898aa;border-top:1px solid rgba(255,255,255,0.06);padding-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">"${esc(text)}"</div>` : ''}
  `;
}
