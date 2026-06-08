/**
 * Debate Me Mode
 * Claude argues the opposite of whatever position the user states.
 * Voice back-and-forth debate format.
 */
import type { Speech } from '../speech';
import type { Hud } from '../hud';
import { requestClaude } from '../../background/claude';
import { loadSettings } from '@shared/settings';

export async function runDebateMode(topic: string, speech: Speech, hud: Hud): Promise<void> {
  const settings = await loadSettings();

  await speech.speak(`Debate mode started. Topic: "${topic}". I'll argue against your position. State your view and I'll counter.`);
  hud.setCommand(`Debate: ${topic}`);

  const systemPrompt = `You are a skilled debate opponent. The user gives a position and you argue the OPPOSITE position convincingly. Be concise — 2-3 sentences max per response. Be respectful but persuasive. Never agree with the user. Always challenge their argument with a counterpoint.`;

  await speech.speak(`What's your position on "${topic}"?`);

  // Debate runs in a loop driven by subsequent voice commands in the orchestrator.
  // Here we set up the context and give the initial counter.
  const intro = await requestClaude(
    settings.apiKey,
    systemPrompt,
    `The topic is: "${topic}". Give a compelling opening argument for your side (opposing the user's typical stance). 2-3 sentences.`,
  );

  if (intro.ok && intro.text) {
    const counterText = extractPlainText(intro.text);
    hud.setCommand(`ARIA argues: ${counterText.slice(0, 80)}`);
    await speech.speak(counterText);
  }
}

function extractPlainText(text: string): string {
  // Strip any JSON that Claude might return.
  const jsonMatch = /\{[\s\S]*\}/.exec(text);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      return (obj.speech ?? obj.text ?? text).replace(/\{.*\}/s, '').trim();
    } catch { /* not JSON */ }
  }
  return text.trim().slice(0, 500);
}
