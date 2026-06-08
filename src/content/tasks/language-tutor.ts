/**
 * Language Tutor Mode
 * Reads text on the current page and translates sentence by sentence via Claude.
 * Speaks both the original and the translation.
 * "repeat that" replays the last sentence pair.
 */
import { extractMainText } from '../page-context';
import type { Speech } from '../speech';
import type { Hud } from '../hud';
import { requestClaude } from '../../background/claude';
import { loadSettings } from '@shared/settings';

let lastPair: { original: string; translated: string } | null = null;
let isRunning = false;

export async function runLanguageTutor(targetLang: string, speech: Speech, hud: Hud): Promise<void> {
  const text = extractMainText().slice(0, 3000);
  if (!text) {
    await speech.speak("I couldn't find readable content on this page.");
    return;
  }

  const sentences = text.match(/[^.!?]+[.!?]+|\S+$/g) ?? [];
  if (sentences.length === 0) {
    await speech.speak("Not enough sentences to tutor on this page.");
    return;
  }

  const settings = await loadSettings();
  isRunning = true;

  await speech.speak(`Language tutor started. I'll read each sentence in English, then ${targetLang}. Say "stop" to end or "repeat" to replay.`);

  for (let i = 0; i < Math.min(sentences.length, 20); i++) {
    if (!isRunning) break;
    const original = sentences[i].trim();
    if (original.length < 10) continue;

    hud.setCommand(`Sentence ${i + 1}/${Math.min(sentences.length, 20)}: translating…`);

    const result = await requestClaude(
      settings.apiKey,
      `You are a language tutor. Translate the given sentence to ${targetLang}. Return ONLY the translation, no other text.`,
      original,
    );

    const translated = (result.ok && result.text ? result.text.trim() : '[Translation unavailable]');
    lastPair = { original, translated };

    hud.setCommand(`${original.slice(0, 60)}`);
    await speech.speak(original);
    await delay(500);
    await speech.speak(translated);
    await delay(1500);
  }

  if (isRunning) {
    await speech.speak("Language tutor session complete.");
    hud.setCommand('Language tutor done');
    isRunning = false;
  }
}

export async function repeatLastTutorSentence(speech: Speech): Promise<void> {
  if (!lastPair) {
    await speech.speak("Nothing to repeat yet.");
    return;
  }
  await speech.speak(lastPair.original);
  await delay(500);
  await speech.speak(lastPair.translated);
}

export function stopLanguageTutor(): void {
  isRunning = false;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
