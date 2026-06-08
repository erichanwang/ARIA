/**
 * Text-to-speech wrapper around the page's Web Speech Synthesis API.
 *
 * Why in the content script (not chrome.tts / offscreen)? read_aloud needs to
 * highlight each sentence in the DOM as it is spoken, which requires the TTS
 * boundary events to be co-located with the page. A simple queue prevents
 * overlapping utterances (e.g. an answer speaking over a read-aloud).
 */
export interface TtsOptions {
  rate?: number;
  voiceURI?: string | null;
  /** Called when an utterance starts speaking. */
  onStart?: () => void;
  /** Called when an utterance finishes (or is cancelled). */
  onEnd?: () => void;
  /** Called at each word boundary with the word text and its char offset. */
  onWordBoundary?: (word: string, charIndex: number) => void;
}

export class Speech {
  private synth = window.speechSynthesis;
  private queue: SpeechSynthesisUtterance[] = [];
  private speaking = false;
  private rate = 1.0;
  private voiceURI: string | null = null;

  configure(opts: { rate?: number; voiceURI?: string | null }): void {
    if (opts.rate !== undefined) this.rate = clamp(opts.rate, 0.5, 2.0);
    if (opts.voiceURI !== undefined) this.voiceURI = opts.voiceURI;
  }

  /** Queue a sentence to be spoken. Resolves when it finishes. */
  speak(text: string, opts: TtsOptions = {}): Promise<void> {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = opts.rate ?? this.rate;
      // If a user voice is configured, use it. Otherwise try to find a
      // language-appropriate voice using the Intl.Segmenter script heuristic.
      const voice = this.resolveVoice(opts.voiceURI ?? this.voiceURI)
        ?? this.resolveVoiceForText(text);
      if (voice) u.voice = voice;
      u.onstart = () => opts.onStart?.();
      if (opts.onWordBoundary) {
        u.onboundary = (e: SpeechSynthesisEvent) => {
          if (e.name !== 'word') return;
          const word = text.slice(e.charIndex, e.charIndex + (e.charLength ?? 12)).replace(/\W+$/, '');
          opts.onWordBoundary!(word, e.charIndex);
        };
      }
      u.onend = () => {
        opts.onEnd?.();
        resolve();
        this.next();
      };
      u.onerror = () => {
        opts.onEnd?.();
        resolve();
        this.next();
      };
      this.queue.push(u);
      this.pump();
    });
  }

  /** Speak immediately, cancelling anything queued/in-flight. */
  interrupt(text: string, opts: TtsOptions = {}): Promise<void> {
    this.cancel();
    return this.speak(text, opts);
  }

  cancel(): void {
    this.queue = [];
    this.speaking = false;
    this.synth.cancel();
  }

  isBusy(): boolean {
    return this.speaking || this.queue.length > 0;
  }

  private pump(): void {
    if (this.speaking) return;
    this.next();
  }

  private next(): void {
    const u = this.queue.shift();
    if (!u) {
      this.speaking = false;
      return;
    }
    this.speaking = true;
    this.synth.speak(u);
  }

  private resolveVoice(uri: string | null): SpeechSynthesisVoice | null {
    if (!uri) return null;
    return this.synth.getVoices().find((v) => v.voiceURI === uri) ?? null;
  }

  /**
   * Heuristic: detect the dominant script in the text and find a matching
   * system voice. Falls back to null (browser default) if none found.
   */
  private resolveVoiceForText(text: string): SpeechSynthesisVoice | null {
    const lang = detectLang(text);
    if (!lang) return null;
    const voices = this.synth.getVoices();
    return voices.find((v) => v.lang.startsWith(lang)) ?? null;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Very lightweight script-based language tag guess (not a full Intl.Segmenter). */
function detectLang(text: string): string | null {
  const cjk = (text.match(/[一-鿿㐀-䶿]/g) ?? []).length;
  const jpKana = (text.match(/[぀-ゟ゠-ヿ]/g) ?? []).length;
  const korean = (text.match(/[가-힯]/g) ?? []).length;
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const devanagari = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  const thai = (text.match(/[฀-๿]/g) ?? []).length;
  const total = text.replace(/\s/g, '').length || 1;
  if (jpKana / total > 0.1) return 'ja';
  if (korean / total > 0.1) return 'ko';
  if (cjk / total > 0.1) return 'zh';
  if (arabic / total > 0.1) return 'ar';
  if (devanagari / total > 0.1) return 'hi';
  if (thai / total > 0.1) return 'th';
  return null;
}
