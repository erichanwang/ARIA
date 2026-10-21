/**
 * On-device speech-to-text. Whisper (onnx-community/whisper-base.en, fp32 --
 * the same model and dtype the desktop app and `npm run eval:stt` use) runs
 * inside this offscreen document via @huggingface/transformers on the ONNX
 * Runtime WASM backend. Nothing leaves the machine: model, tokenizer and the
 * ORT wasm are vendored under public/ by scripts/download-assets.mjs and
 * loaded through chrome.runtime.getURL, remote model loading is switched off,
 * and the extension CSP would block a CDN fetch anyway.
 *
 * Audio comes from @picovoice/web-voice-processor, which already fronts the
 * wake-word engine: 16 kHz mono Int16 frames of 512 samples (32 ms). An RMS
 * energy endpointer decides when the command has ended, then the utterance is
 * transcribed in one shot. Whisper is not a streaming model, so there is no
 * interim text; onInterim is kept on the handler type for API compatibility.
 */
import { WebVoiceProcessor } from '@picovoice/web-voice-processor';
import { env, pipeline } from '@huggingface/transformers';

/** Directory name under public/models/ (see scripts/download-assets.mjs). */
const MODEL = 'whisper-base.en';
const SAMPLE_RATE = 16_000;

// Endpointer knobs. Frames are 512 samples = 32 ms.
const WARMUP_FRAMES = 8; // 256 ms of ambient audio to estimate the noise floor
const PRE_ROLL_FRAMES = 10; // 320 ms kept from before onset so the first syllable is not clipped
const MIN_SPEECH_MS = 400;
const END_SILENCE_MS = 700;
const MAX_UTTERANCE_MS = 10_000;
// ponytail: fixed threshold clamp; expose as a setting if a quiet or hot mic needs tuning
const MIN_THRESHOLD = 0.004;
const MAX_THRESHOLD = 0.02;

type Transcriber = (audio: Float32Array) => Promise<{ text: string } | { text: string }[]>;
type Frame = { command?: string; inputFrame: Int16Array };
type Engine = { onmessage: (e: MessageEvent<Frame>) => void };

function assetUrl(p: string): string {
  return typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL(p) : p;
}

let transcriberPromise: Promise<Transcriber> | null = null;

/** Load (once) the bundled Whisper pipeline. Safe to call early to warm up. */
export function loadTranscriber(): Promise<Transcriber> {
  if (!transcriberPromise) {
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = assetUrl('public/models/');
    env.useBrowserCache = false; // files are already local to the extension
    // transformers.js would otherwise fetch the ORT factory from jsdelivr and
    // import it as a blob: URL; both are blocked by the extension CSP.
    env.useWasmCache = false;
    const wasm = env.backends.onnx.wasm as { wasmPaths?: unknown; numThreads?: number };
    wasm.wasmPaths = {
      mjs: assetUrl('public/ort/ort-wasm-simd-threaded.asyncify.mjs'),
      wasm: assetUrl('public/ort/ort-wasm-simd-threaded.asyncify.wasm'),
    };
    wasm.numThreads = 1; // no SharedArrayBuffer without cross-origin isolation
    transcriberPromise = (
      pipeline('automatic-speech-recognition', MODEL, {
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'fp32' },
        device: 'wasm',
      }) as unknown as Promise<Transcriber>
    ).catch((e: unknown) => {
      transcriberPromise = null;
      throw e;
    });
  }
  return transcriberPromise;
}

export interface SttHandlers {
  onInterim: (text: string) => void;
  /** Called with the final transcript and the BCP-47 lang tag used for recognition. */
  onFinal: (text: string, lang: string) => void;
  onError: (err: string) => void;
}

export class Stt {
  private engine: Engine | null = null;
  private timer: number | null = null;
  private frames: Float32Array[] = []; // pre-roll ring, then the utterance
  private warmup: number[] = [];
  private noiseFloor = 0.0005;
  private inSpeech = false;
  private speechMs = 0;
  private silenceMs = 0;
  private done = false;

