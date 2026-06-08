import { describe, expect, it } from 'vitest';
import { formatTranscriptTimestamp } from '../src/shared/transcript-timestamp';

describe('voice transcript timestamps', () => {
  it('formats local time with seconds and leading zeroes', () => {
    expect(formatTranscriptTimestamp(new Date(2026, 6, 20, 9, 5, 7))).toBe('[09:05:07]');
  });
});
