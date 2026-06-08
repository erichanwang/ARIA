/**
 * KI-04 regression test: gaze calibration must persist via chrome.storage.local
 * (survives Chrome restart / content-script teardown), not localStorage
 * (per-page-origin, wiped on teardown).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadTransform, applyTransform, type GazeTransform } from '../src/content/calibration';

function mockChromeStorage(): void {
  const store: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (key: string) => Promise.resolve(key in store ? { [key]: store[key] } : {}),
        set: (items: Record<string, unknown>) => {
          Object.assign(store, items);
          return Promise.resolve();
        },
      },
    },
  };
}

describe('gaze calibration persistence (KI-04)', () => {
  beforeEach(() => {
    mockChromeStorage();
  });

  it('returns null when nothing is stored', async () => {
    expect(await loadTransform()).toBeNull();
  });

  it('round-trips a saved transform through chrome.storage.local', async () => {
    const transform: GazeTransform = { ax: 1, bx: 0, cx: 10, ay: 0, by: 1, cy: 20 };
    await chrome.storage.local.set({ 'aria.gazeCalibration': JSON.stringify(transform) });
    const loaded = await loadTransform();
    expect(loaded).toEqual(transform);
  });

  it('returns null for corrupt stored JSON instead of throwing', async () => {
    await chrome.storage.local.set({ 'aria.gazeCalibration': '{not json' });
    expect(await loadTransform()).toBeNull();
  });

  it('applyTransform maps a gaze feature to screen pixels', () => {
    const transform: GazeTransform = { ax: 100, bx: 0, cx: 5, ay: 0, by: 200, cy: 8 };
    expect(applyTransform(transform, { x: 0.5, y: 0.25 })).toEqual({ x: 55, y: 58 });
  });
});
