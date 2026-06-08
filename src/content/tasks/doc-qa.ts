/**
 * Document Q&A
 * Loads the full page text, then runs a voice Q&A session where the user
 * asks questions and Claude answers based solely on the page content.
 */
import type { Speech } from '../speech';
import type { Hud } from '../hud';
import { extractMainText } from '../page-context';
import { requestClaude } from '../../background/claude';
import { loadSettings } from '@shared/settings';


const MAX_DOC_CHARS = 6000;

export async function runDocQA(speech: Speech, hud: Hud): Promise<void> {
  const pageText = extractMainText().slice(0, MAX_DOC_CHARS);

  if (pageText.length < 100) {
    await speech.speak("I can't find enough text on this page to answer questions about.");
    return;
  }

  await speech.speak(`Document Q&A ready. I've loaded ${Math.round(pageText.length / 100) * 100} characters from this page. Ask me anything about it.`);
  hud.setCommand('Doc Q&A — listening for your question…');
}

/** Answer a specific question about the current page's text. */
export async function answerDocQuestion(question: string, speech: Speech, hud: Hud): Promise<void> {
  const settings = await loadSettings();
  const pageText = extractMainText().slice(0, MAX_DOC_CHARS);

  hud.setCommand(`Answering: "${question.slice(0, 60)}"`);

  const systemPrompt = `Answer the following question using ONLY the provided document text. Be concise (1-3 sentences). If the answer is not in the text, say "I don't see that in the document."

Document:
${pageText}`;

  const result = await requestClaude(settings.apiKey, systemPrompt, question);
  if (result.ok && result.text) {
    const answer = extractPlainText(result.text);
    hud.setCommand(`Answer: ${answer.slice(0, 80)}`);
    await speech.speak(answer);
  } else {
    await speech.speak("I had trouble processing that question. Please try again.");
  }
}

function extractPlainText(text: string): string {
  const jsonMatch = /\{[\s\S]*\}/.exec(text);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      return (obj.speech ?? obj.text ?? obj.answer ?? text).trim();
    } catch { /* not JSON */ }
  }
  return text.trim().slice(0, 600);
}
