/**
 * Keyboard shortcut quick-reference overlay. Rendered directly in the page
 * DOM (not shadow root) so the backdrop blur works across the full viewport.
 * Toggled with Ctrl+Shift+?.
 */

const SHORTCUTS = [
  { keys: 'Ctrl+Shift+P', desc: 'Open command palette (type any command)' },
  { keys: 'Ctrl+Shift+H', desc: 'Toggle command history panel' },
  { keys: 'Ctrl+Shift+A', desc: 'Toggle agent on / off' },
  { keys: 'Ctrl+Shift+F', desc: 'Toggle focus mode (minimal overlay)' },
  { keys: 'Ctrl+Shift+O', desc: 'Toggle page outline (heading navigator)' },
  { keys: 'Ctrl+Shift+R', desc: 'Auto-scroll reading mode (Space to pause)' },
  { keys: 'Ctrl+Shift+E', desc: 'Export session transcript' },
  { keys: 'Ctrl+Shift+?', desc: 'Show / hide this help' },
];

const GESTURES = [
  { gesture: 'Pinch', desc: 'Left click' },
  { gesture: 'Peace ✌', desc: 'Right click (context menu)' },
  { gesture: 'Open palm', desc: 'Pause cursor' },
  { gesture: 'Two fingers — move', desc: 'Scroll up / down' },
  { gesture: 'Swipe ←', desc: 'Navigate back' },
  { gesture: 'Swipe →', desc: 'Navigate forward' },
  { gesture: 'Swipe ↑', desc: 'Scroll up (large)' },
  { gesture: 'Swipe ↓', desc: 'Scroll down (large)' },
  { gesture: 'Thumbs up 👍', desc: 'Confirm pending action' },
  { gesture: 'Thumbs down 👎', desc: 'Cancel pending action' },
  { gesture: 'Three fingers (1s)', desc: 'Open task picker' },
];

let overlay: HTMLDivElement | null = null;

export function toggleShortcutsHelp(): void {
  if (overlay) {
    overlay.remove();
    overlay = null;
    return;
  }

  overlay = document.createElement('div');
  overlay.id = 'aria-shortcuts-overlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483645',
    'background:rgba(0,0,0,0.6)', 'backdrop-filter:blur(4px)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'font-family:ui-sans-serif,system-ui,sans-serif',
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'background:rgba(18,18,24,0.97)', 'border:1px solid rgba(255,255,255,0.1)',
    'border-radius:16px', 'padding:24px 28px', 'width:560px', 'max-width:90vw',
    'max-height:80vh', 'overflow-y:auto',
    'box-shadow:0 24px 64px rgba(0,0,0,0.7)',
    'color:#f3f3f7',
  ].join(';');

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
      <h2 style="margin:0;font-size:16px;font-weight:700;letter-spacing:0.3px">ARIA Shortcuts &amp; Gestures</h2>
      <button id="aria-sh-close" style="background:none;border:none;color:#9aa0aa;cursor:pointer;font-size:18px;line-height:1;padding:2px 4px">✕</button>
    </div>

    <h3 style="margin:0 0 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:#9aa0aa">Keyboard shortcuts</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      ${SHORTCUTS.map((s) => `
      <tr>
        <td style="padding:5px 0;width:45%">
          <code style="background:rgba(255,255,255,0.08);padding:2px 7px;border-radius:4px;font-size:12px;font-family:monospace">${s.keys}</code>
        </td>
        <td style="padding:5px 0;font-size:13px;color:#c0c8d4">${s.desc}</td>
      </tr>`).join('')}
    </table>

    <h3 style="margin:0 0 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:#9aa0aa">Hand gestures</h3>
    <table style="width:100%;border-collapse:collapse">
      ${GESTURES.map((g) => `
      <tr>
        <td style="padding:4px 0;width:45%;font-size:13px;font-weight:600;color:#e0e4ef">${g.gesture}</td>
        <td style="padding:4px 0;font-size:13px;color:#c0c8d4">${g.desc}</td>
      </tr>`).join('')}
    </table>

    <p style="margin:16px 0 0;font-size:11px;color:#6a737d;text-align:center">Press Ctrl+Shift+? or click anywhere outside to close</p>
  `;

  overlay.appendChild(card);
  document.documentElement.appendChild(overlay);

  card.querySelector('#aria-sh-close')?.addEventListener('click', toggleShortcutsHelp);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) toggleShortcutsHelp();
  });
}
