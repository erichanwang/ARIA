/**
 * First-launch onboarding overlay. Shows a 4-step tutorial:
 *   1. Welcome + what ARIA is
 *   2. Wake word ("Hey ARIA")
 *   3. Input modes
 *   4. API key setup
 *
 * Stored flag in chrome.storage.local prevents re-showing after first complete.
 * Rendered in the page DOM (not shadow root) for maximum visibility.
 */

const SEEN_KEY = 'aria.onboardingSeen';

export async function maybeShowOnboarding(): Promise<void> {
  const raw = await chrome.storage.local.get(SEEN_KEY);
  if (raw[SEEN_KEY]) return;
  showOnboarding();
}

function showOnboarding(): void {
  const overlay = document.createElement('div');
  overlay.id = 'aria-onboarding';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647',
    'background:rgba(0,0,0,0.82)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'font-family:ui-sans-serif,system-ui,sans-serif',
    'backdrop-filter:blur(4px)',
  ].join(';');

  const steps = [
    {
      icon: '🤖',
      title: 'Welcome to ARIA',
      body: 'ARIA (Adaptive Real-time Intelligent Agent) controls your browser with your voice, eyes, or hands — powered by Claude AI. You can click, scroll, fill forms, translate, read pages aloud, and much more.',
    },
    {
      icon: '🎤',
      title: 'Voice commands',
      body: 'Say <strong>"Hey ARIA"</strong> then speak naturally: <em>"click the login button"</em>, <em>"scroll down"</em>, <em>"fill in my name"</em>, <em>"read this page"</em>, or <em>"translate to Spanish"</em>.',
    },
    {
      icon: '👁',
      title: 'Input modes',
      body: 'Switch modes in the ARIA popup: <strong>Voice</strong> for Claude-powered commands, <strong>Eye</strong> for gaze + brow-raise control, <strong>Hand</strong> for gesture control via webcam.',
    },
    {
      icon: '⌨️',
      title: 'Keyboard shortcuts',
      body: '<strong>Ctrl+Shift+P</strong> opens the command palette to type commands, <strong>Ctrl+Shift+O</strong> shows page outline, <strong>Ctrl+Shift+R</strong> starts auto-scroll, <strong>Ctrl+Shift+?</strong> shows all shortcuts.',
    },
    {
      icon: '🎬',
      title: 'Macros',
      body: 'Record multi-step automations: say <strong>"start recording"</strong>, then run your commands, then <strong>"stop recording my macro"</strong>. Replay with <strong>"run my macro"</strong>.',
    },
    {
      icon: '🔑',
      title: 'Set your API key',
      body: 'Open the ARIA popup and enter your <strong>Anthropic API key</strong>. Keys start with <code>sk-ant-</code>. All processing happens on-device except the Claude API call.',
    },
  ];

  let step = 0;

  const card = document.createElement('div');
  card.style.cssText = [
    'background:rgba(14,14,20,0.98)', 'border:1px solid rgba(255,255,255,0.1)',
    'border-radius:20px', 'padding:40px 36px', 'max-width:420px', 'width:90vw',
    'color:#f3f3f7', 'box-shadow:0 24px 80px rgba(0,0,0,0.7)',
    'display:flex', 'flex-direction:column', 'gap:20px',
  ].join(';');

  const iconEl = document.createElement('div');
  iconEl.style.cssText = 'font-size:44px; text-align:center';

  const titleEl = document.createElement('h2');
  titleEl.style.cssText = 'margin:0;font-size:20px;text-align:center;letter-spacing:-0.3px';

  const bodyEl = document.createElement('p');
  bodyEl.style.cssText = 'margin:0;color:#c0c8d4;line-height:1.6;text-align:center;font-size:14px';

  const dots = document.createElement('div');
  dots.style.cssText = 'display:flex;justify-content:center;gap:8px';

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center';

  const backBtn = document.createElement('button');
  backBtn.textContent = 'Back';
  backBtn.style.cssText = [
    'padding:10px 24px', 'border-radius:10px',
    'border:1px solid rgba(255,255,255,0.15)', 'background:rgba(255,255,255,0.07)',
    'color:#f3f3f7', 'cursor:pointer', 'font-size:14px',
  ].join(';');

  const nextBtn = document.createElement('button');
  nextBtn.style.cssText = [
    'padding:10px 28px', 'border-radius:10px',
    'border:none', 'background:#ff2b2b',
    'color:#fff', 'cursor:pointer', 'font-size:14px', 'font-weight:600',
  ].join(';');

  card.append(iconEl, titleEl, bodyEl, dots, btnRow);
  btnRow.append(backBtn, nextBtn);
  overlay.appendChild(card);
  document.documentElement.appendChild(overlay);

  const render = () => {
    const s = steps[step];
    iconEl.textContent = s.icon;
    titleEl.textContent = s.title;
    bodyEl.innerHTML = s.body;

    // Dots
    dots.innerHTML = '';
    steps.forEach((_, i) => {
      const dot = document.createElement('div');
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${i === step ? '#ff2b2b' : 'rgba(255,255,255,0.2)'}`;
      dots.appendChild(dot);
    });

    backBtn.style.display = step === 0 ? 'none' : '';
    nextBtn.textContent = step === steps.length - 1 ? 'Get started!' : 'Next';
  };

  backBtn.addEventListener('click', () => { step = Math.max(0, step - 1); render(); });
  nextBtn.addEventListener('click', () => {
    if (step < steps.length - 1) {
      step++;
      render();
    } else {
      overlay.remove();
      void chrome.storage.local.set({ [SEEN_KEY]: true });
    }
  });

  render();
}
