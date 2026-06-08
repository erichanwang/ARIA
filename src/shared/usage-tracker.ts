/**
 * Local-only usage tracking. Counts commands per day, cumulative tokens,
 * and current streak. No data ever leaves the device.
 *
 * Free tier gate: when MAX_DAILY_COMMANDS > 0 and today's count exceeds it,
 * canRun() returns false and the orchestrator should speak a limit message.
 * Set MAX_DAILY_COMMANDS to 0 to disable the limit (default - all users free).
 */

const USAGE_KEY = 'aria.usage';

export interface UsageStats {
  date: string;          // YYYY-MM-DD
  commandsToday: number;
  commandsTotal: number;
  streakDays: number;
  lastActiveDate: string;
}

const DEFAULT_STATS: UsageStats = {
  date: '',
  commandsToday: 0,
  commandsTotal: 0,
  streakDays: 0,
  lastActiveDate: '',
};

export const MAX_DAILY_COMMANDS = 0; // 0 = unlimited (flip to a number to gate)

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function prevDay(date: string): string {
  const d = new Date(date);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function loadUsageStats(): Promise<UsageStats> {
  const raw = await chrome.storage.local.get(USAGE_KEY);
  return { ...DEFAULT_STATS, ...(raw[USAGE_KEY] as Partial<UsageStats> | undefined) };
}

/** Call once per command. Returns updated stats. */
export async function recordUsage(): Promise<UsageStats> {
  const stats = await loadUsageStats();
  const t = today();

  if (stats.date !== t) {
    // New day - reset daily count, update streak.
    const streak = stats.lastActiveDate === prevDay(t) ? stats.streakDays + 1 : 1;
    stats.date = t;
    stats.commandsToday = 0;
    stats.streakDays = streak;
  }

  stats.commandsToday++;
  stats.commandsTotal++;
  stats.lastActiveDate = t;

  await chrome.storage.local.set({ [USAGE_KEY]: stats });
  return stats;
}

/** Returns true if the user is within their daily limit (or there is no limit). */
export async function canRunCommand(): Promise<boolean> {
  if (MAX_DAILY_COMMANDS === 0) return true;
  const stats = await loadUsageStats();
  if (stats.date !== today()) return true; // new day, counter resets
  return stats.commandsToday < MAX_DAILY_COMMANDS;
}
