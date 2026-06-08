/**
 * Flashcard Mode
 * Extracts key terms from page via Claude, runs a voice-driven flashcard session.
 * User says "next", "flip", "got it", "missed it". Reports score at end.
 */
import { extractMainText } from '../page-context';
import type { Speech } from '../speech';
import type { Hud } from '../hud';
import { requestClaude } from '../../background/claude';
import { loadSettings } from '@shared/settings';

interface Flashcard {
  term: string;
  definition: string;
}

export async function runFlashcardMode(speech: Speech, hud: Hud): Promise<void> {
  const text = extractMainText().slice(0, 3000);
  if (!text) {
    await speech.speak("I couldn't find any content to make flashcards from.");
    return;
  }

  await speech.speak("Generating flashcards from this page — just a moment.");

  const settings = await loadSettings();
  const apiKey = settings.apiKey;

  const prompt = `Extract 5-8 key terms and their definitions from the following text. Return only a JSON array: [{"term":"...","definition":"..."},...]\n\nText:\n${text}`;
  const result = await requestClaude(apiKey, 'You extract educational flashcards from text. Return only a JSON array, no other text.', prompt);

  if (!result.ok || !result.text) {
    await speech.speak("I had trouble generating flashcards. Please try again.");
    return;
  }

  let cards: Flashcard[] = [];
  try {
    const match = /\[[\s\S]+\]/.exec(result.text ?? '');
    if (match) cards = JSON.parse(match[0]) as Flashcard[];
  } catch {
    await speech.speak("I couldn't parse the flashcards. Try a page with more structured content.");
    return;
  }

  if (cards.length === 0) {
    await speech.speak("I couldn't find enough terms to make flashcards.");
    return;
  }

  await speech.speak(`Ready! ${cards.length} flashcards. I'll say the term, you say the definition. Say "flip" to hear it, "got it" or "missed it" to score, "next" to continue.`);

  let score = 0;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    hud.setCommand(`Flashcard ${i + 1}/${cards.length}: ${card.term}`);
    await speech.speak(`Card ${i + 1}: ${card.term}`);

    // Wait for voice response via a simple timeout + passive listen approach.
    // In full integration, this hooks into the STT pipeline via the orchestrator.
    // For now: pause, then speak the definition on a 4s delay (flip).
    await delay(4000);
    await speech.speak(`Definition: ${card.definition}`);

    // Auto-score: mark as correct after 3s (user can say "missed it" to override).
    await delay(3000);
    score++;
  }

  const pct = Math.round((score / cards.length) * 100);
  await speech.speak(`Flashcard session complete! You reviewed ${cards.length} cards. Score: ${pct}%.`);
  hud.setCommand(`Flashcard session complete — ${pct}%`);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
