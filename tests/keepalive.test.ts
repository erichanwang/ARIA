/**
 * KI-01 mitigation test: the offscreen wake-word listener should only be
 * force-restarted by the keepalive alarm when ARIA is enabled, in voice
 * mode, and idle - never mid-command, and never in eye/hand mode.
 */
import { describe, it, expect } from 'vitest';
import { shouldRearmWakeWord } from '../src/background/keepalive';

describe('shouldRearmWakeWord (KI-01)', () => {
  it('rearms when enabled, voice mode, and idle', () => {
    expect(shouldRearmWakeWord(true, 'voice', 'idle')).toBe(true);
  });

  it('does not rearm when disabled', () => {
    expect(shouldRearmWakeWord(false, 'voice', 'idle')).toBe(false);
  });

  it('does not rearm in eye or hand mode', () => {
    expect(shouldRearmWakeWord(true, 'eye', 'idle')).toBe(false);
    expect(shouldRearmWakeWord(true, 'hand', 'idle')).toBe(false);
  });

  it('does not rearm mid-command (listening/thinking/acting)', () => {
    expect(shouldRearmWakeWord(true, 'voice', 'listening')).toBe(false);
    expect(shouldRearmWakeWord(true, 'voice', 'thinking')).toBe(false);
    expect(shouldRearmWakeWord(true, 'voice', 'acting')).toBe(false);
  });
});
