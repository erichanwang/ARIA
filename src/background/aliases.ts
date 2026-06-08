/**
 * Phonetic Command Aliases
 * Users can register shorthand phrases that map to canonical commands.
 * e.g. "alias next article as click the next post link"
 * Stored in chrome.storage.local under 'aria.aliases'.
 */

const STORAGE_KEY = 'aria.aliases';

/** Parse "alias <phonetic> as <canonical>" - returns both parts or null. */
export function parseAliasCommand(cmd: string): { phonetic: string; canonical: string } | null {
  const m = /^alias\s+(.+?)\s+as\s+(.+)$/i.exec(cmd.trim());
  if (!m) return null;
  return { phonetic: m[1].trim().toLowerCase(), canonical: m[2].trim() };
}

export async function saveAlias(phonetic: string, canonical: string): Promise<void> {
  const { [STORAGE_KEY]: existing = {} } = await chrome.storage.local.get(STORAGE_KEY) as Record<string, Record<string, string>>;
  existing[phonetic] = canonical;
  await chrome.storage.local.set({ [STORAGE_KEY]: existing });
}

export async function deleteAlias(phonetic: string): Promise<void> {
  const { [STORAGE_KEY]: existing = {} } = await chrome.storage.local.get(STORAGE_KEY) as Record<string, Record<string, string>>;
  delete existing[phonetic];
  await chrome.storage.local.set({ [STORAGE_KEY]: existing });
}

export async function loadAliases(): Promise<Record<string, string>> {
  const { [STORAGE_KEY]: data = {} } = await chrome.storage.local.get(STORAGE_KEY) as Record<string, Record<string, string>>;
  return data;
}

/**
 * Resolve a command through the alias table.
 * Returns the canonical command if a match is found, otherwise returns the original.
 */
export async function resolveAlias(cmd: string): Promise<string> {
  const aliases = await loadAliases();
  const normalized = cmd.trim().toLowerCase();
  for (const [phonetic, canonical] of Object.entries(aliases)) {
    if (normalized === phonetic) return canonical;
  }
  return cmd;
}
