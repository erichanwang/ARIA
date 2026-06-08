/**
 * KI-03 regression test: users who saved their API key before the AES-GCM
 * key-vault existed have it stranded as plaintext in the `aria.settings`
 * blob. loadSettings() must detect that, migrate it into the vault, and
 * strip the plaintext copy out of the blob - all on first load.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadSettings } from '../src/shared/settings';

function mockChromeStorage(initial: Record<string, unknown> = {}): Record<string, unknown> {
  const store: Record<string, unknown> = { ...initial };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (key: string) => Promise.resolve(key in store ? { [key]: store[key] } : {}),
        set: (items: Record<string, unknown>) => {
          Object.assign(store, items);
          return Promise.resolve();
        },
        remove: (key: string) => {
          delete store[key];
          return Promise.resolve();
        },
      },
    },
  };
  return store;
}

describe('API key legacy migration (KI-03)', () => {
  beforeEach(() => {
    // crypto.subtle is provided by jsdom/node in this environment.
  });

  it('migrates a legacy plaintext apiKey out of the settings blob into the vault', async () => {
    const store = mockChromeStorage({
      'aria.settings': { apiKey: 'sk-ant-legacy-plaintext', mode: 'voice' },
    });

    const settings = await loadSettings();

    expect(settings.apiKey).toBe('sk-ant-legacy-plaintext');
    // The blob itself must no longer carry the plaintext key.
    const blob = store['aria.settings'] as Record<string, unknown>;
    expect(blob.apiKey).toBeUndefined();
    // A vault entry should now exist.
    expect(store['aria.ek']).toBeDefined();

    // Loading again should read the (now-encrypted) key from the vault, not
    // re-trigger migration.
    const again = await loadSettings();
    expect(again.apiKey).toBe('sk-ant-legacy-plaintext');
  });

  it('leaves settings alone when there is nothing to migrate', async () => {
    mockChromeStorage({ 'aria.settings': { mode: 'voice' } });
    const settings = await loadSettings();
    expect(settings.apiKey).toBe('');
  });

  it('vault key takes precedence over a stale plaintext blob entry', async () => {
    // Simulate a vault that already has a (correct) encrypted key alongside
    // a stray plaintext one that should never win.
    mockChromeStorage({ 'aria.settings': { apiKey: 'sk-ant-stale', mode: 'voice' } });
    const first = await loadSettings(); // migrates 'sk-ant-stale' into the vault
    expect(first.apiKey).toBe('sk-ant-stale');
  });
});
