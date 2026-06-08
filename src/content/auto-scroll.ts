/**
 * Auto-scroll reading mode: smoothly scrolls the page at a comfortable
 * reading pace. Ctrl+Shift+R to toggle. Spacebar or a hand pinch pauses/resumes.
 * Arrow Up/Down and +/- adjust the speed.
 */

interface AutoScroller {
  stop(): void;
}

let active: AutoScroller | null = null;

/** Speed in pixels per second. Default ~80px/s (~average reading scroll pace). */
let speed = 80;

export function isAutoScrolling(): boolean {
  return active !== null;
}

export function adjustAutoScrollSpeed(delta: number): void {
  speed = Math.max(20, Math.min(500, speed + delta));
}

export function toggleAutoScroll(
  onSpeak?: (msg: string) => void,
): void {
  if (active) {
    active.stop();
    active = null;
    onSpeak?.('Auto-scroll stopped.');
    return;
  }

  active = startScroller(onSpeak);
  onSpeak?.('Auto-scroll started. Spacebar to pause, plus and minus to adjust speed.');
}

export function pauseAutoScroll(): void {
  if (!active) return;
  // Re-toggle: stop active, mark null so next call restarts.
  // For pause we expose separate start/stop instead.
  active.stop();
  active = null;
}

/**
 * KI-09: `window.scrollBy` is a no-op on pages that put `overflow: hidden`
 * on `<body>`/`<html>` and scroll a custom inner container instead. Walk up
 * from the focused element looking for the first actually-scrollable
 * ancestor; fall back to `window` (the common case) if none is found.
 */
export function isScrollable(el: Element): boolean {
  const style = getComputedStyle(el);
  return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
}

export function resolveScrollTarget(): Element | Window {
  let el: Element | null = document.activeElement;
  while (el && el !== document.documentElement) {
    if (isScrollable(el)) return el;
    el = el.parentElement;
  }
  return window;
}

function startScroller(onSpeak?: (msg: string) => void): AutoScroller {
  let running = true;
  let paused = false;
  let last: DOMHighResTimeStamp | null = null;
  let rafId: number;
  const target = resolveScrollTarget();

  const step = (now: DOMHighResTimeStamp) => {
    if (!running) return;
    if (!paused && last !== null) {
      const dt = (now - last) / 1000;
      target.scrollBy({ top: speed * dt, behavior: 'instant' as ScrollBehavior });

      // Stop automatically when at the bottom.
      const atBottom =
        target instanceof Element
          ? target.scrollTop + target.clientHeight >= target.scrollHeight - 4
          : window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
      if (atBottom) {
        running = false;
        active = null;
        onSpeak?.('Reached bottom of page.');
        return;
      }
    }
    last = now;
    rafId = requestAnimationFrame(step);
  };

  rafId = requestAnimationFrame(step);

  const onKey = (e: KeyboardEvent) => {
    if (!running) { cleanup(); return; }
    if (e.code === 'Space') {
      e.preventDefault();
      paused = !paused;
      last = null;
      onSpeak?.(paused ? 'Paused.' : 'Resumed.');
    } else if (e.key === '+' || e.key === '=') {
      speed = Math.min(500, speed + 20);
      onSpeak?.(`Speed ${speed}.`);
    } else if (e.key === '-') {
      speed = Math.max(20, speed - 20);
      onSpeak?.(`Speed ${speed}.`);
    } else if (e.key === 'Escape') {
      active?.stop();
      active = null;
      cleanup();
    }
  };

  document.addEventListener('keydown', onKey);

  function cleanup() {
    document.removeEventListener('keydown', onKey);
  }

  return {
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
      cleanup();
    },
  };
}
