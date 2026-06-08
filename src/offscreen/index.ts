/**
 * Offscreen document entry. The only context allowed to touch the microphone
 * (and later the camera) under MV3. Runs Porcupine wake-word detection and
 * Web Speech STT, relaying events to the background service worker.
 *
 * Lifecycle is driven entirely by messages from the background SW:
 *   START_LISTENING → boot mic + wake word
 *   STOP_LISTENING  → tear everything down
 *   START_STT       → capture one command (after a wake)
 */
import { WakeWord } from './wake-word';
import { SoftWakeWord } from './soft-wake-word';
import { Stt } from './stt';
import { Vision } from './vision';
import { AriaMessage, isForMe, sendRuntime } from '@shared/messages';

let wakeWord: WakeWord | SoftWakeWord | null = null;
let stt: Stt | null = null;
const vision = new Vision();

function reportStatus(wakeWordReady: boolean, micActive: boolean, error: string | null): void {
  sendRuntime({ type: 'OFFSCREEN_STATUS', target: 'background', wakeWordReady, micActive, error });
}

chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (!isForMe(msg, 'offscreen')) return;
  const m = msg as AriaMessage;

  switch (m.type) {
    case 'START_LISTENING':
      void startListening(m.accessKey, m.wakePhrase);
      return;
    case 'STOP_LISTENING':
      void stopListening();
      return;
    case 'START_STT':
      startStt(m.windowMs);
      return;
    case 'START_VISION':
      vision.start(m.tracker).catch((e) =>
        reportStatus(wakeWord?.isRunning() ?? false, true, `vision: ${(e as Error).message}`),
      );
      return;
    case 'STOP_VISION':
      void vision.stop();
      return;
  }
});

async function startListening(accessKey: string, wakePhrase?: string): Promise<void> {
  if (wakeWord?.isRunning()) return;
  // Use Porcupine if an access key is provided; fall back to soft SpeechRecognition matching.
  if (accessKey) {
    try {
      wakeWord = new WakeWord(accessKey, onWake);
      await (wakeWord as WakeWord).start();
      reportStatus(true, true, null);
      return;
    } catch (e) {
      reportStatus(false, false, `Porcupine failed, falling back to soft wake: ${(e as Error).message}`);
    }
  }
  // Soft fallback: continuous SpeechRecognition keyword match.
  const phrase = wakePhrase ?? 'hey aria';
  const soft = new SoftWakeWord(phrase, onWake);
  soft.start();
  wakeWord = soft;
  reportStatus(soft.isRunning(), true, null);
}

async function stopListening(): Promise<void> {
  stt?.stop();
  if (wakeWord instanceof WakeWord) {
    await wakeWord.stop();
  } else {
    wakeWord?.stop();
  }
  wakeWord = null;
  reportStatus(false, false, null);
}

function onWake(): void {
  // Tell the background the wake word fired; it will orchestrate STT + Claude.
  sendRuntime({ type: 'WAKE_WORD_DETECTED', target: 'background' });
}

function startStt(windowMs: number): void {
  // Pause wake word listener so it doesn't contend with Web Speech for the mic.
  if (wakeWord instanceof WakeWord) void wakeWord.pause();
  else wakeWord?.pause();

  stt = new Stt({
    onInterim: (text) =>
      sendRuntime({ type: 'TRANSCRIPT', target: 'background', transcript: text, isFinal: false }),
    onFinal: (text, lang) => {
      sendRuntime({ type: 'TRANSCRIPT', target: 'background', transcript: text, isFinal: true, lang });
      if (wakeWord instanceof WakeWord) void wakeWord.resume();
      else wakeWord?.resume();
    },
    onError: (err) => {
      reportStatus(wakeWord?.isRunning() ?? false, true, `stt: ${err}`);
      if (wakeWord instanceof WakeWord) void wakeWord.resume();
      else wakeWord?.resume();
    },
  });
  stt.start(windowMs);
}

// Announce presence on load.
reportStatus(false, false, null);
