/**
 * In-memory response cache for Claude API calls.
 * Keyed by (command + URL), valid for 5 minutes.
 * Prevents double-charging for accidental repeat commands.
 */
import type { ClaudeResult } from './claude';

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  result: ClaudeResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getCachedResponse(command: string, url: string): ClaudeResult | null {
  const key = cacheKey(command, url);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

export function setCachedResponse(command: string, url: string, result: ClaudeResult): void {
  if (!result.ok) return; // Don't cache errors.
  const key = cacheKey(command, url);
  cache.set(key, { result, expiresAt: Date.now() + TTL_MS });
  // Bound cache size to 100 entries.
  if (cache.size > 100) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

function cacheKey(command: string, url: string): string {
  return `${command.toLowerCase().trim()}|${url}`;
}
