/**
 * Session context: tracks the last N commands + outcomes so they can be
 * injected into every Claude call ("ARIA remembers what it just did").
 * Also stores the extended history (last 10) for the history panel.
 */
import type { HistoryEntry } from '@shared/types';

let idCounter = 0;

const FREQ_KEY = 'aria.cmdfreq';

/** Persist command frequency map so command palette ranks by all-time usage. */
export async function recordCommandFrequency(command: string): Promise<void> {
  const raw = await chrome.storage.local.get(FREQ_KEY);
  const freq: Record<string, number> = (raw[FREQ_KEY] as Record<string, number>) ?? {};
  const key = command.toLowerCase().trim();
  freq[key] = (freq[key] ?? 0) + 1;
  await chrome.storage.local.set({ [FREQ_KEY]: freq });
}

export class SessionContext {
  private entries: HistoryEntry[] = [];
  private readonly maxContext = 5;
  private readonly maxHistory = 10;

  add(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): HistoryEntry {
    const full: HistoryEntry = {
      id: ++idCounter,
      timestamp: Date.now(),
      ...entry,
    };
    this.entries.push(full);
    if (this.entries.length > this.maxHistory) {
      this.entries.shift();
    }
    return full;
  }

  /** Returns the last N entries as a formatted string for Claude's context. */
  getContextString(): string {
    const recent = this.entries.slice(-this.maxContext);
    if (recent.length === 0) return '';
    const lines = recent.map(
      (e) => `- "${e.command}" → ${e.action} (${e.success ? 'ok' : 'failed'})`,
    );
    return `\nRecent actions:\n${lines.join('\n')}`;
  }

  /** Full history for the history panel (newest first). */
  getHistory(): HistoryEntry[] {
    return [...this.entries].reverse();
  }

  /** Look up an entry by id (for redo). */
  getById(id: number): HistoryEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }
}
