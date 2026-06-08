/**
 * Manages the single offscreen document that owns the mic and camera.
 * MV3 allows exactly one offscreen document per extension, so creation must be
 * race-safe. A ref-count tracks active users; the document is closed when the
 * last user releases it so it doesn't persist when ARIA is idle.
 */
const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';

let creating: Promise<void> | null = null;
let refCount = 0;

export async function ensureOffscreen(): Promise<void> {
  refCount++;
  if (await hasOffscreen()) return;
  if (creating) {
    await creating;
    return;
  }
  creating = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'Microphone and camera access for voice commands and eye/hand tracking.',
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

/** Release one reference. Closes the document when the count reaches zero. */
export async function releaseOffscreen(): Promise<void> {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0) await closeOffscreen();
}

export async function closeOffscreen(): Promise<void> {
  refCount = 0;
  if (await hasOffscreen()) await chrome.offscreen.closeDocument().catch(() => {});
}

async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  return contexts.length > 0;
}
