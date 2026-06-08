/**
 * Voice Clipboard Manager
 * Named snippets stored in chrome.storage.local.
 * "remember this as my address" → stores; "paste my address" → types.
 */

const STORAGE_KEY = 'aria.voiceClips';
const MAX_CLIPS = 20;

export interface VoiceClip {
  name: string;
  content: string;
  timestamp: number;
}

export async function loadClips(): Promise<VoiceClip[]> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  return (raw[STORAGE_KEY] as VoiceClip[] | undefined) ?? [];
}

async function saveClips(clips: VoiceClip[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: clips });
}

export async function rememberClip(name: string, content: string): Promise<string> {
  const clips = await loadClips();
  const existing = clips.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
  const entry: VoiceClip = { name, content, timestamp: Date.now() };
  if (existing >= 0) {
    clips[existing] = entry;
  } else {
    if (clips.length >= MAX_CLIPS) clips.shift(); // drop oldest
    clips.push(entry);
  }
  await saveClips(clips);
  return `Remembered "${name}".`;
}

export async function recallClip(name: string): Promise<string | null> {
  const clips = await loadClips();
  const clip = clips.find((c) => c.name.toLowerCase() === name.toLowerCase());
  return clip?.content ?? null;
}

export async function listClips(): Promise<string> {
  const clips = await loadClips();
  if (clips.length === 0) return "You don't have any saved clips yet.";
  return `You have ${clips.length} saved clip${clips.length === 1 ? '' : 's'}: ${clips.map((c) => c.name).join(', ')}.`;
}

export async function deleteClip(name: string): Promise<string> {
  const clips = await loadClips();
  const idx = clips.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
  if (idx < 0) return `I don't have a clip called "${name}".`;
  clips.splice(idx, 1);
  await saveClips(clips);
  return `Deleted "${name}".`;
}

/** Parse command like "remember this as my address" or "paste my address". */
export function parseRememberCommand(cmd: string): { name: string } | null {
  const m = /(?:remember|save)\s+(?:this|it)?\s*(?:as\s+)?(.+)/i.exec(cmd);
  if (!m) return null;
  return { name: m[1].trim() };
}

export function parsePasteCommand(cmd: string): { name: string } | null {
  const m = /(?:paste|type|insert|use)\s+(?:my\s+)?(.+)/i.exec(cmd);
  if (!m) return null;
  return { name: m[1].trim() };
}

export function parseForgetCommand(cmd: string): { name: string } | null {
  const m = /(?:forget|delete|remove)\s+(?:my\s+)?(?:clip\s+)?(.+)/i.exec(cmd);
  if (!m) return null;
  return { name: m[1].trim() };
}
