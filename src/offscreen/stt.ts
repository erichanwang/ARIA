/**
 * Speech-to-text via the browser's Web Speech API (webkitSpeechRecognition).
 * One-shot capture: started on wake, auto-stops on a final result or after the
 * silence window. Emits interim transcripts so the HUD can show live text.
 *
 * KNOWN CAVEAT (see status notes): webkitSpeechRecognition in an extension
 * offscreen document may be denied microphone permission in some Chrome
 * versions ('not-allowed'). If that surfaces in testing, the fallback is to run
 * STT inside the content script (page-origin mic permission). Kept here to
 * match the spec's "mic lives in offscreen" architecture.
 */

// webkitSpeechRecognition isn't in the default TS DOM lib.
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
  resultIndex: number;
}

type Ctor = new () => SpeechRecognitionLike;

export interface SttHandlers {
  onInterim: (text: string) => void;
  /** Called with the final transcript and the BCP-47 lang tag used for recognition. */
  onFinal: (text: string, lang: string) => void;
  onError: (err: string) => void;
}

export class Stt {
  private recognition: SpeechRecognitionLike | null = null;
  private timer: number | null = null;

  constructor(private handlers: SttHandlers) {}

  static isSupported(): boolean {
    return 'webkitSpeechRecognition' in self || 'SpeechRecognition' in self;
  }

  /** Capture a single command. Auto-stops after windowMs of total time. */
  start(windowMs: number): void {
    const Ctor =
      (self as unknown as { webkitSpeechRecognition?: Ctor }).webkitSpeechRecognition ??
      (self as unknown as { SpeechRecognition?: Ctor }).SpeechRecognition;
    if (!Ctor) {
      this.handlers.onError('SpeechRecognition unavailable');
      return;
    }

    const rec = new Ctor();
    // Use the browser's system language so non-English users get native STT.
    rec.lang = (typeof navigator !== 'undefined' ? navigator.language : null) ?? 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    const usedLang = rec.lang;
    let finalText = '';
    let finalEmitted = false;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) finalText += transcript;
        else interim += transcript;
      }
      if (interim) this.handlers.onInterim(interim);
      if (finalText && !finalEmitted) {
        finalEmitted = true;
        this.handlers.onFinal(finalText.trim(), usedLang);
      }
    };
    rec.onerror = (e) => this.handlers.onError(e.error);
    rec.onend = () => {
      this.clearTimer();
      if (finalText.trim() && !finalEmitted) this.handlers.onFinal(finalText.trim(), usedLang);
    };

    this.recognition = rec;
    try {
      rec.start();
    } catch (e) {
      this.handlers.onError((e as Error).message);
      return;
    }
    this.timer = self.setTimeout(() => this.stop(), windowMs);
  }

  stop(): void {
    this.clearTimer();
    this.recognition?.stop();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
