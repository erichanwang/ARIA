/**
 * Cursor Skins
 * Five additional cursor themes beyond the default red.
 * Each skin overrides CSS custom properties and the HUD color scheme.
 *
 * Cursor Size Adaptive
 * Detects high-DPI (4K) screens and adjusts cursor scale automatically.
 */
import { getOverlayRoot } from './overlay';

export type CursorSkin = 'default' | 'ghost' | 'hacker' | 'pastel' | 'blueprint' | 'minimal';

const SKIN_VARS: Record<CursorSkin, { accent: string; glow: string; label: string }> = {
  default:   { accent: '#ff2b2b', glow: 'rgba(255,43,43,0.55)',   label: '#ff2b2b' },
  ghost:     { accent: 'rgba(255,255,255,0.85)', glow: 'rgba(200,220,255,0.45)', label: 'rgba(255,255,255,0.9)' },
  hacker:    { accent: '#00ff41', glow: 'rgba(0,255,65,0.55)',    label: '#00ff41' },
  pastel:    { accent: '#ff85c2', glow: 'rgba(255,133,194,0.5)',  label: '#ff85c2' },
  blueprint: { accent: '#2b7fff', glow: 'rgba(43,127,255,0.55)',  label: '#2b7fff' },
  minimal:   { accent: '#ffffff', glow: 'rgba(255,255,255,0.15)', label: 'rgba(255,255,255,0.7)' },
};

let skinStyleEl: HTMLStyleElement | null = null;

export function applyCursorSkin(skin: CursorSkin): void {
  const vars = SKIN_VARS[skin] ?? SKIN_VARS.default;
  const root = getOverlayRoot();

  if (!skinStyleEl) {
    skinStyleEl = document.createElement('style');
    skinStyleEl.id = 'aria-cursor-skin';
    root.appendChild(skinStyleEl);
  }

  const isMinimal = skin === 'minimal';
  skinStyleEl.textContent = `
    :host {
      --aria-accent: ${vars.accent};
    }
    #aria-cursor {
      background: ${vars.accent};
      box-shadow: 0 0 0 4px rgba(0,0,0,0.1),
                  0 0 0 8px rgba(0,0,0,0.05),
                  0 0 14px 2px ${vars.glow};
      ${isMinimal ? 'animation:none;box-shadow:0 0 0 2px rgba(255,255,255,0.3);' : ''}
    }
    #aria-cursor .aria-label {
      background: ${vars.label};
      color: ${skin === 'hacker' ? '#000' : skin === 'ghost' || skin === 'minimal' ? 'rgba(0,0,0,0.8)' : '#fff'};
    }`;

  // Auto-scale for high-DPI displays.
  applyAdaptiveScale(root);
}

function applyAdaptiveScale(root: ShadowRoot): void {
  const dpr = window.devicePixelRatio ?? 1;
  const screenArea = screen.width * screen.height;

  let scale = 1.0;
  if (dpr >= 2 && screenArea >= 3840 * 2160) scale = 1.5;       // 4K+
  else if (dpr >= 2 && screenArea >= 2560 * 1440) scale = 1.25; // QHD
  else if (screenArea <= 1280 * 720) scale = 0.8;                // small screen

  const cursor = root.getElementById('aria-cursor') as HTMLElement | null;
  if (cursor) {
    const currentScale = parseFloat(cursor.style.getPropertyValue('--scale') || '1');
    // Only override if user hasn't manually set scale.
    if (!cursor.dataset.manualScale) {
      cursor.style.setProperty('--scale', String(scale * currentScale));
      cursor.dataset.autoScale = String(scale);
    }
  }
}
