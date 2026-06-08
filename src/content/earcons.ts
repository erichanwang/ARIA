/**
 * Earcon system: subtle audio cues for agent lifecycle events.
 * Uses Web Audio API (no network requests, no files).
 *
 *   wake      → rising two-tone chime (agent woke up)
 *   complete  → soft click / tick (action done)
 *   error     → descending buzz (something failed)
 *   listening → short low tone (mic open)
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

type EarconType = 'wake' | 'complete' | 'error' | 'listening';

export function playEarcon(type: EarconType, enabled = true): void {
  if (!enabled) return;
  try {
    switch (type) {
      case 'wake':      playWake(); break;
      case 'complete':  playComplete(); break;
      case 'error':     playError(); break;
      case 'listening': playListening(); break;
    }
  } catch {
    // Audio context may be suspended on some pages; fail silently.
  }
}

/** Rising two-tone chime: C5 → E5 */
function playWake(): void {
  const ac = getCtx();
  tone(ac, 523.25, 0, 0.08, 'sine', 0.18);
  tone(ac, 659.25, 0.1, 0.08, 'sine', 0.18);
}

/** Soft click */
function playComplete(): void {
  const ac = getCtx();
  tone(ac, 880, 0, 0.04, 'sine', 0.12);
}

/** Descending buzz */
function playError(): void {
  const ac = getCtx();
  tone(ac, 220, 0, 0.06, 'sawtooth', 0.1);
  tone(ac, 180, 0.07, 0.09, 'sawtooth', 0.09);
}

/** Short low tone: mic opening */
function playListening(): void {
  const ac = getCtx();
  tone(ac, 392, 0, 0.05, 'sine', 0.1);
}

function tone(
  ac: AudioContext,
  freq: number,
  delayS: number,
  durationS: number,
  type: OscillatorType,
  gain: number,
): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.connect(g);
  g.connect(ac.destination);
  osc.type = type;
  osc.frequency.value = freq;
  const t = ac.currentTime + delayS;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + durationS);
  osc.start(t);
  osc.stop(t + durationS + 0.02);
}
