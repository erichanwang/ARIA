/**
 * The overlay host. A single fixed, full-viewport container attached to a
 * SHADOW ROOT so the page's CSS can never bleed into the cursor/HUD and vice
 * versa. Everything ARIA draws on the page lives inside this shadow tree.
 *
 * pointer-events on the host are 'none' so the agent never blocks the user's
 * own clicks; individual interactive bits (e.g. HUD buttons) re-enable them.
 */
const HOST_ID = 'aria-overlay-host';

let shadow: ShadowRoot | null = null;
let repositionListener: (() => void) | null = null;

/**
 * KI-07: `contain: layout|paint|strict|content` on <html> or <body> makes
 * that element a containing block for `position: fixed` descendants (per
 * spec), so a `position:fixed` host appended under it gets clipped/offset by
 * that element's box instead of the viewport, and scrolls out of view.
 */
export function pageContainsFixedPositioning(): boolean {
  const containValue = (el: Element | null): string =>
    el ? getComputedStyle(el).contain : '';
  const establishesContainingBlock = (value: string): boolean =>
    /\b(layout|paint|strict|content)\b/.test(value);
  return (
    establishesContainingBlock(containValue(document.documentElement)) ||
    establishesContainingBlock(containValue(document.body))
  );
}

export function getOverlayRoot(): ShadowRoot {
  if (shadow) return shadow;

  const existing = document.getElementById(HOST_ID);
  if (existing && existing.shadowRoot) {
    shadow = existing.shadowRoot;
    return shadow;
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  const fixedIsBroken = pageContainsFixedPositioning();
  // The host itself must sit above all page content and never intercept input.
  host.style.cssText = [
    `position:${fixedIsBroken ? 'absolute' : 'fixed'}`,
    'inset:0',
    'width:100vw',
    'height:100vh',
    'pointer-events:none',
    'z-index:2147483647',
    'margin:0',
    'padding:0',
    'border:0',
  ].join(';');
  document.documentElement.appendChild(host);

  if (fixedIsBroken) {
    // Manually keep the host pinned to the viewport by tracking scroll -
    // `position:fixed` won't do it here because an ancestor establishes a
    // containing block for fixed descendants.
    const reposition = (): void => {
      host.style.top = `${window.scrollY}px`;
      host.style.left = `${window.scrollX}px`;
    };
    reposition();
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition);
    repositionListener = () => {
      window.removeEventListener('scroll', reposition);
      window.removeEventListener('resize', reposition);
    };
  }

  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  shadow.appendChild(style);
  return shadow;
}

export function removeOverlay(): void {
  document.getElementById(HOST_ID)?.remove();
  shadow = null;
  repositionListener?.();
  repositionListener = null;
}

/** Apply the user's chosen accent color to the overlay via a CSS custom property. */
export function applyAccentColor(color: string): void {
  const root = getOverlayRoot();
  // CSS custom properties defined on :host inherit into the shadow tree.
  // We update the dynamic override style so it wins over the OVERLAY_CSS default.
  let accentStyle = root.getElementById('aria-accent-override') as HTMLStyleElement | null;
  if (!accentStyle) {
    accentStyle = document.createElement('style');
    accentStyle.id = 'aria-accent-override';
    root.appendChild(accentStyle);
  }
  accentStyle.textContent = `:host { --aria-accent: ${color}; }`;
}

export function toggleFocusMode(): void {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  if (host.hasAttribute('data-focus-mode')) {
    host.removeAttribute('data-focus-mode');
  } else {
    host.setAttribute('data-focus-mode', '');
  }
}

/**
 * All ARIA styles, scoped inside the shadow root. Cursor states are driven by
 * the [data-state] attribute on #aria-cursor; mode tint by [data-mode].
 */
