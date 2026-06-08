/**
 * Soft wake-word fallback using continuous webkitSpeechRecognition.
 * Used when no Picovoice access key is configured or as a supplement.
 * Lower accuracy than Porcupine, but zero setup and fully customizable phrase.
 */

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>; resultIndex: number }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type Ctor = new () => SpeechRecognitionLike;

export class SoftWakeWord {
  private rec: SpeechRecognitionLike | null = null;
  private running = false;
  private phrase: string;

  constructor(phrase: string, private onWake: () => void) {
    this.phrase = phrase.toLowerCase().trim();
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    const Ctor =
      (self as unknown as { webkitSpeechRecognition?: Ctor }).webkitSpeechRecognition ??
      (self as unknown as { SpeechRecognition?: Ctor }).SpeechRecognition;
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    this.rec = rec;

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.toLowerCase();
        if (t.includes(this.phrase)) {
          this.onWake();
          return;
        }
      }
    };
    rec.onerror = (_e) => { /* ignore — restart below */ };
    rec.onend = () => {
      // Auto-restart continuous listening on unexpected end.
      if (this.running) {
        try { rec.start(); } catch (_) { /* already started */ }
      }
    };

    try { rec.start(); } catch (_) { return; }
    this.running = true;
  }

  stop(): void {
    this.running = false;
    this.rec?.stop();
    this.rec = null;
  }

  pause(): void {
    this.rec?.stop();
  }

  resume(): void {
    if (!this.running || !this.rec) return;
    try { this.rec.start(); } catch (_) { /* already started */ }
  }
}
