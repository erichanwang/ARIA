/**
 * On-device STT (src/offscreen/stt.ts):
 * - the endpointer collects pre-roll + speech + trailing silence from
 *   web-voice-processor frames and hands one Float32Array to Whisper;
 * - a silent window ends in onError('no-speech') so the wake word resumes;
 * - transformers.js is configured to load only from the extension's own
 *   files (no Hugging Face hub, no CDN wasm), which is the privacy claim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories are hoisted above imports, so everything they touch must
// be created with vi.hoisted().
const h = vi.hoisted(() => {
  const pipelineCalls: unknown[][] = [];
  const state: { transcribed: Float32Array | null; engine: Engine | null } = { transcribed: null, engine: null };
  type Engine = { onmessage: (e: { data: { command: string; inputFrame: Int16Array } }) => void };
  const fakeEnv = {
    allowRemoteModels: true,
    allowLocalModels: true,
    localModelPath: '/models/',
    useBrowserCache: true,
    useWasmCache: true,
    backends: { onnx: { wasm: {} as Record<string, unknown> } },
  };
  const pipeline = vi.fn(async (...args: unknown[]) => {
    pipelineCalls.push(args);
    return async (audio: Float32Array) => {
      state.transcribed = audio;
      return { text: '  Open settings. ' };
    };
  });
  const subscribe = vi.fn(async (e: Engine) => { state.engine = e; });
  const unsubscribe = vi.fn(async () => { state.engine = null; });
  return { pipelineCalls, state, fakeEnv, pipeline, subscribe, unsubscribe };
});
const { pipelineCalls, state, fakeEnv, subscribe, unsubscribe } = h;
vi.mock('@huggingface/transformers', () => ({ env: h.fakeEnv, pipeline: h.pipeline }));
vi.mock('@picovoice/web-voice-processor', () => ({
  WebVoiceProcessor: { subscribe: h.subscribe, unsubscribe: h.unsubscribe },
}));

(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { getURL: (p: string) => `chrome-extension://aria-test/${p}` },
};

import { Stt, loadTranscriber } from '../src/offscreen/stt';

const FRAME = 512;
function frame(amplitude: number): Int16Array {
  const f = new Int16Array(FRAME);
  for (let i = 0; i < FRAME; i++) f[i] = Math.round(amplitude * 32767 * Math.sin(i / 3));
  return f;
}
function feed(amplitude: number, n: number): void {
  for (let i = 0; i < n; i++) state.engine?.onmessage({ data: { command: 'process', inputFrame: frame(amplitude) } });
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  pipelineCalls.length = 0;
  state.transcribed = null;
  state.engine = null;
  subscribe.mockClear();
  unsubscribe.mockClear();
});

describe('Stt (on-device Whisper)', () => {
  it('endpoints an utterance and emits the trimmed transcript', async () => {
    const onFinal = vi.fn();
    const onError = vi.fn();
    const stt = new Stt({ onInterim: vi.fn(), onFinal, onError });
    stt.start(8000);
    await flush();
    expect(subscribe).toHaveBeenCalledTimes(1);

    feed(0.0005, 8); // warm-up: noise floor
    feed(0.0005, 4); // more ambient silence (only the last 10 frames are kept as pre-roll)
    feed(0.3, 20); // speech, 640 ms
    feed(0.0005, 22); // 704 ms of silence -> end of utterance
    await flush();
    await flush();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onFinal).toHaveBeenCalledWith('Open settings.', 'en-US');
    // pre-roll (10 frames, the last being the onset) + 19 more speech + 22 silence
    expect(state.transcribed!.length).toBe((10 + 19 + 22) * FRAME);
    expect(Math.max(...Array.from(state.transcribed!.slice(9 * FRAME, 10 * FRAME)))).toBeCloseTo(0.3, 1);
  });

  it('reports no-speech when the window closes without speech', async () => {
    vi.useFakeTimers();
    const onFinal = vi.fn();
    const onError = vi.fn();
    const stt = new Stt({ onInterim: vi.fn(), onFinal, onError });
    stt.start(3000);
    await Promise.resolve();
    feed(0.0005, 30);
    vi.advanceTimersByTime(3000);
    vi.useRealTimers();
    await flush();
    expect(onFinal).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('no-speech');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(pipelineCalls).toHaveLength(0);
  });

  it('loads Whisper only from extension-local files, never a hub or CDN', async () => {
    await loadTranscriber();
    expect(fakeEnv.allowRemoteModels).toBe(false);
    expect(fakeEnv.useWasmCache).toBe(false);
    expect(fakeEnv.localModelPath).toBe('chrome-extension://aria-test/public/models/');
    const wasm = fakeEnv.backends.onnx.wasm as { wasmPaths: { mjs: string; wasm: string }; numThreads: number };
    expect(wasm.wasmPaths.mjs).toMatch(/^chrome-extension:\/\/aria-test\/public\/ort\//);
    expect(wasm.wasmPaths.wasm).toMatch(/^chrome-extension:\/\/aria-test\/public\/ort\//);
    expect(wasm.numThreads).toBe(1);
    // The pipeline is memoised across tests, so look at the first-ever call.
    expect(h.pipeline.mock.calls[0]?.[0]).toBe('automatic-speech-recognition');
    expect(h.pipeline.mock.calls[0]?.[1]).toBe('whisper-base.en');
  });
});
