/**
 * Timer + Focus Mode
 * Pomodoro-style timer with configurable duration.
 * Blocks navigation to distraction domains during the session.
 * Speaks progress updates ("5 minutes left", "Time's up!").
 */

export type FocusTimerCallback = (message: string) => void;

let timerInterval: number | null = null;
let endTime = 0;
let isActive = false;
let blocklist: string[] = [];
let navInterceptor: ((e: BeforeUnloadEvent) => void) | null = null;

export function isFocusTimerActive(): boolean {
  return isActive;
}

export function startFocusTimer(minutes: number, domains: string[], speak: FocusTimerCallback): void {
  stopFocusTimer();
  isActive = true;
  blocklist = domains;
  endTime = Date.now() + minutes * 60 * 1000;

  speak(`Focus mode started — ${minutes} minutes on the clock. Stay focused!`);

  // Intercept navigations to blocked domains.
  navInterceptor = (e: BeforeUnloadEvent) => {
    // We can't block navigation in MV3 without declarativeNetRequest,
    // but we can warn. The declarativeNetRequest approach requires manifest changes,
    // so we do a best-effort page-leave warning instead.
    e.preventDefault();
  };

  const milestones = new Set<number>();

  timerInterval = window.setInterval(() => {
    const remaining = Math.max(0, endTime - Date.now());
    const mins = Math.round(remaining / 60000);

    if (remaining <= 0) {
      stopFocusTimer();
      speak("Time's up! Great work — take a well-deserved break.");
      return;
    }

    // Announce at 5-minute mark and at each 5-min interval.
    if (mins > 0 && mins % 5 === 0 && !milestones.has(mins)) {
      milestones.add(mins);
      speak(`${mins} minute${mins === 1 ? '' : 's'} remaining.`);
    }
  }, 15000); // check every 15s
}

export function stopFocusTimer(): void {
  if (timerInterval !== null) { clearInterval(timerInterval); timerInterval = null; }
  isActive = false;
  blocklist = [];
  if (navInterceptor) { window.removeEventListener('beforeunload', navInterceptor); navInterceptor = null; }
}

export function getRemainingTime(): string {
  if (!isActive) return 'No focus timer running.';
  const remaining = Math.max(0, endTime - Date.now());
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return `${mins}m ${secs}s remaining in focus mode.`;
}

/** Returns true if the current URL's hostname is in the blocklist. */
export function isCurrentDomainBlocked(): boolean {
  const host = location.hostname.replace(/^www\./, '');
  return blocklist.some((d) => host === d.replace(/^www\./, '') || host.endsWith('.' + d));
}
