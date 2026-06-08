/**
 * KI-09 regression test: auto-scroll must find the actual scrollable
 * container (walking up from the focused element) instead of always
 * assuming `window` scrolls, which is a no-op on pages using a custom
 * `overflow:hidden` body + inner scroll container.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { isScrollable, resolveScrollTarget } from '../src/content/auto-scroll';

function makeScrollable(el: HTMLElement, overflowY: string, scrollHeight: number, clientHeight: number): void {
  el.style.overflowY = overflowY;
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
}

afterEach(() => {
  document.body.innerHTML = '';
  (document.activeElement as HTMLElement | null)?.blur?.();
});

describe('isScrollable (KI-09)', () => {
  it('is false for a non-scrolling element', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    makeScrollable(div, 'visible', 100, 100);
    expect(isScrollable(div)).toBe(false);
  });

  it('is true for overflow:auto with more content than height', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    makeScrollable(div, 'auto', 2000, 400);
    expect(isScrollable(div)).toBe(true);
  });
});

describe('resolveScrollTarget (KI-09)', () => {
  it('returns window when no scrollable ancestor exists', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    div.tabIndex = 0;
    div.focus();
    expect(resolveScrollTarget()).toBe(window);
  });

  it('returns the nearest scrollable ancestor of the focused element', () => {
    const container = document.createElement('div');
    const inner = document.createElement('button');
    container.appendChild(inner);
    document.body.appendChild(container);
    makeScrollable(container, 'scroll', 3000, 500);
    inner.focus();
    expect(resolveScrollTarget()).toBe(container);
  });
});
