/**
 * KI-05 regression test: waitForTabLoad should resolve as soon as
 * chrome.tabs.onUpdated reports 'complete' for the tab, and should still
 * resolve (not hang) if that never happens, via its timeout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForTabLoad } from '../src/shared/messages';

function mockChromeTabs(): { fire: (tabId: number, status: string) => void } {
  const listeners: Array<(tabId: number, changeInfo: { status?: string }) => void> = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    tabs: {
      onUpdated: {
        addListener: (l: (tabId: number, changeInfo: { status?: string }) => void) => listeners.push(l),
        removeListener: (l: (tabId: number, changeInfo: { status?: string }) => void) => {
          const i = listeners.indexOf(l);
          if (i >= 0) listeners.splice(i, 1);
        },
      },
    },
  };
  return {
    fire: (tabId: number, status: string) => listeners.forEach((l) => l(tabId, { status })),
  };
}

describe('waitForTabLoad (KI-05)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves as soon as the matching tab reports status complete', async () => {
    const { fire } = mockChromeTabs();
    let resolved = false;
    void waitForTabLoad(42, 8000).then(() => { resolved = true; });

    fire(99, 'complete'); // different tab — must not resolve
    await Promise.resolve();
    expect(resolved).toBe(false);

    fire(42, 'loading'); // same tab, wrong status — must not resolve
    await Promise.resolve();
    expect(resolved).toBe(false);

    fire(42, 'complete');
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it('falls back to the timeout if the tab never reports complete', async () => {
    mockChromeTabs();
    let resolved = false;
    void waitForTabLoad(7, 8000).then(() => { resolved = true; });

    await vi.advanceTimersByTimeAsync(7999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(resolved).toBe(true);
  });
});