const OVERLAY_CSS = /* css */ `
  :host { all: initial; --aria-accent: #ff2b2b; }

  /* Respect OS-level accessibility preferences. */
  @media (prefers-reduced-motion: reduce) {
    #aria-cursor { animation: none !important; transition: none !important; }
    .aria-trail { animation: none !important; opacity: 0 !important; }
    .aria-dwell-ring { animation: none !important; }
  }
  @media (forced-colors: active) {
    #aria-cursor { background: Highlight; box-shadow: none; }
    #aria-hud { background: Canvas; color: CanvasText; border-color: Highlight; }
  }

  /* ----------------------------- cursor ----------------------------------- */
  #aria-cursor {
    position: fixed;
    top: 0;
    left: 0;
    width: 20px;
    height: 20px;
    margin-left: -10px;   /* center the dot on its coordinate */
    margin-top: -10px;
    border-radius: 50%;
    background: var(--aria-accent, #ff2b2b);
    pointer-events: none;
    will-change: transform;
    transform: translate(var(--x, 50vw), var(--y, 50vh)) scale(var(--scale, 1));
    box-shadow: 0 0 0 4px rgba(255, 43, 43, 0.30),
                0 0 0 8px rgba(255, 43, 43, 0.15),
                0 0 14px 2px rgba(255, 43, 43, 0.55);
    animation: aria-pulse 1.5s ease-in-out infinite;
  }

  /* "AGENT" label, above-right of the cursor tip. */
  #aria-cursor .aria-label {
    position: absolute;
    top: -22px;
    left: 18px;
    font-family: 'Courier New', ui-monospace, monospace;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: #fff;
    background: rgba(255, 43, 43, 0.88);
    padding: 2px 6px;
    border-radius: 3px;
    white-space: nowrap;
    user-select: none;
    transition: background 0.2s ease;
  }

  /* Spinning arc used in the 'thinking' state. */
  #aria-cursor .aria-arc {
    position: absolute;
    inset: -6px;
    border-radius: 50%;
    border: 2px solid transparent;
    border-top-color: rgba(255, 255, 255, 0.95);
    opacity: 0;
  }

  /* -------------------------- state variants ------------------------------ */
  #aria-cursor[data-state="idle"] {
    background: var(--aria-accent, #ff2b2b);
    animation: aria-pulse 1.5s ease-in-out infinite;
  }

  #aria-cursor[data-state="listening"] {
    background: #2b7fff;
    box-shadow: 0 0 0 4px rgba(43, 127, 255, 0.30),
                0 0 0 10px rgba(43, 127, 255, 0.15),
                0 0 16px 3px rgba(43, 127, 255, 0.6);
    animation: aria-listen 1s ease-in-out infinite;
  }
  #aria-cursor[data-state="listening"] .aria-label { background: rgba(43, 127, 255, 0.9); }

  #aria-cursor[data-state="thinking"] {
    background: #9b6bff;
    box-shadow: 0 0 0 4px rgba(155, 107, 255, 0.30), 0 0 16px 3px rgba(155, 107, 255, 0.6);
    animation: none;
  }
  #aria-cursor[data-state="thinking"] .aria-arc { opacity: 1; animation: aria-spin 0.8s linear infinite; }
  #aria-cursor[data-state="thinking"] .aria-label { background: rgba(155, 107, 255, 0.9); }

  #aria-cursor[data-state="acting"] {
    background: #ffffff;
    box-shadow: 0 0 0 6px rgba(255, 255, 255, 0.5), 0 0 22px 6px rgba(255, 255, 255, 0.8);
    animation: aria-flash 0.35s ease-out;
  }
  #aria-cursor[data-state="acting"] .aria-label { background: rgba(40, 40, 40, 0.9); }

  #aria-cursor[data-state="error"] {
    background: #ff8c00;
    box-shadow: 0 0 0 4px rgba(255, 140, 0, 0.30), 0 0 16px 3px rgba(255, 140, 0, 0.6);
    animation: aria-shake 0.35s ease-in-out 2;
  }
  #aria-cursor[data-state="error"] .aria-label { background: rgba(255, 140, 0, 0.92); }

  /* Per-mode tint of the label text (voice=red default handled above). */
  #aria-cursor[data-mode="eye"]  { filter: hue-rotate(120deg); }
  #aria-cursor[data-mode="hand"] { filter: hue-rotate(250deg); }

  /* ----------------------------- keyframes -------------------------------- */
  @keyframes aria-pulse {
    0%, 100% { box-shadow: 0 0 0 4px rgba(255,43,43,0.30), 0 0 0 8px rgba(255,43,43,0.15), 0 0 14px 2px rgba(255,43,43,0.55); }
    50%      { box-shadow: 0 0 0 8px rgba(255,43,43,0.20), 0 0 0 16px rgba(255,43,43,0.08), 0 0 20px 4px rgba(255,43,43,0.5); }
  }
  @keyframes aria-listen {
    0%, 100% { box-shadow: 0 0 0 4px rgba(43,127,255,0.30), 0 0 0 10px rgba(43,127,255,0.15), 0 0 16px 3px rgba(43,127,255,0.6); }
    50%      { box-shadow: 0 0 0 9px rgba(43,127,255,0.22), 0 0 0 18px rgba(43,127,255,0.08), 0 0 22px 5px rgba(43,127,255,0.55); }
  }
  @keyframes aria-spin { to { transform: rotate(360deg); } }
  @keyframes aria-flash {
    0%   { filter: brightness(2.2); }
    100% { filter: brightness(1); }
  }
  @keyframes aria-shake {
    0%, 100% { margin-left: -10px; }
    25%      { margin-left: -16px; }
    75%      { margin-left: -4px; }
  }

  /* ------------------------------- HUD ------------------------------------ */
  #aria-hud {
    position: fixed;
    /* Default position: bottom-center. When --hud-x/y are set, they override. */
    bottom: calc(var(--hud-y, 20px) * -1 + 20px);
    left: calc(var(--hud-x, 50%) - 0px);
    min-width: 260px;
    max-width: 420px;
    padding: 12px 16px;
    background: rgba(18, 18, 22, 0.92);
    color: #f3f3f7;
    color-scheme: dark;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 13px;
    line-height: 1.4;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(8px);
    pointer-events: auto;
    opacity: 0;
    transition: opacity 0.2s ease, transform 0.2s ease;
    user-select: none;
  }
  /* When drag position is set, use absolute top/left via translate. */
  #aria-hud[style*="--hud-x"] {
    bottom: unset;
    left: var(--hud-x, 50%);
    top: var(--hud-y, auto);
    transform: none;
  }
  #aria-hud[data-visible="true"] { opacity: 1; }
  #aria-hud:not([style*="--hud-x"])[data-visible="true"] { transform: translateX(-50%) translateY(0); }
  #aria-hud:not([style*="--hud-x"]) { left: 50%; transform: translateX(-50%) translateY(8px); }
  #aria-hud .aria-hud-status {
    display: flex; align-items: center; gap: 8px;
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;
    color: #9aa0aa; margin-bottom: 4px;
  }
  #aria-hud .aria-hud-dot {
    width: 8px; height: 8px; border-radius: 50%; background: var(--aria-accent, #ff2b2b);
    box-shadow: 0 0 8px color-mix(in srgb, var(--aria-accent, #ff2b2b) 80%, transparent);
  }
  #aria-hud .aria-hud-transcript { color: #f3f3f7; font-weight: 500; }
  #aria-hud .aria-hud-command { color: #9aa0aa; font-size: 12px; margin-top: 2px; }

  /* ------------------------------- dwell ring ----------------------------- */
  .aria-dwell-ring {
    position: fixed;
    top: 0; left: 0;
    width: var(--size, 88px);
    height: var(--size, 88px);
    margin-left: calc(var(--size, 88px) / -2);
    margin-top: calc(var(--size, 88px) / -2);
    border-radius: 50%;
    border: 3px solid rgba(20,210,255,0.25);
    pointer-events: none;
    transform: translate(var(--x, 0), var(--y, 0));
    overflow: hidden;
  }
  .aria-dwell-ring::after {
    content: '';
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    border: 3px solid transparent;
    border-top-color: #14d2ff;
    transform: rotate(calc(360deg * var(--progress, 0)));
    transition: transform 0.05s linear;
  }

  /* ------------------------------- cursor trail --------------------------- */
  .aria-trail {
    position: fixed;
    top: 0;
    left: 0;
    width: 8px;
    height: 8px;
    margin-left: -4px;
    margin-top: -4px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--aria-accent, #ff2b2b) 55%, transparent);
    pointer-events: none;
    transform: translate(var(--x, 0), var(--y, 0));
    animation: aria-trail-fade 0.55s ease-out forwards;
  }
  @keyframes aria-trail-fade {
    0%   { opacity: 0.7; transform: translate(var(--x), var(--y)) scale(1); }
    100% { opacity: 0;   transform: translate(var(--x), var(--y)) scale(0.2); }
  }
  .aria-trail[data-source="eye"]   { background: rgba(0,200,255,0.55); }
  .aria-trail[data-source="hand"]  { background: rgba(255,140,0,0.55); }
  .aria-trail[data-source="mouse"] { background: rgba(255,255,255,0.35); }

  /* ------------------------------- confidence prompt ---------------------- */
  .aria-hud-confidence {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    padding: 8px 10px;
    background: rgba(255, 140, 0, 0.12);
    border: 1px solid rgba(255, 140, 0, 0.3);
    border-radius: 8px;
    font-size: 12px;
    color: #ffd580;
  }
  .aria-hud-conf-icon { font-size: 14px; }
  .aria-hud-conf-text { flex: 1; min-width: 0; }
  .aria-hud-conf-text em { font-style: normal; font-weight: 600; color: #fff; }
  .aria-hud-conf-timer {
    font-variant-numeric: tabular-nums;
    background: rgba(255,140,0,0.25);
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 11px;
    font-weight: 700;
  }
  .aria-hud-conf-btns { display: flex; gap: 6px; width: 100%; }
  .aria-hud-conf-btn {
    flex: 1;
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.07);
    color: #f3f3f7;
    cursor: pointer;
    font-size: 12px;
    pointer-events: all;
  }
  .aria-hud-conf-btn.ok {
    background: rgba(255,140,0,0.3);
    border-color: rgba(255,140,0,0.5);
    color: #ffd580;
  }
  .aria-hud-conf-btn:hover { filter: brightness(1.2); }

  /* ------------------------------- mode chips ----------------------------- */
  .aria-hud-modes {
    display: flex;
    gap: 6px;
    margin-top: 6px;
    flex-wrap: wrap;
  }
  .aria-hud-mode-chip {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    background: rgba(255,255,255,0.1);
    color: #9aa0aa;
  }

  /* ------------------------------- focus mode ----------------------------- */
  :host([data-focus-mode]) #aria-hud,
  :host([data-focus-mode]) #aria-history-panel,
  :host([data-focus-mode]) .aria-hud-modes,
  :host([data-focus-mode]) .aria-hud-confidence {
    display: none !important;
  }
  :host([data-focus-mode]) #aria-cursor {
    opacity: 0.4;
    box-shadow: none;
  }

  /* ------------------------------- reading ruler -------------------------- */
  .aria-reading-ruler {
    position: fixed;
    left: 0;
    top: var(--y, 50vh);
    width: 100vw;
    height: 2px;
    background: linear-gradient(90deg, transparent 0%, rgba(20,210,255,0.2) 15%, rgba(20,210,255,0.35) 50%, rgba(20,210,255,0.2) 85%, transparent 100%);
    pointer-events: none;
    transition: top 0.08s ease-out;
  }

  /* ─────────────────── Feature Explosion CSS ─────────────────────────── */

  /* Mini Mode - collapses UI to a glowing pill */
  :host([data-mini="true"]) #aria-hud,
  :host([data-mini="true"]) #aria-history-panel,
  :host([data-mini="true"]) .aria-hud-modes,
  :host([data-mini="true"]) .aria-hud-confidence {
    display: none !important;
  }
  :host([data-mini="true"]) #aria-cursor {
    width: 12px;
    height: 12px;
    margin-left: -6px;
    margin-top: -6px;
  }
  :host([data-mini="true"]) #aria-cursor .aria-label { display: none; }
  :host([data-mini="true"]) #aria-cursor .aria-arc   { display: none; }

  /* Noise Meter */
  .aria-noise-meter {
    height: 3px;
    background: rgba(255,255,255,0.1);
    border-radius: 2px;
    margin-top: 6px;
    overflow: hidden;
    position: relative;
  }
  .aria-noise-meter::after {
    content: '';
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: var(--noise-pct, 0%);
    background: #2b7fff;
    border-radius: 2px;
    transition: width 0.1s ease;
  }
  .aria-noise-meter.aria-noise-high::after { background: #ff8c00; }
  .aria-noise-warn {
    font-size: 11px;
    color: #ff8c00;
    margin-top: 4px;
  }

  /* Action Replay Trail (additional dots via JS - same .aria-trail class) */

  /* Notification toasts use page-level DOM (outside shadow root) */

  /* ------------------------------- light mode ----------------------------- */
  @media (prefers-color-scheme: light) {
    #aria-hud {
      background: rgba(255, 255, 255, 0.94);
      color: #1a1a26;
      border-color: rgba(0, 0, 0, 0.1);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    }
    #aria-hud .aria-hud-status { color: #6a737d; }
    #aria-hud .aria-hud-transcript { color: #1a1a26; }
    #aria-hud .aria-hud-command { color: #6a737d; }
    #aria-history-panel {
      background: rgba(248, 248, 252, 0.97);
      color: #1a1a26;
      border-color: rgba(0, 0, 0, 0.08);
    }
    .aria-hp-title, .aria-hp-meta { color: #6a737d; }
    .aria-hp-cmd { color: #1a1a26; }
  }
`;
