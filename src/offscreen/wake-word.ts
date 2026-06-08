/**
 * Porcupine wake-word detection, running locally via WASM. No audio leaves the
 * device - Porcupine processes the mic stream in-worker and only emits a
 * keyword-detected event.
 *
 * NOTE - stand-in keyword: the bespoke "Hey ARIA" model isn't generated yet, so
 * we use the built-in "Blueberry" keyword as a placeholder (per the build spec).
 * Swap to a custom .ppn model + keyword label once trained in the Picovoice
 * console. The Porcupine params file must exist at the publicPath below.
 */
import { BuiltInKeyword, PorcupineWorker } from '@picovoice/porcupine-web';
import { WebVoiceProcessor } from '@picovoice/web-voice-processor';

// Path is resolved by chrome-extension://<id>/ at runtime (web_accessible_resource).
const PORCUPINE_MODEL_PATH = '/public/porcupine-model/porcupine_params.pv';

export class WakeWord {
  private worker: PorcupineWorker | null = null;
  private running = false;

  constructor(
    private accessKey: string,
    private onWake: () => void,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.worker = await PorcupineWorker.create(
      this.accessKey,
      // STAND-IN: replace with { label, publicPath } of a custom "Hey ARIA" .ppn.
      BuiltInKeyword.Blueberry,
      (detection) => {
        if (detection.index >= 0) this.onWake();
      },
      { publicPath: PORCUPINE_MODEL_PATH },
    );
    await WebVoiceProcessor.subscribe(this.worker);
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    if (this.worker) {
      await WebVoiceProcessor.unsubscribe(this.worker);
      this.worker.terminate();
      this.worker = null;
    }
    this.running = false;
  }

  /** Pause mic processing during STT so Porcupine doesn't fight Web Speech. */
  async pause(): Promise<void> {
    if (this.worker) await WebVoiceProcessor.unsubscribe(this.worker);
  }

  async resume(): Promise<void> {
    if (this.worker && this.running) await WebVoiceProcessor.subscribe(this.worker);
  }
}
