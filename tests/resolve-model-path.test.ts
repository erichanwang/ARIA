/**
 * KI-02 regression test: face/hand landmarker models should load from the
 * bundled local path when present, and fall back to the Google CDN URL
 * (which MediaPipe fetches itself, cached by the normal HTTP cache) when the
 * local .task file wasn't bundled/downloaded.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveModelPath } from '../src/offscreen/vision';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveModelPath (KI-02)', () => {
  it('uses the local path when the file exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
    const result = await resolveModelPath('/public/models/face_landmarker.task', 'https://cdn.example/face.task');
    expect(result).toBe('/public/models/face_landmarker.task');
  });

  it('falls back to the CDN URL when the local file 404s', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const result = await resolveModelPath('/public/models/face_landmarker.task', 'https://cdn.example/face.task');
    expect(result).toBe('https://cdn.example/face.task');
  });

  it('falls back to the CDN URL when the local fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network error'); }));
    const result = await resolveModelPath('/public/models/hand_landmarker.task', 'https://cdn.example/hand.task');
    expect(result).toBe('https://cdn.example/hand.task');
  });
});
