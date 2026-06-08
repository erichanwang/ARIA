/**
 * Page action preview toast. Before a destructive action (form submit,
 * navigation away from the page) the agent shows a 2-second toast with a
 * cancel button. If not cancelled, it resolves true and the action proceeds.
 *
 * Lives directly in the page DOM (not shadow root) to guarantee it renders
 * on top of extension popups that may be z-index-capped.
 */

const PREVIEW_MS = 2500;

export function previewAction(label: string): Promise<boolean> {
  return new Promise((resolve) => {
    const existing = document.getElementById('aria-action-preview');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'aria-action-preview';
    applyStyles(toast);

    const progress = document.createElement('div');
    progress.id = 'aria-action-progress';
    applyProgressStyles(progress, PREVIEW_MS);

    const msg = document.createElement('span');
    msg.textContent = label;
    msg.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

    const btn = document.createElement('button');
    btn.textContent = 'Cancel';
    btn.style.cssText = [
      'flex-shrink:0', 'padding:5px 12px', 'border-radius:6px',
      'border:1px solid rgba(255,255,255,0.25)', 'background:rgba(255,255,255,0.1)',
      'color:#f3f3f7', 'cursor:pointer', 'font-size:12px',
    ].join(';');
    btn.addEventListener('click', () => { cleanup(); resolve(false); });

    toast.append(msg, btn);
    document.documentElement.appendChild(toast);
    // Trigger animation on next frame.
    requestAnimationFrame(() => document.documentElement.appendChild(progress));

    const timer = setTimeout(() => { cleanup(); resolve(true); }, PREVIEW_MS);

    function cleanup() {
      clearTimeout(timer);
      toast.remove();
      document.getElementById('aria-action-progress')?.remove();
    }
  });
}

function applyStyles(el: HTMLElement): void {
  el.style.cssText = [
    'position:fixed', 'bottom:80px', 'left:50%',
    'transform:translateX(-50%)',
    'display:flex', 'align-items:center', 'gap:12px',
    'padding:12px 16px', 'max-width:440px', 'width:90vw',
    'background:rgba(18,18,26,0.97)',
    'border:1px solid rgba(255,255,255,0.1)',
    'border-radius:10px',
    'box-shadow:0 6px 28px rgba(0,0,0,0.5)',
    'color:#f3f3f7',
    'font-family:ui-sans-serif,system-ui,sans-serif',
    'font-size:13px',
    'z-index:2147483647',
    'backdrop-filter:blur(8px)',
  ].join(';');
}

function applyProgressStyles(el: HTMLElement, ms: number): void {
  el.style.cssText = [
    'position:fixed', 'bottom:78px', 'left:50%', 'transform:translateX(-50%)',
    'height:3px', 'width:90vw', 'max-width:440px',
    'background:linear-gradient(90deg,#ff2b2b,#ff8c00)',
    'border-radius:0 0 10px 10px',
    'animation:aria-preview-shrink ' + ms + 'ms linear forwards',
    'z-index:2147483647',
    'transform-origin:left center',
  ].join(';');

  // Inject the keyframe once.
  if (!document.getElementById('aria-preview-kf')) {
    const s = document.createElement('style');
    s.id = 'aria-preview-kf';
    s.textContent = `@keyframes aria-preview-shrink { from { transform: translateX(-50%) scaleX(1); } to { transform: translateX(-50%) scaleX(0); } }`;
    document.head?.appendChild(s);
  }
}
