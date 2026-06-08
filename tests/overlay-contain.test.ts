/**
 * KI-07 regression test: when an ancestor (html/body) establishes a
 * containing block for fixed-position descendants via CSS `contain`, the
 * overlay host must fall back to `position: absolute` + scroll-tracked
 * offsets instead of `position: fixed`, so it isn't clipped/misplaced.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getOverlayRoot, removeOverlay, pageContainsFixedPositioning } from '../src/content/overlay';

afterEach(() => {
  removeOverlay();
  document.documentElement.style.contain = '';
  document.body.style.contain = '';
});

describe('pageContainsFixedPositioning (KI-07)', () => {
  it('is false with no contain set', () => {
    expect(pageContainsFixedPositioning()).toBe(false);
  });

  it('detects contain: layout on <html>', () => {
    document.documentElement.style.contain = 'layout';
    expect(pageContainsFixedPositioning()).toBe(true);
  });

  it('detects contain: strict on <body>', () => {
    document.body.style.contain = 'strict';
    expect(pageContainsFixedPositioning()).toBe(true);
  });
});

describe('overlay host positioning strategy', () => {
  it('uses position:fixed when nothing establishes a containing block', () => {
    getOverlayRoot();
    const host = document.getElementById('aria-overlay-host')!;
    expect(host.style.position).toBe('fixed');
  });

  it('falls back to position:absolute + scroll tracking when contain is present', () => {
    document.documentElement.style.contain = 'layout';
    getOverlayRoot();
    const host = document.getElementById('aria-overlay-host')!;
    expect(host.style.position).toBe('absolute');

    Object.defineProperty(window, 'scrollY', { value: 250, configurable: true });
    Object.defineProperty(window, 'scrollX', { value: 10, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    expect(host.style.top).toBe('250px');
    expect(host.style.left).toBe('10px');
  });
});
