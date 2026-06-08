/**
 * KI-01 mitigation: Chrome throttles the offscreen document once it's gone
 * ~30s without user-gesture-adjacent activity, which can silently kill the
 * wake-word listener's SpeechRecognition/Porcupine instance. We can't detect
 * "silently dead" directly, so the periodic keepalive alarm force-restarts
 * the offscreen wake-word listener whenever it's safe to do so (voice mode,
 * enabled, and not mid-command) - cheap insurance against the throttle.
 *
 * Pulled out as a pure predicate so the restart *decision* is unit-testable
 * without a real Chrome runtime; the actual chrome.* calls stay in index.ts.
 */
import type { CursorState, InputMode } from '@shared/types';

export function shouldRearmWakeWord(enabled: boolean, mode: InputMode, state: CursorState): boolean {
  return enabled && mode === 'voice' && state === 'idle';
}
