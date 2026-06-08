/**
 * Text-input fallback when Web Speech API is unavailable or denied.
 * Shows a floating text box so users can type commands manually.
 * Dismissed after submission or Escape.
 */
import { sendRuntime } from '@shared/messages';

let active = false;

export function showSttFallback(): void {
  if (active) return;
  active = true;

  const container = document.createElement('div');
  container.id = 'aria-stt-fallback';
  container.style.cssText = [
    'position:fixed', 'bottom:80px', 'left:50%', 'transform:translateX(-50%)',
    'z-index:2147483647', 'display:flex', 'gap:6px',
    'background:rgba(18,18,24,0.97)', 'border:1px solid rgba(255,100,100,0.4)',
    'border-radius:10px', 'padding:8px 10px',
    'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
    'font-family:ui-sans-serif,system-ui,sans-serif',
    'animation:aria-fadein 0.15s ease',
  ].join(';');

  injectStyle();

  const label = document.createElement('span');
  label.style.cssText = 'font-size:11px;color:#ff8080;align-self:center;white-space:nowrap';
  label.textContent = 'Voice unavailable — type:';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Type your command…';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.style.cssText = [
    'flex:1', 'min-width:200px', 'padding:6px 10px',
    'border:1px solid rgba(255,255,255,0.1)', 'border-radius:6px',
    'background:rgba(255,255,255,0.05)', 'color:#f3f3f7', 'font-size:13px',
    'outline:none',
  ].join(';');

  const btn = document.createElement('button');
  btn.textContent = 'Send';
  btn.style.cssText = [
    'padding:6px 12px', 'border-radius:6px', 'border:none',
    'background:#ff2b2b', 'color:#fff', 'font-size:13px', 'cursor:pointer',
  ].join(';');

  const submit = () => {
    const command = input.value.trim();
    if (!command) return;
    sendRuntime({ type: 'MANUAL_COMMAND', target: 'background', command });
    dismiss();
  };

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') dismiss();
  });

  container.append(label, input, btn);
  document.documentElement.appendChild(container);
  input.focus();

  function dismiss() {
    active = false;
    container.remove();
  }

  // Auto-dismiss after 30s of inactivity.
  const timer = setTimeout(dismiss, 30000);
  input.addEventListener('keydown', () => { clearTimeout(timer); });
}

function injectStyle(): void {
  if (document.getElementById('aria-stt-fallback-style')) return;
  const s = document.createElement('style');
  s.id = 'aria-stt-fallback-style';
  s.textContent = `
    @keyframes aria-fadein { from { opacity:0; transform:translateX(-50%) translateY(8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
    #aria-stt-fallback input::placeholder { color:#6a737d; }
  `;
  document.head.appendChild(s);
}
