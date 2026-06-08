/**
 * Page outline sidebar: a collapsible panel listing all headings on the page
 * for quick keyboard/gaze navigation. Toggled with Ctrl+Shift+O.
 * Clicking a heading smoothly scrolls to it.
 */

let panel: HTMLDivElement | null = null;

export function togglePageOutline(): void {
  if (panel) {
    panel.remove();
    panel = null;
    return;
  }

  const headings = Array.from(document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))
    .filter((h) => h.offsetParent !== null && h.textContent?.trim());

  if (headings.length === 0) return;

  panel = document.createElement('div');
  panel.id = 'aria-page-outline';
  panel.style.cssText = [
    'position:fixed', 'top:0', 'right:0', 'bottom:0', 'z-index:2147483645',
    'width:280px', 'max-width:40vw',
    'background:rgba(12,12,18,0.97)', 'border-left:1px solid rgba(255,255,255,0.08)',
    'overflow-y:auto', 'padding:12px 0',
    'font-family:ui-sans-serif,system-ui,sans-serif',
    'box-shadow:-8px 0 32px rgba(0,0,0,0.5)',
    'animation:aria-outline-in 0.2s ease',
  ].join(';');

  injectStyle();

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 16px 8px;margin-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.06)';

  const title = document.createElement('span');
  title.style.cssText = 'font-size:11px;text-transform:uppercase;letter-spacing:0.7px;color:#9aa0aa;font-weight:700';
  title.textContent = `Outline (${headings.length})`;

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:#6a737d;cursor:pointer;font-size:14px;line-height:1';
  closeBtn.addEventListener('click', togglePageOutline);

  header.append(title, closeBtn);
  panel.appendChild(header);

  for (const h of headings) {
    const level = parseInt(h.tagName.slice(1), 10);
    const item = document.createElement('button');
    item.style.cssText = [
      'display:block', 'width:100%', 'text-align:left',
      `padding:6px ${8 + (level - 1) * 12}px`,
      'border:none', 'background:transparent', 'cursor:pointer',
      'color:#c0c8d4', `font-size:${14 - (level - 1)}px`,
      'line-height:1.3', 'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
    ].join(';');
    item.title = h.textContent?.trim() ?? '';
    item.textContent = h.textContent?.trim() ?? '';
    item.addEventListener('click', () => {
      h.scrollIntoView({ behavior: 'smooth', block: 'center' });
      h.focus();
    });
    item.addEventListener('mouseover', () => { item.style.background = 'rgba(255,255,255,0.05)'; });
    item.addEventListener('mouseout', () => { item.style.background = 'transparent'; });
    panel!.appendChild(item);
  }

  document.documentElement.appendChild(panel);

  // Close on Escape.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      togglePageOutline();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
}

function injectStyle(): void {
  if (document.getElementById('aria-outline-style')) return;
  const s = document.createElement('style');
  s.id = 'aria-outline-style';
  s.textContent = `
    @keyframes aria-outline-in {
      from { transform: translateX(100%); }
      to   { transform: translateX(0); }
    }
  `;
  document.head.appendChild(s);
}
