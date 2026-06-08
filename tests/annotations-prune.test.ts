/**
 * KI-13 regression test: annotations accumulated indefinitely with no
 * cleanup. pruneAnnotations() must drop entries older than the TTL and cap
 * the list to the most recent MAX_PER_HOSTNAME entries.
 */
import { describe, it, expect } from 'vitest';
import { pruneAnnotations } from '../src/content/annotations';

function makeAnn(createdAt: number) {
  return { url: 'https://example.com', path: 'div', note: 'n', x: 0, y: 0, createdAt };
}

describe('pruneAnnotations (KI-13)', () => {
  const now = 1_000_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;

  it('drops annotations older than 90 days', () => {
    const anns = [makeAnn(now - 91 * DAY), makeAnn(now - 10 * DAY)];
    const pruned = pruneAnnotations(anns, now);
    expect(pruned).toHaveLength(1);
    expect(pruned[0].createdAt).toBe(now - 10 * DAY);
  });

  it('caps to the most recent 50 when over the limit', () => {
    const anns = Array.from({ length: 60 }, (_, i) => makeAnn(now - i * 1000));
    const pruned = pruneAnnotations(anns, now);
    expect(pruned).toHaveLength(50);
    // Keeps the most recent (last 50 in insertion order), oldest one dropped.
    expect(pruned[0]).toEqual(anns[10]);
  });

  it('leaves a small, fresh list untouched', () => {
    const anns = [makeAnn(now - 5000), makeAnn(now - 1000)];
    expect(pruneAnnotations(anns, now)).toEqual(anns);
  });
});
