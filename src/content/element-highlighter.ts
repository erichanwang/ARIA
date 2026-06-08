/**
 * Element Highlighter Mode
 * Draws numbered overlays on every interactive element on the page.
 * "show me all clickable things" → numbers appear.
 * "click 4" → clicks the 4th element.
 */
import { getOverlayRoot } from './overlay';

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[tabindex]:not([tabindex="-1"])',
  '[onclick]',
].join(',');

const DANGER_WORDS = /delete|remove|cancel|unsubscribe|logout|log out|sign out|deactivate|disable|reset|clear|purge|drop/i;

interface HighlightedElement {
  el: Element;
  badge: HTMLElement;
  isDangerous: boolean;
}

let activeHighlights: HighlightedElement[] = [];
let overlayContainer: HTMLElement | null = null;
const numberedMap = new Map<number, Element>();

export function showInteractiveElements(): number {
  hideInteractiveElements();

  const root = getOverlayRoot();
  overlayContainer = document.createElement('div');
  overlayContainer.id = 'aria-element-highlighter';
  root.appendChild(overlayContainer);

  const elements = Array.from(document.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR))
    .filter((el) => isInViewport(el) && isVisible(el))
    .slice(0, 50);

  elements.forEach((el, idx) => {
    const num = idx + 1;
    const rect = el.getBoundingClientRect();
    const dangerous = DANGER_WORDS.test(el.textContent ?? '') || DANGER_WORDS.test(el.getAttribute('aria-label') ?? '');

    const badge = document.createElement('div');
    badge.className = 'aria-eh-badge' + (dangerous ? ' aria-eh-danger' : '');
    badge.textContent = String(num);
    badge.style.cssText = [
      'position:fixed',
      `top:${rect.top}px`,
      `left:${rect.left}px`,
      'pointer-events:none',
      'z-index:2147483646',
    ].join(';');

    const outline = document.createElement('div');
    outline.className = 'aria-eh-outline' + (dangerous ? ' aria-eh-danger-outline' : '');
    outline.style.cssText = [
      'position:fixed',
      `top:${rect.top - 2}px`,
      `left:${rect.left - 2}px`,
      `width:${rect.width + 4}px`,
      `height:${rect.height + 4}px`,
      'pointer-events:none',
    ].join(';');

    overlayContainer!.appendChild(outline);
    overlayContainer!.appendChild(badge);
    numberedMap.set(num, el);
    activeHighlights.push({ el, badge, isDangerous: dangerous });
  });

  injectHighlighterStyles();
  return elements.length;
}

export function hideInteractiveElements(): void {
  overlayContainer?.remove();
  overlayContainer = null;
  activeHighlights = [];
  numberedMap.clear();
}

export function clickNumberedElement(num: number): Element | null {
  const el = numberedMap.get(num);
  if (!el) return null;
  hideInteractiveElements();
  return el;
}

export function isHighlighterActive(): boolean {
  return numberedMap.size > 0;
}

function isInViewport(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}

function isVisible(el: HTMLElement): boolean {
  if (!el.offsetParent && el.tagName !== 'BODY') return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function injectHighlighterStyles(): void {
  const root = getOverlayRoot();
  if (root.getElementById('aria-eh-styles')) return;
  const style = document.createElement('style');
  style.id = 'aria-eh-styles';
  style.textContent = `
    .aria-eh-badge {
      background: rgba(43,127,255,0.92);
      color: #fff;
      font-family: ui-monospace, monospace;
      font-size: 11px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 4px;
      min-width: 20px;
      text-align: center;
      transform: translate(-50%, -50%);
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }
    .aria-eh-badge.aria-eh-danger { background: rgba(255,140,0,0.95); }
    .aria-eh-outline {
      border: 2px solid rgba(43,127,255,0.7);
      border-radius: 4px;
      background: rgba(43,127,255,0.06);
    }
    .aria-eh-danger-outline {
      border-color: rgba(255,140,0,0.8);
      background: rgba(255,140,0,0.06);
    }`;
  root.appendChild(style);
}
