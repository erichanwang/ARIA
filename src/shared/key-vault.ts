/**
 * Encrypts the Anthropic API key at rest using AES-GCM and a
 * per-device CryptoKey that lives only in chrome.storage.local.
 *
 * Threat model: prevents the key from being extracted by reading
 * Chrome's LevelDB storage files off-disk. An attacker who already
 * has extension-context code execution can bypass this.
 *
 * Storage layout:
 *   aria.dk  - exported AES-GCM device key (JWK, JSON string)
 *   aria.ek  - encrypted API key ({ iv: string, ct: string }, JSON)
 */

const DK_KEY = 'aria.dk';
const EK_KEY = 'aria.ek';

interface EncryptedPayload {
  iv: string;  // base64
  ct: string;  // base64
}

async function getDeviceKey(): Promise<CryptoKey> {
  const raw = await chrome.storage.local.get(DK_KEY);
  if (raw[DK_KEY]) {
    return crypto.subtle.importKey(
      'jwk',
      JSON.parse(raw[DK_KEY] as string) as JsonWebKey,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt'],
    );
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const exported = await crypto.subtle.exportKey('jwk', key);
  await chrome.storage.local.set({ [DK_KEY]: JSON.stringify(exported) });
  return key;
}

export async function saveApiKey(plaintext: string): Promise<void> {
  if (!plaintext) {
    await chrome.storage.local.remove(EK_KEY);
    return;
  }
  const key = await getDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const payload: EncryptedPayload = {
    iv: btoa(String.fromCharCode(...iv)),
    ct: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
  };
  await chrome.storage.local.set({ [EK_KEY]: JSON.stringify(payload) });
}

export async function loadApiKey(): Promise<string> {
  const raw = await chrome.storage.local.get(EK_KEY);
  if (!raw[EK_KEY]) return '';
  try {
    const payload = JSON.parse(raw[EK_KEY] as string) as EncryptedPayload;
    const iv = Uint8Array.from(atob(payload.iv), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(payload.ct), (c) => c.charCodeAt(0));
    const key = await getDeviceKey();
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(decrypted);
  } catch {
    return '';
  }
}
