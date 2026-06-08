/**
 * Dark Overlay Tutorial
 * First-time feature explanations as dismissable dark overlay cards.
 * Never shown twice - tracked per feature in chrome.storage.local.
 */

const STORAGE_KEY = 'aria.seenTutorials';

export async function maybeShowTutorial(featureId: string, title: string, body: string): Promise<void> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  const seen = (raw[STORAGE_KEY] as string[] | undefined) ?? [];
  if (seen.includes(featureId)) return;

  showTutorialCard(title, body, async () => {
    seen.push(featureId);
    await chrome.storage.local.set({ [STORAGE_KEY]: seen });
  });
}

function showTutorialCard(title: string, body: string, onDismiss: () => void): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed', 'inset:0',
    'background:rgba(0,0,0,0.72)',
    'z-index:2147483646',
    'display:flex', 'align-items:center', 'justify-content:center',
    'animation:aria-tut-in 0.3s ease',
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'background:rgba(18,18,28,0.98)',
    'border:1px solid rgba(155,107,255,0.4)',
    'border-radius:16px',
    'padding:28px 32px',
    'max-width:420px',
    'width:90vw',
    'box-shadow:0 24px 60px rgba(0,0,0,0.7)',
    'font-family:ui-sans-serif,system-ui,sans-serif',
    'color:#f3f3f7',
    'text-align:center',
  ].join(';');

  const icon = document.createElement('div');
  icon.style.cssText = 'font-size:32px;margin-bottom:12px';
  icon.textContent = '✨';

  const h = document.createElement('h3');
  h.style.cssText = 'margin:0 0 10px;font-size:18px;font-weight:700;color:#fff';
  h.textContent = title;

  const p = document.createElement('p');
  p.style.cssText = 'margin:0 0 20px;font-size:14px;line-height:1.6;color:#c0c4d0';
  p.textContent = body;

  const btn = document.createElement('button');
  btn.style.cssText = [
    'background:rgba(155,107,255,0.85)',
    'border:none', 'color:#fff', 'border-radius:8px',
    'padding:10px 24px', 'font-size:14px', 'font-weight:600',
    'cursor:pointer',
  ].join(';');
  btn.textContent = 'Got it!';
  btn.addEventListener('click', () => {
    overlay.remove();
    injectTutStyle();
    onDismiss();
  });

  card.append(icon, h, p, btn);
  overlay.appendChild(card);
  document.documentElement.appendChild(overlay);
  injectTutStyle();
  btn.focus();
}

function injectTutStyle(): void {
  if (document.getElementById('aria-tut-styles')) return;
  const style = document.createElement('style');
  style.id = 'aria-tut-styles';
  style.textContent = `
    @keyframes aria-tut-in {
      from { opacity:0; }
      to   { opacity:1; }
    }`;
  document.head.appendChild(style);
}
