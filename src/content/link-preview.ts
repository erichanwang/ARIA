/**
 * Link preview: when the agent cursor (or gaze) dwells over an anchor tag,
 * show a small tooltip with the link destination and title.
 * Updates on every cursor position change with a debounce.
 */

let tooltip: HTMLDivElement | null = null;
let lastHref = '';
let dwellTimer: number | null = null;

export function updateLinkPreview(x: number, y: number): void {
  const el = document.elementFromPoint(x, y);
  const anchor = el?.closest<HTMLAnchorElement>('a[href]');

  if (!anchor) {
    dismissPreview();
    return;
  }

  const href = anchor.href;
  if (href === lastHref) return;
  lastHref = href;
  dismissPreview();

  if (dwellTimer !== null) clearTimeout(dwellTimer);
  dwellTimer = window.setTimeout(() => showPreview(href, anchor.title || anchor.textContent?.trim().slice(0, 60) || ''), 600);
}

function showPreview(href: string, label: string): void {
  tooltip = document.createElement('div');
  tooltip.id = 'aria-link-preview';

  let display: string;
  try {
    const u = new URL(href);
    display = u.hostname + u.pathname.slice(0, 40) + (u.pathname.length > 40 ? '…' : '');
  } catch {
    display = href.slice(0, 60);
  }

  tooltip.style.cssText = [
    'position:fixed', 'bottom:16px', 'left:50%', 'transform:translateX(-50%)',
    'z-index:2147483644',
    'padding:6px 12px', 'border-radius:8px',
    'background:rgba(10,10,16,0.95)', 'border:1px solid rgba(255,255,255,0.08)',
    'color:#c0c8d4', 'font-family:ui-sans-serif,system-ui,sans-serif',
    'font-size:12px', 'max-width:480px', 'word-break:break-all',
    'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
    'pointer-events:none',
  ].join(';');

  tooltip.textContent = label ? `${label} — ${display}` : display;
  document.documentElement.appendChild(tooltip);
}

export function dismissPreview(): void {
  if (dwellTimer !== null) { clearTimeout(dwellTimer); dwellTimer = null; }
  tooltip?.remove();
  tooltip = null;
  lastHref = '';
}