  constructor(private handlers: SttHandlers) {}

  static isSupported(): boolean {
    return typeof WebAssembly !== 'undefined';
  }

  /** Start loading the model so the first command does not pay for it. */
  static preload(): void {
    loadTranscriber().catch(() => {});
  }

  /** Capture a single command. Auto-stops after windowMs of total time. */
  start(windowMs: number): void {
    const engine: Engine = {
      onmessage: (e) => {
        if (e.data?.command === 'process') this.onFrame(e.data.inputFrame);
      },
    };
    this.engine = engine;
    WebVoiceProcessor.subscribe(engine).catch((e: Error) => this.fail(`mic: ${e.message}`));
    this.timer = self.setTimeout(() => this.stop(), windowMs);
  }

  /** End capture and transcribe whatever was heard. */
  stop(): void {
    if (this.done) return;
    this.done = true;
    this.clearTimer();
    this.release();
    if (!this.inSpeech || this.speechMs < MIN_SPEECH_MS) {
      this.frames = [];
      this.handlers.onError('no-speech');
      return;
    }
    void this.transcribe();
  }

  private onFrame(frame: Int16Array): void {
    if (this.done) return;
    const f = new Float32Array(frame.length);
    let energy = 0;
    for (let i = 0; i < frame.length; i++) {
      const s = frame[i] / 32768;
      f[i] = s;
      energy += s * s;
    }
    const rms = Math.sqrt(energy / frame.length);
    const ms = (frame.length / SAMPLE_RATE) * 1000;

    if (!this.inSpeech) {
      this.frames.push(f);
      if (this.frames.length > PRE_ROLL_FRAMES) this.frames.shift();
      if (this.warmup.length < WARMUP_FRAMES) {
        this.warmup.push(rms);
        if (this.warmup.length === WARMUP_FRAMES) {
          const sorted = [...this.warmup].sort((a, b) => a - b);
          this.noiseFloor = Math.max(0.0002, sorted[Math.floor(sorted.length * 0.75)]);
        }
        return;
      }
      if (rms < this.threshold()) {
        this.noiseFloor = this.noiseFloor * 0.98 + rms * 0.02;
        return;
      }
      this.inSpeech = true; // this frame is already in the ring as the onset
      this.speechMs = ms;
      return;
    }

    this.frames.push(f);
    this.speechMs += ms;
    this.silenceMs = rms < this.threshold() ? this.silenceMs + ms : 0;
    if ((this.silenceMs >= END_SILENCE_MS && this.speechMs >= MIN_SPEECH_MS) || this.speechMs >= MAX_UTTERANCE_MS) {
      this.stop();
    }
  }

  private threshold(): number {
    return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, this.noiseFloor * 2));
  }

  private async transcribe(): Promise<void> {
    const total = this.frames.reduce((n, f) => n + f.length, 0);
    const audio = new Float32Array(total);
    let offset = 0;
    for (const f of this.frames) {
      audio.set(f, offset);
      offset += f.length;
    }
    this.frames = [];
    try {
      const transcriber = await loadTranscriber();
      const out = await transcriber(audio);
      const text = (Array.isArray(out) ? out[0]?.text : out.text)?.trim() ?? '';
      if (!text) {
        this.handlers.onError('no-speech');
        return;
      }
      // whisper-base.en is English-only, so the tag is fixed rather than navigator.language.
      this.handlers.onFinal(text, 'en-US');
    } catch (e) {
      this.handlers.onError((e as Error).message);
    }
  }

  private fail(err: string): void {
    if (this.done) return;
    this.done = true;
    this.clearTimer();
    this.release();
    this.handlers.onError(err);
  }

  private release(): void {
    if (this.engine) {
      void WebVoiceProcessor.unsubscribe(this.engine);
      this.engine = null;
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
