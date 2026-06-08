/**
 * Single gateway to persisted settings. ALL settings live in
 * chrome.storage.local - the API key is stored encrypted via key-vault,
 * never as plaintext in the settings blob.
 */
import { AriaSettings, DEFAULT_SETTINGS } from './types';
import { loadApiKey, saveApiKey } from './key-vault';

const KEY = 'aria.settings';

export async function loadSettings(): Promise<AriaSettings> {
  const [raw, vaultApiKey] = await Promise.all([
    chrome.storage.local.get(KEY),
    loadApiKey(),
  ]);
  const stored = (raw[KEY] as Partial<AriaSettings> | undefined) ?? {};

  // KI-03: users who saved their key before the AES-GCM vault existed have it
  // stranded as plaintext in the settings blob. If the vault is empty but the
  // blob still has a plaintext key, migrate it into the vault once and strip
  // it from the blob so it isn't left sitting there in plaintext.
  let apiKey = vaultApiKey;
  if (!apiKey && stored.apiKey) {
    apiKey = stored.apiKey;
    await saveApiKey(apiKey);
    const { apiKey: _legacy, ...rest } = stored;
    await chrome.storage.local.set({ [KEY]: rest });
  }

  // apiKey from vault overrides anything stored in the settings blob.
  return { ...DEFAULT_SETTINGS, ...stored, apiKey };
}

export async function saveSettings(settings: AriaSettings): Promise<void> {
  await saveApiKey(settings.apiKey ?? '');
  // Store everything except apiKey in the plain settings blob.
  const { apiKey: _apiKey, ...rest } = settings;
  await chrome.storage.local.set({ [KEY]: rest });
}

export async function patchSettings(patch: Partial<AriaSettings>): Promise<AriaSettings> {
  const next = { ...(await loadSettings()), ...patch };
  await saveSettings(next);
  return next;
}

/** Subscribe to settings changes (fires in any context). Returns an unsubscribe. */
export function onSettingsChanged(cb: (settings: AriaSettings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area === 'local' && changes[KEY]) {
      cb({ ...DEFAULT_SETTINGS, ...(changes[KEY].newValue as Partial<AriaSettings>) });
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/** Picovoice access key is stored separately (it's a vendor key, not a setting). */
const PV_KEY = 'aria.picovoiceAccessKey';

export async function loadPicovoiceKey(): Promise<string> {
  const raw = await chrome.storage.local.get(PV_KEY);
  return (raw[PV_KEY] as string | undefined) ?? '';
}

export async function savePicovoiceKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [PV_KEY]: key });
}
