import { describe, expect, it } from 'vitest';
import { wordErrorRate } from '../src/shared/transcript-metrics';

describe('word error rate', () => {
  it('returns zero for equivalent normalized transcripts', () => {
    expect(wordErrorRate('Open GitHub, please.', 'open github please')).toBe(0);
  });

  it('keeps apostrophes only when they are internal to a word', () => {
    expect(wordErrorRate("Don't stop.", "don't stop")).toBe(0);
    expect(wordErrorRate("don't", 'do not')).toBe(2);
  });

  it('counts substitutions, deletions, and insertions', () => {
    expect(wordErrorRate('one two three', 'one too three')).toBeCloseTo(1 / 3);
    expect(wordErrorRate('one two three', 'one three')).toBeCloseTo(1 / 3);
    expect(wordErrorRate('one two', 'one small two')).toBeCloseTo(1 / 2);
  });

  it('handles empty input', () => {
    expect(wordErrorRate('', '')).toBe(0);
    expect(wordErrorRate('', 'unexpected')).toBe(1);
    expect(wordErrorRate('expected', '')).toBe(1);
  });
});
