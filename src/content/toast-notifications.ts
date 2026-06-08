/**
 * Notification System
 * Non-intrusive toast notifications for async events.
 * Toasts appear bottom-right, auto-dismiss after 4s.
 * Each has an optional "tell me more" voice button.
 */

const CONTAINER_ID = 'aria-toast-container';

export interface ToastOptions {
  text: string;
  duration?: number;
  moreLabel?: string;
  onMore?: () => void;
}

export function showToast(opts: ToastOptions | string): void {
  const o: ToastOptions = typeof opts === 'string' ? { text: opts } : opts;
  const duration = o.duration ?? 4000;

  let container = document.getElementById(CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:20px',
      'z-index:2147483645',
      'display:flex', 'flex-direction:column', 'gap:8px',
      'align-items:flex-end',
      'pointer-events:none',
    ].join(';');
    document.documentElement.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.style.cssText = [
    'background:rgba(18,18,26,0.97)',
    'border:1px solid rgba(255,255,255,0.12)',
    'border-radius:10px',
    'padding:10px 14px',
    'max-width:300px',
    'box-shadow:0 8px 28px rgba(0,0,0,0.5)',
    'backdrop-filter:blur(8px)',
    'color:#f3f3f7',
    'font-family:ui-sans-serif,system-ui,sans-serif',
    'font-size:13px',
    'line-height:1.4',
    'pointer-events:all',
    'display:flex', 'align-items:center', 'gap:10px',
    'animation:aria-toast-in 0.25s ease',
    'cursor:default',
  ].join(';');

  const dot = document.createElement('span');
  dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#ff2b2b;flex-shrink:0;box-shadow:0 0 8px rgba(255,43,43,0.8)';

  const msg = document.createElement('span');
  msg.style.cssText = 'flex:1;min-width:0';
  msg.textContent = o.text;

  toast.append(dot, msg);

  if (o.moreLabel && o.onMore) {
    const btn = document.createElement('button');
    btn.textContent = o.moreLabel;
    btn.style.cssText = 'background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);color:#f3f3f7;border-radius:5px;padding:2px 8px;font-size:11px;cursor:pointer;white-space:nowrap;flex-shrink:0';
    btn.addEventListener('click', () => { o.onMore!(); dismiss(); });
    toast.appendChild(btn);
  }

  const dismiss = () => {
    toast.style.animation = 'aria-toast-out 0.2s ease forwards';
    setTimeout(() => toast.remove(), 200);
  };
  toast.addEventListener('click', dismiss);

  injectToastStyles();
  container.appendChild(toast);
  setTimeout(dismiss, duration);
}

function injectToastStyles(): void {
  if (document.getElementById('aria-toast-styles')) return;
  const style = document.createElement('style');
  style.id = 'aria-toast-styles';
  style.textContent = `
    @keyframes aria-toast-in {
      from { opacity:0; transform:translateY(12px); }
      to   { opacity:1; transform:translateY(0); }
    }
    @keyframes aria-toast-out {
      to { opacity:0; transform:translateY(8px); }
    }`;
  document.head.appendChild(style);
}
